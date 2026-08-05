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
  collectedBy: Role;
  confirmed: boolean; // true once the owner confirms the handover (FR-7.11)
  createdAt: number;
}

/**
 * The day's state, stamped with the date it belongs to (`YYYY-MM-DD`).
 * Anything read for a different date is treated as a fresh day — that is
 * what makes the morning load list come back tomorrow (FR-6.2).
 */
export interface DayState {
  date: string;
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
  acceptCheques: boolean;
  sendConfirmations: boolean;
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
