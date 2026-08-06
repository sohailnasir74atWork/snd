/**
 * Store indirection — every screen imports `useStore` from HERE, never from a
 * concrete implementation. Preview mode backs it with the in-memory devStore;
 * a real signed-in session backs it with the Firestore store. Screens cannot
 * tell the difference, which is the whole point.
 */
import React from 'react';
import type {
  CompanySettings, DayState, Employee, Expense, FixedCharge,
  Order, OrderItem, Payment, Product, Shop,
} from './models';

export interface BookOrderInput {
  shopId: string;
  items: OrderItem[];
  discountPercent: number;
  deliveryDay: 'today' | 'tomorrow';
}

export interface CloseOutInput {
  orderId: string;
  deliveredQtys: Record<string, number>;
  paymentAmount: number;
  mode: 'cash' | 'transfer' | 'cheque';
}

export interface ProductInput {
  name: string; code: string; unit: Product['unit']; packSize: string;
  tradePrice: number; mrp: number; stockQty: number;
  /** What the business pays for it — owner-only, drives real profit (FR-15.1). */
  costPrice?: number;
}

export interface CollectionInput {
  shopId: string;
  amount: number;
  mode: 'cash' | 'transfer' | 'cheque';
  /** True only for the booker's conspicuous forced-cash exception (FR-7.13). */
  exception?: boolean;
}

export interface ShopInput {
  name: string; ownerName?: string; phone: string; area: string;
  address?: string; standingDiscountPercent?: number;
}

export interface StoreApi {
  // live data
  products: Product[];
  shops: Shop[];
  orders: Order[];
  payments: Payment[];
  day: DayState;
  /**
   * Every staff member's day doc — admin only (others get []). This is how
   * the owner sees "X handed over, waiting for confirmation" (FR-7.11).
   */
  staffDays: DayState[];
  /** uid → display name for handover cards — admin only (others get {}). */
  staffNames: Record<string, string>;
  settings: CompanySettings;
  employees: Employee[];
  expenses: Expense[];
  fixedCharges: FixedCharge[];
  ready: boolean;

  // field flows
  bookOrder(input: BookOrderInput): Promise<Order> | Order;
  flagCollection(shopId: string): void;
  startRoute(): void;
  closeOutStop(input: CloseOutInput): Promise<{ invoiceNo: string; receiptNo?: string }> | { invoiceNo: string; receiptNo?: string };
  /** Money collected without a delivery — the khata visit (FR-7.4). */
  collect(input: CollectionInput): Promise<{ receiptNo: string }> | { receiptNo: string };
  handOver(): void;
  /**
   * Owner counts ONE person's cash and confirms it (FR-7.11) — only that
   * person's unconfirmed payments flip, never the whole company's.
   */
  confirmHandover(staffId: string): void;

  // admin management
  addProduct(p: ProductInput): void;
  updateProduct(id: string, patch: Partial<Product>): void;
  addShop(s: ShopInput): void;
  updateSettings(patch: Partial<CompanySettings>): void;
  addEmployee(email: string, name: string, role: Employee['role']): Promise<void>;
  removeEmployee(email: string): Promise<void>;
  addExpense(e: Omit<Expense, 'id'>): void;
  addFixedCharge(c: Omit<FixedCharge, 'id'>): void;

  // derived
  cashWithStaff(): number;
  cashConfirmed(): number;
}

export const StoreContext = React.createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside a store provider');
  return ctx;
}
