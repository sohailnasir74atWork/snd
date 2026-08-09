/**
 * Which van an order belongs to.
 *
 * No native import — same rule as `geo.ts` and `window.ts`. Getting this wrong
 * does not throw: it addresses an order to a rider who is not there, and
 * because a rider's Firestore read rule keys on `assignedTo == uid`, the order
 * then becomes invisible to every phone in the company. That failure is silent
 * by construction, so it gets tested.
 */
import type { Area, CompanySettings, Shop } from '../data/models';

/**
 * The ladder, most specific first:
 *
 *   1. the round the shop sits on   (`Area.riderId`)
 *   2. the company default          (`settings.defaultRiderId`)
 *   3. the pre-multi-rider setting  (`settings.autoAssignRiderId`) — migration
 *      shim so a company created under the one-rider model keeps delivering
 *      without anyone touching its settings document
 *   4. nobody
 *
 * Rung 4 is a legitimate outcome, not a failure. An order with no rider is
 * surfaced to the owner as Unassigned; the alternative — handing it to whoever
 * the settings document happens to name — is how a six-van business ends up
 * with every round's orders on one man's phone.
 *
 * Areas are matched by NAME because that is what a shop stores. The same
 * deliberate choice lets an area be renamed without rewriting orders, which
 * carry a frozen `shopSnapshot.area`.
 */
export function riderForShop(
  shop: Shop | undefined,
  areas: Area[],
  settings: Pick<CompanySettings, 'defaultRiderId' | 'autoAssignRiderId'>,
): string | null {
  const area = shop ? areas.find(a => a.name === shop.area) : undefined;
  return area?.riderId ?? settings.defaultRiderId ?? settings.autoAssignRiderId ?? null;
}

/**
 * Orders no van is carrying — booked into a round with nobody on it, or
 * addressed to someone since removed.
 *
 * `activeStaff` is the uid→name map of people still in the company; a uid
 * missing from it is a removed employee, which is the second and less obvious
 * way an order goes dark.
 */
export function unassignedOf<T extends { status: string; assignedTo?: string }>(
  orders: T[],
  activeStaff: Record<string, unknown>,
): T[] {
  return orders.filter(o =>
    (o.status === 'booked' || o.status === 'assigned') &&
    (!o.assignedTo || activeStaff[o.assignedTo] === undefined));
}

/**
 * The shops one booker is responsible for.
 *
 * Three cases, and the order of them is the design:
 *
 *   nothing configured  → everybody sees everything. A one-booker business
 *                         never opens this screen and nothing changes for it.
 *   he has rounds       → exactly his rounds, and nobody else's. Two bookers
 *                         working the same shop on the same day is the thing
 *                         territories exist to stop.
 *   others have rounds,
 *   he does not         → the rounds NOBODY covers. Never an empty screen:
 *                         a booker who arrives before the owner has assigned
 *                         him a patch still has a day's work, and shops filed
 *                         under a name with no area document (the ones Areas
 *                         surfaces as "found on shops, not on this list")
 *                         stay reachable instead of falling out of the app.
 */
export function shopsForBooker(bookerId: string, shops: Shop[], areas: Area[]): Shop[] {
  const assigned = areas.filter(a => a.bookerId);
  if (!assigned.length) return shops;

  const mine = new Set(areas.filter(a => a.bookerId === bookerId).map(a => a.name));
  if (mine.size) return shops.filter(s => mine.has(s.area));

  const covered = new Set(assigned.map(a => a.name));
  return shops.filter(s => !covered.has(s.area));
}

/**
 * How many days a full sweep of `shopCount` shops takes at `shopsPerDay`.
 *
 * The formula is unchanged; what changed is what you feed it. It used to be
 * handed EVERY shop in the company, so a distributor with 2,000 shops and the
 * default 20-a-day setting got a 100-day visit cycle — meaning a shop counted
 * as "due" only once a quarter had passed, and every booker's route screen
 * showed the same near-empty list. Fed one booker's own territory it gives the
 * answer it always meant to: his 200 shops at 20 a day is a 10-day round.
 */
export function visitCycleDays(shopCount: number, shopsPerDay: number): number {
  return Math.max(1, Math.round(shopCount / Math.max(1, shopsPerDay)));
}
