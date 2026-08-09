/**
 * Dev data store — in-memory StoreApi implementation for preview mode.
 * Same shape as the Firestore store; screens can't tell the difference.
 * Seeded with the owner's real products.
 */
import React from 'react';
import type {
  Area, CompanySettings, DayState, Employee, Expense, FixedCharge, FloatMovement,
  Order, Payment, Product, RewardClaim, Shop,
} from './models';
import { DEFAULT_VISIBILITY, EMPTY_DAY, todayKey, tomorrowKey } from './models';
import {
  BookOrderInput, CloseOutInput, CollectionInput, ProductInput,
  RewardClaimInput, RewardStaffInput, ShopInput, StoreApi, StoreContext,
} from './store';
import { computeTotals, nextSerial } from '../lib/order';
import { allocateFifo } from '../lib/fifo';

const now = Date.now();
const seedProducts: Product[] = [
  { id: 'p1', name: 'Face Wash', code: 'FW-01', unit: 'pc', packSize: '120 ml',
    tradePrice: 900, mrp: 1050, stockQty: 240, committedQty: 0, active: true },
  { id: 'p2', name: 'Sunblock', code: 'SB-01', unit: 'pc', packSize: '90 ml',
    tradePrice: 750, mrp: 895, stockQty: 180, committedQty: 0, active: true },
];

/** The demo areas — the same list the owner would build in Areas. */
const seedAreas: Area[] = [
  { id: 'a1', name: 'Saddar', active: true },
  { id: 'a2', name: 'Cantt', active: true },
];

// Real Lahore coordinates, and pinned on purpose: the demo is the only place
// the area sweep can be seen working before the field has pinned anything.
// s3 is deliberately left unpinned so the "not on the map yet" case shows too.
const pin = (lat: number, lng: number) => ({ lat, lng, accuracyM: 8, savedAt: now, savedBy: 'demo' });

const seedShops: Shop[] = [
  { id: 's1', name: 'Beauty Corner', ownerName: 'Rashid', phone: '923001234567', area: 'Saddar',
    outstanding: 2300, standingDiscountPercent: 0, active: true,
    // Counter staff live on their shop now — same as the real store.
    counterStaff: [
      { id: 'rs1', name: 'Salman (counter)', phone: '923001112233', active: true, addedBy: 'booker' },
    ],
    location: pin(31.5580, 74.3280),
    lastVisitAt: now - 8 * 86400_000,
    lastOrderSummary: [{ productId: 'p1', qty: 6 }, { productId: 'p2', qty: 4 }] },
  { id: 's2', name: 'Glow Mart', ownerName: 'Naveed', phone: '923009876543', area: 'Saddar',
    outstanding: 0, standingDiscountPercent: 0, active: true,
    location: pin(31.5595, 74.3310),
    lastVisitAt: now - 9 * 86400_000,
    lastOrderSummary: [{ productId: 'p2', qty: 12 }] },
  { id: 's3', name: 'City Cosmetics', ownerName: 'Imran', phone: '923215551234', area: 'Cantt',
    outstanding: 6439, standingDiscountPercent: 2, active: true,
    lastVisitAt: now - 15 * 86400_000 },
];

const seedSettings: CompanySettings = {
  brandName: 'Preview Skincare',
  currencySymbol: 'Rs',
  countryCode: '92',
  taxPercent: 0,
  maxDiscountPercent: 10,
  defaultDeliveryDay: 'tomorrow',
  shopsPerDay: 20,
  rewardApprovalLimit: 1000,
  rewardPerPiece: 40,
  acceptCheques: false,
  sendConfirmations: true,
  visibility: DEFAULT_VISIBILITY,
};

interface StoreState {
  products: Product[];
  shops: Shop[];
  areas: Area[];
  orders: Order[];
  payments: Payment[];
  day: DayState;
  settings: CompanySettings;
  employees: Employee[];
  expenses: Expense[];
  fixedCharges: FixedCharge[];
  rewardClaims: RewardClaim[];
  floatMovements: FloatMovement[];
}

