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
