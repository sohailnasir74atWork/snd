/**
 * How much history a phone keeps live, and how the two slices are recombined.
 *
 * No native import, on purpose — same rule as `geo.ts`. This is the arithmetic
 * that decides whether an old unpaid bill is still visible to the person
 * standing in front of the shop, so it has to be testable without a device.
 */
import { todayKey } from '../data/models';

/**
 * Ninety days, and the number is not arbitrary: Reports' widest preset is
 * "Last month", which asked on the 3rd reaches back to the 1st of the previous
 * month — 62 days. Ninety clears that with room for a slow month-end close.
 *
 * Why a window at all: every listener in `firestoreStore` used to subscribe to
 * a whole collection with no bound. That is invisible in year one and fatal in
 * year two — 40,000 orders is ~80 MB of Hermes heap held three times over
 * (Firestore's cache, the snapshot docs, the mapped state) against a 192 MB
 * budget on the phones this app actually runs on. The device dies before the
 * Firebase bill does; the bill is the second symptom, not the first.
 */
export const WINDOW_DAYS = 90;

/**
 * The oldest `deliveryDate` a windowed listener asks for, as 'YYYY-MM-DD'.
 *
 * Keyed on `deliveryDate` — a client-written string — and never on `bookedAt`,
 * which is a `serverTimestamp()`. A range filter on an unresolved server
 * timestamp does not match locally, so booking an order with no signal would
 * have dropped it out of the booker's own list the instant he wrote it. The
 * one field that is always resolved on the device is the one the window is
 * allowed to use.
 */
export function windowStartKey(now: number = Date.now()): string {
  return todayKey(new Date(now - WINDOW_DAYS * 86400_000));
}

/** The same cut as a Date, for the one collection keyed on a real timestamp. */
export function windowStartDate(now: number = Date.now()): Date {
  return new Date(now - WINDOW_DAYS * 86400_000);
}

/**
 * Union two snapshot slices, first-wins on id.
 *
 * `primary` is the windowed slice and `extra` the open one; they overlap
 * heavily (a bill delivered yesterday and still unpaid is in both), so
 * de-duplication is the whole job. Allocation-free when `extra` adds nothing,
 * which is the common case on every snapshot after the first.
 */
export function mergeById<T extends { id: string }>(primary: T[], extra: T[]): T[] {
  if (!extra.length) return primary;
  if (!primary.length) return extra;
  const have = new Set(primary.map(x => x.id));
  const rest = extra.filter(x => !have.has(x.id));
  return rest.length ? primary.concat(rest) : primary;
}
