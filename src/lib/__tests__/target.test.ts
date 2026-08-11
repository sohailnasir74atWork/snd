import { DEFAULT_TARGETS, allProgress, monthPace, progressOf, targetsOf } from '../target';
import type { Order, Payment } from '../../data/models';

const mk = (over: Partial<Order>): Order => ({
  id: 'o', orderNo: 'ORD', bookedBy: 'b', shopId: 's',
  shopSnapshot: { name: 'S', phone: '', area: 'A' },
  items: [
    { productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: 100 },
    { productId: 'p2', name: 'Sunblock', qty: 4, unitPrice: 200 },
  ],
  orderedTotals: { subTotal: 1400, discountTotal: 0, grandTotal: 1400 },
  discountPercent: 0, status: 'assigned', paymentStatus: 'unpaid', amountPaid: 0,
  deliveryDay: 'tomorrow', bookedAt: 1, deliveryDate: '2026-08-12', ...over,
} as Order);

const pay = (over: Partial<Payment>): Payment => ({
  id: 'p', receiptNo: 'R', shopId: 's', orderIds: [], amount: 1000,
  mode: 'cash', collectedBy: 'r', confirmed: true, createdAt: 1, ...over,
} as Payment);

describe('a business that has never set one still has something to beat', () => {
  test('absent falls back to 500 pieces', () => {
    expect(targetsOf(undefined)).toEqual(DEFAULT_TARGETS);
    expect(DEFAULT_TARGETS[0]).toEqual({ metric: 'pieces', value: 500 });
  });

  test('an EMPTY array is a deliberate "no targets" and is respected', () => {
    // The distinction that matters: never asked vs answered "none".
    expect(targetsOf([])).toEqual([]);
  });
});

describe('lump sum', () => {
  const orders = [mk({ id: 'a' }), mk({ id: 'b' })];

  test('pieces counts every unit across every product', () => {
    const p = progressOf({ metric: 'pieces', value: 100 }, orders, []);
    expect(p.done).toBe(20); // (6+4) x 2 orders
    expect(p.label).toBe('20 pcs');
    expect(p.fraction).toBeCloseTo(0.2);
  });

  test('value counts rupees net of tax', () => {
    const taxed = mk({ id: 'c', orderedTotals: { subTotal: 1400, discountTotal: 0, taxTotal: 238, grandTotal: 1638 } });
    // 1,638 billed but 238 of that is the government's.
    expect(progressOf({ metric: 'value', value: 10000 }, [taxed], []).done).toBe(1400);
  });

  test('cancelled and returned count toward nothing', () => {
    const p = progressOf({ metric: 'pieces', value: 100 },
      [mk({ id: 'x', status: 'cancelled' }), mk({ id: 'y', status: 'returned' })], []);
    expect(p.done).toBe(0);
  });
});

describe('product-wise', () => {
  const orders = [mk({ id: 'a' }), mk({ id: 'b' })];

  test('narrows to one product only', () => {
    expect(progressOf({ metric: 'pieces', value: 50, productId: 'p2' }, orders, []).done).toBe(8);
  });

  test('a product nobody ordered is zero, not everything', () => {
    expect(progressOf({ metric: 'pieces', value: 50, productId: 'nope' }, orders, []).done).toBe(0);
  });

  test('the parts add up to the lump sum', () => {
    // If these ever disagree, a split target is lying about the same month.
    const lump = progressOf({ metric: 'pieces', value: 1 }, orders, []).done;
    const parts = ['p1', 'p2']
      .map(id => progressOf({ metric: 'pieces', value: 1, productId: id }, orders, []).done)
      .reduce((a, b) => a + b, 0);
    expect(parts).toBe(lump);
  });
});

describe('collection', () => {
  test('counts CONFIRMED cash only — a rider\'s satchel is not collected', () => {
    // A target that ticked up on collection rather than confirmation would be
    // met by money still walking around a bazaar.
    const p = progressOf({ metric: 'collection', value: 10000 },
      [], [pay({ id: '1' }), pay({ id: '2', confirmed: false }), pay({ id: '3', voided: true })]);
    expect(p.done).toBe(1000);
  });

  test('productId is ignored rather than pretending money is labelled', () => {
    const withProduct = progressOf({ metric: 'collection', value: 10000, productId: 'p1' }, [], [pay({})]);
    expect(withProduct.done).toBe(1000);
  });
});

describe('the arithmetic never blows up', () => {
  test('a target of zero reads as complete, not as a division by zero', () => {
    expect(progressOf({ metric: 'pieces', value: 0 }, [], []).fraction).toBe(1);
  });

  test('over-achievement clamps at 1 so a bar cannot overflow its box', () => {
    expect(progressOf({ metric: 'pieces', value: 1 }, [mk({})], []).fraction).toBe(1);
  });

  test('allProgress answers for every target set', () => {
    const all = allProgress(
      [{ metric: 'pieces', value: 10 }, { metric: 'value', value: 100 }], [mk({})], []);
    expect(all).toHaveLength(2);
  });
});

describe('where the month itself has got to', () => {
  test('mid-month', () => {
    expect(monthPace(new Date(2026, 7, 11))).toEqual({ day: 11, days: 31, fraction: 11 / 31 });
  });

  test('February knows its own length', () => {
    expect(monthPace(new Date(2026, 1, 10)).days).toBe(28);
    expect(monthPace(new Date(2028, 1, 10)).days).toBe(29); // leap
  });
});
