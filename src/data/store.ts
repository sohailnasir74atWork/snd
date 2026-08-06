/**
 * Store indirection — every screen imports `useStore` from HERE, never from a
 * concrete implementation. Preview mode backs it with the in-memory devStore;
 * a real signed-in session backs it with the Firestore store. Screens cannot
 * tell the difference, which is the whole point.
 */
import React from 'react';
import type {
  CompanySettings, DayState, Employee, Expense, FixedCharge, FloatMovement,
  Order, OrderItem, Payment, Product, RewardClaim, RewardStaff, Shop,
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
  /** Pre-app paper-khata debt, entered once at creation (owner only). */
  openingBalance?: number;
}

export interface RewardStaffInput {
  name: string; phone: string; shopId: string;
}

export interface RewardClaimInput {
  staffId: string;
  pieces: number;
  /** Mandatory shelf count taken on the same visit (FR-16). */
  shelfCount: number;
  /** Receipt-proof photo, base64 JPEG — uploaded before the claim lands. */
  photoBase64?: string;
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
  /** Rewards (FR-16): admin + booker see these; rider gets []. */
  rewardStaff: RewardStaff[];
  rewardClaims: RewardClaim[];
  /** Admin sees all float rows; staff see their own. */
  floatMovements: FloatMovement[];
  ready: boolean;

  // field flows
  bookOrder(input: BookOrderInput): Promise<Order> | Order;
  /**
   * Cancel a not-yet-delivered order (FR-5.7: cancel, never delete) and
   * release its committed stock. Booker: own orders; owner: any.
   */
  cancelOrder(orderId: string): void;
  /** Shop closed today — push the stop to tomorrow (keeps stock committed). */
  deferOrder(orderId: string): void;
  /** Shop refused the goods — status 'returned', committed stock released. */
  returnOrder(orderId: string, reason: string): void;
  flagCollection(shopId: string): void;
  startRoute(): void;
  /** Tapped too early — allowed until the first close-out of the day. */
  undoStartRoute(): void;
  /** Has THE RIDER started his route? (the van freeze — FR-6.2, cross-phone). */
  riderRouteStarted(): boolean;
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
  /** Supplier delivery or a count correction — atomic increment, logged. */
  adjustStock(productId: string, delta: number, note: string): void;
  addShop(s: ShopInput): void;
  updateShop(id: string, patch: Partial<Shop>): void;
  /** Manual khata correction (returns, bounced cheques, paper-era fixes). */
  adjustShopBalance(shopId: string, delta: number, note: string): void;
  /**
   * Owner crosses out a wrong payment: the row stays (voided), the shop's
   * khata is restored and the FIFO allocations are un-applied.
   */
  voidPayment(paymentId: string): void;
  updateSettings(patch: Partial<CompanySettings>): void;
  addEmployee(email: string, name: string, role: Employee['role']): Promise<void>;
  removeEmployee(email: string): Promise<void>;
  addExpense(e: Omit<Expense, 'id'>): void;
  removeExpense(id: string): void;
  addFixedCharge(c: Omit<FixedCharge, 'id'>): void;
  updateFixedCharge(id: string, patch: Partial<FixedCharge>): void;
  removeFixedCharge(id: string): void;

  // rewards (FR-16) + shelf counts
  addRewardStaff(s: RewardStaffInput): void;
  /** Uploads the proof photo first — throws if that fails, so no photo-less claims. */
  submitRewardClaim(c: RewardClaimInput): Promise<{ claimNo: string }>;
  /** Admin only (FR-16.5); approval also writes the float payout row. */
  decideRewardClaim(id: string, decision: 'approved' | 'rejected'): void;
  /** Admin hands cash float to staff / takes it back. */
  moveFloat(staffId: string, amount: number, kind: 'issue' | 'return'): void;
  recordShelfCount(shopId: string, count: number): void;

  // derived
  cashWithStaff(): number;
  cashConfirmed(): number;
  /** issues − payouts − returns for one staff member's float. */
  floatBalance(staffId: string): number;
}

export const StoreContext = React.createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const ctx = React.useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside a store provider');
  return ctx;
}
