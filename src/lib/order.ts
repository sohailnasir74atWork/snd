/** Pure order math — unit-tested; screens never do arithmetic themselves. */
import type { OrderItem, Totals } from '../data/models';

/**
 * `taxPercent` defaults to 0, and at 0 this returns exactly what it always
 * returned — same keys, same numbers, no `taxTotal`. That is deliberate: every
 * order already in every database was computed without tax, and none of them
 * may change meaning because the function grew a parameter.
 *
 * Tax is EXCLUSIVE — charged on the discounted subtotal and added on top,
 * which is how a Pakistani trade invoice is written. Discount comes first
 * because you are taxed on what you actually charged, not on the list price.
 */
export function computeTotals(
  items: OrderItem[],
  discountPercent: number,
  useDelivered = false,
  taxPercent = 0,
): Totals {
  const subTotal = items.reduce((sum, it) => {
    const qty = useDelivered ? it.deliveredQty ?? 0 : it.qty;
    return sum + qty * it.unitPrice;
  }, 0);
  // Round discount to whole rupees — money stays integer (§4.3).
  const discountTotal = Math.round((subTotal * discountPercent) / 100);
  const taxable = subTotal - discountTotal;
  const taxTotal = Math.round((taxable * taxPercent) / 100);
  // The key is omitted entirely at 0 so an untaxed order's document is byte
  // for byte what it was before, and `stripUndefined` never has to think.
  return taxTotal > 0
    ? { subTotal, discountTotal, taxTotal, grandTotal: taxable + taxTotal }
    : { subTotal, discountTotal, grandTotal: taxable };
}

/**
 * The lowest price the owner's cap allows on this subtotal — the floor the
 * booker cannot negotiate past.
 */
export function lowestPrice(subTotal: number, maxPercent: number): number {
  const capped = Math.min(Math.max(maxPercent, 0), 100);
  return subTotal - Math.round((subTotal * capped) / 100);
}

/**
 * The discount percent that turns `subTotal` into exactly `price`, clamped to
 * the owner's cap and to full price.
 *
 * The booker negotiates in rupees — "give it to me for 700" — but the ORDER
 * stores a percent, and that is not an implementation detail worth undoing:
 * the rider re-bills against DELIVERED quantities, so a rate survives a short
 * delivery and a fixed rupee concession does not. Six of twelve delivered
 * would otherwise carry the whole twelve-piece discount.
 *
 * The percent is deliberately NOT rounded. `computeTotals` rounds the rupee
 * amount, so an exact percent lands on exactly the price that was typed;
 * rounding to two places here first would drift a big order by whole rupees
 * and the booker would watch the total disagree with what he entered.
 */
export function discountPercentForPrice(subTotal: number, price: number, maxPercent: number): number {
  if (subTotal <= 0) return 0;
  const floor = lowestPrice(subTotal, maxPercent);
  const clamped = Math.min(Math.max(price, floor), subTotal);
  return ((subTotal - clamped) / subTotal) * 100;
}

/**
 * What a shop actually pays on `taxable` rupees of goods — the same arithmetic
 * `computeTotals` does, exposed so a screen can quote a tax-inclusive figure
 * without rebuilding an item list to ask.
 */
export function totalWithTax(taxable: number, taxPercent = 0): number {
  return taxable + Math.round((taxable * taxPercent) / 100);
}

/**
 * The discount percent that makes the shop's FINAL total — tax included —
 * come to exactly `total`.
 *
 * The tax-exclusive twin above inverts one multiplication. This one has to
 * invert two roundings: `computeTotals` rounds the discount to whole rupees
 * and then rounds the tax on what is left, so dividing by (1 + rate) lands
 * within a rupee of the answer but not reliably ON it.
 *
 * Worse, some totals cannot be charged AT ALL. At 17% the tax on 12,820 rupees
 * of goods rounds to 2,179 and on 12,821 to 2,180 — so a bill comes to 14,999
 * or to 15,001, and there is no basket that makes exactly 15,000. When the
 * typed figure falls in one of those gaps this takes the nearest total BELOW
 * it, never above: the booker has given his word on a number across a counter,
 * and a shop asked for one rupee more than it agreed is the app calling him a
 * liar. Undercharging by a rupee is invisible; overcharging is an argument.
 *
 * Clamped between the owner's cap and full price, both measured WITH tax,
 * because that is the pair of numbers the booker is quoting between.
 */
export function discountPercentForTotal(
  subTotal: number,
  total: number,
  maxPercent: number,
  taxPercent = 0,
): number {
  if (subTotal <= 0) return 0;
  const floorTaxable = lowestPrice(subTotal, maxPercent);
  const clamped = Math.min(
    Math.max(total, totalWithTax(floorTaxable, taxPercent)),
    totalWithTax(subTotal, taxPercent),
  );
  const estimate = Math.round(clamped / (1 + taxPercent / 100));
  // The cap always satisfies "at or below", so it is a safe starting answer.
  let taxable = floorTaxable;
  // ±2 is generous: rounding twice can only ever put the estimate out by one.
  for (const candidate of [estimate - 2, estimate - 1, estimate, estimate + 1, estimate + 2]) {
    if (candidate < floorTaxable || candidate > subTotal) continue;
    const charged = totalWithTax(candidate, taxPercent);
    if (charged === clamped) { taxable = candidate; break; } // exact wins outright
    if (charged < clamped && candidate > taxable) taxable = candidate;
  }
  // Unrounded for the same reason as discountPercentForPrice: computeTotals
  // rounds the rupees, so an exact percent reproduces the exact taxable.
  return ((subTotal - taxable) / subTotal) * 100;
}

/**
 * A stored discount percent as a human reads it: `5.4054…` -> `5.4`, `5` -> `5`.
 * Display only — never feed this back into `computeTotals`, which needs the
 * exact value to reproduce the price that was agreed.
 */
export function formatDiscountPercent(percent: number): string {
  return String(Math.round(percent * 10) / 10);
}

/**
 * What the business actually earned on a bill: the total minus the tax it is
 * only holding for the government. Identical to `grandTotal` for every
 * untaxed order, which is all of them until someone sets a rate.
 */
export function netOfTax(totals: Totals | undefined): number {
  if (!totals) return 0;
  return totals.grandTotal - (totals.taxTotal ?? 0);
}

let seq = 0;
export function nextSerial(prefix: 'ORD' | 'INV' | 'RCP' | 'RWD', year = new Date().getFullYear()): string {
  // Dev-store placeholder; the real serial comes from the counters transaction (§8.1).
  seq += 1;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}
