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

/**
 * A round — the patch of town a booker sweeps in one go.
 *
 * Shops still store the area's NAME, not its id. That is deliberate: every
 * shop that already exists carries a free-typed name, and every order carries
 * a frozen `shopSnapshot.area` copy of it. Keying on an id would mean
 * rewriting all of both to gain nothing a name does not already do — so the
 * area list governs what can be CHOSEN, and renaming fans the new name out to
 * the shops that were using the old one.
 */
export interface Area {
  id: string;
  name: string;
  /** Retired areas stay on old shops but disappear from every picker. */
  active: boolean;
  /**
   * The rider who covers this round — how an order finds its van (FR-6.1).
   *
   * The area is the right place for this because it is already the unit the
   * business plans by: a round is a set of shops one person drives. Booking
   * resolves the shop's area to a rider here, and falls back to
   * `settings.defaultRiderId` when a round has nobody on it yet.
   *
   * Unset is a legitimate state, not an error — a new area has no rider until
   * the owner puts one on it, and orders booked into it land in the owner's
   * "Unassigned" list rather than being silently handed to whoever happens to
   * be first in the employee table.
   */
  riderId?: string;
  /**
   * The bookers who cover this round — their territory. More than one is
   * allowed and normal: a dense bazaar round is worked by two men on the same
   * morning, and the owner is the one who decides that, not the data model.
   *
   * Empty (or absent) means nobody owns it, and an unowned round is picked up
   * by any booker who has no territory of his own (see `shopsForBooker`).
   * While NO round has a booker on it, every booker sees every shop, which is
   * exactly how the app behaved before territories existed.
   *
   * Territory is a CLIENT scope, never a rule — the rules have always let any
   * booker read any shop in his company, because covering a colleague's patch
   * is normal and the shop picker searches company-wide on purpose. Putting
   * two bookers on one round changes what each of them SEES, nothing about
   * what either is permitted to do.
   */
  bookerIds?: string[];
  /**
   * The single-booker field this replaced. READ, NEVER WRITTEN — a migration
   * shim exactly like `settings.autoAssignRiderId`, so a company configured
   * before rounds could be shared keeps working untouched until the owner next
   * edits that round, at which point `setAreaBooker` folds it into the array
   * and deletes it. Read it through `bookersOf()`, never directly.
   */
  bookerId?: string;
}

/**
 * Where a shop actually is — dropped by whoever was standing at the counter.
 *
 * `savedAt` is the phone's clock, not a server timestamp, and deliberately so:
 * nothing computes off it, it exists only to show the owner how old a pin is,
 * and a plain number is readable offline the instant it is written instead of
 * arriving as a null that has to be estimated (the bug that made a just-visited
 * shop read back as "never visited" — see the shops listener).
 */
export interface ShopLocation {
  lat: number;
  lng: number;
  /**
   * GPS accuracy in metres when it was saved. A 5-metre pin and a 200-metre
   * pin look identical on a map; this is the only thing that says which one
   * to walk to. A bazaar street is ~15 m wide, so anything above that is
   * pointing at the block, not the door.
   */
  accuracyM: number;
  savedAt: number;
  savedBy: string;
}

export interface Shop {
  id: string;
  name: string;
  ownerName?: string;
  phone: string;
  area: string;
  address?: string;
  /** Set once someone stood there and saved it. Absent on every older shop. */
  location?: ShopLocation;
  /** Shopfront photo on the CDN — what the next person looks for from the road. */
  photoUrl?: string;
  outstanding: number;
  /**
   * DEAD — read by nothing, written by nothing (2026-08-10, owner's decision).
   *
   * A per-shop rate that applied itself to every order for that shop without
   * appearing on the order screen, the confirmation or the bill. The same
   * objection that removed the percent chips from New Order: a discount nobody
   * decided to give in the moment is not a negotiation. Price is agreed per
   * basket now and typed in rupees.
   *
   * The field is left on the type and on the documents that carry it rather
   * than migrated away — deleting it buys nothing, and a stored number that
   * nothing reads cannot cost anybody money. Do not wire it back up without
   * putting the rate on the order screen where the booker can see it.
   */
  standingDiscountPercent?: number;
  lastVisitAt?: number;
  lastOrderSummary?: { productId: string; qty: number }[];
  collectionFlagged?: boolean;
  /** Shelf-count collection (FR-16 / §v1 scope) — recorded on booker visits. */
  lastShelfCount?: number;
  lastShelfCountAt?: number;
  /**
   * Who sells for us behind this counter (FR-16). Optional and usually empty:
   * a shop is registered long before anyone agrees to the reward scheme.
   */
  counterStaff?: CounterStaff[];
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
  /**
   * Sales tax on (subTotal − discountTotal), added on top — exclusive, which
   * is how a trade invoice in Pakistan is written.
   *
   * Absent on every order booked before tax existed, and absent on every order
   * of a business whose `taxPercent` is 0 — which is the default and was the
   * only possible value until now. Read it as `?? 0` everywhere; a missing
   * value and a zero value mean the same thing and always will.
   */
  taxTotal?: number;
  /** What the shop owes: subTotal − discountTotal + taxTotal. */
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
  /**
   * Money that moved the shop's khata but matched no bill the collecting
   * phone could see (a rider only receives his own orders). The owner
   * reconciles it; it is never silently dropped.
   */
  unallocated?: number;
  createdAt: number;
}

