import { computeWorkday, clockTime, durationLabel } from '../workday';
import type { DayState, Order, Payment, RewardClaim } from '../../data/models';

// A fixed working day so nothing here depends on when the tests run.
const DAY_START = new Date('2026-08-09T00:00:00Z').getTime();
const DAY_END = DAY_START + 86400_000 - 1;
const at = (h: number, m = 0) => DAY_START + h * 3600_000 + m * 60_000;

const order = (o: Partial<Order>): Order => ({
  id: 'o', orderNo: 'ORD-1', bookedBy: 'booker1', deliveryDate: '2026-08-09',
  shopId: 's1', shopSnapshot: { name: 'Shop', phone: '', area: '' }, items: [],
  orderedTotals: { subTotal: 0, discount: 0, tax: 0, grandTotal: 0 },
  discountPercent: 0, status: 'booked', paymentStatus: 'unpaid', amountPaid: 0,
  deliveryDay: 'today', bookedAt: at(9), ...o,
} as Order);

const payment = (p: Partial<Payment>): Payment => ({
  id: 'p', receiptNo: 'R1', shopId: 's1', orderIds: [], amount: 1000, mode: 'cash',
  collectedBy: 'rider1', confirmed: false, createdAt: at(12), ...p,
} as Payment);

const base = {
  staffId: 'booker1', dayStartMs: DAY_START, dayEndMs: DAY_END,
  orders: [] as Order[], payments: [] as Payment[], rewardClaims: [] as RewardClaim[],
};

describe('computeWorkday — reading a day off the work', () => {
  test('a person who did nothing has no day, not a zero-length one', () => {
    const w = computeWorkday(base, at(18));
    expect(w.startedAt).toBeNull();
    expect(w.lastActionAt).toBeNull();
    expect(w.activeMs).toBe(0);
    expect(w.startSource).toBe('none');
    expect(w.stillWorking).toBe(false);
  });

  test('start is the first piece of work, end is the last', () => {
    const w = computeWorkday({
      ...base,
      orders: [
        order({ id: 'a', bookedAt: at(9, 30) }),
        order({ id: 'b', bookedAt: at(14, 15) }),
        order({ id: 'c', bookedAt: at(11) }),
      ],
    }, at(18));
    expect(w.startedAt).toBe(at(9, 30));
    expect(w.lastActionAt).toBe(at(14, 15));
    expect(w.activeMs).toBe(4 * 3600_000 + 45 * 60_000);
    expect(w.startSource).toBe('derived');
    expect(w.ordersBooked).toBe(3);
  });

  test("the rider's pressed button beats the first delivery, because it is earlier and true", () => {
    const day: DayState = {
      date: '2026-08-09', staffId: 'rider1', routeStarted: true,
      routeStartedAt: at(8), handedOver: true, handedOverAt: at(19),
      handoverConfirmed: false,
    };
    const w = computeWorkday({
      ...base,
      staffId: 'rider1',
      // The first delivery is an hour after he left the depot — deriving from
      // it would silently lose the ride.
      orders: [order({ assignedTo: 'rider1', deliveredAt: at(9), status: 'delivered' })],
      day,
    }, at(20));
    expect(w.startedAt).toBe(at(8));
    expect(w.lastActionAt).toBe(at(19));
    expect(w.startSource).toBe('explicit');
    expect(w.handedOver).toBe(true);
  });

  test('yesterday and tomorrow are not this day', () => {
    const w = computeWorkday({
      ...base,
      orders: [
        order({ id: 'old', bookedAt: DAY_START - 3600_000 }),
        order({ id: 'new', bookedAt: DAY_END + 3600_000 }),
        order({ id: 'today', bookedAt: at(10) }),
      ],
    }, at(18));
    expect(w.ordersBooked).toBe(1);
    expect(w.startedAt).toBe(at(10));
  });

  test('another person\'s work is not counted as yours', () => {
    const w = computeWorkday({
      ...base,
      orders: [order({ bookedBy: 'someone-else', bookedAt: at(7) })],
    }, at(18));
    expect(w.ordersBooked).toBe(0);
    expect(w.startedAt).toBeNull();
  });

  test('a voided payment is struck off the day as well as the books', () => {
    const w = computeWorkday({
      ...base,
      staffId: 'rider1',
      payments: [
        payment({ id: 'good', amount: 500, createdAt: at(11) }),
        payment({ id: 'bad', amount: 9999, voided: true, createdAt: at(23) }),
      ],
    }, at(23, 30));
    expect(w.collected).toBe(500);
    // and the mistake must not stretch his day to 11pm either
    expect(w.lastActionAt).toBe(at(11));
  });

  test('shops touched counts each shop once, across booking, delivery and cash', () => {
    const w = computeWorkday({
      ...base,
      staffId: 'r',
      orders: [
        order({ id: '1', bookedBy: 'r', shopId: 'shopA', bookedAt: at(9) }),
        order({ id: '2', assignedTo: 'r', shopId: 'shopA', deliveredAt: at(10), status: 'delivered' }),
        order({ id: '3', bookedBy: 'r', shopId: 'shopB', bookedAt: at(11) }),
      ],
      payments: [payment({ collectedBy: 'r', shopId: 'shopC', createdAt: at(12) })],
    }, at(18));
    expect(w.shopsTouched).toBe(3);
  });

  test('still working means recent activity and no handover yet', () => {
    const orders = [order({ bookedAt: at(14) })];
    expect(computeWorkday({ ...base, orders }, at(14, 30)).stillWorking).toBe(true);
    // Two hours of silence reads as gone home.
    expect(computeWorkday({ ...base, orders }, at(16, 30)).stillWorking).toBe(false);
  });

  test('handing over ends the day even if he was active a minute ago', () => {
    const day: DayState = {
      date: '2026-08-09', staffId: 'booker1', routeStarted: false,
      handedOver: true, handedOverAt: at(18), handoverConfirmed: false,
    };
    const w = computeWorkday({ ...base, orders: [order({ bookedAt: at(17, 55) })], day }, at(18, 1));
    expect(w.stillWorking).toBe(false);
    expect(w.lastActionAt).toBe(at(18));
  });
});

describe('clockTime — a wall clock, not a timestamp', () => {
  test('midnight and noon do not become 0 o\'clock', () => {
    const midnight = new Date('2026-08-09T00:10:00').getTime();
    const noon = new Date('2026-08-09T12:05:00').getTime();
    expect(clockTime(midnight)).toBe('12:10 am');
    expect(clockTime(noon)).toBe('12:05 pm');
  });

  test('nothing to show says so', () => {
    expect(clockTime(null)).toBe('—');
  });
});

describe('durationLabel — how a person says it', () => {
  test('hours and minutes', () => {
    expect(durationLabel(6 * 3600_000 + 20 * 60_000)).toBe('6h 20m');
    expect(durationLabel(45 * 60_000)).toBe('45m');
    expect(durationLabel(3 * 3600_000)).toBe('3h');
  });

  test('no time worked is a dash, not "0m"', () => {
    expect(durationLabel(0)).toBe('—');
    expect(durationLabel(-5)).toBe('—');
  });
});
