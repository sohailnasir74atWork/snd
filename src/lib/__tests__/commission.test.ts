import { commissionFor, commissionSplit } from '../commission';
import type { Order, OrderItem, Totals } from '../../data/models';

const items: OrderItem[] = [
  { productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: 900, deliveredQty: 6 },
  { productId: 'p2', name: 'Sunblock', qty: 12, unitPrice: 750, deliveredQty: 6 },
];
const ordered: Totals = { subTotal: 14400, discountTotal: 0, grandTotal: 14400 };
const billed: Totals = { subTotal: 9900, discountTotal: 0, grandTotal: 9900 };
const taxed: Totals = { subTotal: 9900, discountTotal: 0, taxTotal: 1683, grandTotal: 11583 };

const order = (over: Partial<Order>): Order => ({
  id: 'o', orderNo: 'ORD-1', bookedBy: 'b', shopId: 's',
  shopSnapshot: { name: 'Shop', phone: '', area: 'A' },
  items, orderedTotals: ordered, billedTotals: billed, discountPercent: 0,
  status: 'assigned', paymentStatus: 'unpaid', amountPaid: 0,
  deliveryDay: 'tomorrow', bookedAt: 1, ...over,
} as Order);

describe('Rs per piece', () => {
  const rate = { mode: 'fixed' as const, value: 20 };

  test('pays on ordered pieces before the van has been', () => {
    expect(commissionFor(items, ordered, rate, false)).toBe(18 * 20); // 360
  });

  test('pays on DELIVERED pieces after it — a short delivery pays less', () => {
    // Twelve sunblock ordered, six arrived. He is paid for what reached a shop.
    expect(commissionFor(items, billed, rate, true)).toBe(12 * 20); // 240
  });

  test('a rate of zero earns zero rather than being a special case', () => {
    expect(commissionFor(items, ordered, { mode: 'fixed', value: 0 }, false)).toBe(0);
  });
});

describe('percent of the sale', () => {
  const rate = { mode: 'percent' as const, value: 2 };

  test('two percent of an untaxed sale', () => {
    expect(commissionFor(items, billed, rate, true)).toBe(198); // 2% of 9,900
  });

  test('NET of tax — he is not paid a share of the government\'s money', () => {
    // Bill totals 11,583 but 1,683 of it is tax the business only holds.
    // Paying on the gross would make the company fund his commission itself,
    // and a change in the tax rate would silently change his pay.
    expect(commissionFor(items, taxed, rate, true)).toBe(198); // still 2% of 9,900
  });

  test('rounds to whole rupees — money stays integer', () => {
    const odd = commissionFor(items, billed, { mode: 'percent', value: 2.5 }, true);
    expect(Number.isInteger(odd)).toBe(true);
    expect(odd).toBe(248); // 2.5% of 9,900 = 247.5 -> 248
  });
});

describe('confirmed vs unconfirmed', () => {
  const rate = { mode: 'fixed' as const, value: 20 };

  test('booked but not delivered is unconfirmed', () => {
    const s = commissionSplit([order({ status: 'assigned' })], rate);
    expect(s).toMatchObject({ confirmed: 0, unconfirmed: 360, unconfirmedOrders: 1 });
  });

  test('delivered but NOT paid is still unconfirmed', () => {
    // The case that matters. Telling him he has earned money the shop has not
    // handed over invites him to stop chasing it.
    const s = commissionSplit([order({ status: 'delivered', paymentStatus: 'partial' })], rate);
    expect(s).toMatchObject({ confirmed: 0, unconfirmed: 240 });
  });

  test('delivered AND paid in full is confirmed', () => {
    const s = commissionSplit([order({ status: 'delivered', paymentStatus: 'paid' })], rate);
    expect(s).toMatchObject({ confirmed: 240, unconfirmed: 0, confirmedOrders: 1 });
  });

  test('cancelled and returned earn nothing at all — not even unconfirmed', () => {
    const s = commissionSplit(
      [order({ status: 'cancelled' }), order({ status: 'returned' })], rate,
    );
    expect(s).toEqual({ confirmed: 0, unconfirmed: 0, confirmedOrders: 0, unconfirmedOrders: 0 });
  });

  test('a mixed day adds up both ways', () => {
    const s = commissionSplit([
      order({ id: 'a', status: 'delivered', paymentStatus: 'paid' }),
      order({ id: 'b', status: 'assigned' }),
      order({ id: 'c', status: 'cancelled' }),
    ], rate);
    expect(s.confirmed).toBe(240);
    expect(s.unconfirmed).toBe(360);
    expect(s.confirmedOrders + s.unconfirmedOrders).toBe(2);
  });

  test('no orders is zero, not NaN', () => {
    expect(commissionSplit([], rate)).toEqual({
      confirmed: 0, unconfirmed: 0, confirmedOrders: 0, unconfirmedOrders: 0,
    });
  });
});
