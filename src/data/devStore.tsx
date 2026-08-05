/**
 * Dev data store — in-memory StoreApi implementation for preview mode.
 * Same shape as the Firestore store; screens can't tell the difference.
 * Seeded with the owner's real products.
 */
import React from 'react';
import type {
  CompanySettings, DayState, Employee, Expense, FixedCharge,
  Order, Payment, Product, Shop,
} from './models';
import {
  BookOrderInput, CloseOutInput, ProductInput, ShopInput, StoreApi, StoreContext,
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

const seedShops: Shop[] = [
  { id: 's1', name: 'Beauty Corner', ownerName: 'Rashid', phone: '923001234567', area: 'Saddar',
    outstanding: 2300, standingDiscountPercent: 0, active: true,
    lastVisitAt: now - 8 * 86400_000,
    lastOrderSummary: [{ productId: 'p1', qty: 6 }, { productId: 'p2', qty: 4 }] },
  { id: 's2', name: 'Glow Mart', ownerName: 'Naveed', phone: '923009876543', area: 'Saddar',
    outstanding: 0, standingDiscountPercent: 0, active: true,
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
  defaultDeliveryDay: 'today',
  shopsPerDay: 20,
  rewardApprovalLimit: 1000,
  acceptCheques: false,
  sendConfirmations: true,
};

interface StoreState {
  products: Product[];
  shops: Shop[];
  orders: Order[];
  payments: Payment[];
  day: DayState;
  settings: CompanySettings;
  employees: Employee[];
  expenses: Expense[];
  fixedCharges: FixedCharge[];
}

export function DevStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<StoreState>({
    products: seedProducts,
    shops: seedShops,
    orders: [],
    payments: [],
    day: { routeStarted: false, handedOver: false, handoverConfirmed: false },
    settings: seedSettings,
    employees: [
      { email: 'owner@example.com', name: 'You (preview)', role: 'admin', joined: true },
    ],
    expenses: [],
    fixedCharges: [],
  });

  const api: StoreApi = {
    ...state,
    ready: true,

    bookOrder(input: BookOrderInput): Order {
      const shop = state.shops.find(s => s.id === input.shopId)!;
      const order: Order = {
        id: `o${Date.now()}`,
        orderNo: nextSerial('ORD'),
        shopId: shop.id,
        shopSnapshot: { name: shop.name, phone: shop.phone, area: shop.area },
        items: input.items,
        orderedTotals: computeTotals(input.items, input.discountPercent),
        discountPercent: input.discountPercent,
        status: 'assigned',
        paymentStatus: 'unpaid',
        amountPaid: 0,
        deliveryDay: state.day.routeStarted ? 'tomorrow' : input.deliveryDay,
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

    flagCollection(shopId) {
      setState(st => ({
        ...st,
        shops: st.shops.map(s => (s.id === shopId ? { ...s, collectionFlagged: true } : s)),
      }));
    },

    startRoute() {
      setState(st => ({ ...st, day: { ...st.day, routeStarted: true } }));
    },

    closeOutStop({ orderId, deliveredQtys, paymentAmount, mode }: CloseOutInput) {
      const order = state.orders.find(o => o.id === orderId)!;
      const items = order.items.map(it => ({ ...it, deliveredQty: deliveredQtys[it.productId] ?? it.qty }));
      const billed = computeTotals(items, order.discountPercent, true);
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

    handOver() {
      setState(st => ({ ...st, day: { ...st.day, handedOver: true } }));
    },

    confirmHandover() {
      setState(st => ({
        ...st,
        payments: st.payments.map(p => ({ ...p, confirmed: true })),
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

    addShop(s: ShopInput) {
      setState(st => ({
        ...st,
        shops: [...st.shops, {
          id: `s${Date.now()}`, outstanding: 0, active: true,
          standingDiscountPercent: s.standingDiscountPercent ?? 0, ...s,
        }],
      }));
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

    addFixedCharge(c) {
      setState(st => ({ ...st, fixedCharges: [...st.fixedCharges, { id: `f${Date.now()}`, ...c }] }));
    },

    cashWithStaff() {
      return state.payments.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
    },
    cashConfirmed() {
      return state.payments.filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
    },
  };

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}
