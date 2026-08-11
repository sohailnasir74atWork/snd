/**
 * Monthly targets — what a man is aiming at, and how far along he is.
 *
 * Pure, no native import. The owner sets these three ways and often more than
 * one at once, so `progressOf` takes whatever shape the target is and answers
 * the same question about all of them: done, of how many, in what unit.
 */
import type { MonthlyTarget, Order, Payment, TargetMetric } from '../data/models';
import { netOfTax, totalQty } from './order';

/**
 * What a business aims at before anybody has told it otherwise.
 *
 * 500 pieces, because a target nobody set is still better than a screen with
 * no goal on it — a booker opening My Day should see something to beat. It is
 * used only when `settings.monthlyTargets` is ABSENT; an empty array means the
 * owner turned targets off and is respected.
 */
export const DEFAULT_TARGETS: MonthlyTarget[] = [{ metric: 'pieces', value: 500 }];

export function targetsOf(stored: MonthlyTarget[] | undefined): MonthlyTarget[] {
  return stored ?? DEFAULT_TARGETS;
}

export interface TargetProgress {
  target: MonthlyTarget;
  done: number;
  /** 0–1, clamped. A target of 0 reads as complete rather than dividing by zero. */
  fraction: number;
  /** Rendered in the target's own unit — pieces are counted, money is money. */
  label: string;
}

const UNIT: Record<TargetMetric, (n: number) => string> = {
  pieces: n => `${n.toLocaleString()} pcs`,
  value: n => `Rs ${n.toLocaleString()}`,
  collection: n => `Rs ${n.toLocaleString()}`,
};

/** Cancelled and returned orders count toward nothing. */
function counts(o: Order): boolean {
  return o.status !== 'cancelled' && o.status !== 'returned';
}

/**
 * How far along one target is.
 *
 * `orders` and `payments` are already the month's, already scoped to the
 * person — this function does no filtering by date or owner, because the
 * caller knows whose month it is and this does not.
 *
 * **`collection` counts CONFIRMED payments only.** Cash in a rider's satchel
 * has not come home yet, and a target that ticked up on collection rather than
 * on confirmation would be met by money still walking around a bazaar.
 */
export function progressOf(
  target: MonthlyTarget,
  orders: Order[],
  payments: Payment[],
): TargetProgress {
  const live = orders.filter(counts);
  let done = 0;

  if (target.metric === 'collection') {
    // productId is meaningless here — money does not arrive labelled by
    // product — and is ignored rather than silently narrowing the answer.
    done = payments
      .filter(p => p.confirmed && !p.voided)
      .reduce((s, p) => s + p.amount, 0);
  } else if (target.productId) {
    const only = target.productId;
    for (const o of live) {
      const items = o.items.filter(i => i.productId === only);
      if (items.length === 0) continue;
      done += target.metric === 'pieces'
        ? totalQty(items)
        // A product's share of a taxed, discounted order is its share of the
        // line value — computing it any other way would make the parts of a
        // split target fail to add up to the lump-sum one.
        : Math.round(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
    }
  } else {
    done = target.metric === 'pieces'
      ? live.reduce((s, o) => s + totalQty(o.items), 0)
      : live.reduce((s, o) => s + netOfTax(o.billedTotals ?? o.orderedTotals), 0);
  }

  const fraction = target.value > 0 ? Math.min(done / target.value, 1) : 1;
  return { target, done, fraction, label: UNIT[target.metric](done) };
}

/** The same, for every target the owner has set. */
export function allProgress(
  targets: MonthlyTarget[],
  orders: Order[],
  payments: Payment[],
): TargetProgress[] {
  return targets.map(t => progressOf(t, orders, payments));
}

/** "18 of 31" — where the month itself has got to, for pace. */
export function monthPace(now: Date): { day: number; days: number; fraction: number } {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  return { day, days, fraction: day / days };
}
