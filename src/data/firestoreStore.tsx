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
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import {
  collection, deleteDoc, deleteField, doc, getFirestore, increment, onSnapshot,
  orderBy, query, where, runTransaction, serverTimestamp, setDoc, updateDoc,
  waitForPendingWrites, writeBatch,
} from '@react-native-firebase/firestore';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { getCrashlytics, recordError } from '@react-native-firebase/crashlytics';
import {
  getMessaging, getToken, onTokenRefresh, requestPermission,
} from '@react-native-firebase/messaging';
import type {
  Area, CompanySettings, DayState, Employee, Expense, FixedCharge, FloatMovement,
  Order, Payment, Product, RewardClaim, RewardStaff, Shop,
} from './models';
import { DEFAULT_VISIBILITY, EMPTY_DAY, todayKey, tomorrowKey, yesterdayKey } from './models';
import {
  BookOrderInput, CloseOutInput, CollectionInput, ProductInput,
  RewardClaimInput, RewardStaffInput, ShopInput, StoreApi, StoreContext,
} from './store';
import { computeTotals } from '../lib/order';
import { allocateFifo } from '../lib/fifo';
import { formatSerial, nextLocalRef, type SerialKind } from '../lib/serials';
import { uploadPhotoBase64 } from '../lib/storage';
import type { Role, SessionUser } from '../app/types';

const DEFAULT_SETTINGS: CompanySettings = {
  brandName: '', currencySymbol: 'Rs', countryCode: '92', taxPercent: 0,
  maxDiscountPercent: 10, defaultDeliveryDay: 'today', shopsPerDay: 20,
  rewardApprovalLimit: 1000, rewardPerPiece: 40,
  acceptCheques: false, sendConfirmations: true,
  visibility: DEFAULT_VISIBILITY,
};

/**
 * An optional field the user left blank arrives here as `undefined`, and
 * Firestore THROWS on it — synchronously, while serialising the arguments, so
 * the `.catch()` on every write below never runs and the screen dies. It
 * killed the first-run wizard (blank address/phone) and Add Shop (blank owner
 * name). Telling Firestore to drop undefined keys gives exactly the semantics
 * these forms want: "left blank" means "don't store it".
 *
 * Set once, before any read or write. Failure is non-fatal — worst case we are
 * back to the old behaviour, so it must never take the app down on startup.
 */
let undefinedGuardApplied = false;
function applyUndefinedGuard(db: ReturnType<typeof getFirestore>): void {
  if (undefinedGuardApplied) return;
  undefinedGuardApplied = true;
  // settings() lives on the module instance getFirestore() returns, but the
  // modular Firestore type doesn't surface it — hence the narrow cast.
  const withSettings = db as unknown as {
    settings?: (s: Record<string, unknown>) => Promise<void>;
  };
  try {
    withSettings.settings?.({ ignoreUndefinedProperties: true })
      ?.catch((e: unknown) => console.warn('[snd] ignoreUndefinedProperties', e));
  } catch (e) {
    console.warn('[snd] ignoreUndefinedProperties', e);
  }
}

/** Belt-and-braces for the guard above: drop blank optional fields locally. */
function stripUndefined<T extends object>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

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

const ROLES: Role[] = ['admin', 'booker', 'rider'];

/**
 * A mirror row is only renderable once it has a role. `addEmployee` is not
 * atomic — the callable lands first, the mirror write second — and
 * admitSignIn's `{joined:true}` merge CREATES the doc when that second write
 * never happened. The resulting role-less row threw on render and, with no
 * error boundary, bricked the Employees screen for good.
 */
function isUsableEmployee(e: Partial<Employee> & { removed?: boolean }): e is Employee {
  return !e.removed && !!e.role && ROLES.includes(e.role);
}