// ---- Rewards (FR-16): counter-staff program -------------------------------

/** A shop's counter person registered for the per-piece reward. */
/**
 * A counter person, stored ON the shop they stand in.
 *
 * They are not our employees — they work behind someone else's counter and
 * recommend our product for a per-piece reward — so they are a property of the
 * shop in exactly the way its phone number is. The only question anyone ever
 * asks is "who sells for us in THIS shop", and the answer now travels with the
 * shop instead of living in a separate collection you have to go and join.
 *
 * Optional and often absent: register a shop today with nobody, find someone
 * next month, open the shop and add them. An empty list and a missing field
 * mean the same thing.
 *
 * `id` is generated on the device and must never be reused, because
 * `RewardClaim.staffId` points at it and a claim is a money record that has to
 * survive the list being edited around it.
 */
export interface CounterStaff {
  id: string;
  name: string;
  /** Optional — plenty of counter staff are known by name and face only. */
  phone?: string;
  active: boolean;
  addedBy: string; // uid
}

/**
 * A counter person flattened out with the shop they belong to.
 *
 * Derived, never stored — the store builds this from every shop's
 * `counterStaff` so screens that want one company-wide list (the booker's
 * rewards tab) do not each have to walk the shops themselves.
 */
export interface RewardStaff extends CounterStaff {
  shopId: string;
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
  /**
   * When the rider actually pressed the button, not just that he did.
   *
   * The booleans alone say a day happened but not when, so the only way to
   * answer "what time did he start" was to guess from the first delivery —
   * which is wrong by however long the ride to the first shop took. Optional
   * because every day written before this existed has neither, and those days
   * still have to read correctly.
   */
  routeStartedAt?: number;
  handedOverAt?: number;
}

/** Today as 'YYYY-MM-DD' in the phone's local time (§12.1). */
export function todayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function tomorrowKey(d: Date = new Date()): string {
  return todayKey(new Date(d.getTime() + 86400_000));
}

export function yesterdayKey(d: Date = new Date()): string {
  return todayKey(new Date(d.getTime() - 86400_000));
}

export const EMPTY_DAY = (date = todayKey()): DayState => ({
  date, routeStarted: false, handedOver: false, handoverConfirmed: false,
});

