import { orderConfirmationHtml, billHtml, billSheetHtml, receiptHtml, itemsPerSlip } from '../templates';
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

/**
 * A serial issued with no signal (src/lib/serials `LOCAL-…`) is a device
 * reference, not the company's number. Unmarked on paper it reads exactly like
 * a real one — these assert that it never prints unmarked, and equally that a
 * normal document is not littered with a warning it does not need.
 */
describe('provisional serials are marked on paper (FR-5.8)', () => {
  test('an offline order confirmation is marked and explained', () => {
    const html = orderConfirmationHtml({
      settings, shop, order: { ...order, orderNo: 'LOCAL-ORD-7' },
    });
    expect(html).toContain('LOCAL-ORD-7');
    expect(html).toContain('PROVISIONAL');
    expect(html).toContain('no internet connection');
  });

  test('an offline bill marks the bill number and the order number', () => {
    const html = billHtml({
      settings, shop,
      order: { ...order, orderNo: 'LOCAL-ORD-7', invoiceNo: 'LOCAL-INV-8' },
      amountInWordsLine: 'Rupees nine thousand nine hundred only',
      received: 5000,
      previousBalance: 4400,
    });
    expect(html).toContain('LOCAL-INV-8');
    expect(html).toContain('LOCAL-ORD-7');
    expect(html.match(/PROVISIONAL/g)).toHaveLength(3); // two numbers + the note
  });

  test('an offline receipt is marked', () => {
    const html = receiptHtml({
      settings,
      payment: {
        id: 'pay2', receiptNo: 'LOCAL-RCP-3', shopId: 's1', orderIds: [],
        amount: 5000, mode: 'cash', collectedBy: 'rider', confirmed: false,
        createdAt: new Date(2026, 7, 6).getTime(),
      },
      shopName: 'Bismillah Store',
      allocations: [],
      newOutstanding: 4400,
    });
    expect(html).toContain('LOCAL-RCP-3');
    expect(html).toContain('PROVISIONAL');
  });

  test('a synced document carries no marker and no note at all', () => {
    const html = billHtml({
      settings, shop, order,
      amountInWordsLine: 'Rupees nine thousand nine hundred only',
      received: 5000,
      previousBalance: 4400,
    });
    expect(html).not.toContain('PROVISIONAL');
    expect(html).not.toContain('no internet connection');
  });
});

/**
 * The logo is a data: URI, never a CDN link — the rider printing a bill may
 * have no signal, and a remote <img> would be a hole in the one document the
 * shopkeeper keeps. `lib/logoCache.ts` is what makes the bytes local.
 */
describe('company logo on the letterhead', () => {
  const LOGO_URI = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  test('a bill with a logo embeds it beside the brand name', () => {
    const html = billHtml({
      settings, shop, order, logo: LOGO_URI,
      amountInWordsLine: 'Rupees nine thousand nine hundred only',
      received: 5000, previousBalance: 4400,
    });
    expect(html).toContain('class="letterhead"');
    expect(html).toContain(LOGO_URI);
    expect(html).toContain('Alpha Skin Care'); // the name is still the header
  });

  test('every document type carries it', () => {
    expect(orderConfirmationHtml({ settings, order, shop, logo: LOGO_URI }))
      .toContain('class="logo"');
    expect(receiptHtml({
      settings, shopName: 'Bismillah Store', allocations: [], newOutstanding: 0,
      logo: LOGO_URI,
      payment: {
        id: 'p', receiptNo: 'RCP-2026-0009', shopId: 's1', orderIds: [], amount: 100,
        mode: 'cash', collectedBy: 'rider', confirmed: false, createdAt: Date.now(),
      },
    })).toContain('class="logo"');
  });

  test('without one there is no broken image, just the name', () => {
    const html = billHtml({
      settings, shop, order,
      amountInWordsLine: 'Rupees nine thousand nine hundred only',
      received: 5000, previousBalance: 4400,
    });
    // The masthead is always there — it is the pad. Only the picture is
    // optional, and its absence must leave a gap rather than a broken icon.
    expect(html).not.toContain('<img');
    expect(html).toContain('Alpha Skin Care');
  });
});

// ------------------------------------------------ bill sheet (§8.2b)

/** n slips off the same order, each with its own bill number and shop name. */
function slips(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    order: { ...order, id: `o${i}`, invoiceNo: `INV-2026-${String(i + 1).padStart(4, '0')}` },
    shop: { ...shop, id: `s${i}`, name: `Shop ${i + 1}` },
    paid: 5000,
  }));
}

