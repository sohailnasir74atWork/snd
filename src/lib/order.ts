/** Pure order math — unit-tested; screens never do arithmetic themselves. */
import type { OrderItem, Totals } from '../data/models';

export function computeTotals(items: OrderItem[], discountPercent: number, useDelivered = false): Totals {
  const subTotal = items.reduce((sum, it) => {
    const qty = useDelivered ? it.deliveredQty ?? 0 : it.qty;
    return sum + qty * it.unitPrice;
  }, 0);
  // Round discount to whole rupees — money stays integer (§4.3).
  const discountTotal = Math.round((subTotal * discountPercent) / 100);
  return { subTotal, discountTotal, grandTotal: subTotal - discountTotal };
}

let seq = 0;
export function nextSerial(prefix: 'ORD' | 'INV' | 'RCP' | 'RWD', year = new Date().getFullYear()): string {
  // Dev-store placeholder; the real serial comes from the counters transaction (§8.1).
  seq += 1;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}
