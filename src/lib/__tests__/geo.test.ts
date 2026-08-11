import { distanceM, formatAccuracy, formatDistance, isPlaced, orderByNearest } from '../geo';

// Real Lahore coordinates: the pin maths has to hold at the latitude the
// business actually works at, not at the equator where longitude is widest.
const ANARKALI = { lat: 31.5709, lng: 74.3086, accuracyM: 5 };
const LIBERTY = { lat: 31.5119, lng: 74.3466, accuracyM: 5 };

describe('distanceM — straight-line metres (haversine)', () => {
  test('a point is no distance from itself', () => {
    expect(distanceM(ANARKALI, ANARKALI)).toBe(0);
  });

  test('two known Lahore landmarks, ~7.3 km apart', () => {
    const d = distanceM(ANARKALI, LIBERTY);
    expect(d).toBeGreaterThan(7000);
    expect(d).toBeLessThan(7600);
  });

  test('symmetric — order of the two shops cannot change the answer', () => {
    expect(distanceM(ANARKALI, LIBERTY)).toBeCloseTo(distanceM(LIBERTY, ANARKALI), 6);
  });

  test('resolves the width of one bazaar street, which is the whole point', () => {
    // ~0.0001 degrees of latitude is about 11 m. Two shops across the road
    // from each other must not collapse to the same stop.
    const across = { lat: ANARKALI.lat + 0.0001, lng: ANARKALI.lng, accuracyM: 5 };
    const d = distanceM(ANARKALI, across);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(13);
  });

  test('one degree of latitude is ~111 km anywhere on earth', () => {
    const d = distanceM({ lat: 0, lng: 0, accuracyM: 1 }, { lat: 1, lng: 0, accuracyM: 1 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });

  test('survives antipodal input without NaN from a rounding overshoot', () => {
    const d = distanceM({ lat: 0, lng: 0, accuracyM: 1 }, { lat: 0, lng: 180, accuracyM: 1 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20000000);
  });
});

describe('formatDistance — what a person says', () => {
  test('metres round to the nearest ten below a kilometre', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(124)).toBe('120 m');
    expect(formatDistance(126)).toBe('130 m');
    expect(formatDistance(999)).toBe('1000 m');
  });

  test('kilometres above that, one decimal until it stops mattering', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(7380)).toBe('7.4 km');
    expect(formatDistance(24000)).toBe('24 km');
  });

  test('an unmeasurable distance says nothing rather than "NaN m"', () => {
    expect(formatDistance(Number.NaN)).toBe('');
  });
});

describe('formatAccuracy — how much to trust the pin', () => {
  test('a plain metre reading', () => {
    expect(formatAccuracy(8.2)).toBe('±8 m');
  });

  test('a phone that would not say does not get dressed up as perfect', () => {
    expect(formatAccuracy(Number.NaN)).toBe('accuracy unknown');
  });
});

