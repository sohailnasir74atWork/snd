/**
 * The download ledger. Pure functions only — `prune` takes `now` rather than
 * reading the clock precisely so this can assert the keep window without
 * faking time.
 */
import { KEEP_DAYS, prune } from '../billLog';

const DAY = 86400_000;
const NOW = new Date(2026, 7, 11).getTime();

describe('how long a printed bill is remembered', () => {
  test('the owner asked for a week and gets rather more', () => {
    // The promise made on screen is `${KEEP_DAYS} days`. If someone shortens
    // this below seven, that promise becomes a lie and a bill starts
    // reappearing in the to-print list to be handed over twice.
    expect(KEEP_DAYS).toBeGreaterThanOrEqual(7);
  });

  test('a mark inside the window survives', () => {
    const log = { a: NOW - 6 * DAY };
    expect(prune(log, NOW)).toEqual(log);
  });

  test('a mark on the last day of the window survives', () => {
    // The boundary is inclusive, so a bill printed exactly KEEP_DAYS ago is
    // still findable rather than vanishing on an off-by-one.
    const log = { a: NOW - KEEP_DAYS * DAY };
    expect(prune(log, NOW)).toEqual(log);
  });

  test('a mark past the window is dropped', () => {
    expect(prune({ a: NOW - (KEEP_DAYS + 1) * DAY }, NOW)).toEqual({});
  });

  test('pruning one does not disturb the others', () => {
    const log = { old: NOW - 400 * DAY, fresh: NOW - DAY, now: NOW };
    expect(prune(log, NOW)).toEqual({ fresh: NOW - DAY, now: NOW });
  });

  test('an empty ledger prunes to an empty ledger, not a crash', () => {
    expect(prune({}, NOW)).toEqual({});
  });

  test('a dropped mark means the bill returns to the to-print list', () => {
    // The screen decides the tab by `log[id] === undefined`, so this IS the
    // behaviour: forgetting a bill puts it back in front of the owner. That is
    // the right way round — the cost is printing a copy twice, and the cost of
    // the opposite is a bill nobody ever prints.
    const log = prune({ b: NOW - 90 * DAY }, NOW);
    expect(log.b).toBeUndefined();
  });
});
