import { WINDOW_DAYS, mergeById, windowStartDate, windowStartKey } from '../window';
import { todayKey } from '../../data/models';

// A fixed clock: 2026-08-09, the day the window was introduced.
const NOW = new Date(2026, 7, 9, 14, 30).getTime();

describe('windowStartKey', () => {
  it('is WINDOW_DAYS behind today, as a YYYY-MM-DD string', () => {
    expect(windowStartKey(NOW)).toBe(todayKey(new Date(NOW - WINDOW_DAYS * 86400_000)));
    expect(windowStartKey(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sorts lexicographically against the deliveryDate keys it is compared to', () => {
    // The whole window is a string range query, so ordering by < and > has to
    // agree with ordering by date. Zero-padding is what makes that true.
    const start = windowStartKey(NOW);
    expect(start < todayKey(new Date(NOW))).toBe(true);
    expect(start > todayKey(new Date(NOW - 200 * 86400_000))).toBe(true);
  });

  it('reaches back far enough for the widest report preset', () => {
    // "Last month" asked on the 3rd starts at the 1st of the previous month.
    const askedOnThe3rd = new Date(2026, 7, 3).getTime();
    const lastMonthStart = todayKey(new Date(2026, 6 - 1 + 1, 1)); // 2026-07-01
    expect(windowStartKey(askedOnThe3rd) < lastMonthStart).toBe(true);
  });

  it('windowStartDate agrees with windowStartKey', () => {
    expect(todayKey(windowStartDate(NOW))).toBe(windowStartKey(NOW));
  });
});

describe('mergeById', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };

  it('keeps everything from both slices', () => {
    expect(mergeById([a], [b]).map(x => x.id)).toEqual(['a', 'b']);
  });

  it('de-duplicates the overlap — a recent unpaid bill is in BOTH slices', () => {
    expect(mergeById([a, b], [b, c]).map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('prefers the primary copy, so the windowed doc wins on conflict', () => {
    const stale = { id: 'a', v: 'open' };
    const fresh = { id: 'a', v: 'window' };
    expect(mergeById([fresh], [stale])[0].v).toBe('window');
  });

  it('returns the primary array untouched when the extra adds nothing', () => {
    const primary = [a, b];
    expect(mergeById(primary, [])).toBe(primary);
    expect(mergeById(primary, [a])).toBe(primary);
  });

  it('handles either side being empty', () => {
    expect(mergeById([], [a]).map(x => x.id)).toEqual(['a']);
    expect(mergeById([a], []).map(x => x.id)).toEqual(['a']);
    expect(mergeById<{ id: string }>([], [])).toEqual([]);
  });
});
