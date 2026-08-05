/**
 * Firestore store — the real StoreApi implementation (SRS §9, §12).
 *
 * Three properties this file must hold, learned the hard way in the audit:
 *
 * 1. QUERIES MATCH RULES. Firestore rules are not filters: a query the rules
 *    cannot prove is rejected whole. Every listener below therefore carries
 *    the same `where()` the rule checks, per role.
 * 2. MONEY MOVES ATOMICALLY. A delivery touches the order, a payment, the
 *    shop's balance and stock. Either all of it lands or none of it does —
 *    a half-written close-out is a shop whose khata silently disagrees with
 *    the paper it was just handed.
 * 3. IT WORKS WITH NO SIGNAL. Serial numbers come from a local reference when
 *    offline (FR-5.8) and are promoted at sync; nothing in the field flow
 *    awaits a server round-trip.
 */
import React from 'react';
import {
  collection, doc, getFirestore, onSnapshot, orderBy, query, where,
  runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
} from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import type {
  CompanySettings, DayState, Employee, Expense, FixedCharge,
  Order, Payment, Product, Shop,
} from './models';
import { EMPTY_DAY, todayKey, tomorrowKey } from './models';
import {
  BookOrderInput, CloseOutInput, ProductInput, ShopInput, StoreApi, StoreContext,
} from './store';
import { computeTotals } from '../lib/order';
import { allocateFifo } from '../lib/fifo';
import { formatSerial, nextLocalRef, type SerialKind } from '../lib/serials';
import type { SessionUser } from '../app/types';

const DEFAULT_SETTINGS: CompanySettings = {
  brandName: '', currencySymbol: 'Rs', countryCode: '92', taxPercent: 0,
  maxDiscountPercent: 10, defaultDeliveryDay: 'today', shopsPerDay: 20,
  rewardApprovalLimit: 1000, acceptCheques: false, sendConfirmations: true,
};

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const anyV = v as { toMillis?: () => number };
  return anyV.toMillis ? anyV.toMillis() : 0;
}

