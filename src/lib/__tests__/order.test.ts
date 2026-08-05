import { computeTotals } from '../order';

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