describe('orderByNearest — the walking order for one round', () => {
  const at = (lat: number, lng: number) => ({ lat, lng, accuracyM: 5, savedAt: 0, savedBy: 'x' });
  // Named so an unpinned stop is a real member of the type rather than a weak
  // object literal TypeScript refuses to match against Placed.
  type Stop = { id: string; location?: ReturnType<typeof at> };
  // A straight line of shops heading north, deliberately handed over shuffled.
  const near = { id: 'near', location: at(31.5000, 74.3000) };
  const mid = { id: 'mid', location: at(31.5030, 74.3000) };
  const far = { id: 'far', location: at(31.5090, 74.3000) };
  const start = { lat: 31.4990, lng: 74.3000, accuracyM: 5 };

  test('walks nearest first, whatever order they arrive in', () => {
    expect(orderByNearest(start, [far, near, mid]).map(s => s.id)).toEqual(['near', 'mid', 'far']);
  });

  test('chains from the LAST stop, not from the starting point', () => {
    // Standing at `far`, the nearest is mid, and from mid the nearest is near.
    // A router that kept measuring from the start would answer near, mid.
    expect(orderByNearest(far.location, [near, mid]).map(s => s.id)).toEqual(['mid', 'near']);
  });

  test('unpinned shops are dropped, never silently parked at the end', () => {
    const ghost: Stop = { id: 'ghost' };
    const out = orderByNearest(start, [ghost, near, mid]);
    expect(out.map(s => s.id)).toEqual(['near', 'mid']);
  });

  test('an empty round, and a round with nothing pinned, both come back empty', () => {
    const nothingPinned: Stop[] = [{ id: 'a' }, { id: 'b' }];
    expect(orderByNearest(start, [])).toEqual([]);
    expect(orderByNearest(start, nothingPinned)).toEqual([]);
  });

  test('every shop appears exactly once — no stop dropped, none visited twice', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      location: at(31.5 + (i % 4) * 0.001, 74.3 + Math.floor(i / 4) * 0.001),
    }));
    const out = orderByNearest(start, many);
    expect(out).toHaveLength(12);
    expect(new Set(out.map(s => s.id)).size).toBe(12);
  });

  test('two shops on the exact same spot are both kept', () => {
    const a = { id: 'a', location: at(31.5, 74.3) };
    const b = { id: 'b', location: at(31.5, 74.3) };
    expect(orderByNearest(start, [a, b]).map(s => s.id).sort()).toEqual(['a', 'b']);
  });

  test('does not mutate the array it was given', () => {
    const input = [far, near, mid];
    orderByNearest(start, input);
    expect(input.map(s => s.id)).toEqual(['far', 'near', 'mid']);
  });
});

/**
 * `isPlaced` is the gate between a Firestore document and a native map view.
 * Firestore is spread onto Shop with no shape check and the rules validate
 * which keys may be written, never the shape of `location` — so a half-written
 * document is reachable, and one of the five native sites it feeds
 * (animateToRegion) rethrows as an uncatchable RuntimeException.
 */
describe('isPlaced — what may reach a native map', () => {
  const at = (lat: unknown, lng: unknown) =>
    ({ location: { lat, lng, accuracyM: 5, savedAt: 1, savedBy: 'u' } } as never);

  test('a real pin passes', () => {
    expect(isPlaced(at(31.52, 74.35))).toBe(true);
  });

  test('no location at all fails', () => {
    expect(isPlaced({})).toBe(false);
    expect(isPlaced({ location: undefined })).toBe(false);
  });

  test('a half-written document fails — this is the crash case', () => {
    expect(isPlaced(at(null, 74.35))).toBe(false);
    expect(isPlaced(at(31.52, undefined))).toBe(false);
    expect(isPlaced(at(undefined, undefined))).toBe(false);
  });

  test('NaN fails — it serialises to null and native getDouble throws', () => {
    expect(isPlaced(at(Number.NaN, 74.35))).toBe(false);
    expect(isPlaced(at(31.52, Number.NaN))).toBe(false);
  });

  test('Infinity fails', () => {
    expect(isPlaced(at(Number.POSITIVE_INFINITY, 0))).toBe(false);
  });

  test('a string that looks like a number fails — no coercion', () => {
    expect(isPlaced(at('31.52', '74.35'))).toBe(false);
  });

  test('out of range fails', () => {
    expect(isPlaced(at(91, 0))).toBe(false);
    expect(isPlaced(at(0, 181))).toBe(false);
  });

  test('0,0 PASSES — it is off West Africa, not invalid', () => {
    // Deliberate. Treating null island as "unset" would silently drop a real
    // pin, and no shop in this business is within a thousand miles of it.
    expect(isPlaced(at(0, 0))).toBe(true);
  });

  test('the exact bounds pass', () => {
    expect(isPlaced(at(90, 180))).toBe(true);
    expect(isPlaced(at(-90, -180))).toBe(true);
  });

  test('orderByNearest drops a malformed pin instead of routing to it', () => {
    const good = { id: 'a', location: { lat: 31.5, lng: 74.3, accuracyM: 5, savedAt: 1, savedBy: 'u' } };
    const bad = { id: 'b', location: { lat: null, lng: 74.3, accuracyM: 5, savedAt: 1, savedBy: 'u' } };
    const out = orderByNearest({ lat: 31.5, lng: 74.3, accuracyM: 5 }, [good, bad] as never[]);
    expect(out).toHaveLength(1);
    expect((out[0] as { id: string }).id).toBe('a');
  });
});
