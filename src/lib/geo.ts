/**
 * Distances between points on the ground.
 *
 * Deliberately free of any native import: this is the maths that orders a
 * route, and it has to be testable and runnable without a GPS chip anywhere
 * near it. Reading the phone's own position lives in `location.ts`, which
 * imports this — never the other way round.
 */
import type { ShopLocation } from '../data/models';

export interface GeoFix {
  lat: number;
  lng: number;
  /** Metres. The radius the phone believes it is somewhere inside. */
  accuracyM: number;
}

/**
 * A fix this loose is pointing at the block, not the door.
 *
 * A bazaar street is roughly 15 m wide, so past ~30 m the pin cannot even say
 * which side of the road the shop is on. Saving it anyway is still better than
 * nothing — but the person is told, because they are the only one who can fix
 * it by walking outside and waiting ten seconds.
 */
export const POOR_ACCURACY_M = 30;

const R_METRES = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Straight-line metres between two points (haversine).
 *
 * Straight-line, not driving distance — deliberately. The road answer costs a
 * billed API call per pair, and for ordering shops inside one small area the
 * two agree often enough that paying for the difference would be silly. It is
 * used to sort a list, never to quote a distance as fact.
 */
export function distanceM(a: GeoFix | ShopLocation, b: GeoFix | ShopLocation): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  // Clamped before the root: a rounding overshoot past 1 would make asin
  // return NaN, and a NaN distance silently sorts a shop to the end forever.
  return 2 * R_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "120 m" / "1.4 km" — what a person says, not what a float looks like. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '';
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km`;
}

/** Anything carrying a pin — a Shop, in practice. */
export interface Placed {
  location?: ShopLocation;
}

/**
 * Does this thing carry a pin a map can actually draw?
 *
 * Every gate in this app used to be truthiness — `!!shop.location` — and the
 * store spreads a Firestore document straight onto a `Shop` with no shape
 * check, while the rules validate which KEYS may be written and never the
 * shape of `location`. So `{ lat: null }` is a document this app will happily
 * hand to a native map.
 *
 * What that costs, at each stage: `distanceM` returns NaN, so the shop is
 * never picked as nearest and quietly sits wherever it was; `formatDistance`
 * returns an empty string; `bearingLabel` indexes an array at NaN and the
 * guide line reads "head undefined"; and the round picker still counts the
 * shop as pinned, so the card claims every shop is on the map. Then the camera
 * animates: `animateToRegion` serialises the region to JSON, `NaN` becomes
 * `null`, and the native side's `getDouble` throws inside a catch that
 * rethrows as a RuntimeException — a crash no JavaScript can catch.
 *
 * One predicate, applied where a shop becomes a stop, removes all of it. A
 * shop that fails lands in the existing "Not on the map" list, which is
 * exactly where a broken pin belongs.
 */
export function isPlaced<T extends Placed>(s: T): s is T & { location: ShopLocation } {
  const l = s.location;
  return !!l
    && Number.isFinite(l.lat) && Number.isFinite(l.lng)
    && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180;
}

/**
 * Put the stops in the order a person would actually walk them: nearest to
 * where you are, then nearest to that, and so on.
 *
 * Greedy nearest-neighbour, not an optimal tour. A true solution to twenty
 * stops is a travelling-salesman problem, and nobody is waiting on a phone for
 * that — greedy lands within a comfortable margin on a compact round, which is
 * what an area IS. More importantly it is STABLE: the next shop is always the
 * nearest unvisited one, so a rider who skips a stop or wanders off the order
 * still gets a sensible answer instead of a re-planned route they do not
 * recognise.
 *
 * Unpinned shops are dropped entirely. They cannot be routed to, and silently
 * leaving them at the end would make the sweep claim to be finished at a shop
 * nobody could find.
 */
export function orderByNearest<T extends Placed>(from: GeoFix | ShopLocation, items: T[]): T[] {
  // isPlaced, not truthiness: this is the choke point that decides what
  // becomes a stop at all, so a malformed pin is dropped here and never
  // reaches a marker, a circle, a polyline or the camera.
  const remaining = items.filter(isPlaced);
  const ordered: T[] = [];
  let cursor: GeoFix | ShopLocation = from;
  while (remaining.length > 0) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceM(cursor, remaining[i].location);
      if (d < bestD) { bestD = d; best = i; }
    }
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    cursor = next.location;
  }
  return ordered;
}

/** "±8 m", or "accuracy unknown" when the phone would not say. */
export function formatAccuracy(accuracyM: number): string {
  if (!Number.isFinite(accuracyM)) return 'accuracy unknown';
  return `±${Math.round(accuracyM)} m`;
}
