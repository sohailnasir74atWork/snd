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

/**
 * Collections that are only synced once a screen asks for them.
 *
 * Everything else attaches at sign-in because the field flow needs it before
 * anyone navigates anywhere. These four do not: a rider who never opens
 * Expenses should not be paying to sync the owner's expense history, and on a
 * phone with a year of data that is a real fraction of every cold start.
 */
export type LazyKey =
  | 'expenses'
  | 'fixedCharges'
  | 'employeeList'
  | 'floatMovements';

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
  address?: string;
  /**
   * Whoever already stands behind that counter, registered in the same breath
   * as the shop. Optional and usually empty — a shop is registered at a
   * counter in thirty seconds and the person selling for you is often found
   * out later, which is why `CounterStaffSection` exists on the shop editor
   * too. Both doors, because both moments are real.
   */
  counterStaff?: { name: string; phone?: string }[];
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
  name: string;
  /** Optional — plenty of counter staff are known by name and face only. */
  phone?: string;
  shopId: string;
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
  /** Everyone who can be given a territory — admin only (others get []). */
  bookers: { id: string; name: string }[];
  /**
   * The active shops on THIS person's round.
   *
   * A booker gets his territory (the rounds he is on, or the rounds nobody
   * covers if he has none, or everything while no territory is set at all);
   * a rider and the owner get every active shop. Screens should prefer this
   * over filtering `shops` themselves — it is what makes ten bookers stop
   * working the same street.
   */
  routeShops: Shop[];
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
   * True only in preview mode.
   *
   * Screens should not branch on this — two stores that behave differently is
   * HANDOFF section 3, and every one of these is a place the demo can drift
   * from the real app. It exists for the one thing preview genuinely cannot
   * do: reach a Cloud Function. Nobody is signed in, so anything that needs
   * the server has to be faked locally rather than fail with an error the
   * demo user cannot act on.
   */
  demo: boolean;
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
  /**
   * Owner-only: change what the goods on an order COST, before the van goes.
   *
   * The booker negotiates a discount off a fixed trade price; this changes the
   * trade price itself for this one order — the case the discount box cannot
   * express, where the owner has agreed a different rate with a shop and the
   * order was written at the standard one.
   *
   * Prices only. Quantities are deliberately not editable here: `committedQty`
   * moves at booking and would have to move with them, and a stock correction
   * hidden inside a price screen is how stock quietly stops matching the
   * shelf. Cancel and rebook is the honest path for a changed basket.
   *
   * Refused once the order has left `booked`/`assigned` — after that the
   * shop is holding paper with a number on it, and the rider is billing
   * against delivered quantities.
   */
  repriceOrder(orderId: string, prices: { productId: string; unitPrice: number }[]): void;
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
  /**
   * Recount `committedQty` for every product from the orders that are actually
   * live, and write back whatever the count says.
   *
   * `committedQty` is a running counter, moved by `increment()` from several
   * phones at once — booking adds, cancelling and delivering subtract. That is
   * the right design for concurrent writes and it has one weakness: anything
   * that removes an order WITHOUT going through the app decrements nothing,
   * and the counter drifts up and stays there. A console delete during testing
   * does exactly that, and the owner is then told 144 pieces are committed
   * when 15 are.
   *
   * Nothing in the app can cause this — every path is symmetric — so this is a
   * repair tool, not a scheduled job. It is owner-only and it reads the orders
   * already on the device rather than re-querying: the windowed slice
   * (lib/window.ts) always contains every unpaid and undelivered order, which
   * is precisely the set that can be committed.
   */
  recountCommitted(): void;
  /** Supplier delivery or a count correction — atomic increment, logged. */
  adjustStock(productId: string, delta: number, note: string): void;
  addShop(s: ShopInput): void;
  updateShop(id: string, patch: Partial<Shop>): void;
  /**
   * Remove a shop for good — owner only, and the rules enforce that.
   *
   * Deactivating is still the right move for a shop that has traded: its
   * orders and payments stay behind and keep pointing at a shop that no
   * longer exists, and the live khata on the document goes with it. This is
   * for the wrong entries and the test rows, which every real account
   * collects and could not previously get rid of. The confirmation — twice
   * over when money is owed — belongs to the screen.
   */
  deleteShop(id: string): void;
  /**
   * Pin an existing shop. Separate from updateShop because the store is what
   * knows who is standing there — and because the rules let a RIDER write
   * exactly these two keys and nothing else, so the call sites must not be
   * able to smuggle another field along.
   */
  setShopLocation(shopId: string, fix: { lat: number; lng: number; accuracyM: number }): void;
  setShopPhoto(shopId: string, photoUrl: string): void;
  /**
   * Add a round. Owner from More → Areas, booker from the shop form's area
   * sheet when what he typed matches nothing — he is the one standing in a
   * street the company has never worked.
   *
   * Creating only. Renaming, retiring and putting a rider or booker on a round
   * stay the owner's, enforced in firestore.rules.
   */
  addArea(name: string): void;
  /** Renames the area AND every shop still filed under the old name. */
  renameArea(id: string, name: string): void;
  /**
   * Set or clear the company logo. Separate from `updateSettings` because that
   * strips undefined before writing — `{ logoUrl: undefined }` through it is a
   * no-op, so "Remove" would have silently done nothing while the demo store
   * cleared it happily. Two stores that disagree is HANDOFF section 3.
   */
  setLogo(url: string | null): void;
  setAreaActive(id: string, active: boolean): void;
  /**
   * Put a rider on a round, or take him off it (null). Future bookings only —
   * orders already written keep the van they were booked to.
   */
  setAreaRider(id: string, riderId: string | null): void;
  /**
   * Set who covers a round — the WHOLE list, not a delta. An empty array
   * leaves it unclaimed.
   *
   * Several bookers on one round is allowed on purpose (see `Area.bookerIds`).
   * The caller passes the complete new list because it already holds it from
   * `bookersOf()`, which lets one write both replace the list and retire the
   * legacy single-booker field — no read-modify-write, and no window where a
   * round is claimed by nobody.
   */
  setAreaBooker(id: string, bookerIds: string[]): void;
  /**
   * Start syncing a collection this screen needs. Prefer the `useNeed` hook.
   *
   * Idempotent, and once started the listener runs for the rest of the
   * session — Firestore re-bills a listener disconnected for over 30 minutes
   * as a brand-new query, so detaching on navigation would cost more than it
   * saves. This buys the first read, not every read.
   */
  need(key: LazyKey): void;
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
  /** Invite a Google address. The person is "Invited" until they sign in. */
  addEmployee(email: string, name: string, role: Employee['role']): Promise<void>;
  /**
   * Mint a login instead of asking for one — the owner picks the ID and the
   * PIN, and the person can sign in the moment he is handed them. Resolves with
   * the pair to write on the slip.
   */
  createStaffLogin(input: {
    name: string;
    loginId: string;
    pin: string;
    role: Employee['role'];
  }): Promise<{ loginId: string; companyCode: string }>;
  /**
   * The owner IS the reset flow — nothing can be mailed to a staff address.
   * Resolves with the pair to read out, taken from the server rather than from
   * the settings listener, which may not have delivered the code yet.
   */
  resetStaffPin(email: string, pin: string): Promise<{ loginId: string; companyCode: string }>;
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

/**
 * Declare what this screen reads. Call it at the top of any component that
 * touches a lazy collection — including one that only reads a COUNT of it,
 * which is the easy case to forget and shows up as a permanent zero.
 *
 *   useNeed('expenses', 'fixedCharges');
 *
 * Safe to call from several screens for the same key; the first one starts the
 * listener and the rest are no-ops.
 */
export function useNeed(...keys: LazyKey[]): void {
  const { need } = useStore();
  // The key list is spread into the dep array, so a screen with a fixed set of
  // keys re-runs this only when one of them actually changes.
  React.useEffect(() => {
    keys.forEach(need);
  }, [need, ...keys]); // eslint-disable-line react-hooks/exhaustive-deps
}
