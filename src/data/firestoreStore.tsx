/**
 * Firestore store — the real StoreApi implementation (SRS §9, §12).
 *
 * Live listeners on companies/{companyId}/* feed the same interface the
 * dev store implements, so every screen works unchanged. Firestore's local
 * cache + queued writes give offline-first behaviour for free; serial
 * numbers come from the counters transaction (§8.1) and are therefore
 * final only once the write reaches the server — offline the app shows
 * the local reference until sync (FR-5.8 provisional rule; the UI treats
 * a pending serial as provisional).
 */
import React from 'react';
import {
  collection, doc, getFirestore, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc,
} from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import type {
  CompanySettings, DayState, Employee, Expense, FixedCharge,
  Order, Payment, Product, Shop,
} from './models';
import {
  BookOrderInput, CloseOutInput, ProductInput, ShopInput, StoreApi, StoreContext,
} from './store';
import { computeTotals } from '../lib/order';
import { allocateFifo } from '../lib/fifo';
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

async function nextSerials(
  companyId: string,
  fields: ('order' | 'invoice' | 'receipt')[],
): Promise<Record<string, string>> {
  const db = getFirestore();
  const year = new Date().getFullYear();
  const ref = doc(db, `companies/${companyId}/counters/${year}`);
  const PREFIX: Record<string, string> = { order: 'ORD', invoice: 'INV', receipt: 'RCP' };
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = (snap.exists() ? snap.data() : {}) as Record<string, number>;
    const out: Record<string, string> = {};
    const patch: Record<string, number> = {};
    for (const f of fields) {
      const n = (data[f] ?? 0) + 1 + (patch[f] ? 1 : 0);
      patch[f] = n;
      out[f] = `${PREFIX[f]}-${year}-${String(n).padStart(4, '0')}`;
    }
    tx.set(ref, { ...data, ...patch }, { merge: true });
    return out;
  });
}

