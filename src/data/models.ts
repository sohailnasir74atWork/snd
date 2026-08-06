/** Data model — mirrors SRS §9 (Firestore) so the dev store swaps for the real backend without touching screens. */
import type { Role } from '../app/types';

export interface Product {
  id: string;
  name: string;
  code: string;
  unit: 'pc' | 'dozen' | 'box';
  packSize: string;
  tradePrice: number; // integer money — price to shop
  mrp: number;
  /** Buying cost — owner-only; sales minus cost = real profit (FR-15.1). */
  costPrice?: number;
  stockQty: number;
  committedQty: number;
  active: boolean;
  photoUrl?: string;
}

export interface Shop {
  id: string;
  name: string;
  ownerName?: string;
  phone: string;
  area: string;
  address?: string;
  outstanding: number;
  standingDiscountPercent: number;
  lastVisitAt?: number;
  lastOrderSummary?: { productId: string; qty: number }[];
  collectionFlagged?: boolean;
  /** Shelf-count collection (FR-16 / §v1 scope) — recorded on booker visits. */
  lastShelfCount?: number;
  lastShelfCountAt?: number;
  active: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  deliveredQty?: number;
}

export type OrderStatus =
  | 'booked' | 'assigned' | 'out_for_delivery' | 'delivered' | 'closed' | 'cancelled' | 'returned';

export interface Order {
  id: string;
  orderNo: string; // ORD-YYYY-NNNN at booking (§8.1) — "local-N" until sync (FR-5.8)
  provisional?: boolean; // true while the serial is still a local reference
  invoiceNo?: string; // INV-… issued by the rider at delivery (FR-5.2)
  invoiceProvisional?: boolean;
  bookedBy: string; // uid — every non-admin security rule keys on this
  assignedTo?: string; // uid of the rider the order belongs to
  deliveryDate: string; // 'YYYY-MM-DD' — the day this order belongs to
  shopId: string;
  shopSnapshot: { name: string; phone: string; area: string };
  items: OrderItem[];
  orderedTotals: Totals;
  billedTotals?: Totals;
  discountPercent: number;
  status: OrderStatus;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  amountPaid: number;
  deliveryDay: 'today' | 'tomorrow';
  /** Why it came back without delivering ('Send back' at the door). */
  undeliveredReason?: string;
  bookedAt: number;
  deliveredAt?: number;
}

export interface Totals {
  subTotal: number;
  discountTotal: number;
  grandTotal: number;
}

export interface Payment {
  id: string;
  receiptNo: string;
  shopId: string;
  orderIds: { orderId: string; amount: number }[];
  amount: number;
  mode: 'cash' | 'transfer' | 'cheque';
  /** uid of the person who took the money ('rider'/'booker' in preview mode). */
  collectedBy: string;
  confirmed: boolean; // true once the owner confirms the handover (FR-7.11)
  /**
   * The booker's conspicuous forced-cash case (FR-7.13). Rules only let a
   * booker create a payment with this flag; the khata moves at the owner's
   * confirmation, never at collection.
   */
  exception?: boolean;
  /**
   * Owner-only correction (rider typo etc.): the row stays forever, every
   * total simply skips it. Voiding restores the shop's khata and un-applies
   * the FIFO allocations — money history is never deleted, only crossed out.
   */
  voided?: boolean;
  voidedBy?: string;
  voidedAt?: number;
  createdAt: number;
}

// ---- Rewards (FR-16): counter-staff program -------------------------------

/** A shop's counter person registered for the per-piece reward. */
export interface RewardStaff {
  id: string;
  name: string;
  phone: string;
  shopId: string;
  active: boolean;
  addedBy: string; // uid
}

export type RewardClaimStatus = 'pending' | 'approved' | 'rejected';