export function DevStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<StoreState>({
    products: seedProducts,
    shops: seedShops,
    areas: seedAreas,
    orders: [],
    payments: [],
    day: EMPTY_DAY(),
    settings: seedSettings,
    employees: [
      { email: 'owner@example.com', name: 'You (preview)', role: 'admin', joined: true },
    ],
    expenses: [],
    fixedCharges: [],
    rewardClaims: [],
    floatMovements: [
      { id: 'f1', staffId: 'booker', amount: 2000, kind: 'issue', createdAt: now - 86400_000 },
    ],
  });

  const api: StoreApi = {
    ...state,
    ready: true,
    // Nothing in preview mode ever leaves the phone, so nothing is ever queued.
    pendingWrites: 0,
    async flushPendingWrites() { return true; },
    // Preview stand-ins: the demo's single rider is the only staff member.
    staffDays: state.day.handedOver ? [{ ...state.day, staffId: 'rider' }] : [],
    staffNames: { rider: 'Delivery Rider (demo)', booker: 'Order Booker (demo)' },
    riders: [{ id: 'rider', name: 'Delivery Rider (demo)' }],
    bookers: [{ id: 'booker', name: 'Order Booker (demo)' }],
    // One booker covers the whole demo, so his round is every live shop.
    routeShops: state.shops.filter(s => s.active),
    // The demo books everything to its one rider, so nothing is ever orphaned.
    unassignedOrders: [],
    riderForShop() { return 'rider'; },
    // Derived from the shops, same as the real store — two stores that differ
    // is how two production bugs hid for two rounds (HANDOFF section 3).
    rewardStaff: state.shops.flatMap(sh =>
      (sh.counterStaff ?? []).map(cs => ({ ...cs, shopId: sh.id }))),
    // Nothing is lazy in preview mode: the whole demo is already in memory.
    need() {},

    bookOrder(input: BookOrderInput): Order {
      const shop = state.shops.find(s => s.id === input.shopId)!;
      const deliveryDay = state.day.routeStarted ? 'tomorrow' : input.deliveryDay;
      const order: Order = {
        id: `o${Date.now()}`,
        orderNo: nextSerial('ORD'),
        bookedBy: 'preview-booker',
        assignedTo: 'preview-rider',
        deliveryDate: deliveryDay === 'today' ? todayKey() : tomorrowKey(),
        shopId: shop.id,
        shopSnapshot: { name: shop.name, phone: shop.phone, area: shop.area },
        items: input.items,
        orderedTotals: computeTotals(input.items, input.discountPercent, false, state.settings.taxPercent),
        discountPercent: input.discountPercent,
        status: 'assigned',
        paymentStatus: 'unpaid',
        amountPaid: 0,
        deliveryDay,
        bookedAt: Date.now(),
      };
      setState(st => ({
        ...st,
        orders: [...st.orders, order],
        products: st.products.map(p => {
          const it = input.items.find(i => i.productId === p.id);
          return it ? { ...p, committedQty: p.committedQty + it.qty } : p;
        }),
        shops: st.shops.map(s =>
          s.id === shop.id
            ? { ...s, lastVisitAt: Date.now(), lastOrderSummary: input.items.map(i => ({ productId: i.productId, qty: i.qty })) }
            : s,
        ),
      }));
      return order;
    },

    cancelOrder(orderId) {
      setState(st => {
        const order = st.orders.find(o => o.id === orderId);
        if (!order || (order.status !== 'booked' && order.status !== 'assigned')) return st;
        return {
          ...st,
          orders: st.orders.map(o => (o.id === orderId ? { ...o, status: 'cancelled' as const } : o)),
          products: st.products.map(p => {
            const it = order.items.find(i => i.productId === p.id);
            return it ? { ...p, committedQty: Math.max(0, p.committedQty - it.qty) } : p;
          }),
        };
      });
    },

    deferOrder(orderId) {
      setState(st => ({
        ...st,
        orders: st.orders.map(o =>
          o.id === orderId ? { ...o, deliveryDate: tomorrowKey(), deliveryDay: 'tomorrow' as const } : o),
      }));
    },

    returnOrder(orderId, reason) {
      setState(st => {
        const order = st.orders.find(o => o.id === orderId);
        if (!order) return st;
        return {
          ...st,
          orders: st.orders.map(o =>
            o.id === orderId ? { ...o, status: 'returned' as const, undeliveredReason: reason } : o),
          products: st.products.map(p => {
            const it = order.items.find(i => i.productId === p.id);
            return it ? { ...p, committedQty: Math.max(0, p.committedQty - it.qty) } : p;
          }),
        };
      });
    },

    flagCollection(shopId) {
      setState(st => ({
        ...st,
        shops: st.shops.map(s => (s.id === shopId ? { ...s, collectionFlagged: true } : s)),
      }));
    },

    startRoute() {
      setState(st => ({ ...st, day: { ...st.day, routeStarted: true } }));
    },

    undoStartRoute() {
      setState(st => ({ ...st, day: { ...st.day, routeStarted: false } }));
    },

    riderRouteStarted() {
      return state.day.routeStarted; // one shared day in the demo
    },

    closeOutStop({ orderId, deliveredQtys, paymentAmount, mode }: CloseOutInput) {
      const order = state.orders.find(o => o.id === orderId);
      // Same guard as the real store, so the demo cannot show a flow the
      // signed-in app refuses.
      if (!order || order.status === 'cancelled' || order.status === 'returned'
          || order.status === 'delivered') {
        throw new Error('This stop is no longer open. Go back to the route and reopen it.');
      }
      const items = order.items.map(it => ({ ...it, deliveredQty: deliveredQtys[it.productId] ?? it.qty }));
      const billed = computeTotals(items, order.discountPercent, true, state.settings.taxPercent);
      const invoiceNo = nextSerial('INV');

      let receiptNo: string | undefined;
      const shop = state.shops.find(s => s.id === order.shopId)!;
      let newOutstanding = shop.outstanding + billed.grandTotal;
      const payments = [...state.payments];
      if (paymentAmount > 0) {
        receiptNo = nextSerial('RCP');
        const bills = [
          ...(shop.outstanding > 0 ? [{ orderId: 'old-khata', balance: shop.outstanding, billedAt: 0 }] : []),
          { orderId: order.id, balance: billed.grandTotal, billedAt: Date.now() },
        ];
        const { allocations } = allocateFifo(paymentAmount, bills);
        payments.push({
          id: `pay${Date.now()}`, receiptNo, shopId: shop.id, orderIds: allocations,
          amount: paymentAmount, mode, collectedBy: 'rider', confirmed: false, createdAt: Date.now(),
        });
        newOutstanding -= paymentAmount;
      }

      setState(st => ({
        ...st,
        payments,
        orders: st.orders.map(o =>
          o.id === orderId
            ? {
                ...o, items, billedTotals: billed, invoiceNo, status: 'delivered',
                deliveredAt: Date.now(),
                amountPaid: Math.min(paymentAmount, billed.grandTotal),
                paymentStatus:
                  paymentAmount >= billed.grandTotal ? 'paid' : paymentAmount > 0 ? 'partial' : 'unpaid',
              }
            : o,
        ),
        products: st.products.map(p => {
          const it = items.find(i => i.productId === p.id);
          if (!it) return p;
          return {
            ...p,
            stockQty: p.stockQty - (it.deliveredQty ?? 0),
            committedQty: Math.max(0, p.committedQty - it.qty),
          };
        }),
        shops: st.shops.map(s =>
          s.id === shop.id ? { ...s, outstanding: newOutstanding, collectionFlagged: false } : s,
        ),
      }));
      return { invoiceNo, receiptNo };
    },

    collect({ shopId, amount, mode, exception }: CollectionInput) {
      const receiptNo = nextSerial('RCP');
      const unpaid = state.orders
        .filter(o => o.shopId === shopId && o.status === 'delivered' && o.paymentStatus !== 'paid')
        .map(o => ({
          orderId: o.id,
          balance: (o.billedTotals?.grandTotal ?? 0) - o.amountPaid,
          billedAt: o.deliveredAt ?? o.bookedAt,
        }))
        .filter(b => b.balance > 0);
      const { allocations } = allocateFifo(amount, unpaid);
      setState(st => ({
        ...st,
        payments: [...st.payments, {
          id: `pay${Date.now()}`, receiptNo, shopId, orderIds: allocations,
          amount, mode, collectedBy: exception ? 'booker' : 'rider',
          confirmed: false, exception: exception === true, createdAt: Date.now(),
        }],
        shops: st.shops.map(s =>
          s.id === shopId
            ? { ...s, outstanding: Math.max(0, s.outstanding - amount), collectionFlagged: false }
            : s),
        orders: st.orders.map(o => {
          const a = allocations.find(x => x.orderId === o.id);
          if (!a) return o;
          const paid = o.amountPaid + a.amount;
          return { ...o, amountPaid: paid,
            paymentStatus: paid >= (o.billedTotals?.grandTotal ?? 0) ? 'paid' as const : 'partial' as const };
        }),
      }));
      return { receiptNo };
    },

    handOver() {
      setState(st => ({ ...st, day: { ...st.day, handedOver: true } }));
    },

    confirmHandover(staffId: string) {
      setState(st => ({
        ...st,
        payments: st.payments.map(p => (p.collectedBy === staffId ? { ...p, confirmed: true } : p)),
        day: { ...st.day, handoverConfirmed: true },
      }));
    },

    addProduct(p: ProductInput) {
      setState(st => ({
        ...st,
        products: [...st.products, {
          id: `p${Date.now()}`, active: true, committedQty: 0, ...p,
        }],
      }));
    },

    updateProduct(id, patch) {
      setState(st => ({
        ...st,
        products: st.products.map(p => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },

    adjustStock(productId, delta) {
      setState(st => ({
        ...st,
        products: st.products.map(p => (p.id === productId ? { ...p, stockQty: p.stockQty + delta } : p)),
      }));
    },

    addShop({ openingBalance, location, ...s }: ShopInput) {
      setState(st => ({
        ...st,
        shops: [...st.shops, {
          id: `s${Date.now()}`, outstanding: openingBalance && openingBalance > 0 ? openingBalance : 0,
          active: true, standingDiscountPercent: s.standingDiscountPercent ?? 0, ...s,
          // Stamped by the store, exactly as firestoreStore does it.
          ...(location ? { location: { ...location, savedAt: Date.now(), savedBy: 'demo' } } : {}),
        }],
      }));
    },

    updateShop(id, patch) {
      setState(st => ({
        ...st,
        shops: st.shops.map(s => (s.id === id ? { ...s, ...patch } : s)),
      }));
    },

    deleteShop(id) {
      setState(st => ({ ...st, shops: st.shops.filter(s => s.id !== id) }));
    },

    setShopLocation(shopId, fix) {
      setState(st => ({
        ...st,
        shops: st.shops.map(s => (s.id === shopId
          ? { ...s, location: { ...fix, savedAt: Date.now(), savedBy: 'demo' } }
          : s)),
      }));
    },

    setShopPhoto(shopId, photoUrl) {
      setState(st => ({
        ...st,
        shops: st.shops.map(s => (s.id === shopId ? { ...s, photoUrl } : s)),
      }));
    },

    addArea(name) {
      const clean = name.trim();
      if (!clean) return;
      setState(st => (st.areas.some(a => a.name.toLowerCase() === clean.toLowerCase())
        ? st
        : { ...st, areas: [...st.areas, { id: `a${Date.now()}`, name: clean, active: true }] }));
    },

    // Renames the shops too, exactly as firestoreStore does — a shop left on
    // the old name would vanish from the area it belongs to.
    renameArea(id, name) {
      const clean = name.trim();
      if (!clean) return;
      setState(st => {
        const before = st.areas.find(a => a.id === id);
        if (!before || before.name === clean) return st;
        return {
          ...st,
          areas: st.areas.map(a => (a.id === id ? { ...a, name: clean } : a)),
          shops: st.shops.map(s => (s.area === before.name ? { ...s, area: clean } : s)),
        };
      });
    },

    setAreaActive(id, active) {
      setState(st => ({
        ...st,
        areas: st.areas.map(a => (a.id === id ? { ...a, active } : a)),
      }));
    },

    setAreaRider(id, riderId) {
      setState(st => ({
        ...st,
        areas: st.areas.map(a => (a.id === id ? { ...a, riderId: riderId ?? undefined } : a)),
      }));
    },

    setAreaBooker(id, bookerId) {
      setState(st => ({
        ...st,
        areas: st.areas.map(a => (a.id === id ? { ...a, bookerId: bookerId ?? undefined } : a)),
      }));
    },

    assignOrder(orderId, riderId) {
      setState(st => ({
        ...st,
        orders: st.orders.map(o => (o.id === orderId ? { ...o, assignedTo: riderId } : o)),
      }));
    },

    adjustShopBalance(shopId, delta) {
      setState(st => ({
        ...st,
        shops: st.shops.map(s => (s.id === shopId ? { ...s, outstanding: s.outstanding + delta } : s)),
      }));
    },

    voidPayment(paymentId) {
      setState(st => {
        const p = st.payments.find(pp => pp.id === paymentId);
        if (!p || p.voided) return st;
        const khataWasMoved = !p.exception || p.confirmed;
        return {
          ...st,
          payments: st.payments.map(pp =>
            pp.id === paymentId ? { ...pp, voided: true, voidedBy: 'admin', voidedAt: Date.now() } : pp),
          shops: khataWasMoved
            ? st.shops.map(s => (s.id === p.shopId ? { ...s, outstanding: s.outstanding + p.amount } : s))
            : st.shops,
          orders: khataWasMoved
            ? st.orders.map(o => {
                const a = (p.orderIds ?? []).find(x => x.orderId === o.id);
                if (!a) return o;
                const newPaid = o.amountPaid - a.amount;
                return {
                  ...o, amountPaid: newPaid,
                  paymentStatus: newPaid <= 0 ? 'unpaid' as const
                    : newPaid >= (o.billedTotals?.grandTotal ?? 0) ? 'paid' as const : 'partial' as const,
                };
              })
            : st.orders,
        };
      });
    },

    updateSettings(patch) {
      setState(st => ({ ...st, settings: { ...st.settings, ...patch } }));
    },

    async addEmployee(email, name, role) {
      setState(st => ({
        ...st,
        employees: [...st.employees, { email: email.toLowerCase(), name, role, joined: false }],
      }));
    },

    async removeEmployee(email) {
      setState(st => ({
        ...st,
        employees: st.employees.filter(e => e.email !== email.toLowerCase()),
      }));
    },

    addExpense(e) {
      setState(st => ({ ...st, expenses: [...st.expenses, { id: `e${Date.now()}`, ...e }] }));
    },

    removeExpense(id) {
      setState(st => ({ ...st, expenses: st.expenses.filter(e => e.id !== id) }));
    },

    addFixedCharge(c) {
      setState(st => ({ ...st, fixedCharges: [...st.fixedCharges, { id: `f${Date.now()}`, ...c }] }));
    },

    updateFixedCharge(id, patch) {
      setState(st => ({
        ...st,
        fixedCharges: st.fixedCharges.map(c => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },

    removeFixedCharge(id) {
      setState(st => ({ ...st, fixedCharges: st.fixedCharges.filter(c => c.id !== id) }));
    },

    addRewardStaff(s: RewardStaffInput) {
      setState(st => ({
        ...st,
        shops: st.shops.map(sh => (sh.id === s.shopId
          ? { ...sh, counterStaff: [...(sh.counterStaff ?? []), {
              id: `cs${Date.now()}`, name: s.name, active: true, addedBy: 'booker',
              ...(s.phone ? { phone: s.phone } : {}),
            }] }
          : sh)),
      }));
    },

    setRewardStaffActive(id, active) {
      setState(st => ({
        ...st,
        shops: st.shops.map(sh => ((sh.counterStaff ?? []).some(cs => cs.id === id)
          ? { ...sh, counterStaff: sh.counterStaff!.map(cs => (cs.id === id ? { ...cs, active } : cs)) }
          : sh)),
      }));
    },

    async submitRewardClaim({ staffId, pieces, shelfCount }: RewardClaimInput) {
      const rStaff = state.shops
        .flatMap(sh => (sh.counterStaff ?? []).map(cs => ({ ...cs, shopId: sh.id })))
        .find(r => r.id === staffId)!;
      const shop = state.shops.find(sh => sh.id === rStaff.shopId);
      const amount = pieces * state.settings.rewardPerPiece;
      const claimNo = nextSerial('RWD');
      setState(st => ({
        ...st,
        rewardClaims: [...st.rewardClaims, {
          id: `rc${Date.now()}`, claimNo, staffId, staffName: rStaff.name,
          shopId: rStaff.shopId, shopName: shop?.name ?? '', pieces, amount,
          shelfCount, by: 'booker', status: 'pending',
          overLimit: amount > st.settings.rewardApprovalLimit, createdAt: Date.now(),
        }],
        shops: st.shops.map(sh =>
          sh.id === rStaff.shopId
            ? { ...sh, lastShelfCount: shelfCount, lastShelfCountAt: Date.now() }
            : sh),
      }));
      return { claimNo };
    },

    decideRewardClaim(id, decision) {
      setState(st => {
        const claim = st.rewardClaims.find(c => c.id === id);
        return {
          ...st,
          rewardClaims: st.rewardClaims.map(c =>
            c.id === id ? { ...c, status: decision, decidedAt: Date.now(), decidedBy: 'admin' } : c),
          floatMovements: decision === 'approved' && claim
            ? [...st.floatMovements, {
                id: `f${Date.now()}`, staffId: claim.by, amount: claim.amount,
                kind: 'payout' as const, refClaimId: id, createdAt: Date.now(),
              }]
            : st.floatMovements,
        };
      });
    },

    moveFloat(staffId, amount, kind) {
      setState(st => ({
        ...st,
        floatMovements: [...st.floatMovements, {
          id: `f${Date.now()}`, staffId, amount, kind, createdAt: Date.now(),
        }],
      }));
    },

    recordShelfCount(shopId, count) {
      setState(st => ({
        ...st,
        shops: st.shops.map(sh =>
          sh.id === shopId ? { ...sh, lastShelfCount: count, lastShelfCountAt: Date.now() } : sh),
      }));
    },

    cashWithStaff() {
      return state.payments.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
    },
    cashConfirmed() {
      return state.payments.filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
    },
    floatBalance(staffId: string) {
      return state.floatMovements
        .filter(f => f.staffId === staffId)
        .reduce((s, f) => s + (f.kind === 'issue' ? f.amount : -f.amount), 0);
    },
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
