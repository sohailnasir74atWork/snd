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
  handOver(): void;
  confirmHandover(): void;

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
