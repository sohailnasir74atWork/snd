/**
 * Gross profit — the owner's core question (FR-15.1/15.2).
 *
 * Per item: delivered pieces × (price billed − what the product costs today).
 * Cost comes from the CURRENT product (a price change re-prices history —
 * accepted: the owner wants one truth, not a cost per invoice).
 * Items whose product has no cost price are skipped and counted so the
 * screen can say the number is understated. Integer rupees throughout.
 */
import type { Order, Product } from '../data/models';

export interface ProfitLine {
  productId: string;
  name: string;
  pieces: number;
  profit: number; // integer rupees
}

export interface ProfitSummary {
  gross: number; // integer rupees across every item we could cost
  orders: number; // delivered orders the number is built from
  skippedProducts: number; // distinct products sold with no cost price on file
  lines: ProfitLine[]; // biggest profit first
}

export function profitFor(delivered: Order[], products: Product[]): ProfitSummary {
  const costOf = new Map<string, number | undefined>();
  for (const p of products) costOf.set(p.id, p.costPrice);

  const byProduct = new Map<string, ProfitLine>();
  const skipped = new Set<string>();

  for (const o of delivered) {
    for (const item of o.items) {
      const qty = item.deliveredQty ?? item.qty;
      if (qty <= 0) continue;
      const cost = costOf.get(item.productId);
      if (cost === undefined) { skipped.add(item.productId); continue; }
      const line = byProduct.get(item.productId) ?? {
        productId: item.productId, name: item.name, pieces: 0, profit: 0,
      };
      line.pieces += qty;
      line.profit += qty * (item.unitPrice - cost);
      byProduct.set(item.productId, line);
    }
  }

  const lines = Array.from(byProduct.values()).sort((a, b) => b.profit - a.profit);
  return {
    gross: lines.reduce((sum, l) => sum + l.profit, 0),
    orders: delivered.length,
    skippedProducts: skipped.size,
    lines,
  };
}