describe('bill sheet — many copies on one A4 (§8.2b)', () => {
  test('an A4 page, not the A5 sheet the single bill uses', () => {
    const html = billSheetHtml({ settings, bills: slips(1), perPage: 4 });
    expect(html).toContain('size: A4 portrait');
    expect(html).not.toContain('size: A5 portrait');
  });

  test('every slip is headed BILL', () => {
    // It read BILL COPY / ORDER COPY depending on delivery. The owner asked
    // for one standard bill: these go to shops, and a document that calls
    // itself a copy invites the question of where the original is.
    const html = billSheetHtml({ settings, bills: slips(1), perPage: 4 });
    expect(html).toContain('>BILL<');
  });

  /**
   * The owner prints these to hand to the DELIVERY MAN, so an order that has
   * not gone out yet is the one he needs most — and it is not a bill. These
   * pin the difference, because printing an undelivered order under the word
   * BILL is the exact lie the confirmation prints "This is not a bill" to
   * avoid, on paper that gets cut out and handed over.
   */
  test('an undelivered order prints as a standard bill too', () => {
    const pending = { ...order, status: 'assigned' as const, deliveredAt: undefined, invoiceNo: undefined };
    const html = billSheetHtml({ settings, perPage: 3, bills: [{ order: pending, shop, paid: 0 }] });
    expect(html).toContain('>BILL<');
    expect(html).not.toContain('ORDER COPY');
  });

  test('an undelivered order is priced on what was ORDERED', () => {
    // Ordered 6 + 12 = 14,400; delivered would be 9,900. Before the van has
    // been, the second number does not exist yet.
    const pending = { ...order, status: 'assigned' as const, deliveredAt: undefined, invoiceNo: undefined };
    const html = billSheetHtml({ settings, perPage: 3, bills: [{ order: pending, shop, paid: 0 }] });
    expect(html).toContain('14,400');
    expect(html).not.toContain('9,900');
    expect(html).toContain('>12<'); // the full ordered quantity, not the 6 delivered
  });

  test('an undelivered order still carries Paid and Balance', () => {
    // It used to print "Not yet delivered — Tomorrow" instead. The owner hands
    // this to the shop with the goods, so it needs to say what is owed.
    const pending = { ...order, status: 'assigned' as const, deliveredAt: undefined, invoiceNo: undefined };
    const html = billSheetHtml({ settings, perPage: 3, bills: [{ order: pending, shop, paid: 0 }] });
    expect(html).toContain('Balance');
    expect(html).not.toContain('Not yet delivered');
  });

  test('three to a page turns the PAPER, not the content', () => {
    const html = billSheetHtml({ settings, bills: slips(3), perPage: 3 });
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('width: 297mm; height: 210mm');
    // The other layouts stay portrait.
    expect(billSheetHtml({ settings, bills: slips(3), perPage: 4 })).toContain('size: A4 portrait');
  });

  test('an undelivered order carries its ORDER number, not an invented bill number', () => {
    const pending = { ...order, status: 'assigned' as const, deliveredAt: undefined, invoiceNo: undefined };
    const html = billSheetHtml({ settings, perPage: 3, bills: [{ order: pending, shop, paid: 0 }] });
    expect(html).toContain('ORD-2026-0001');
  });

  test('four to a page fills two pages with five bills', () => {
    const html = billSheetHtml({ settings, bills: slips(5), perPage: 4 });
    expect((html.match(/class="page"/g) ?? []).length).toBe(2);
  });

  test('a part-full last page still has all its cells, so the cuts line up', () => {
    // Five bills at 4-up leaves one slip and three blanks — and the blanks
    // must exist or the last page cuts on different lines from every other.
    const html = billSheetHtml({ settings, bills: slips(5), perPage: 4 });
    expect((html.match(/class="cell"/g) ?? []).length).toBe(8);
  });

  test('each layout puts the right number of cells on a page', () => {
    for (const [perPage, cells] of [[2, 2], [3, 3], [4, 4]] as const) {
      const html = billSheetHtml({ settings, bills: slips(1), perPage });
      expect((html.match(/class="cell"/g) ?? []).length).toBe(cells);
    }
  });

  test('every slip carries its own bill number and shop', () => {
    const html = billSheetHtml({ settings, bills: slips(3), perPage: 4 });
    for (const n of ['INV-2026-0001', 'INV-2026-0002', 'INV-2026-0003']) expect(html).toContain(n);
    for (const s of ['Shop 1', 'Shop 2', 'Shop 3']) expect(html).toContain(s);
  });

  test('the total is the BILLED total — delivered quantities, not ordered', () => {
    const html = billSheetHtml({ settings, bills: slips(1), perPage: 4 });
    expect(html).toContain('9,900');   // billed
    expect(html).not.toContain('14,400'); // ordered — a short delivery must not print
  });

  test('balance is the bill less what was paid against it', () => {
    const html = billSheetHtml({ settings, bills: slips(1), perPage: 4 });
    expect(html).toContain('4,900'); // 9,900 - 5,000
  });

  /** n delivered lines, named so the first hidden one can be looked for. */
  function basket(n: number) {
    return {
      ...order,
      items: Array.from({ length: n }, (_, i) => ({
        productId: `p${i}`, name: `Product ${String(i + 1).padStart(2, '0')}`,
        qty: 2, unitPrice: 100, deliveredQty: 2,
      })),
    };
  }

  test('a long basket is summarised, never silently cut', () => {
    // Twenty-four delivered lines into a 3-up column, which shows eighteen.
    const html = billSheetHtml({
      settings, perPage: 3, bills: [{ order: basket(24), shop, paid: 0 }],
    });
    expect(html).toContain('+ 6 more items');
    expect(html).toContain('covers all 24');
    expect(html).toContain('Product 18');      // the last one shown
    expect(html).not.toContain('Product 19');  // the first one hidden
  });

  /**
   * This test used to assert the opposite, and the app printed on that belief
   * for a year: that a half-page 2-up cell holds the longest basket. It does
   * not. 2-up and 4-up are both 148.5mm tall and only 3-up is 210mm, so the
   * TALL layout is the roomy one and the wide one is the tightest — which is
   * why 2-up's cap was set at twenty against a cell that held eleven, and
   * lines twelve onward were cut off the paper with nothing to say so.
   *
   * Pinned in this direction so it cannot be quietly restored. If this fails,
   * re-measure before changing the numbers: the caps come off a rendered A4,
   * not off which layout sounds biggest.
   */
  test('the TALL layout holds the longest basket, not the widest', () => {
    const caps = ([2, 3, 4] as const).map(perPage => {
      const html = billSheetHtml({ settings, perPage, bills: [{ order: basket(30), shop, paid: 0 }] });
      return Number(/covers all 30/.test(html) ? /\+ (\d+) more item/.exec(html)?.[1] ?? '0' : '0');
    });
    // Each layout hides 30 - cap lines, so the SMALLEST hidden count is the
    // roomiest layout. That has to be 3-up.
    const [hid2, hid3, hid4] = caps;
    expect(hid3).toBeLessThan(hid2);
    expect(hid3).toBeLessThan(hid4);
  });

  /**
   * The cap is a promise about paper, so it has to be a promise the SCREEN
   * makes with the same number. These were maintained separately and disagreed.
   */
  test('the screen reads its item counts off the layout table', () => {
    for (const perPage of [2, 3, 4] as const) {
      const cap = itemsPerSlip(perPage);
      const html = billSheetHtml({ settings, perPage, bills: [{ order: basket(30), shop, paid: 0 }] });
      expect(html).toContain(`+ ${30 - cap} more items`);
    }
  });

  test('three to a page is three TALL columns — a receipt shape', () => {
    // A bill is a receipt: header across the top, items down the page, total
    // at the foot. As wide horizontal strips the header ran along the long
    // edge and it did not read as a receipt at all.
    const html = billSheetHtml({ settings, bills: slips(3), perPage: 3 });
    expect(html).toContain('grid-template-columns: repeat(3, 1fr)');
    expect(html).toContain('grid-template-rows: repeat(1, 1fr)');
  });

  test('the logo rides on every slip when there is one', () => {
    const html = billSheetHtml({
      settings, bills: slips(3), perPage: 3, logo: 'data:image/png;base64,AAAA',
    });
    expect((html.match(/class="s-logo"/g) ?? []).length).toBe(3);
  });

  test('no logo leaves no broken image behind', () => {
    expect(billSheetHtml({ settings, bills: slips(2), perPage: 3 })).not.toContain('<img');
  });

  test('the warranty travels on every cut-out slip, not just the sheet', () => {
    // These get cut apart and handed over. Terms that only exist once, on the
    // copy the owner keeps, were never given to the buyer.
    const html = billSheetHtml({
      settings: { ...settings, warrantyText: 'Goods once sold are not returnable.' },
      bills: slips(3), perPage: 3,
    });
    expect((html.match(/Goods once sold are not returnable\./g) ?? []).length).toBe(3);
  });

  test('an empty warranty prints no block at all', () => {
    const html = billSheetHtml({
      settings: { ...settings, warrantyText: '   ' }, bills: slips(1), perPage: 3,
    });
    expect(html).not.toContain('s-warranty">');
  });

  test('a basket that fits says nothing about hidden lines', () => {
    const html = billSheetHtml({ settings, bills: slips(1), perPage: 2 });
    expect(html).not.toContain('more item');
  });

  test('a provisional number is marked here too', () => {
    const html = billSheetHtml({
      settings, perPage: 4,
      bills: [{ order: { ...order, invoiceNo: 'LOCAL-INV-7' }, shop, paid: 0 }],
    });
    expect(html).toContain('PROV');
  });

  /** Page one: what the owner pulls off the shelf before the van goes. */
  describe('the load sheet on the front', () => {
    const runs = [
      { order: { ...order, id: 'a' }, shop: { ...shop, id: 'sa' }, paid: 0 },
      { order: { ...order, id: 'b' }, shop: { ...shop, id: 'sb', name: 'Other Shop' }, paid: 0 },
    ];

    test('off by default — an existing caller gets exactly the pages it got before', () => {
      const html = billSheetHtml({ settings, bills: runs, perPage: 3 });
      expect(html).not.toContain('LOAD SHEET');
      expect((html.match(/class="page"/g) ?? []).length).toBe(1);
    });

    test('on, it is ONE extra page in the SAME pdf', () => {
      // The picking list and the shop copies belong in the same five minutes.
      // Printed separately, the picking list gets left on the desk.
      const html = billSheetHtml({ settings, bills: runs, perPage: 3, loadSheet: true });
      expect(html).toContain('LOAD SHEET');
      expect((html.match(/class="page load"/g) ?? []).length).toBe(1);
    });

    test('it comes FIRST — the van is loaded before anything is handed over', () => {
      const html = billSheetHtml({ settings, bills: runs, perPage: 3, loadSheet: true });
      expect(html.indexOf('LOAD SHEET')).toBeLessThan(html.indexOf('>BILL<'));
    });

    test('quantities are added across every shop in the run', () => {
      // Two shops, 6 Face Wash each (delivered 6) -> the shelf gives up 12.
      const html = billSheetHtml({ settings, bills: runs, perPage: 3, loadSheet: true });
      expect(html).toContain('>12<');
      expect(html).toContain('2 shops');
    });

    test('the totals line counts pieces, not lines', () => {
      // Face Wash 6+6 and Sunblock 12+12 ordered = 36 pieces over 2 products.
      const html = billSheetHtml({ settings, bills: runs, perPage: 3, loadSheet: true });
      expect(html).toContain('36 pieces');
      expect(html).toContain('2 products');
    });

    test('nothing ticked means no cover page rather than an empty one', () => {
      const html = billSheetHtml({ settings, bills: [], perPage: 3, loadSheet: true });
      expect(html).not.toContain('LOAD SHEET');
    });
  });

  test('no bills still produces a valid document rather than markup with no page', () => {
    const html = billSheetHtml({ settings, bills: [], perPage: 4 });
    expect(html).toContain('<!DOCTYPE html>');
    expect((html.match(/class="page"/g) ?? []).length).toBe(1);
  });
});

