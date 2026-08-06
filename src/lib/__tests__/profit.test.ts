/**
 * Profit maths — the owner's core question (FR-15.2).
 * Tests run against the REAL profitFor used by ReportsScreen (src/lib/profit.ts):
 * gross profit counts DELIVERED quantities only, at the product's cost price,
 * and is honest about products with no cost entered.
 */
import { profitFor } from '../profit';
import { computeTotals } from '../order';
import type { Order, Product } from '../../data/models';

function product(p: Partial<Product> & { id: string; tradePrice: number }): Product {
  return {
    name: p.id, code: p.id.toUpperCase(), unit: 'pc', packSize: '',
    mrp: p.tradePrice, stockQty: 0, committedQty: 0, active: true,
    ...p,
  } as Product;
}

/** A delivered order carrying just the fields profitFor reads. */
function delivered(items: Order['items']): Order {
  return { items } as Order;
}

const products: Product[] = [
  product({ id: 'p1', tradePrice: 900, costPrice: 750 }), // face wash: 150/pc
  product({ id: 'p2', tradePrice: 750, costPrice: 600 }), // sunblock: 150/pc
  product({ id: 'p3', tradePrice: 500 }),                 // no cost entered
];

test('profit counts delivered quantities, never ordered ones', () => {
  const orders = [delivered([
    { productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: 900, deliveredQty: 6 },
    { productId: 'p2', name: 'Sunblock', qty: 12, unitPrice: 750, deliveredQty: 6 }, // short delivery
  ])];
  const s = profitFor(orders, products);
  expect(s.gross).toBe(6 * 150 + 6 * 150); // 1,800 — not 6*150 + 12*150
  expect(s.skippedProducts).toBe(0);
  expect(s.orders).toBe(1);
});

test('products without a cost price are skipped and counted, never guessed', () => {
  const orders = [delivered([
    { productId: 'p1', name: 'Face Wash', qty: 2, unitPrice: 900, deliveredQty: 2 },
    { productId: 'p3', name: 'Toner', qty: 5, unitPrice: 500, deliveredQty: 5 },
  ])];
  const s = profitFor(orders, products);
  expect(s.gross).toBe(300); // only the face wash
  expect(s.skippedProducts).toBe(1); // the owner is told the figure is understated
});

test('lines are per product, biggest profit first, pieces summed across orders', () => {
  const orders = [
    delivered([{ productId: 'p1', name: 'Face Wash', qty: 2, unitPrice: 900, deliveredQty: 2 }]),
    delivered([
      { productId: 'p1', name: 'Face Wash', qty: 3, unitPrice: 900, deliveredQty: 3 },
      { productId: 'p2', name: 'Sunblock', qty: 20, unitPrice: 750, deliveredQty: 20 },
    ]),
  ];
  const s = profitFor(orders, products);
  expect(s.lines.map(l => l.productId)).toEqual(['p2', 'p1']); // 3000 before 750
  expect(s.lines[1]).toMatchObject({ pieces: 5, profit: 5 * 150 });
});

test('a discount reduces profit, and the totals stay integers', () => {
  const items = [{ productId: 'p1', name: 'Face Wash', qty: 10, unitPrice: 900, deliveredQty: 10 }];
  const billed = computeTotals(items, 5, true);
  const cost = 10 * 750;
  const profitAfterDiscount = billed.grandTotal - cost;
  expect(billed.grandTotal).toBe(9000 - 450);
  expect(profitAfterDiscount).toBe(1050);
  expect(Number.isInteger(profitAfterDiscount)).toBe(true);
});

test('nothing delivered means no profit and nothing skipped', () => {
  const s = profitFor(
    [delivered([{ productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: 900, deliveredQty: 0 }])],
    products,
  );
  expect(s.gross).toBe(0);
  expect(s.skippedProducts).toBe(0);
  expect(s.lines).toEqual([]);
});
