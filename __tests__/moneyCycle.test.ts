/**
 * The full money cycle as pure math — the §17.2 scenarios 7/8/10 skeleton:
 * book → short-deliver → bill at delivery → FIFO with khata → confirm.
 * (On-device equivalents were driven by adb on the emulator; this keeps the
 * arithmetic pinned in CI forever.)
 */
import { computeTotals } from '../src/lib/order';
import { allocateFifo } from '../src/lib/fifo';
import { amountInWordsLine } from '../src/lib/money';

const FACE_WASH = 900;
const SUNBLOCK = 750;

test('the emulator run, replayed as math', () => {
  // Booker: 6 face wash + 4 sunblock, no discount.
  const items = [
    { productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: FACE_WASH },
    { productId: 'p2', name: 'Sunblock', qty: 4, unitPrice: SUNBLOCK },
  ];
  const ordered = computeTotals(items, 0);
  expect(ordered.grandTotal).toBe(8400);

  // Rider stop 1: full delivery, pays bill + old khata 2,300.
  const delivered1 = items.map(i => ({ ...i, deliveredQty: i.qty }));
  const billed1 = computeTotals(delivered1, 0, true);
  expect(billed1.grandTotal).toBe(8400);
  const pay1 = allocateFifo(8400 + 2300, [
    { orderId: 'old-khata', balance: 2300, billedAt: 0 },
    { orderId: 'o1', balance: billed1.grandTotal, billedAt: 1 },
  ]);
  expect(pay1.allocations).toEqual([
    { orderId: 'old-khata', amount: 2300 },
    { orderId: 'o1', amount: 8400 },
  ]);
  expect(pay1.unallocated).toBe(0);

  // Rider stop 2: short delivery 3 of 6 + 2 of 4 → bill written at the door.
  const delivered2 = items.map((i, idx) => ({ ...i, deliveredQty: idx === 0 ? 3 : 2 }));
  const billed2 = computeTotals(delivered2, 0, true);
  expect(billed2.grandTotal).toBe(3 * FACE_WASH + 2 * SUNBLOCK); // 4,200

  // Owner confirms: total cash of the day.
  expect(8400 + 2300 + billed2.grandTotal).toBe(14900);
  expect(amountInWordsLine(14900)).toBe('Rupees fourteen thousand nine hundred only');
});