describe('a business with no sales tax never sees the words', () => {
  const untaxed = { ...settings, taxPercent: 0 };
  const bill = { order, shop, paid: 5000 };

  test('the slip prints no tax line at all', () => {
    const html = billSheetHtml({ settings: untaxed, bills: [bill], perPage: 3 });
    expect(html).not.toContain('Sales tax');
  });

  test('nor does the full A5 bill', () => {
    const html = billHtml({
      settings: untaxed, order, shop,
      amountInWordsLine: 'x', received: 0, previousBalance: 0,
    });
    expect(html).not.toContain('Sales tax');
  });

  test('but a taxed order says so, with the rate that was actually charged', () => {
    const taxed = { ...order, billedTotals: { subTotal: 9900, discountTotal: 0, taxTotal: 1683, grandTotal: 11583 } };
    const html = billSheetHtml({ settings, bills: [{ ...bill, order: taxed }], perPage: 3 });
    expect(html).toContain('Sales tax');
  });
});

describe('the warranty reaches every document a shop keeps', () => {
  const withTerms = { ...settings, warrantyText: 'Goods once sold are not returnable.' };

  test('the full A5 bill — the one the rider sends over WhatsApp', () => {
    const html = billHtml({
      settings: withTerms, order, shop,
      amountInWordsLine: 'x', received: 0, previousBalance: 0,
    });
    expect(html).toContain('Goods once sold are not returnable.');
  });

  test('and the cut-out slips', () => {
    const html = billSheetHtml({ settings: withTerms, bills: [{ order, shop, paid: 0 }], perPage: 3 });
    expect(html).toContain('Goods once sold are not returnable.');
  });

  test('the order confirmation does NOT carry it', () => {
    // It is not a bill and says so in bold. Trade warranty terms belong on the
    // document that accompanies the goods, not on a slip that promises them.
    expect(orderConfirmationHtml({ settings: withTerms, order, shop }))
      .not.toContain('Goods once sold are not returnable.');
  });
});
