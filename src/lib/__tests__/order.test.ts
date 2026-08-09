import { computeTotals, netOfTax } from '../order';

const items = [
  { productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: 900, deliveredQty: 6 },
  { productId: 'p2', name: 'Sunblock', qty: 12, unitPrice: 750, deliveredQty: 6 },
];

describe('order totals — ordered vs billed (FR-5.1/5.2, §8.2)', () => {
  test('ordered totals use ordered quantities', () => {
    const t = computeTotals(items, 0);
    expect(t.subTotal).toBe(6 * 900 + 12 * 750);
    expect(t.grandTotal).toBe(14400);
  });

  test('billed totals use delivered quantities — the short-delivery case', () => {
    const t = computeTotals(items, 0, true);
    expect(t.grandTotal).toBe(6 * 900 + 6 * 750); // 9,900 — what the shop owes
  });

  test('discount rounds to whole rupees, money stays integer', () => {
    const t = computeTotals(items, 5);
    expect(t.discountTotal).toBe(Math.round(14400 * 0.05));
    expect(Number.isInteger(t.grandTotal)).toBe(true);
    expect(t.grandTotal).toBe(14400 - 720);
  });

  test('empty cart is zero everywhere', () => {
    expect(computeTotals([], 10).grandTotal).toBe(0);
  });
});

describe('sales tax (exclusive, on the discounted subtotal)', () => {
  test('no rate means the result is exactly what it always was', () => {
    // The safety property the whole change rests on: every order in every
    // database was computed without tax and none of them may shift.
    const before = { subTotal: 14400, discountTotal: 0, grandTotal: 14400 };
    expect(computeTotals(items, 0)).toEqual(before);
    expect(computeTotals(items, 0, false, 0)).toEqual(before);
    expect('taxTotal' in computeTotals(items, 0)).toBe(false);
  });

  test('tax is charged on what you actually billed, not the list price', () => {
    // 14,400 less a 5% discount is 13,680; 17% of that is 2,325.60 -> 2,326.
    const t = computeTotals(items, 5, false, 17);
    expect(t.subTotal).toBe(14400);
    expect(t.discountTotal).toBe(720);
    expect(t.taxTotal).toBe(2326);
    expect(t.grandTotal).toBe(13680 + 2326);
  });

  test('tax rides on delivered quantities too — the short-delivery case', () => {
    const t = computeTotals(items, 0, true, 17);
    expect(t.subTotal).toBe(9900);
    expect(t.taxTotal).toBe(Math.round(9900 * 0.17));
    expect(t.grandTotal).toBe(9900 + t.taxTotal!);
  });

  test('money stays integer', () => {
    const t = computeTotals(items, 3, false, 17);
    expect(Number.isInteger(t.taxTotal!)).toBe(true);
    expect(Number.isInteger(t.grandTotal)).toBe(true);
  });

  test('netOfTax is what the business earned, not what it collected', () => {
    const taxed = computeTotals(items, 0, false, 17);
    expect(netOfTax(taxed)).toBe(14400);
    // …and is a no-op for every untaxed bill, which is all of them today.
    const plain = computeTotals(items, 0);
    expect(netOfTax(plain)).toBe(plain.grandTotal);
    expect(netOfTax(undefined)).toBe(0);
  });
});
