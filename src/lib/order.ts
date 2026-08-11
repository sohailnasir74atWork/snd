/** Pure order math — unit-tested; screens never do arithmetic themselves. */
import type { OrderItem, Payment, Totals } from '../data/models';

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
 * The two ways of saying one concession. Which one comes out of the booker's
 * mouth depends on how the haggle went — "give it to me for 660" and "take 40
 * off" are the same sentence — and the screen offers both boxes so that he
 * never does the subtraction at the counter with the shopkeeper watching him
 * do it. One of them is always wrong by a rupee when done in the head, and it
 * is always wrong in the shop's favour to argue about.
 *
 * `fullPrice` is whatever full price MEANS on the basis he is typing in: goods
 * in exclusive mode, goods-plus-tax in inclusive mode. Hand both functions the
 * same number the price box is measured against and the pair cannot disagree.
 *
 * Neither clamps to the owner's cap. `discountPercentForPrice` and
 * `discountPercentForTotal` already do that on the way to a stored rate, and
 * clamping here as well would rewrite the digits under the booker's thumb
 * while he was still typing them — he types 4, then 0, and a cap-clamp on the
 * first keystroke turns "40" into something he did not ask for. The hint line
 * tells him he is past the cap; the field does not argue back mid-keystroke.
 */
export function priceForDiscountAmount(fullPrice: number, amount: number): number {
  return Math.max(fullPrice - amount, 0);
}

export function discountAmountForPrice(fullPrice: number, price: number): number {
  return Math.max(fullPrice - price, 0);
}

/**
 * Pieces, not rupees. `useDelivered` mirrors `computeTotals` for the same
 * reason it exists there: a billed order counts what the rider actually handed
 * over, a booked one counts what the shop asked for.
 */
export function totalQty(items: OrderItem[], useDelivered = false): number {
  return items.reduce((sum, it) => sum + (useDelivered ? it.deliveredQty ?? 0 : it.qty), 0);
}

/** One product, and everything the whole run needs of it. */
export interface PickLine {
  productId: string;
  name: string;
  qty: number;
  /** How many shops want it — the number that says "split this box". */
  shops: number;
  /**
   * And WHICH shops, with how many each.
   *
   * The total gets the stock off the shelf; this is what turns one heap of 54
   * into nine piles. Without it the owner has the right quantity in front of
   * him and still has to open nine order slips to find out who gets what,
   * which is the counting he asked not to do.
   */
  perShop: { shopId: string; name: string; qty: number }[];
}

/** One shop's contribution to the run. */
export interface PickEntry {
  shopId: string;
  shopName: string;
  items: OrderItem[];
}

/**
 * What to pull off the shelf for a run, added up across every shop in it.
 *
 * The owner loads the van from ONE list, not from nine. Reading nine order
 * slips and adding the sunblock up in his head is the step where a van leaves
 * with eleven of something and needs fourteen, and nobody finds out until the
 * rider is four shops down a bazaar.
 *
 * Keyed by `productId`, never by name: two products can be renamed into the
 * same string, and a rename between two orders would otherwise split one line
 * into two. The name shown is the one on the first order that mentions it,
 * which is the only one this function can honestly claim.
 *
 * Sorted by name, ascending and deterministically — a picker works down a list
 * against a shelf, and quantity order would move a line every time an order
 * was added. `localeCompare` is avoided on purpose: it is locale-dependent and
 * this list has to come out identical on the phone and in the printed PDF.
 */
export function pickList(entries: PickEntry[], useDelivered = false): PickLine[] {
  const byProduct = new Map<string, PickLine>();
  for (const entry of entries) {
    for (const it of entry.items) {
      const qty = useDelivered ? it.deliveredQty ?? 0 : it.qty;
      if (qty <= 0) continue;
      const line = byProduct.get(it.productId);
      if (!line) {
        byProduct.set(it.productId, {
          productId: it.productId, name: it.name, qty, shops: 1,
          perShop: [{ shopId: entry.shopId, name: entry.shopName, qty }],
        });
        continue;
      }
      line.qty += qty;
      /**
       * Keyed by `shopId`, never by name — the same rule as the products
       * above, and for a sharper reason. Two shops genuinely called
       * "Al-Madina Traders" on different streets is ordinary in this market.
       * Merging them by name would build ONE pile of twelve where two piles
       * of six belong, and the rider would deliver a double order to the
       * first one and nothing to the second.
       */
      const already = line.perShop.find(p => p.shopId === entry.shopId);
      if (already) already.qty += qty;
      else { line.perShop.push({ shopId: entry.shopId, name: entry.shopName, qty }); line.shops += 1; }
    }
  }
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  for (const line of byProduct.values()) line.perShop.sort(byName);
  return [...byProduct.values()].sort(byName);
}

/**
 * What has actually been paid against ONE bill — every non-voided payment's
 * allocation to that order, summed.
 *
 * Voided payments are skipped because voiding un-applies the allocation
 * (`Payment.voided`); the row survives as history and every total steps over
 * it. UNCONFIRMED payments are counted, and that is the deliberate half:
 * `confirmed` means the owner has the cash in his own hand, not that the shop
 * paid. The shop paid when it paid. A bill copy that ignored the rider's
 * satchel would dun a shopkeeper for money he handed over this morning — the
 * same mistake `paidToPrevious` was added to `billHtml` to fix.
 */
export function paidAgainstOrder(payments: Payment[], orderId: string): number {
  return payments.reduce((sum, p) => p.voided
    ? sum
    : sum + p.orderIds.reduce((s, a) => a.orderId === orderId ? s + a.amount : s, 0), 0);
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