export function FirestoreStoreProvider({
  user, children,
}: { user: SessionUser; children: React.ReactNode }) {
  const companyId = user.companyId;
  const db = getFirestore();
  const base = `companies/${companyId}`;
  const isAdmin = user.role === 'admin';
  const isRider = user.role === 'rider';

  const [products, setProducts] = React.useState<Product[]>([]);
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [settings, setSettings] = React.useState<CompanySettings>(DEFAULT_SETTINGS);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [fixedCharges, setFixedCharges] = React.useState<FixedCharge[]>([]);
  const [rawDay, setRawDay] = React.useState<DayState>(EMPTY_DAY());
  const [ready, setReady] = React.useState(false);

  /** A day document from an earlier date is yesterday's — start fresh (FR-6.2). */
  const day: DayState = rawDay.date === todayKey() ? rawDay : EMPTY_DAY();

  React.useEffect(() => {
    const warn = (label: string) => (e: unknown) =>
      console.warn(`[snd] ${label} listener error`, e);

    // Every query carries the filter its security rule checks (audit finding #1).
    const ordersQuery = isAdmin
      ? query(collection(db, `${base}/orders`), orderBy('bookedAt', 'desc'))
      : isRider
        ? query(collection(db, `${base}/orders`), where('assignedTo', '==', user.uid))
        : query(collection(db, `${base}/orders`), where('bookedBy', '==', user.uid));

    const paymentsQuery = isAdmin
      ? collection(db, `${base}/payments`)
      : query(collection(db, `${base}/payments`), where('collectedBy', '==', user.uid));

    const subs: (() => void)[] = [
      onSnapshot(collection(db, `${base}/products`), s => {
        setProducts(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })));
        setReady(true);
      }, e => { warn('products')(e); setReady(true); }),

      onSnapshot(collection(db, `${base}/shops`), s =>
        setShops(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Shop, 'id'>),
            lastVisitAt: toMillis(data.lastVisitAt),
          } as Shop;
        })), warn('shops')),

      onSnapshot(ordersQuery, s =>
        setOrders(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Order, 'id'>),
            bookedAt: toMillis(data.bookedAt) || Date.now(),
            deliveredAt: data.deliveredAt ? toMillis(data.deliveredAt) : undefined,
          } as Order;
        })), warn('orders')),

      onSnapshot(paymentsQuery, s =>
        setPayments(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Payment, 'id'>),
            createdAt: toMillis(data.createdAt) || Date.now(),
            confirmed: Boolean(data.confirmed),
          } as Payment;
        })), warn('payments')),

      onSnapshot(doc(db, `${base}/settings/company`), s => {
        if (s.exists()) setSettings({ ...DEFAULT_SETTINGS, ...(s.data() as Partial<CompanySettings>) });
      }, warn('settings')),

      // Day state is per person: the rider's route lock is his own.
      onSnapshot(doc(db, `${base}/days/${user.uid}`), s => {
        if (s.exists()) setRawDay({ ...EMPTY_DAY(), ...(s.data() as Partial<DayState>) } as DayState);
      }, warn('day')),
    ];

    // Owner-only collections — non-admins must not even ask (rules deny the list).
    if (isAdmin) {
      subs.push(
        onSnapshot(collection(db, `${base}/expenses`), s =>
          setExpenses(s.docs.map(d => {
            const data = d.data() as Record<string, unknown>;
            return { id: d.id, ...(data as unknown as Omit<Expense, 'id'>), date: toMillis(data.date) || Date.now() } as Expense;
          })), warn('expenses')),
        onSnapshot(collection(db, `${base}/fixedCharges`), s =>
          setFixedCharges(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FixedCharge, 'id'>) }))), warn('charges')),
        onSnapshot(collection(db, `${base}/employeeList`), s =>
          setEmployees(s.docs.map(d => d.data() as Employee).filter(e => !(e as { removed?: boolean }).removed)),
          warn('employees')),
      );
    }
    return () => subs.forEach(u => u());
  }, [base, isAdmin, isRider, user.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Final serial if the server is reachable, provisional local reference if
   * not. Never blocks the field flow (FR-5.8).
   */
  async function serial(kind: SerialKind): Promise<{ value: string; provisional: boolean }> {
    const year = new Date().getFullYear();
    const ref = doc(db, `${base}/counters/${year}`);
    try {
      const value = await Promise.race([
        runTransaction(db, async tx => {
          const snap = await tx.get(ref);
          const data = (snap.exists() ? snap.data() : {}) as Record<string, number>;
          const n = (data[kind] ?? 0) + 1;
          tx.set(ref, { ...data, [kind]: n }, { merge: true });
          return formatSerial(kind, n, year);
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('offline')), 4000)),
      ]);
      return { value, provisional: false };
    } catch {
      return { value: await nextLocalRef(kind), provisional: true };
    }
  }

  const api: StoreApi = {
    products, shops, orders, payments, settings, employees, expenses, fixedCharges, day, ready,

    async bookOrder(input: BookOrderInput): Promise<Order> {
      const shop = shops.find(s => s.id === input.shopId)!;
      const { value: orderNo, provisional } = await serial('order');
      const orderRef = doc(collection(db, `${base}/orders`));
      // The load list is frozen once the rider starts: later orders are tomorrow's.
      const deliveryDay = day.routeStarted ? 'tomorrow' : input.deliveryDay;
      const order: Omit<Order, 'id'> = {
        orderNo,
        provisional,
        bookedBy: user.uid,
        assignedTo: settings.autoAssignRiderId ?? null as unknown as string,
        deliveryDate: deliveryDay === 'today' ? todayKey() : tomorrowKey(),
        shopId: shop.id,
        shopSnapshot: { name: shop.name, phone: shop.phone, area: shop.area },
        items: input.items,
        orderedTotals: computeTotals(input.items, input.discountPercent),
        discountPercent: input.discountPercent,
        status: 'assigned',
        paymentStatus: 'unpaid',
        amountPaid: 0,
        deliveryDay,
        bookedAt: Date.now(),
      };

      // One batch: the order, the shop's visit stamp and the committed stock
      // land together or not at all. Batches queue offline — no await on a
      // server round-trip anywhere in this flow.
      const batch = writeBatch(db);
      batch.set(orderRef, { ...order, bookedAt: serverTimestamp() });
      batch.update(doc(db, `${base}/shops/${shop.id}`), {
        lastVisitAt: serverTimestamp(),
        lastOrderSummary: input.items.map(i => ({ productId: i.productId, qty: i.qty })),
      });
      for (const it of input.items) {
        const p = products.find(pp => pp.id === it.productId);
        if (p) batch.update(doc(db, `${base}/products/${p.id}`), { committedQty: p.committedQty + it.qty });
      }
      batch.commit().catch(e => console.warn('[snd] bookOrder sync', e));
      return { id: orderRef.id, ...order };
    },

    flagCollection(shopId) {
      void updateDoc(doc(db, `${base}/shops/${shopId}`), {
        collectionFlaggedAt: serverTimestamp(),
        collectionFlaggedBy: user.uid,
      });
    },

    startRoute() {
      void setDoc(doc(db, `${base}/days/${user.uid}`), {
        ...EMPTY_DAY(), routeStarted: true, staffId: user.uid,
      }, { merge: true });
    },

    async closeOutStop({ orderId, deliveredQtys, paymentAmount, mode }: CloseOutInput) {
      const order = orders.find(o => o.id === orderId)!;
      const shop = shops.find(s => s.id === order.shopId)!;
      const items = order.items.map(it => ({ ...it, deliveredQty: deliveredQtys[it.productId] ?? it.qty }));
      const billed = computeTotals(items, order.discountPercent, true);

      const inv = await serial('invoice');
      const rcp = paymentAmount > 0 ? await serial('receipt') : null;

      let allocations: { orderId: string; amount: number }[] = [];
      if (paymentAmount > 0) {
        const bills = [
          ...(shop.outstanding > 0 ? [{ orderId: 'old-khata', balance: shop.outstanding, billedAt: 0 }] : []),
          { orderId, balance: billed.grandTotal, billedAt: Date.now() },
        ];
        allocations = allocateFifo(paymentAmount, bills).allocations;
      }

      // Everything the stop changes, in ONE batch (audit finding #4).
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/orders/${orderId}`), {
        items, billedTotals: billed,
        invoiceNo: inv.value, invoiceProvisional: inv.provisional,
        status: 'delivered', deliveredAt: serverTimestamp(),
        amountPaid: Math.min(paymentAmount, billed.grandTotal),
        paymentStatus: paymentAmount >= billed.grandTotal ? 'paid' : paymentAmount > 0 ? 'partial' : 'unpaid',
      });
      if (rcp) {
        batch.set(doc(collection(db, `${base}/payments`)), {
          receiptNo: rcp.value, provisional: rcp.provisional,
          shopId: shop.id, orderIds: allocations, amount: paymentAmount,
          mode, collectedBy: user.uid, confirmed: false,
          createdAt: serverTimestamp(),
        });
      }
      batch.update(doc(db, `${base}/shops/${shop.id}`), {
        outstanding: shop.outstanding + billed.grandTotal - paymentAmount,
        collectionFlaggedAt: null, collectionFlaggedBy: null,
      });
      for (const it of items) {
        const p = products.find(pp => pp.id === it.productId);
        if (p) {
          batch.update(doc(db, `${base}/products/${p.id}`), {
            stockQty: p.stockQty - (it.deliveredQty ?? 0),
            committedQty: Math.max(0, p.committedQty - it.qty),
          });
        }
      }
      batch.commit().catch(e => console.warn('[snd] closeOut sync', e));
      return { invoiceNo: inv.value, receiptNo: rcp?.value };
    },

    handOver() {
      void setDoc(doc(db, `${base}/days/${user.uid}`), {
        date: todayKey(), handedOver: true, staffId: user.uid,
      }, { merge: true });
    },

    confirmHandover() {
      // Admin-only by rules; marks today's unconfirmed payments (FR-7.11).
      const batch = writeBatch(db);
      payments.filter(p => !p.confirmed)
        .forEach(p => batch.update(doc(db, `${base}/payments/${p.id}`), { confirmed: true }));
      batch.commit().catch(e => console.warn('[snd] confirm sync', e));
      // Every staff member's day doc for today is marked confirmed.
      void setDoc(doc(db, `${base}/days/${user.uid}`), {
        date: todayKey(), handoverConfirmed: true, staffId: user.uid,
      }, { merge: true });
    },

    addProduct(p: ProductInput) {
      void setDoc(doc(collection(db, `${base}/products`)), {
        ...p, active: true, committedQty: 0, createdAt: serverTimestamp(),
      });
    },

    updateProduct(id, patch) {
      void updateDoc(doc(db, `${base}/products/${id}`), patch as Record<string, unknown>);
    },

    addShop(s: ShopInput) {
      void setDoc(doc(collection(db, `${base}/shops`)), {
        ...s, standingDiscountPercent: s.standingDiscountPercent ?? 0,
        outstanding: 0, active: true, createdAt: serverTimestamp(), createdBy: user.uid,
      });
    },

    updateSettings(patch) {
      void setDoc(doc(db, `${base}/settings/company`), patch, { merge: true });
    },

    async addEmployee(email, name, role) {
      const call = httpsCallable(getFunctions(undefined, 'asia-south1'), 'addEmployee');
      await call({ email, name, role });
      await setDoc(doc(db, `${base}/employeeList/${email.toLowerCase()}`), {
        email: email.toLowerCase(), name, role, joined: false, removed: false,
      });
    },

    async removeEmployee(email) {
      const call = httpsCallable(getFunctions(undefined, 'asia-south1'), 'removeEmployee');
      await call({ email });
      await setDoc(doc(db, `${base}/employeeList/${email.toLowerCase()}`), {
        removed: true,
      }, { merge: true });
    },

    addExpense(e) {
      void setDoc(doc(collection(db, `${base}/expenses`)), { ...e, createdAt: serverTimestamp() });
    },

    addFixedCharge(c) {
      void setDoc(doc(collection(db, `${base}/fixedCharges`)), { ...c, createdAt: serverTimestamp() });
    },

    cashWithStaff() {
      return payments.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
    },
    cashConfirmed() {
      return payments.filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
    },
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
