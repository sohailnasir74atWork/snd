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