export function FirestoreStoreProvider({
  user, children,
}: { user: SessionUser; children: React.ReactNode }) {
  const companyId = user.companyId;
  const db = getFirestore();
  const base = `companies/${companyId}`;

  const [products, setProducts] = React.useState<Product[]>([]);
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [settings, setSettings] = React.useState<CompanySettings>(DEFAULT_SETTINGS);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [fixedCharges, setFixedCharges] = React.useState<FixedCharge[]>([]);
  const [day, setDay] = React.useState<DayState>({
    routeStarted: false, handedOver: false, handoverConfirmed: false,
  });
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const subs = [
      onSnapshot(collection(db, `${base}/products`), s => {
        setProducts(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })));
        setReady(true);
      }),
      onSnapshot(collection(db, `${base}/shops`), s =>
        setShops(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Shop, 'id'>),
            lastVisitAt: toMillis(data.lastVisitAt),
          } as Shop;
        })),
      ),
      onSnapshot(query(collection(db, `${base}/orders`), orderBy('bookedAt', 'desc')), s =>
        setOrders(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Order, 'id'>),
            bookedAt: toMillis(data.bookedAt) || Date.now(),
            deliveredAt: data.deliveredAt ? toMillis(data.deliveredAt) : undefined,
          } as Order;
        })),
      ),
      onSnapshot(collection(db, `${base}/payments`), s =>
        setPayments(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Payment, 'id'>),
            createdAt: toMillis(data.createdAt) || Date.now(),
            confirmed: Boolean(data.confirmed),
          } as Payment;
        })),
      ),
      onSnapshot(doc(db, `${base}/settings/company`), s => {
        if (s.exists()) setSettings({ ...DEFAULT_SETTINGS, ...(s.data() as Partial<CompanySettings>) });
      }),
      onSnapshot(doc(db, `${base}/settings/day`), s => {
        if (s.exists()) setDay(s.data() as DayState);
      }),
      onSnapshot(collection(db, `${base}/expenses`), s =>
        setExpenses(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return { id: d.id, ...(data as unknown as Omit<Expense, 'id'>), date: toMillis(data.date) || Date.now() } as Expense;
        })),
      ),
      onSnapshot(collection(db, `${base}/fixedCharges`), s =>
        setFixedCharges(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FixedCharge, 'id'>) }))),
      ),
      onSnapshot(collection(db, `${base}/employeeList`), s =>
        setEmployees(s.docs.map(d => d.data() as Employee)),
      ),
    ];
    return () => subs.forEach(u => u());
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const api: StoreApi = {
    products, shops, orders, payments, settings, employees, expenses, fixedCharges, day, ready,

    async bookOrder(input: BookOrderInput): Promise<Order> {
      const shop = shops.find(s => s.id === input.shopId)!;
      const { order: orderNo } = await nextSerials(companyId, ['order']);
      const orderRef = doc(collection(db, `${base}/orders`));
      const order: Omit<Order, 'id'> = {
        orderNo,
        shopId: shop.id,
        shopSnapshot: { name: shop.name, phone: shop.phone, area: shop.area },
        items: input.items,
        orderedTotals: computeTotals(input.items, input.discountPercent),
        discountPercent: input.discountPercent,
        status: 'assigned',
        paymentStatus: 'unpaid',
        amountPaid: 0,
        deliveryDay: day.routeStarted ? 'tomorrow' : input.deliveryDay,
        bookedAt: Date.now(),
      };
      await setDoc(orderRef, { ...order, bookedAt: serverTimestamp(), createdBy: user.uid });
      await updateDoc(doc(db, `${base}/shops/${shop.id}`), {
        lastVisitAt: serverTimestamp(),
        lastOrderSummary: input.items.map(i => ({ productId: i.productId, qty: i.qty })),
      });
      for (const it of input.items) {
        const p = products.find(pp => pp.id === it.productId);
        if (p) await updateDoc(doc(db, `${base}/products/${p.id}`), { committedQty: p.committedQty + it.qty });
      }
      return { id: orderRef.id, ...order };
    },

    flagCollection(shopId) {
      void updateDoc(doc(db, `${base}/shops/${shopId}`), { collectionFlagged: true });
    },

    startRoute() {
      void setDoc(doc(db, `${base}/settings/day`), {
        routeStarted: true, handedOver: false, handoverConfirmed: false,
      }, { merge: true });
    },

    async closeOutStop({ orderId, deliveredQtys, paymentAmount, mode }: CloseOutInput) {
      const order = orders.find(o => o.id === orderId)!;
      const shop = shops.find(s => s.id === order.shopId)!;
      const items = order.items.map(it => ({ ...it, deliveredQty: deliveredQtys[it.productId] ?? it.qty }));
      const billed = computeTotals(items, order.discountPercent, true);
      const fields: ('invoice' | 'receipt')[] = paymentAmount > 0 ? ['invoice', 'receipt'] : ['invoice'];
      const serials = await nextSerials(companyId, fields);

      await updateDoc(doc(db, `${base}/orders/${orderId}`), {
        items, billedTotals: billed, invoiceNo: serials.invoice,
        status: 'delivered', deliveredAt: serverTimestamp(),
        amountPaid: Math.min(paymentAmount, billed.grandTotal),
        paymentStatus: paymentAmount >= billed.grandTotal ? 'paid' : paymentAmount > 0 ? 'partial' : 'unpaid',
      });

      let receiptNo: string | undefined;
      let newOutstanding = shop.outstanding + billed.grandTotal;
      if (paymentAmount > 0) {
        receiptNo = serials.receipt;
        const bills = [
          ...(shop.outstanding > 0 ? [{ orderId: 'old-khata', balance: shop.outstanding, billedAt: 0 }] : []),
          { orderId, balance: billed.grandTotal, billedAt: Date.now() },
        ];
        const { allocations } = allocateFifo(paymentAmount, bills);
        await setDoc(doc(collection(db, `${base}/payments`)), {
          receiptNo, shopId: shop.id, orderIds: allocations, amount: paymentAmount,
          mode, collectedBy: user.uid, confirmed: false, createdAt: serverTimestamp(),
        });
        newOutstanding -= paymentAmount;
      }
      await updateDoc(doc(db, `${base}/shops/${shop.id}`), {
        outstanding: newOutstanding, collectionFlagged: false,
      });
      for (const it of items) {
        const p = products.find(pp => pp.id === it.productId);
        if (p) {
          await updateDoc(doc(db, `${base}/products/${p.id}`), {
            stockQty: p.stockQty - (it.deliveredQty ?? 0),
            committedQty: Math.max(0, p.committedQty - it.qty),
          });
        }
      }
      return { invoiceNo: serials.invoice, receiptNo };
    },

    handOver() {
      void setDoc(doc(db, `${base}/settings/day`), { handedOver: true }, { merge: true });
    },

    confirmHandover() {
      // Admin-only by rules; marks every unconfirmed payment (FR-7.11).
      void (async () => {
        for (const p of payments.filter(pp => !pp.confirmed)) {
          await updateDoc(doc(db, `${base}/payments/${p.id}`), { confirmed: true }).catch(() => {});
        }
        await setDoc(doc(db, `${base}/settings/day`), { handoverConfirmed: true }, { merge: true });
      })();
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
      // Mirror for the Employees screen (the directory itself is server-only).
      await setDoc(doc(db, `${base}/employeeList/${email.toLowerCase()}`), {
        email: email.toLowerCase(), name, role, joined: false,
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
