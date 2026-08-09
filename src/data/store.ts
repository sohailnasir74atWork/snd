/**
 * Store indirection — every screen imports `useStore` from HERE, never from a
 * concrete implementation. Preview mode backs it with the in-memory devStore;
 * a real signed-in session backs it with the Firestore store. Screens cannot
 * tell the difference, which is the whole point.
 */
import React from 'react';
import type {
  Area, CompanySettings, DayState, Employee, Expense, FixedCharge, FloatMovement,
  Order, OrderItem, Payment, Product, RewardClaim, RewardStaff, Shop, ShopLocation,
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
  /**
   * Both optional: a shop registered at the counter with no signal still gets
   * created, and the pin and the photo are added on the next visit.
   *
   * The raw fix only — who saved it and when are stamped by the store, which
   * is the layer that knows whose phone this is.
   */
  location?: Omit<ShopLocation, 'savedAt' | 'savedBy'>;
  photoUrl?: string;
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
  /** Every round the owner has defined. Pickers show the active ones. */
  areas: Area[];
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
  /**
   * Everyone who can be put on a round — admin only (others get []).
   * A company has as many riders as it has vans; nothing here assumes one.
   */
  riders: { id: string; name: string }[];
  /**
   * Booked orders no van is carrying: the round has no rider on it, or the
   * rider it was addressed to has been removed. Admin only (others get []).
   *
   * The rider read rule keys on `assignedTo == uid`, so these are invisible
   * to every rider and visible only to the owner — which is the point. They
   * used to be swept onto "the" rider automatically; with several vans that
   * silently overrode the owner's own assignments.
   */
  unassignedOrders: Order[];
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
  /**
   * Orders and payments written on this phone that have not reached the
   * server yet. Signing out destroys them, so the sign-out flow refuses
   * while this is above zero.
   */
  pendingWrites: number;
  /** Wait for the offline queue to drain. Resolves false if it did not in time. */
  flushPendingWrites(timeoutMs?: number): Promise<boolean>;

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
  /**
   * Has THAT rider started his route? (the van freeze — FR-6.2, cross-phone).
   *
   * Takes the rider being asked about: with several vans out, freezing every
   * booker's afternoon because one rider across town has loaded up is wrong.
   * Called on a rider's own phone the argument is ignored — it is his day.
   */
  riderRouteStarted(riderId?: string | null): boolean;
  /** Which van a shop's orders go to: its round's rider, else the default. */
  riderForShop(shopId: string): string | null;
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
  /**
   * Pin an existing shop. Separate from updateShop because the store is what
   * knows who is standing there — and because the rules let a RIDER write
   * exactly these two keys and nothing else, so the call sites must not be
   * able to smuggle another field along.
   */
  setShopLocation(shopId: string, fix: { lat: number; lng: number; accuracyM: number }): void;
  setShopPhoto(shopId: string, photoUrl: string): void;
  /** Owner-only: the area list is what every shop form is allowed to pick from. */
  addArea(name: string): void;
  /** Renames the area AND every shop still filed under the old name. */
  renameArea(id: string, name: string): void;
  setAreaActive(id: string, active: boolean): void;
  /**
   * Put a rider on a round, or take him off it (null). Future bookings only —
   * orders already written keep the van they were booked to.
   */
  setAreaRider(id: string, riderId: string | null): void;
  /** Hand ONE order to a van. The owner's answer to `unassignedOrders`. */
  assignOrder(orderId: string, riderId: string): void;
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
  /**
   * Someone left the counter, or was added by mistake.
   *
   * Deactivated, never deleted: their past claims name them, and a claim
   * pointing at a staff id that no longer exists is an unreadable payout.
   */
  setRewardStaffActive(id: string, active: boolean): void;
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
