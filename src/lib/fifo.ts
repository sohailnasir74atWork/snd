/**
 * FIFO payment allocator — FR-7.4 / FR-7.8.
 *
 * One amount is split across a shop's unpaid bills, oldest first.
 * Offline the split is advisory; the server re-runs the same function
 * inside the sync transaction, so receipts saying "paid towards oldest
 * bills" stay true (§12.1).
 */

export interface UnpaidBill {
  orderId: string;
  /** Remaining balance of this bill, integer money. */
  balance: number;
  /** Used only for ordering; oldest first. Epoch millis. */
  billedAt: number;
}

export interface Allocation {
  orderId: string;
  amount: number;
}

export interface FifoResult {
  allocations: Allocation[];
  /** Anything beyond the shop's total outstanding (rare; owner resolves). */
  unallocated: number;
}

export function allocateFifo(amount: number, bills: UnpaidBill[]): FifoResult {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`allocateFifo needs a non-negative integer amount, got ${amount}`);
  }
  const ordered = [...bills].sort((a, b) => a.billedAt - b.billedAt);
  const allocations: Allocation[] = [];
  let remaining = amount;
  for (const bill of ordered) {
    if (remaining <= 0) break;
    if (bill.balance <= 0) continue;
    const paid = Math.min(remaining, bill.balance);
    allocations.push({ orderId: bill.orderId, amount: paid });
    remaining -= paid;
  }
  return { allocations, unallocated: remaining };
}
