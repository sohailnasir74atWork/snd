import { orderConfirmationHtml, billHtml, receiptHtml } from '../templates';
import { DEFAULT_VISIBILITY } from '../../data/models';
import type { CompanySettings, Order, Payment, Shop } from '../../data/models';

const settings: CompanySettings = {
  brandName: 'Alpha Skin Care',
  address: 'Main Road, Gujranwala',
  phone: '0300-1234567',
  currencySymbol: 'Rs',
  countryCode: '+92',
  taxPercent: 0,
  maxDiscountPercent: 10,
  defaultDeliveryDay: 'tomorrow',
  shopsPerDay: 30,
  rewardApprovalLimit: 5000,
  rewardPerPiece: 40,
  visibility: DEFAULT_VISIBILITY,
  acceptCheques: true,
  sendConfirmations: true,
  receiptFooter: 'Thank you for your business',
};

const shop: Shop = {
  id: 's1',
  name: 'Bismillah Store',
  ownerName: 'Akram',
  phone: '0311-7654321',
  area: 'Satellite Town',
  outstanding: 4400,
  standingDiscountPercent: 0,
  active: true,
};

// Ordered 6 + 12; delivered 6 + 6 (a short delivery on Sunblock).
const order: Order = {
  id: 'o1',
  orderNo: 'ORD-2026-0001',
  invoiceNo: 'INV-2026-0001',
  bookedBy: 'u-booker',
  assignedTo: 'u-rider',
  deliveryDate: '2026-08-05',
  shopId: 's1',
  shopSnapshot: { name: 'Bismillah Store', phone: '0311-7654321', area: 'Satellite Town' },
  items: [
    { productId: 'p1', name: 'Face Wash', qty: 6, unitPrice: 900, deliveredQty: 6 },
    { productId: 'p2', name: 'Sunblock', qty: 12, unitPrice: 750, deliveredQty: 6 },
  ],
  orderedTotals: { subTotal: 14400, discountTotal: 0, grandTotal: 14400 },
  billedTotals: { subTotal: 9900, discountTotal: 0, grandTotal: 9900 },
  discountPercent: 0,
  status: 'delivered',
  paymentStatus: 'partial',
  amountPaid: 5000,
  deliveryDay: 'tomorrow',
  bookedAt: new Date(2026, 7, 5).getTime(), // 5 Aug 2026
  deliveredAt: new Date(2026, 7, 6).getTime(), // 6 Aug 2026
};

describe('order confirmation (§8.1)', () => {
  const html = orderConfirmationHtml({ settings, order, shop });

  test('says loudly that it is not a bill', () => {
    expect(html).toContain('ORDER CONFIRMATION');
    expect(html.toLowerCase()).toContain('this is not a bill');
  });

  test('shows ordered totals, order no, delivery day and the footer promise', () => {
    expect(html).toContain('ORD-2026-0001');
    expect(html).toContain('14,400'); // ordered grand total
    expect(html).toContain('Delivery: Tomorrow');
    expect(html).toContain('Your bill comes with the delivery');
    expect(html).toContain('Alpha Skin Care');
    expect(html).toContain('5 Aug 2026');
  });
});

describe('bill (§8.2)', () => {
  const html = billHtml({
    settings,
    order,
    shop,
    amountInWordsLine: 'Rupees nine thousand nine hundred only',
    received: 5000,
    previousBalance: 4400,
  });

  test('uses deliveredQty, never the ordered qty', () => {
    // Sunblock: ordered 12, delivered 6 -> line amount 4,500 (not 9,000).
    expect(html).toContain('4,500');
    expect(html).not.toContain('9,000');
    expect(html).toContain('>6<');
    expect(html).not.toContain('>12<');
    // Ordered grand total must not leak onto the bill.
    expect(html).not.toContain('14,400');
  });

  test('billed totals, numbers and words line all appear', () => {
    expect(html).toContain('INV-2026-0001');
    expect(html).toContain('ORD-2026-0001');
    expect(html).toContain('9,900'); // billed grand total
    expect(html).toContain('Rupees nine thousand nine hundred only');
  });

  test('khata rows: received, balance this bill, previous balance, outstanding', () => {
    expect(html).toContain('Received');
    expect(html).toContain('Balance this bill');
    expect(html).toContain('Rs 4,900'); // 9,900 - 5,000
    expect(html).toContain('Previous balance');
    expect(html).toContain('TOTAL OUTSTANDING');
    expect(html).toContain('Rs 9,300'); // 4,400 + 4,900
  });

  test('booked and delivered dates both print', () => {
    expect(html).toContain('5 Aug 2026');
    expect(html).toContain('6 Aug 2026');
  });
});

describe('payment receipt (§8.4)', () => {
  const payment: Payment = {
    id: 'pay1',
    receiptNo: 'RCP-2026-0001',
    shopId: 's1',
    orderIds: [
      { orderId: 'o7', amount: 3000 },
      { orderId: 'o8', amount: 2000 },
    ],
    amount: 5000,
    mode: 'cash',
    collectedBy: 'rider',
    confirmed: false,
    createdAt: new Date(2026, 7, 6).getTime(),
  };

  const html = receiptHtml({
    settings,
    payment,
    shopName: 'Bismillah Store',
    allocations: [
      { label: 'INV-2026-0007', amount: 3000 },
      { label: 'INV-2026-0008', amount: 2000 },
    ],
    newOutstanding: 4400,
  });

  test('prints the FIFO split and the new outstanding', () => {
    expect(html).toContain('RCP-2026-0001');
    expect(html).toContain('Rs 5,000');
    expect(html).toContain('INV-2026-0007');
    expect(html).toContain('Rs 3,000');
    expect(html).toContain('INV-2026-0008');
    expect(html).toContain('Rs 2,000');
    expect(html).toContain('New outstanding');
    expect(html).toContain('Rs 4,400');
    expect(html).toContain('Cash');
    expect(html).toContain('Bismillah Store');
  });
});