export function FirestoreStoreProvider({
  user, children,
}: { user: SessionUser; children: React.ReactNode }) {
  const companyId = user.companyId;
  const db = getFirestore();
  applyUndefinedGuard(db);
  const base = `companies/${companyId}`;
  const isAdmin = user.role === 'admin';
  const isRider = user.role === 'rider';

  const [products, setProducts] = React.useState<Product[]>([]);
  const [costs, setCosts] = React.useState<Record<string, number>>({});
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [areas, setAreas] = React.useState<Area[]>([]);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [settings, setSettings] = React.useState<CompanySettings>(DEFAULT_SETTINGS);
  const [employees, setEmployees] = React.useState<Employee[]>([]);
  const [staffNames, setStaffNames] = React.useState<Record<string, string>>({});
  const [staffDays, setStaffDays] = React.useState<DayState[]>([]);
  const [expenses, setExpenses] = React.useState<Expense[]>([]);
  const [fixedCharges, setFixedCharges] = React.useState<FixedCharge[]>([]);
  const [rewardStaff, setRewardStaff] = React.useState<RewardStaff[]>([]);
  const [rewardClaims, setRewardClaims] = React.useState<RewardClaim[]>([]);
  const [floatMovements, setFloatMovements] = React.useState<FloatMovement[]>([]);
  const [ready, setReady] = React.useState(false);
  // Money written on this phone that the server has not acknowledged. Signing
  // out throws the offline queue away, so the sign-out flow checks this first.
  const [pendingOrders, setPendingOrders] = React.useState(0);
  const [pendingPayments, setPendingPayments] = React.useState(0);

  /**
   * One day document per person PER DATE, id "{uid}_{YYYY-MM-DD}". Reusing a
   * single doc leaked yesterday's handoverConfirmed into today, which both
   * faked a confirmation on the staff phone and made the rider's morning
   * [Start route] an illegal update. Today's doc is simply a new one.
   */
  /**
   * A working day ends when it is HANDED OVER, not when the clock passes
   * midnight. Deriving this from `date === todayKey()` alone threw a rider who
   * was still out at 00:05 back to the morning "Load the van" screen, route
   * lock gone and "collected today" reset to Rs 0, mid-route.
   *
   * Today's doc still wins when it exists, so a normal morning is a fresh day.
   */
  const openDayFor = (staffId: string): DayState | undefined => {
    const mine = staffDays.filter(d => d.staffId === staffId);
    return (
      mine.find(d => d.date === todayKey()) ??
      // Only a route actually in flight is worth carrying over — an idle day
      // nobody started is not "open", it is just yesterday.
      mine.filter(d => d.routeStarted && !d.handedOver)
        .sort((a, b) => b.date.localeCompare(a.date))[0]
    );
  };
  const day: DayState = openDayFor(user.uid) ?? EMPTY_DAY();
  /** Write to the day a person is actually working, which past midnight is still yesterday's. */
  const dayDocId = (staffId: string) =>
    `${staffId}_${(staffId === user.uid ? day.date : openDayFor(staffId)?.date) ?? todayKey()}`;

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
          // 'estimate' resolves a serverTimestamp that has not landed yet to
          // the local write time instead of null. Without it, toMillis(null)
          // gave 0 — so a shop the booker had JUST ordered from read back as
          // "never visited" and stayed in "due today", for the whole day if
          // there was no signal. (Round 7 fixed the sibling collectionFlagged
          // case the other way, with a stored boolean.)
          const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Shop, 'id'>),
            lastVisitAt: toMillis(data.lastVisitAt),
            lastShelfCountAt: data.lastShelfCountAt ? toMillis(data.lastShelfCountAt) : undefined,
            // Screens read this boolean. Prefer the stored flag (visible the
            // instant it is written, even offline) and fall back to the
            // timestamp for shops flagged by an older build.
            collectionFlagged: data.collectionFlagged === true || !!data.collectionFlaggedAt,
          } as Shop;
        })), warn('shops')),

      onSnapshot(collection(db, `${base}/areas`), s =>
        setAreas(s.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<Area, 'id'>) }))
          // A missing `active` means an area written before the flag existed;
          // treat it as live rather than quietly emptying every picker.
          .map(a => ({ ...a, active: a.active !== false }))
          .sort((x, y) => x.name.localeCompare(y.name))), warn('areas')),

      // includeMetadataChanges so the unsynced count falls back to zero when
      // the queue drains — without it the acknowledgement is a metadata-only
      // change and never reaches this callback.
      onSnapshot(ordersQuery, { includeMetadataChanges: true }, s => {
        setPendingOrders(s.docs.filter(d => d.metadata.hasPendingWrites).length);
        setOrders(s.docs.map(d => {
          // 'estimate' so deliveredAt is readable the instant the rider closes
          // a stop, not only once the server timestamp lands — the route
          // header counts by it, and offline that write can sit for hours.
          const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Order, 'id'>),
            bookedAt: toMillis(data.bookedAt) || Date.now(),
            deliveredAt: data.deliveredAt ? toMillis(data.deliveredAt) : undefined,
          } as Order;
        }));
      }, warn('orders')),

      onSnapshot(paymentsQuery, { includeMetadataChanges: true }, s => {
        setPendingPayments(s.docs.filter(d => d.metadata.hasPendingWrites).length);
        setPayments(s.docs.map(d => {
          const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<Payment, 'id'>),
            createdAt: toMillis(data.createdAt) || Date.now(),
            confirmed: Boolean(data.confirmed),
            voided: Boolean(data.voided),
            voidedAt: data.voidedAt ? toMillis(data.voidedAt) : undefined,
          } as Payment;
        }));
      }, warn('payments')),

      onSnapshot(doc(db, `${base}/settings/company`), s => {
        if (s.exists()) {
          const data = s.data() as Partial<CompanySettings>;
          setSettings({
            ...DEFAULT_SETTINGS, ...data,
            // Nested object: merge so an older doc missing a flag stays visible.
            visibility: { ...DEFAULT_VISIBILITY, ...(data.visibility ?? {}) },
          });
        }
      }, warn('settings')),

      // TODAY's day docs for the whole team — a handful of tiny documents.
      // Every role needs them: the booker reads the RIDER's route lock to
      // freeze the van, the owner reads them for the handover cards, and each
      // person finds their own in here. Scoped to today so the collection
      // cannot grow into the listener over months.
      // Yesterday rides along so a day that ran past midnight is still
      // visible — both to the person still working it and to the owner, whose
      // confirm card would otherwise vanish at 00:00 with the cash unsettled.
      onSnapshot(
        query(collection(db, `${base}/days`), where('date', 'in', [yesterdayKey(), todayKey()])),
        s => setStaffDays(s.docs.map(d => ({
          ...EMPTY_DAY(), ...(d.data() as Partial<DayState>),
        }) as DayState)), warn('days')),
    ];

    // Rewards (FR-16): admin + booker; the rider has no reward screens and
    // the rules deny him the list.
    if (!isRider) {
      subs.push(
        onSnapshot(collection(db, `${base}/rewardStaff`), s =>
          setRewardStaff(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<RewardStaff, 'id'>) }))),
          warn('rewardStaff')),
        onSnapshot(
          isAdmin
            ? collection(db, `${base}/rewardClaims`)
            : query(collection(db, `${base}/rewardClaims`), where('by', '==', user.uid)),
          s => setRewardClaims(s.docs.map(d => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id, ...(data as unknown as Omit<RewardClaim, 'id'>),
              createdAt: toMillis(data.createdAt) || Date.now(),
              decidedAt: data.decidedAt ? toMillis(data.decidedAt) : undefined,
            } as RewardClaim;
          })), warn('rewardClaims')),
      );
    }
    // Float: the owner sees the whole ledger, staff see their own rows.
    subs.push(
      onSnapshot(
        isAdmin
          ? collection(db, `${base}/floatMovements`)
          : query(collection(db, `${base}/floatMovements`), where('staffId', '==', user.uid)),
        s => setFloatMovements(s.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id, ...(data as unknown as Omit<FloatMovement, 'id'>),
            createdAt: toMillis(data.createdAt) || Date.now(),
          } as FloatMovement;
        })), warn('float')),
    );

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
        // uid → display name for ACTIVE members only — removed staff drop out,
        // which is also what flags their stranded orders for reassignment.
        onSnapshot(collection(db, `${base}/users`), s => {
          const m: Record<string, string> = {};
          s.docs.forEach(d => {
            const data = d.data() as { name?: string; active?: boolean };
            if (data.active !== false) m[d.id] = data.name || '';
          });
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
          setEmployees(s.docs
            .map(d => {
              const data = d.data() as Partial<Employee> & { removed?: boolean };
              // The doc id IS the lowercased email, so it stands in for both
              // fields when only a partial mirror row exists.
              return { ...data, email: data.email || d.id, name: data.name || data.email || d.id };
            })
            .filter(isUsableEmployee)),
          warn('employees')),
      );
    }
    return () => subs.forEach(u => u());
  }, [base, isAdmin, isRider, user.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push notifications (FR-12.10): ask once, keep users/{uid}.fcmToken fresh
  // (the rules whitelist exactly that key for self-update). Best-effort — a
  // refused permission or dead Play Services must never block the field flow.
  React.useEffect(() => {
    let stop: (() => void) | undefined;
    (async () => {
      try {
        const m = getMessaging();
        // RNFirebase's requestPermission() is a hard-coded no-op on Android:
        // it resolves 1 = AUTHORIZED without ever showing a prompt. So the app
        // believed it had permission, saved a token, and every server-side
        // send went into nothing on Android 13+, where POST_NOTIFICATIONS is a
        // runtime permission. Declaring it in the manifest is not enough.
        if (Platform.OS === 'android') {
          if (Platform.Version >= 33) {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
          }
        } else {
          await requestPermission(m);
        }
        // The token is saved either way: a refusal is not permanent, and the
        // moment the person turns notifications on in system settings the
        // already-registered token starts working.
        const save = (token: string) =>
          updateDoc(doc(db, `${base}/users/${user.uid}`), { fcmToken: token })
            .catch(e => console.warn('[snd] fcm token save', e));
        await save(await getToken(m));
        stop = onTokenRefresh(m, t => { void save(t); });
      } catch (e) {
        console.warn('[snd] fcm setup', e);
      }
    })();
    return () => stop?.();
  }, [base, user.uid]); // eslint-disable-line react-hooks/exhaustive-deps

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
      return { value: nextLocalRef(kind), provisional: true };
    }
  }

  // Orders addressed to nobody (booked before the rider joined) or to a
  // REMOVED rider would sit invisible forever — the owner's phone quietly
  // re-addresses them to the current rider (audit blocker).
  React.useEffect(() => {
    if (!isAdmin) return;
    const riderId = settings.autoAssignRiderId;
    if (!riderId || Object.keys(staffNames).length === 0) return;
    const orphans = orders.filter(o =>
      (o.status === 'booked' || o.status === 'assigned') &&
      o.assignedTo !== riderId &&
      (!o.assignedTo || staffNames[o.assignedTo] === undefined));
    if (orphans.length === 0) return;
    const batch = writeBatch(db);
    orphans.slice(0, 200).forEach(o =>
      batch.update(doc(db, `${base}/orders/${o.id}`), { assignedTo: riderId }));
    batch.commit().catch(e => console.warn('[snd] order reassignment', e));
  }, [isAdmin, orders, settings.autoAssignRiderId, staffNames]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The van freeze is the RIDER's lock, read from HIS day doc (FR-6.2). */
  const riderRouteStartedNow = (): boolean => {
    if (isRider) return day.routeStarted;
    const riderId = settings.autoAssignRiderId;
    if (!riderId) return false;
    const d = openDayFor(riderId);
    return !!d && d.routeStarted;
  };

  // Admin sees margins merged back in; staff phones never hold a costPrice.
  const productsView = React.useMemo(
    () => (isAdmin
      ? products.map(p => (costs[p.id] !== undefined ? { ...p, costPrice: costs[p.id] } : p))
      : products),
    [isAdmin, products, costs],
  );

  /**
   * Apply ONE exception payment to the khata, atomically.
   *
   * Confirming is the moment this money moves, so it must happen exactly
   * once. The transaction re-reads the payment and stops if another admin
   * already confirmed it, and re-reads the bills so FIFO runs on server truth
   * rather than on whatever this phone last heard.
   */
  const applyExceptionCash = async (p: Payment): Promise<void> => {
    const payRef = doc(db, `${base}/payments/${p.id}`);
    // The candidate set comes from the local view; the AMOUNTS never do.
    const candidateIds = orders
      .filter(o => o.shopId === p.shopId && o.status === 'delivered' && o.paymentStatus !== 'paid')
      .map(o => o.id);

    await runTransaction(db, async tx => {
      const paySnap = await tx.get(payRef);
      const pay = paySnap.data() as Payment | undefined;
      // Another admin got here first — the money has already moved.
      if (!pay || pay.confirmed || pay.voided) return;

      // Every read must precede every write inside a transaction.
      const snaps = await Promise.all(
        candidateIds.map(id => tx.get(doc(db, `${base}/orders/${id}`))),
      );
      const fresh = snaps
        .map(s => ({ id: s.id, o: s.data() as Order | undefined }))
        .filter((x): x is { id: string; o: Order } =>
          !!x.o && x.o.status === 'delivered' && x.o.paymentStatus !== 'paid');

      const unpaid = fresh
        .map(x => ({
          orderId: x.id,
          balance: (x.o.billedTotals?.grandTotal ?? 0) - (x.o.amountPaid ?? 0),
          billedAt: x.o.deliveredAt ?? x.o.bookedAt,
        }))
        .filter(x => x.balance > 0);

      const { allocations } = allocateFifo(p.amount, unpaid);
      for (const a of allocations) {
        const target = fresh.find(x => x.id === a.orderId);
        if (!target) continue;
        const paid = (target.o.amountPaid ?? 0) + a.amount;
        tx.update(doc(db, `${base}/orders/${a.orderId}`), {
          amountPaid: increment(a.amount),
          paymentStatus: paid >= (target.o.billedTotals?.grandTotal ?? 0) ? 'paid' : 'partial',
        });
      }
      tx.update(doc(db, `${base}/shops/${p.shopId}`), { outstanding: increment(-p.amount) });
      // Persist the split onto the payment itself: it is the only record
      // voidPayment can later use to un-apply this money (the rules whitelist
      // 'orderIds' on the admin update for exactly this).
      tx.update(payRef, { confirmed: true, orderIds: allocations });
    });
  };

  const api: StoreApi = {
    products: productsView, shops, areas, orders, payments, settings, employees,
    staffDays, staffNames, expenses, fixedCharges,
    rewardStaff, rewardClaims, floatMovements, day, ready,
    pendingWrites: pendingOrders + pendingPayments,

    async flushPendingWrites(timeoutMs = 6000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      });
      try {
        return await Promise.race([waitForPendingWrites(db).then(() => true), timedOut]);
      } catch {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    async bookOrder(input: BookOrderInput): Promise<Order> {
      const shop = shops.find(s => s.id === input.shopId)!;
      const { value: orderNo, provisional } = await serial('order');
      const orderRef = doc(collection(db, `${base}/orders`));
      // The load list is frozen once THE RIDER starts — his lock, not ours.
      const deliveryDay = riderRouteStartedNow() ? 'tomorrow' : input.deliveryDay;
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

    /**
     * A booked/assigned order dies here (FR-5.7: cancel, never delete) and
     * its committed stock walks free — otherwise a fat-fingered order
     * inflates the van list and committedQty forever (audit blocker).
     */
    cancelOrder(orderId) {
      const order = orders.find(o => o.id === orderId);
      if (!order || (order.status !== 'booked' && order.status !== 'assigned')) return;
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/orders/${orderId}`), { status: 'cancelled' });
      for (const it of order.items) {
        batch.update(doc(db, `${base}/products/${it.productId}`), { committedQty: increment(-it.qty) });
      }
      batch.commit().catch(writeRejected(`Cancel ${order.orderNo}`));
    },

    /** Shop closed — the stop moves to tomorrow, stock stays committed. */
    deferOrder(orderId) {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      updateDoc(doc(db, `${base}/orders/${orderId}`), {
        deliveryDate: tomorrowKey(), deliveryDay: 'tomorrow',
      }).catch(writeRejected(`Move ${order.orderNo} to tomorrow`));
    },

    /** Shop refused the goods at the door — back on the van, stock released. */
    returnOrder(orderId, reason) {
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/orders/${orderId}`), {
        status: 'returned', undeliveredReason: reason,
      });
      for (const it of order.items) {
        batch.update(doc(db, `${base}/products/${it.productId}`), { committedQty: increment(-it.qty) });
      }
      batch.commit().catch(writeRejected(`Send back ${order.orderNo}`));
    },

    flagCollection(shopId) {
      updateDoc(doc(db, `${base}/shops/${shopId}`), {
        // The boolean rides alongside the timestamp on purpose:
        // serverTimestamp() is NULL in the local cache until the server
        // answers, so offline in a market the booker tapped "Tell the rider"
        // and nothing on screen changed. The plain boolean lands instantly.
        collectionFlagged: true,
        collectionFlaggedAt: serverTimestamp(),
        collectionFlaggedBy: user.uid,
      }).catch(writeRejected('Collection flag'));
    },

    startRoute() {
      setDoc(doc(db, `${base}/days/${dayDocId(user.uid)}`), {
        ...EMPTY_DAY(day.date), routeStarted: true, staffId: user.uid,
      }, { merge: true }).catch(writeRejected('Start route'));
    },

    undoStartRoute() {
      setDoc(doc(db, `${base}/days/${dayDocId(user.uid)}`), {
        date: day.date, routeStarted: false, staffId: user.uid,
      }, { merge: true }).catch(writeRejected('Undo start route'));
    },

    riderRouteStarted: riderRouteStartedNow,

    async closeOutStop({ orderId, deliveredQtys, paymentAmount, mode }: CloseOutInput) {
      const order = orders.find(o => o.id === orderId);
      const shop = order ? shops.find(s => s.id === order.shopId) : undefined;
      // The booker can cancel from his phone while the rider stands at the
      // counter. Delivering a cancelled order would bill a shop that cancelled
      // AND release its committed stock a second time, driving the count
      // negative for every later day.
      if (!order || !shop || order.status === 'cancelled' || order.status === 'returned'
          || order.status === 'delivered') {
        throw new Error(
          order && order.status === 'cancelled'
            ? 'This order was cancelled — do not deliver it.'
            : 'This stop is no longer open. Go back to the route and reopen it.',
        );
      }
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

      // What THIS bill actually received — FIFO may have sent every rupee to
      // the older khata instead. Writing the raw cash figure here marked a
      // bill paid that got nothing, and permanently excluded it from every
      // later collection.
      const paidToThisBill = allocations.find(a => a.orderId === orderId)?.amount ?? 0;

      // Everything the stop changes, in ONE batch (audit finding #4).
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/orders/${orderId}`), {
        items, billedTotals: billed,
        invoiceNo: inv.value, invoiceProvisional: inv.provisional,
        status: 'delivered', deliveredAt: serverTimestamp(),
        amountPaid: paidToThisBill,
        paymentStatus: paidToThisBill >= billed.grandTotal ? 'paid'
          : paidToThisBill > 0 ? 'partial' : 'unpaid',
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
        collectionFlagged: false, collectionFlaggedAt: null, collectionFlaggedBy: null,
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

      // Booker forced-cash exception (FR-7.13): the rules stop a booker from
      // moving balances (FR-7.10), so ONLY the flagged payment is written.
      // The khata moves when the owner confirms it at the handover.
      if (user.role === 'booker') {
        setDoc(doc(collection(db, `${base}/payments`)), {
          receiptNo: rcp.value, provisional: rcp.provisional,
          shopId, orderIds: [], amount, mode,
          collectedBy: user.uid, confirmed: false,
          exception: true,
          createdAt: serverTimestamp(),
        }).catch(writeRejected(`Receipt ${rcp.value}`));
        return { receiptNo: rcp.value };
      }

      const unpaid = orders
        .filter(o => o.shopId === shopId && o.status === 'delivered' && o.paymentStatus !== 'paid')
        .map(o => ({
          orderId: o.id,
          balance: (o.billedTotals?.grandTotal ?? 0) - o.amountPaid,
          billedAt: o.deliveredAt ?? o.bookedAt,
        }))
        .filter(b => b.balance > 0);
      const { allocations, unallocated } = allocateFifo(amount, unpaid);

      const batch = writeBatch(db);
      const payRef = doc(collection(db, `${base}/payments`));
      batch.set(payRef, {
        receiptNo: rcp.value, provisional: rcp.provisional,
        shopId, orderIds: allocations, amount, mode,
        collectedBy: user.uid, confirmed: false,
        exception: exception === true,
        // Money that landed on the khata but could not be matched to a bill
        // THIS PHONE can see — a rider only receives orders assigned to him,
        // so a previous rider's unpaid bills are invisible here. Recorded so
        // the owner can reconcile instead of it vanishing silently.
        unallocated: unallocated > 0 ? unallocated : 0,
        createdAt: serverTimestamp(),
      });
      batch.update(doc(db, `${base}/shops/${shopId}`), {
        // CollectScreen caps the amount at what the shop owes; increment keeps
        // two same-moment collections from resurrecting a stale balance.
        outstanding: increment(-amount),
        collectionFlagged: false, collectionFlaggedAt: null, collectionFlaggedBy: null,
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
      // Money the OWNER takes is already in the owner's hand — no handover
      // to wait for; it confirms itself (rules: create must be unconfirmed,
      // so this is a second, admin-only write).
      if (user.role === 'admin') {
        updateDoc(payRef, { confirmed: true }).catch(writeRejected('Self-confirm'));
      }
      return { receiptNo: rcp.value };
    },

    handOver() {
      setDoc(doc(db, `${base}/days/${dayDocId(user.uid)}`), {
        date: day.date, handedOver: true, staffId: user.uid,
      }, { merge: true }).catch(writeRejected('Handover'));
    },

    /**
     * Owner counts ONE person's cash and confirms exactly that person's
     * payments (FR-7.11) — confirming the rider must never silently mark the
     * booker's uncounted exception cash as received (audit blocker #4).
     */
    confirmHandover(staffId: string) {
      const toConfirm = payments.filter(p => !p.confirmed && !p.voided && p.collectedBy === staffId);

      // Plain confirmations only flip a flag — that money moved when it was
      // collected — so they are idempotent and go in chunks under the
      // 500-write cap.
      const plain = toConfirm.filter(p => !p.exception);
      for (let i = 0; i < plain.length; i += 400) {
        const batch = writeBatch(db);
        plain.slice(i, i + 400).forEach(p =>
          batch.update(doc(db, `${base}/payments/${p.id}`), { confirmed: true }));
        batch.commit().catch(writeRejected('Cash confirmation'));
      }

      // Exception cash (FR-7.13) is different: confirming it is the moment it
      // reaches the khata, so it must happen exactly once. Each runs in its
      // own re-reading transaction — two admins tapping the same card each
      // derived the adjustment from their own local state and both applied
      // it, knocking DOUBLE off the shop's balance.
      toConfirm
        .filter(p => p.exception)
        .forEach(p => {
          applyExceptionCash(p).catch(writeRejected(`Exception cash ${p.receiptNo}`));
        });
      // The staff member's own day doc flips, so THEIR screen shows
      // "confirmed" — the day they are actually working, which past midnight
      // is still yesterday's doc.
      const theirDay = openDayFor(staffId)?.date ?? todayKey();
      setDoc(doc(db, `${base}/days/${staffId}_${theirDay}`), {
        date: theirDay, handoverConfirmed: true, staffId,
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
      const cleanRest = stripUndefined(rest);
      if (Object.keys(cleanRest).length > 0) {
        updateDoc(doc(db, `${base}/products/${id}`), cleanRest as Record<string, unknown>)
          .catch(writeRejected('Product update'));
      }
    },

    /** Supplier delivery / count correction — atomic, and logged so a stock
     *  number can always be explained (stockMovements is append-only). */
    adjustStock(productId, delta, note) {
      if (!delta) return;
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/products/${productId}`), { stockQty: increment(delta) });
      batch.set(doc(collection(db, `${base}/stockMovements`)), {
        productId, delta, note, by: user.uid, createdAt: serverTimestamp(),
      });
      batch.commit().catch(writeRejected('Stock adjustment'));
    },

    addShop({ openingBalance, location, ...s }: ShopInput) {
      setDoc(doc(collection(db, `${base}/shops`)), {
        ...stripUndefined(s), standingDiscountPercent: s.standingDiscountPercent ?? 0,
        // Stamped here, not at the call site: the screen has no business
        // asserting whose fix this was.
        ...(location ? { location: { ...location, savedAt: Date.now(), savedBy: user.uid } } : {}),
        // The paper khata comes with the shop (audit blocker: pre-app debt
        // was invisible to the whole collections flow).
        outstanding: openingBalance && openingBalance > 0 ? openingBalance : 0,
        active: true, createdAt: serverTimestamp(), createdBy: user.uid,
      }).catch(writeRejected('New shop'));
    },

    updateShop(id, patch) {
      updateDoc(doc(db, `${base}/shops/${id}`), stripUndefined(patch) as Record<string, unknown>)
        .catch(writeRejected('Shop update'));
    },

    // The pin and the photo are the only two shop keys a RIDER may write, and
    // the rule enforcing that uses hasOnly() — so these send that key alone.
    // Folding either into updateShop would let one stray field in the patch
    // fail the whole write for a rider, silently, in the field.
    setShopLocation(shopId, fix) {
      updateDoc(doc(db, `${base}/shops/${shopId}`), {
        location: { ...fix, savedAt: Date.now(), savedBy: user.uid },
      }).catch(writeRejected('Shop location'));
    },

    setShopPhoto(shopId, photoUrl) {
      updateDoc(doc(db, `${base}/shops/${shopId}`), { photoUrl })
        .catch(writeRejected('Shop photo'));
    },

    addArea(name) {
      const clean = name.trim();
      if (!clean) return;
      // Two areas with the same name would give the picker two identical
      // chips, and no one could tell which shops sat under which.
      if (areas.some(a => a.name.toLowerCase() === clean.toLowerCase())) return;
      setDoc(doc(collection(db, `${base}/areas`)), {
        name: clean, active: true, createdAt: serverTimestamp(), createdBy: user.uid,
      }).catch(writeRejected('New area'));
    },

    /**
     * Rename the area AND every shop still filed under the old name.
     *
     * Shops store the name, so without the fan-out a rename would orphan every
     * shop that used it: they would keep a name no picker offers any more, and
     * quietly vanish from the area they belong to. Batched so the list and the
     * shops can never disagree.
     */
    renameArea(id, name) {
      const clean = name.trim();
      const before = areas.find(a => a.id === id);
      if (!clean || !before || before.name === clean) return;
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/areas/${id}`), { name: clean });
      shops
        .filter(s => s.area === before.name)
        .forEach(s => batch.update(doc(db, `${base}/shops/${s.id}`), { area: clean }));
      batch.commit().catch(writeRejected('Area rename'));
    },

    // Retiring an area never touches the shops under it — they keep the name,
    // stay grouped, and simply cannot be re-filed there by anyone new.
    setAreaActive(id, active) {
      updateDoc(doc(db, `${base}/areas/${id}`), { active })
        .catch(writeRejected('Area update'));
    },

    /** Manual khata correction — returns, bounced cheques, paper-era fixes. */
    adjustShopBalance(shopId, delta, note) {
      if (!delta) return;
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/shops/${shopId}`), { outstanding: increment(delta) });
      batch.set(doc(collection(db, `${base}/stockMovements`)), {
        shopId, khataDelta: delta, note, by: user.uid, createdAt: serverTimestamp(),
      });
      batch.commit().catch(writeRejected('Khata adjustment'));
    },

    updateSettings(patch) {
      setDoc(doc(db, `${base}/settings/company`), stripUndefined(patch), { merge: true })
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

    removeExpense(id) {
      deleteDoc(doc(db, `${base}/expenses/${id}`)).catch(writeRejected('Expense delete'));
    },

    addFixedCharge(c) {
      setDoc(doc(collection(db, `${base}/fixedCharges`)), { ...c, createdAt: serverTimestamp() })
        .catch(writeRejected('Fixed charge'));
    },

    updateFixedCharge(id, patch) {
      updateDoc(doc(db, `${base}/fixedCharges/${id}`), patch as Record<string, unknown>)
        .catch(writeRejected('Fixed charge update'));
    },

    removeFixedCharge(id) {
      deleteDoc(doc(db, `${base}/fixedCharges/${id}`)).catch(writeRejected('Fixed charge delete'));
    },

    // ---- rewards (FR-16) + shelf counts ------------------------------------

    addRewardStaff(s: RewardStaffInput) {
      setDoc(doc(collection(db, `${base}/rewardStaff`)), {
        ...s, active: true, addedBy: user.uid, createdAt: serverTimestamp(),
      }).catch(writeRejected('Counter-staff registration'));
    },

    setRewardStaffActive(id, active) {
      updateDoc(doc(db, `${base}/rewardStaff/${id}`), { active })
        .catch(writeRejected('Counter staff'));
    },

    /**
     * Photo first, claim second: the upload needs signal, and a claim without
     * its receipt proof must never exist (FR-16). Throws so the screen can
     * say "try again with signal" honestly.
     */
    async submitRewardClaim({ staffId, pieces, shelfCount, photoBase64 }: RewardClaimInput) {
      const rStaff = rewardStaff.find(r => r.id === staffId)!;
      const shop = shops.find(sh => sh.id === rStaff.shopId);
      if (!photoBase64) throw new Error('The receipt photo is required.');
      const photoUrl = await uploadPhotoBase64(photoBase64, 'reward');

      const amount = pieces * settings.rewardPerPiece;
      const claim = await serial('reward');
      const batch = writeBatch(db);
      batch.set(doc(collection(db, `${base}/rewardClaims`)), {
        claimNo: claim.value, provisional: claim.provisional,
        staffId, staffName: rStaff.name,
        shopId: rStaff.shopId, shopName: shop?.name ?? '',
        pieces, amount, photoUrl, shelfCount,
        by: user.uid, status: 'pending',
        overLimit: amount > settings.rewardApprovalLimit,
        createdAt: serverTimestamp(),
      });
      // The mandatory shelf count also lands on the shop (same visit).
      if (shop) {
        batch.update(doc(db, `${base}/shops/${shop.id}`), {
          lastShelfCount: shelfCount, lastShelfCountAt: serverTimestamp(),
        });
      }
      batch.commit().catch(writeRejected(`Claim ${claim.value}`));
      return { claimNo: claim.value };
    },

    decideRewardClaim(id, decision) {
      // Admin-only by rules (FR-16.5 — the booker can never approve himself).
      const claim = rewardClaims.find(c => c.id === id);
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/rewardClaims/${id}`), {
        status: decision, decidedAt: serverTimestamp(), decidedBy: user.uid,
      });
      // Approval = the booker pays it from his float — record the payout row.
      if (decision === 'approved' && claim) {
        batch.set(doc(collection(db, `${base}/floatMovements`)), {
          staffId: claim.by, amount: claim.amount, kind: 'payout',
          refClaimId: id, note: `${claim.claimNo} — ${claim.staffName}`,
          createdAt: serverTimestamp(),
        });
      }
      batch.commit().catch(writeRejected('Claim decision'));
    },

    moveFloat(staffId, amount, kind) {
      setDoc(doc(collection(db, `${base}/floatMovements`)), {
        staffId, amount, kind, createdAt: serverTimestamp(),
      }).catch(writeRejected(kind === 'issue' ? 'Float issue' : 'Float return'));
    },

    recordShelfCount(shopId, count) {
      updateDoc(doc(db, `${base}/shops/${shopId}`), {
        lastShelfCount: count, lastShelfCountAt: serverTimestamp(),
      }).catch(writeRejected('Shelf count'));
    },

    /**
     * Owner crosses out a wrong payment (rider typo). The khata it moved is
     * restored, its FIFO allocations un-applied — EXCEPT an unconfirmed
     * booker exception, which never touched the khata in the first place.
     */
    voidPayment(paymentId) {
      const p = payments.find(pp => pp.id === paymentId);
      if (!p || p.voided) return;
      const batch = writeBatch(db);
      batch.update(doc(db, `${base}/payments/${p.id}`), {
        voided: true, voidedBy: user.uid, voidedAt: serverTimestamp(),
      });
      const khataWasMoved = !p.exception || p.confirmed;
      if (khataWasMoved) {
        batch.update(doc(db, `${base}/shops/${p.shopId}`), { outstanding: increment(p.amount) });
        for (const a of p.orderIds ?? []) {
          const o = orders.find(oo => oo.id === a.orderId);
          if (!o) continue; // 'old-khata' pseudo-bill has no order doc
          const newPaid = o.amountPaid - a.amount;
          batch.update(doc(db, `${base}/orders/${o.id}`), {
            amountPaid: increment(-a.amount),
            paymentStatus: newPaid <= 0 ? 'unpaid' : newPaid >= (o.billedTotals?.grandTotal ?? 0) ? 'paid' : 'partial',
          });
        }
      }
      batch.commit().catch(writeRejected(`Void ${p.receiptNo}`));
    },

    cashWithStaff() {
      return payments.filter(p => !p.confirmed && !p.voided).reduce((s, p) => s + p.amount, 0);
    },
    cashConfirmed() {
      return payments.filter(p => p.confirmed && !p.voided).reduce((s, p) => s + p.amount, 0);
    },
    floatBalance(staffId: string) {
      return floatMovements
        .filter(f => f.staffId === staffId)
        .reduce((s, f) => s + (f.kind === 'issue' ? f.amount : -f.amount), 0);
    },
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
