/**
 * What a booker or a rider has earned — pure, and no native import.
 *
 * The owner sets ONE rate per role and picks how it is read: a fixed number of
 * rupees per piece, or a percentage of the sale. Both modes are here because
 * distributors genuinely run both, and a business that pays Rs 20 a piece
 * cannot express that as a percent of anything.
 *
 * `rewardPerPiece` already existed and is NOT this. That one pays the
 * shopkeeper's own counter staff for pushing the product, through reward
 * claims the owner approves one by one. This pays the distributor's own men
 * for work the app already records, and nobody claims it.
 */
import type { Order, OrderItem, Totals } from '../data/models';
import { netOfTax, totalQty } from './order';

export type CommissionMode = 'fixed' | 'percent';

export interface CommissionRate {
  mode: CommissionMode;
  /** Rupees per piece when `fixed`; percent of the sale when `percent`. */
  value: number;
}

/**
 * One order's commission.
 *
 * **Percent is taken on the sale NET OF TAX**, deliberately. Sales tax is
 * money the business collects and hands straight to the government; paying a
 * man a share of it would mean the company funds his commission out of its own
 * pocket, and the bill would quietly change what he earns the day a tax rate
 * changes. Every other sales figure in this app is net of tax for the same
 * reason.
 *
 * **Fixed is per PIECE, counted the same way the bill counts them** — delivered
 * quantities once the van has been, ordered before that. A short delivery pays
 * for what actually reached the shop.
 *
 * Rounded to whole rupees, like all money here. A rate of 0 earns 0 rather
 * than being a special case, so a company that has never set one simply sees
 * nothing.
 */
export function commissionFor(
  items: OrderItem[],
  totals: Totals | undefined,
  rate: CommissionRate,
  useDelivered: boolean,
): number {
  if (!rate.value || rate.value <= 0) return 0;
  if (rate.mode === 'fixed') return Math.round(totalQty(items, useDelivered) * rate.value);
  return Math.round((netOfTax(totals) * rate.value) / 100);
}

export interface CommissionSplit {
  /** Earned and settled: delivered AND paid in full. */
  confirmed: number;
  /** Earned on paper: booked, or delivered with money still owed. */
  unconfirmed: number;
  confirmedOrders: number;
  unconfirmedOrders: number;
}

/**
 * Is this order's commission settled?
 *
 * Delivery alone is not enough. A shop that has the goods and has not paid is
 * exactly the case the owner is carrying the risk on, and telling the booker
 * he has earned that money invites him to stop chasing it. Confirmed means the
 * goods went AND the cash came.
 *
 * Cancelled and returned orders earn nothing at all — not even unconfirmed.
 */
function isSettled(o: Order): boolean {
  return o.status === 'delivered' && o.paymentStatus === 'paid';
}

/** A person's commission across many orders, split into settled and not. */
export function commissionSplit(orders: Order[], rate: CommissionRate): CommissionSplit {
  const out: CommissionSplit = {
    confirmed: 0, unconfirmed: 0, confirmedOrders: 0, unconfirmedOrders: 0,
  };
  for (const o of orders) {
    if (o.status === 'cancelled' || o.status === 'returned') continue;
    const delivered = o.status === 'delivered';
    const amount = commissionFor(
      o.items,
      delivered ? o.billedTotals ?? o.orderedTotals : o.orderedTotals,
      rate,
      delivered,
    );
    if (isSettled(o)) { out.confirmed += amount; out.confirmedOrders += 1; }
    else { out.unconfirmed += amount; out.unconfirmedOrders += 1; }
  }
  return out;
}