export interface Employee {
  email: string;
  name: string;
  role: Role;
  joined: boolean; // false = "Invited — not joined yet" (FR-1.3)
  /**
   * Set when the OWNER minted this login rather than inviting a Google
   * address. The email behind it is synthesised and unreadable, so every screen
   * showing this person shows `loginId` instead.
   */
  staffLogin?: boolean;
  /** What the person actually types. Present only on a staff login. */
  loginId?: string;
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
  /**
   * The short code every staff member types to sign in — "alitraders". Written
   * by the server (createStaffLogin / business creation) and read-only here;
   * it is mirrored onto settings because this is the document every client
   * already listens to, and the Employees screen has to be able to show the
   * owner what to write on the slip before he has issued anybody a login.
   */
  companyCode?: string;
  address?: string;
  phone?: string;
  taxNumber?: string;
  currencySymbol: string;
  countryCode: string;
  taxPercent: number;
  /**
   * What a price the booker TYPES on New Order means, once a tax rate is set.
   *
   *   false / absent → the typed price is the goods, and tax is added on top.
   *                    Type 700 at 17% and the shop pays 819. This is how the
   *                    app has always behaved and stays the default, so no
   *                    existing company changes meaning.
   *   true           → the typed price is the FINAL figure, tax already inside
   *                    it. Type 700 at 17% and the shop pays 700, of which
   *                    Rs 102 is tax and Rs 598 is goods.
   *
   * Both write the same order: a discount PERCENT off the subtotal, with the
   * tax computed from it exactly as before. The setting only decides which
   * number the booker is quoting, so nothing downstream — the rider's re-bill
   * against delivered quantities, the reports' net-of-tax sales, the printed
   * bill — needs to know which mode the order was taken in.
   *
   * Irrelevant at `taxPercent: 0`, where the two are the same number, and the
   * Settings row hides itself there rather than asking a question with one
   * possible answer.
   */
  priceIncludesTax?: boolean;
  /**
   * May a BOOKER change a shop's details — phone, owner's name, area, counter
   * staff? Default ON (absent means true), because the booker is the only
   * person who ever stands in the shop and finds out the number is wrong.
   *
   * The shop's NAME is never his, switch or no switch: a renamed shop is a
   * different shop to everyone reading a report, and that is enforced in
   * `firestore.rules`, not here. This flag is a CLIENT scope like territory —
   * it takes the editing UI off his screen. A rule cannot read it without a
   * document lookup, and the rules deliberately do none. Turning it off tidies
   * the app; it does not lock the door.
   */
  bookerEditsShops?: boolean;
  maxDiscountPercent: number;
  defaultDeliveryDay: 'today' | 'tomorrow';
  shopsPerDay: number;
  rewardApprovalLimit: number;
  /** Rs paid to counter-staff per piece sold (FR-16) — Rs 40 by default. */
  rewardPerPiece: number;
  acceptCheques: boolean;
  sendConfirmations: boolean;
  visibility: VisibilitySettings;
  /**
   * Who gets an order booked into an area that has no rider on it (FR-6.1).
   *
   * This is the floor of the assignment ladder, not the whole of it — see
   * `Area.riderId`. A one-rider business sets this once and never touches
   * areas; a six-van business leaves it empty and assigns per round.
   */
  defaultRiderId?: string;
  /**
   * @deprecated Superseded by `defaultRiderId` + `Area.riderId`.
   *
   * The old model: ONE rider per company, captured by whichever rider signed
   * in first (functions/index.js) and stamped on every order with no UI to
   * change it. Read as a fallback so companies created before the change keep
   * delivering without a migration; nothing writes it any more.
   */
  autoAssignRiderId?: string;
  receiptFooter?: string;
  /**
   * The small print at the foot of a bill — the trade warranty and returns
   * terms, in the seller's own words.
   *
   * Distributors in this market print one: the pharma houses carry the Drugs
   * Act 1976 Form 2A declaration, and a cosmetics distributor carries the
   * equivalent for his own category. It is free text on purpose. A default is
   * offered (`DEFAULT_WARRANTY`) because a blank box gets left blank, but the
   * wording is a LEGAL statement about the goods this business sells and only
   * its owner can say whether it is the right one — so it is editable, and
   * clearing it prints no block at all rather than a wrong one.
   */
  warrantyText?: string;
  logoUrl?: string;
}

/**
 * A starting point for `warrantyText`, written for COSMETICS.
 *
 * Deliberately a fraction of the length of the pharma Form 2A block it is
 * modelled on: that one is long because the Drugs Act prescribes its wording
 * almost clause for clause, and none of that prescription applies here.
 * Cosmetics in Pakistan sit under the DRAP Act 2012 and the Cosmetics Rules
 * 2020, not the Drugs Act 1976 — printing a drugs warranty on a face wash
 * claims a compliance the goods were never assessed for.
 *
 * ⚠️ This is a TEMPLATE, not legal advice. It states the three things a trade
 * buyer actually needs — that the goods are lawful and sealed, how long he has
 * to complain, and what comes back — and it should be read by whoever advises
 * the business before it goes on paper a shopkeeper keeps.
 */
export const DEFAULT_WARRANTY =
  'WARRANTY (Form 6): We hereby give this warranty that the products supplied under this ' +
  'invoice do not contravene in any way the provisions of the Drug Regulatory Authority of ' +
  'Pakistan Act 2012 and the Alternative Medicine and Health Products (Enlistment) Rules 2014, ' +
  'and are supplied in the original sealed packing of the manufacturer under whose enlistment ' +
  'they are made. Claims for shortage, breakage or damage must be made within 24 hours of ' +
  'delivery. Goods are not returnable except for a manufacturing defect or expiry, and then ' +
  'only in original packing with this invoice.';

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
