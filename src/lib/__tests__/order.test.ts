import {
  computeTotals, discountPercentForPrice, formatDiscountPercent, lowestPrice, netOfTax,
} from '../order';

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

describe('negotiating in rupees — the booker types a price, the order stores a rate', () => {
  const sub = 14400; // the fixture cart at full price

  test('the price typed is the price charged, to the rupee', () => {
    // The property the whole feature rests on: whatever the booker agreed at
    // the counter is exactly what the shop is asked for.
    for (const price of [14399, 13680, 13000, 12960, 12961, 1, 0]) {
      const pct = discountPercentForPrice(sub, price, 100);
      expect(computeTotals(items, pct).grandTotal).toBe(price);
    }
  });

  test('a price that needs an awkward rate still lands exactly', () => {
    // 13,333 off 14,400 is 7.4097222…% — a percent no chip could offer and
    // no two-decimal rounding could reproduce.
    const pct = discountPercentForPrice(sub, 13333, 100);
    expect(pct).not.toBe(Math.round(pct * 100) / 100);
    expect(computeTotals(items, pct).grandTotal).toBe(13333);
  });

  test("the owner's cap is a floor under the price, not a warning", () => {
    const pct = discountPercentForPrice(sub, 5000, 10);
    expect(pct).toBe(10);
    expect(computeTotals(items, pct).grandTotal).toBe(lowestPrice(sub, 10));
    expect(lowestPrice(sub, 10)).toBe(12960);
  });

  test('nobody can charge above list price by typing a bigger number', () => {
    expect(discountPercentForPrice(sub, 99999, 10)).toBe(0);
  });

  test('an empty cart cannot be divided by', () => {
    expect(discountPercentForPrice(0, 500, 10)).toBe(0);
    expect(lowestPrice(0, 10)).toBe(0);
  });

  test('the rate scales to a short delivery — why a rate is stored at all', () => {
    // Agreed 13,680 for twelve; half the sunblock never made it off the van.
    const pct = discountPercentForPrice(sub, 13680, 10);
    const billed = computeTotals(items, pct, true);
    expect(billed.subTotal).toBe(9900);
    // The concession follows the goods that arrived, not the goods ordered.
    expect(billed.grandTotal).toBe(9900 - Math.round(9900 * 0.05));
  });

  test('a stored rate reads as a human number on the bill', () => {
    expect(formatDiscountPercent(discountPercentForPrice(sub, 13333, 100))).toBe('7.4');
    expect(formatDiscountPercent(5)).toBe('5');
    expect(formatDiscountPercent(0)).toBe('0');
  });
});
