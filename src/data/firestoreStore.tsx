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
import { Alert } from 'react-native';
import {
  collection, deleteField, doc, getFirestore, increment, onSnapshot, orderBy,
  query, where, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
} from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { getCrashlytics, recordError } from '@react-native-firebase/crashlytics';
import type {
  CompanySettings, DayState, Employee, Expense, FixedCharge,
  Order, Payment, Product, Shop,
} from './models';
import { EMPTY_DAY, todayKey, tomorrowKey } from './models';
import {
  BookOrderInput, CloseOutInput, CollectionInput, ProductInput, ShopInput, StoreApi, StoreContext,
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

/**
 * A write the server REFUSED (rules, quota) — not an offline queue. Offline
 * writes stay pending and never reach here; a rejection means the change was
 * thrown away, and in a cash app that must be LOUD, never a console line
 * (audit: silent write failure was the worst failure mode in the codebase).
 */
function writeRejected(what: string) {
  return (e: unknown) => {
    console.warn(`[snd] ${what} rejected`, e);
    try {
      recordError(getCrashlytics(), e instanceof Error ? e : new Error(`${what}: ${String(e)}`));
    } catch {} // crash reporting must never crash
    const detail = e instanceof Error ? e.message : String(e);
    Alert.alert(
      'Not saved',
      `${what} was refused by the server and has NOT been recorded.\n\n` +
        `Show this to the owner if it keeps happening:\n${detail}`,
    );
  };
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
  const [costs, setCosts] = React.useState<Record<string, number>>({});
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [settings, setSettings] = React.useState<CompanySettings>(DEFAULT_SETTINGS);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [staffNames, setStaffNames] = React.useState<Record<string, string>>({});
  const [staffDays, setStaffDays] = React.useState<DayState[]>([]);
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
        // costPrice must NEVER ride on the product doc — every role syncs this
        // collection, and margins are owner-only (FR-15.1). Self-heal any doc
        // an older build wrote: copy the cost to productCosts, then strip it.
        if (isAdmin) {
          s.docs.forEach(d => {
            const raw = d.data() as { costPrice?: number };
            if (typeof raw.costPrice === 'number') {
              setDoc(doc(db, `${base}/productCosts/${d.id}`), { costPrice: raw.costPrice }, { merge: true })
                .then(() => updateDoc(d.ref, { costPrice: deleteField() }))
                .catch(warn('cost migration'));
            }
          });
        }
        setProducts(s.docs.map(d => {
          const data = { ...(d.data() as Omit<Product, 'id'>) };
          delete (data as { costPrice?: number }).costPrice;
          return { id: d.id, ...data };
        }));
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
        // Margins live HERE, in an admin-only collection — never on the
        // product docs every staff phone syncs (FR-15.1).
        onSnapshot(collection(db, `${base}/productCosts`), s => {
          const m: Record<string, number> = {};
          s.docs.forEach(d => {
            const v = (d.data() as { costPrice?: number }).costPrice;
            if (typeof v === 'number') m[d.id] = v;
          });
          setCosts(m);
        }, warn('productCosts')),
        // Every staff member's day doc — the owner's view of who handed over
        // and is waiting for their cash to be counted (FR-7.11).
        onSnapshot(collection(db, `${base}/days`), s =>
          setStaffDays(s.docs.map(d => ({
            ...EMPTY_DAY(), ...(d.data() as Partial<DayState>), staffId: d.id,
          }) as DayState)), warn('days')),
        // uid → display name, so handover cards can say WHO is waiting.
        onSnapshot(collection(db, `${base}/users`), s => {
          const m: Record<string, string> = {};
          s.docs.forEach(d => { m[d.id] = (d.data() as { name?: string }).name || ''; });
          setStaffNames(m);
        }, warn('users')),
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

  // Admin sees margins merged back in; staff phones never hold a costPrice.
  const productsView = React.useMemo(
    () => (isAdmin
      ? products.map(p => (costs[p.id] !== undefined ? { ...p, costPrice: costs[p.id] } : p))
      : products),
    [isAdmin, products, costs],
  );

  const api: StoreApi = {
    products: productsView, shops, orders, payments, settings, employees,
    staffDays, staffNames, expenses, fixedCharges, day, ready,

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
        // increment(), not a read-modify-write: the rider is moving the same
        // counters from his phone at the same time (audit blocker #2).
        if (p) batch.update(doc(db, `${base}/products/${p.id}`), { committedQty: increment(it.qty) });
      }
      batch.commit().catch(writeRejected(`Order ${orderNo}`));
      return { id: orderRef.id, ...order };
    },

    flagCollection(shopId) {
      updateDoc(doc(db, `${base}/shops/${shopId}`), {
        collectionFlaggedAt: serverTimestamp(),
        collectionFlaggedBy: user.uid,
      }).catch(writeRejected('Collection flag'));
    },

    startRoute() {
      setDoc(doc(db, `${base}/days/${user.uid}`), {
        ...EMPTY_DAY(), routeStarted: true, staffId: user.uid,
      }, { merge: true }).catch(writeRejected('Start route'));
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
      // increment() everywhere a counter moves: the booker's phone is moving
      // committedQty and outstanding at the same time (audit blocker #2).
      batch.update(doc(db, `${base}/shops/${shop.id}`), {
        outstanding: increment(billed.grandTotal - paymentAmount),
        collectionFlaggedAt: null, collectionFlaggedBy: null,
      });
      for (const it of items) {
        const p = products.find(pp => pp.id === it.productId);
        if (p) {
          batch.update(doc(db, `${base}/products/${p.id}`), {
            stockQty: increment(-(it.deliveredQty ?? 0)),
            committedQty: increment(-it.qty),
          });
        }
      }
      batch.commit().catch(writeRejected(`Delivery ${inv.value}`));
      return { invoiceNo: inv.value, receiptNo: rcp?.value };
    },

    /**
     * Money collected on a visit with no delivery (FR-7.4) — the ordinary
     * khata call. FIFO across the shop's oldest bills; the receipt says what
     * it cleared. `exception` marks the booker's forced-cash case (FR-7.13).
     */
    async collect({ shopId, amount, mode, exception }: CollectionInput) {
      const rcp = await serial('receipt');
      const unpaid = orders
        .filter(o => o.shopId === shopId && o.status === 'delivered' && o.paymentStatus !== 'paid')
        .map(o => ({
          orderId: o.id,
          balance: (o.billedTotals?.grandTotal ?? 0) - o.amountPaid,
          billedAt: o.deliveredAt ?? o.bookedAt,
        }))
        .filter(b => b.balance > 0);
      const { allocations } = allocateFifo(amount, unpaid);

      const batch = writeBatch(db);
      batch.set(doc(collection(db, `${base}/payments`)), {
        receiptNo: rcp.value, provisional: rcp.provisional,
        shopId, orderIds: allocations, amount, mode,
        collectedBy: user.uid, confirmed: false,
        exception: exception === true,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, `${base}/shops/${shopId}`), {
        // CollectScreen caps the amount at what the shop owes; increment keeps
        // two same-moment collections from resurrecting a stale balance.
        outstanding: increment(-amount),
        collectionFlaggedAt: null, collectionFlaggedBy: null,
      });
      for (const a of allocations) {
        const o = orders.find(oo => oo.id === a.orderId);
        if (!o) continue;
        const paid = o.amountPaid + a.amount;
        batch.update(doc(db, `${base}/orders/${o.id}`), {
          amountPaid: increment(a.amount),
          paymentStatus: paid >= (o.billedTotals?.grandTotal ?? 0) ? 'paid' : 'partial',
        });
      }
      batch.commit().catch(writeRejected(`Receipt ${rcp.value}`));
      return { receiptNo: rcp.value };
    },

    handOver() {
      setDoc(doc(db, `${base}/days/${user.uid}`), {
        date: todayKey(), handedOver: true, staffId: user.uid,
      }, { merge: true }).catch(writeRejected('Handover'));
    },

    /**
     * Owner counts ONE person's cash and confirms exactly that person's
     * payments (FR-7.11) — confirming the rider must never silently mark the
     * booker's uncounted exception cash as received (audit blocker #4).
     */
    confirmHandover(staffId: string) {
      const toConfirm = payments.filter(p => !p.confirmed && p.collectedBy === staffId);
      // Firestore batches cap at 500 writes — chunk, one day-doc write at the end.
      for (let i = 0; i < toConfirm.length; i += 400) {
        const batch = writeBatch(db);
        toConfirm.slice(i, i + 400)
          .forEach(p => batch.update(doc(db, `${base}/payments/${p.id}`), { confirmed: true }));
        batch.commit().catch(writeRejected('Cash confirmation'));
      }
      // The staff member's own day doc flips, so THEIR screen shows "confirmed".
      setDoc(doc(db, `${base}/days/${staffId}`), {
        date: todayKey(), handoverConfirmed: true, staffId,
      }, { merge: true }).catch(writeRejected('Handover confirmation'));
    },

    addProduct({ costPrice, ...p }: ProductInput) {
      const ref = doc(collection(db, `${base}/products`));
      // The margin goes to the admin-only productCosts, never the product doc.
      setDoc(ref, {
        ...p, active: true, committedQty: 0, createdAt: serverTimestamp(),
      }).catch(writeRejected('New product'));
      if (costPrice !== undefined && costPrice > 0) {
        setDoc(doc(db, `${base}/productCosts/${ref.id}`), { costPrice }, { merge: true })
          .catch(writeRejected('Cost price'));
      }
    },

    updateProduct(id, patch) {
      const { costPrice, ...rest } = patch;
      if (costPrice !== undefined) {
        setDoc(doc(db, `${base}/productCosts/${id}`), { costPrice }, { merge: true })
          .catch(writeRejected('Cost price'));
      }
      if (Object.keys(rest).length > 0) {
        updateDoc(doc(db, `${base}/products/${id}`), rest as Record<string, unknown>)
          .catch(writeRejected('Product update'));
      }
    },

    addShop(s: ShopInput) {
      setDoc(doc(collection(db, `${base}/shops`)), {
        ...s, standingDiscountPercent: s.standingDiscountPercent ?? 0,
        outstanding: 0, active: true, createdAt: serverTimestamp(), createdBy: user.uid,
      }).catch(writeRejected('New shop'));
    },

    updateSettings(patch) {
      setDoc(doc(db, `${base}/settings/company`), patch, { merge: true })
        .catch(writeRejected('Settings'));
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
      setDoc(doc(collection(db, `${base}/expenses`)), { ...e, createdAt: serverTimestamp() })
        .catch(writeRejected('Expense'));
    },

    addFixedCharge(c) {
      setDoc(doc(collection(db, `${base}/fixedCharges`)), { ...c, createdAt: serverTimestamp() })
        .catch(writeRejected('Fixed charge'));
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