/** One reward claim: pieces sold at the counter, backed by a receipt photo. */
export interface RewardClaim {
  id: string;
  claimNo: string; // RWD-YYYY-NNNN (LOCAL-RWD-n until sync, FR-5.8)
  provisional?: boolean;
  staffId: string; // rewardStaff id
  staffName: string; // snapshot for cards
  shopId: string;
  shopName: string;
  pieces: number;
  amount: number; // pieces × settings.rewardPerPiece at claim time
  photoUrl?: string; // receipt-proof photo (mandatory at submission)
  shelfCount: number; // mandatory shelf count on the claim visit
  by: string; // booker uid — rules key his read on this
  status: RewardClaimStatus;
  overLimit: boolean; // amount > settings.rewardApprovalLimit at claim time
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string;
}

/** Owner-issued cash float and its spending (FR-16 float). Append-only. */
export interface FloatMovement {
  id: string;
  staffId: string; // whose float
  amount: number; // positive rupees
  kind: 'issue' | 'return' | 'payout'; // payout = approved reward paid out
  refClaimId?: string;
  note?: string;
  createdAt: number;
}

/**
 * The day's state, stamped with the date it belongs to (`YYYY-MM-DD`).
 * Anything read for a different date is treated as a fresh day — that is
 * what makes the morning load list come back tomorrow (FR-6.2).
 */
export interface DayState {
  date: string;
  /** uid of the person this day belongs to — set on every write. */
  staffId?: string;
  routeStarted: boolean; // FR-6.2 — [Start route] freezes the load
  handedOver: boolean;
  handoverConfirmed: boolean;
}

/** Today as 'YYYY-MM-DD' in the phone's local time (§12.1). */
export function todayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function tomorrowKey(d: Date = new Date()): string {
  return todayKey(new Date(d.getTime() + 86400_000));
}

export const EMPTY_DAY = (date = todayKey()): DayState => ({
  date, routeStarted: false, handedOver: false, handoverConfirmed: false,
});

export interface Employee {
  email: string;
  name: string;
  role: Role;
  joined: boolean; // false = "Invited — not joined yet" (FR-1.3)
}

/**
 * What staff phones show (FR-2.x) — the owner's call. Everything defaults to
 * visible; a switch only ever HIDES information, never grants access the
 * rules don't already give.
 */
export interface VisibilitySettings {
  bookerSeesDelivery: boolean; // status tags on his booked orders
  bookerSeesPayments: boolean; // reserved — no booker surface shows payments yet
  bookerSeesBalances: boolean; // shop "owed" amounts (and the exception flow)
  bookerSeesOwnTotals: boolean; // order amounts on My Day
  riderSeesOldBalance: boolean; // old khata at close-out + the Collect tab
}

export const DEFAULT_VISIBILITY: VisibilitySettings = {
  bookerSeesDelivery: true,
  bookerSeesPayments: true,
  bookerSeesBalances: true,
  bookerSeesOwnTotals: true,
  riderSeesOldBalance: true,
};

export interface CompanySettings {
  brandName: string;
  address?: string;
  phone?: string;
  taxNumber?: string;
  currencySymbol: string;
  countryCode: string;
  taxPercent: number;
  maxDiscountPercent: number;
  defaultDeliveryDay: 'today' | 'tomorrow';
  shopsPerDay: number;
  rewardApprovalLimit: number;
  /** Rs paid to counter-staff per piece sold (FR-16) — Rs 40 by default. */
  rewardPerPiece: number;
  acceptCheques: boolean;
  sendConfirmations: boolean;
  visibility: VisibilitySettings;
  /** The only rider — orders assign themselves to him (FR-6.1). */
  autoAssignRiderId?: string;
  receiptFooter?: string;
  logoUrl?: string;
}

export interface Expense {
  id: string;
  amount: number;
  category: 'petrol' | 'samples' | 'repairs' | 'transport' | 'other';
  note?: string;
  date: number;
}

export interface FixedCharge {
  id: string;
  label: string;
  amount: number;
  active: boolean;
}
