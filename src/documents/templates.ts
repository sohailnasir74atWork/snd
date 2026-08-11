/**
 * Paper documents (SRS §8) — pure HTML-string generators.
 *
 * No React, no native deps: each function returns a complete, self-contained
 * HTML document (all CSS inline) ready for a print/PDF/WebView pipeline.
 * Layout: a clean A5-portrait sheet with a monospace items table so the same
 * markup also reads well on a 58mm thermal printer.
 *
 * All money is integer rupees — formatting goes through src/lib/money only.
 */
import type { CompanySettings, Order, Payment, Shop, Totals } from '../data/models';
import { formatAmount, formatMoney } from '../lib/money';
import { computeTotals, formatDiscountPercent, pickList } from '../lib/order';
import { isProvisional } from '../lib/serials';
import { displayName } from '../lib/name';

// ---------------------------------------------------------------- helpers

/** Escape user-entered text (shop names, product names, footer) for HTML. */
function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Aug 2026" — deterministic, locale-independent. */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Shared A5 sheet + print CSS wrapper. */
function sheet(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  @page { size: A5 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #E9EEEC; }
  .sheet {
    width: 148mm; min-height: 210mm; margin: 0 auto; padding: 10mm 9mm;
    background: #FFFFFF; color: #14201B;
    font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
    font-size: 12px; line-height: 1.5;
  }
  @media print { html, body { background: #FFFFFF; } .sheet { margin: 0; } }
  .brand { font-size: 19px; font-weight: 800; letter-spacing: 0.5px; }
  .brand-sub { color: #4A5A54; }
  .letterhead { display: flex; align-items: center; gap: 8px; }
  /* Bounded on BOTH axes and never stretched: a wide logo and a tall one both
     have to sit in the same header without pushing the address off the sheet. */
  .logo { width: 20mm; height: 20mm; object-fit: contain; flex: 0 0 auto; }
  .doc-title { margin: 10px 0 2px; font-size: 15px; font-weight: 800; letter-spacing: 1px; }
  .doc-note { font-weight: 700; color: #B3261E; margin-bottom: 8px; }
  .prov {
    font-size: 10px; font-weight: 800; letter-spacing: 0.5px; color: #B3261E;
    border: 1px solid #B3261E; border-radius: 3px; padding: 0 3px; white-space: nowrap;
  }
  .prov-note { margin-top: 4px; color: #B3261E; font-size: 11px; line-height: 1.4; }
  .rule { border: 0; border-top: 2px solid #14201B; margin: 8px 0; }
  .rule-soft { border: 0; border-top: 1px dashed #9AA8A2; margin: 8px 0; }
  .meta { width: 100%; border-collapse: collapse; }
  .meta td { padding: 1px 0; vertical-align: top; }
  .meta .label { color: #4A5A54; padding-right: 8px; white-space: nowrap; }
  table.items { width: 100%; border-collapse: collapse; margin: 6px 0; }
  table.items th {
    text-align: left; border-bottom: 1px solid #14201B; padding: 3px 4px;
    font-size: 11px; letter-spacing: 0.5px;
  }
  table.items td { padding: 3px 4px; border-bottom: 1px dashed #C7D0CC; }
  .num { text-align: right; white-space: nowrap; }
  table.totals { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.totals td { padding: 2px 4px; }
  table.totals .grand td {
    border-top: 2px solid #14201B; border-bottom: 2px solid #14201B;
    font-size: 14px; font-weight: 800; padding: 4px;
  }
  .words { margin: 6px 0 10px; font-style: italic; color: #2F3E38; }
  .big { font-size: 16px; font-weight: 800; }
  .footer { margin-top: 14px; text-align: center; color: #4A5A54; }
  .footer .strong { color: #14201B; font-weight: 700; }
  /* Small print, and it should LOOK like small print: set apart above the
     line, smaller than the bill, and justified so a dense paragraph does not
     end in a ragged half-line. It is a legal statement, not a message — the
     thank-you footer below it keeps the warmer voice. */
  .warranty {
    margin-top: 12px; padding-top: 6px; border-top: 1px solid #9AA8A2;
    font-size: 9px; line-height: 1.35; color: #2F3E38; text-align: justify;
  }
</style>
</head>
<body>
<div class="sheet">
${body}
</div>
</body>
</html>`;
}

/**
 * Company header: logo, brand name, address, phone, tax number.
 *
 * `logo` is a data: URI, never the CDN link — `react-native-html-to-pdf`
 * renders a remote `<img>` by fetching it, and the rider printing this is
 * standing in a street. See `lib/logoCache.ts`. Absent is normal and always
 * will be: the header falls back to the name alone, exactly as it read before
 * logos existed, and a bill must never fail over a picture.
 */
function headerBlock(settings: CompanySettings, logo?: string): string {
  const text: string[] = [`<div class="brand">${esc(settings.brandName)}</div>`];
  if (settings.address) text.push(`<div class="brand-sub">${esc(settings.address)}</div>`);
  if (settings.phone) text.push(`<div class="brand-sub">Phone: ${esc(settings.phone)}</div>`);
  if (settings.taxNumber) text.push(`<div class="brand-sub">Tax number: ${esc(settings.taxNumber)}</div>`);
  if (!logo) return text.join('\n');
  // The logo sits beside the name rather than above it: an A5 sheet has one
  // header's worth of room and the business name must stay the biggest thing
  // on the page. `alt` is empty on purpose — it is decoration, and a broken
  // image should leave a gap, not the word "logo".
  return `<div class="letterhead">
  <img class="logo" src="${esc(logo)}" alt="" />
  <div>${text.join('\n')}</div>
</div>`;
}

interface ItemRow {
  name: string;
  qty: number;
  rate: number;
  amount: number;
}

function itemsTable(rows: ItemRow[], symbol: string): string {
  const body = rows
    .map(
      (r) => `<tr>
  <td>${esc(r.name)}</td>
  <td class="num">${r.qty}</td>
  <td class="num">${formatAmount(r.rate)}</td>
  <td class="num">${formatAmount(r.amount)}</td>
</tr>`,
    )
    .join('\n');
  return `<table class="items">
<thead><tr>
  <th>Product</th>
  <th class="num">Qty</th>
  <th class="num">Rate (${esc(symbol)})</th>
  <th class="num">Amount (${esc(symbol)})</th>
</tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

function totalRow(label: string, amount: number, symbol: string, grand = false): string {
  return `<tr${grand ? ' class="grand"' : ''}><td>${esc(label)}</td><td class="num">${formatMoney(amount, symbol)}</td></tr>`;
}

/**
 * The sales-tax line, or nothing at all.
 *
 * Emits nothing when the bill carries no tax — which is every bill written
 * before tax existed and every bill of a business whose rate is 0. A zero-rupee
 * "Tax (0%)" row on an untaxed invoice is noise that makes the document look
 * like it is for someone else.
 *
 * The rate comes from the TOTALS, not from settings: reprinting a six-month-old
 * bill must show the tax that was actually charged on it, not whatever the rate
 * happens to be today.
 */
function taxRow(totals: Totals, symbol: string): string {
  const tax = totals.taxTotal ?? 0;
  if (tax <= 0) return '';
  const taxable = totals.subTotal - totals.discountTotal;
  const rate = taxable > 0 ? Math.round((tax / taxable) * 1000) / 10 : 0;
  return totalRow(`Sales tax (${rate}%)`, tax, symbol) + '\n';
}

/**
 * The trade warranty and returns terms, or nothing at all.
 *
 * Nothing at all is a real answer and has to stay one: a business that clears
 * the box wants no small print, and an empty bordered box at the foot of every
 * bill would look like the app failed to print something.
 *
 * The text is the seller's, not ours — `settings.warrantyText`, defaulting to
 * the cosmetics template in models. It goes through `esc` like every other
 * field a person can type into, and newlines survive as line breaks so an
 * owner can lay out clauses without needing HTML.
 */
function warrantyBlock(settings: CompanySettings, className: string): string {
  const text = settings.warrantyText?.trim();
  if (!text) return '';
  return `<div class="${className}">${esc(text).replace(/\n/g, '<br />')}</div>`;
}

function metaRow(label: string, value: string): string {
  return `<tr><td class="label">${esc(label)}</td><td>${esc(value)}</td></tr>`;
}

/**
 * A meta row carrying a document number, marked when that number is one the
 * phone issued itself.
 *
 * A serial written with no signal is a device-local reference (`LOCAL-RCP-7`)
 * from src/lib/serials, not a number out of the company's counter — and the
 * shopkeeper is holding the paper it is printed on. Unmarked it reads exactly
 * like a real serial, which is how two shops end up quoting the same number at
 * the owner. `isProvisional` reads the value itself rather than the stored
 * `provisional` flag, so a reprint of an old document is marked correctly
 * whatever the flag on it happens to say.
 */
function serialRow(label: string, value: string): string {
  if (!isProvisional(value)) return metaRow(label, value);
  return `<tr><td class="label">${esc(label)}</td><td>${esc(value)} <span class="prov">PROVISIONAL</span></td></tr>`;
}

/**
 * The one line that explains the mark above, printed only when the sheet
 * carries such a number.
 *
 * It deliberately does NOT promise a final number later: nothing promotes a
 * provisional serial today (HANDOFF §4.14), so the reference on this page is
 * the one that stays. Telling the shop to expect a replacement would make the
 * document lie on the app's behalf.
 */
function provisionalNote(...values: (string | undefined)[]): string {
  if (!values.some(v => isProvisional(v))) return '';
  return '<div class="prov-note">Written with no internet connection. The number marked ' +
    'PROVISIONAL was issued by this phone, not from the company\'s serial list — quote it ' +
    'with the date and the shop name.</div>';
}

// ------------------------------------------------- 1. Order confirmation

export interface OrderConfirmationArgs {
  settings: CompanySettings;
  /**
   * The company logo as a data: URI (`lib/logoCache.ts`). Optional forever —
   * a document without one prints the brand name alone.
   */
  logo?: string;
  order: Order;
  shop: Shop;
}

/**
 * §8.1 — the slip the booker leaves with the shop. Ordered quantities and
 * ordered totals; loudly NOT a bill.
 */
export function orderConfirmationHtml(args: OrderConfirmationArgs): string {
  const { settings, order, shop, logo } = args;
  const symbol = settings.currencySymbol;
  const rows: ItemRow[] = order.items.map((it) => ({
    name: it.name,
    qty: it.qty,
    rate: it.unitPrice,
    amount: it.qty * it.unitPrice,
  }));
  const totals = order.orderedTotals;
  const deliveryLabel = order.deliveryDay === 'today' ? 'Today' : 'Tomorrow';

  const body = `${headerBlock(settings, logo)}
<hr class="rule" />
<div class="doc-title">ORDER CONFIRMATION</div>
<div class="doc-note">This is not a bill</div>
<table class="meta">
${serialRow('Order no', order.orderNo)}
${metaRow('Date', formatDate(order.bookedAt))}
${metaRow('Shop', displayName(shop.name))}
${metaRow('Area', shop.area)}
</table>
${provisionalNote(order.orderNo)}
${itemsTable(rows, symbol)}
<table class="totals">
${totalRow('Subtotal', totals.subTotal, symbol)}
${totalRow(`Discount (${formatDiscountPercent(order.discountPercent)}%)`, totals.discountTotal, symbol)}
${taxRow(totals, symbol)}${totalRow('TOTAL', totals.grandTotal, symbol, true)}
</table>
<hr class="rule-soft" />
<div class="big">Delivery: ${deliveryLabel}</div>
<div class="footer"><span class="strong">Your bill comes with the delivery.</span></div>`;

  return sheet(`Order confirmation ${order.orderNo}`, body);
}

// --------------------------------------------------------------- 2. Bill

export interface BillArgs {
  settings: CompanySettings;
  /**
   * The company logo as a data: URI (`lib/logoCache.ts`). Optional forever —
   * a document without one prints the brand name alone.
   */
  logo?: string;
  order: Order;
  shop: Shop;
  /** Pre-built words line, e.g. "Rupees nine thousand nine hundred only" (src/lib/money amountInWordsLine). */
  amountInWordsLine: string;
  /** Cash the shop handed over against THIS bill at delivery time. 0 if nothing. */
  received: number;
  /** Shop's outstanding balance BEFORE this bill (the old khata). */
  previousBalance: number;
  /**
   * Cash from the same handover that went to the OLD khata rather than this
   * bill (the "+ old khata" option). Without it the printed TOTAL OUTSTANDING
   * ignored the money just paid and dunned the shopkeeper for cash still in
   * the rider's hand.
   */
  paidToPrevious?: number;
}

/**
 * §8.2 — the real invoice the rider hands over. Uses DELIVERED quantities
 * only; short-delivered lines are billed at what actually arrived.
 *
 * Extra args (documented above): `received` and `previousBalance` are the two
 * numbers the template cannot derive from the order itself. From them it
 * prints: Balance this bill = TOTAL - received, and
 * TOTAL OUTSTANDING = previousBalance + balance this bill.
 */
export function billHtml(args: BillArgs): string {
  const { settings, order, shop, logo, received, previousBalance, paidToPrevious = 0 } = args;
  const symbol = settings.currencySymbol;
  const rows: ItemRow[] = order.items
    .filter((it) => (it.deliveredQty ?? 0) > 0)
    .map((it) => {
      const qty = it.deliveredQty ?? 0;
      return { name: it.name, qty, rate: it.unitPrice, amount: qty * it.unitPrice };
    });
  const totals = order.billedTotals ?? computeTotals(order.items, order.discountPercent, true);
  const balanceThisBill = totals.grandTotal - received;
  const remainingPrevious = Math.max(0, previousBalance - paidToPrevious);
  const totalOutstanding = remainingPrevious + balanceThisBill;

  const body = `${headerBlock(settings, logo)}
<hr class="rule" />
<div class="doc-title">BILL</div>
<table class="meta">
${serialRow('Bill no', order.invoiceNo ?? '—')}
${serialRow('Order no', order.orderNo)}
${metaRow('Booked', formatDate(order.bookedAt))}
${metaRow('Delivered', order.deliveredAt !== undefined ? formatDate(order.deliveredAt) : '—')}
${metaRow('Shop', displayName(shop.name))}
${metaRow('Area', shop.area)}
</table>
${provisionalNote(order.invoiceNo, order.orderNo)}
${itemsTable(rows, symbol)}
<table class="totals">
${totalRow('Subtotal', totals.subTotal, symbol)}
${totalRow(`Discount (${formatDiscountPercent(order.discountPercent)}%)`, totals.discountTotal, symbol)}
${taxRow(totals, symbol)}${totalRow('TOTAL', totals.grandTotal, symbol, true)}
</table>
<div class="words">${esc(args.amountInWordsLine)}</div>
<table class="totals">
${totalRow('Received', received, symbol)}
${totalRow('Balance this bill', balanceThisBill, symbol)}
${totalRow('Previous balance', previousBalance, symbol)}
${totalRow('TOTAL OUTSTANDING', totalOutstanding, symbol, true)}
</table>
${warrantyBlock(settings, 'warranty')}
${settings.receiptFooter ? `<div class="footer">${esc(settings.receiptFooter)}</div>` : ''}`;

  return sheet(`Bill ${order.invoiceNo ?? order.orderNo}`, body);
}

// ------------------------------------- 2b. Bill sheet — many bills, one page

/**
 * How many slips share one A4 sheet.
 *
 * **Three is the default, and it is cut straight across.** A bill's item table
 * is four columns wide — name, qty, rate, amount — and the name is the one
 * that needs the room. Splitting the page down the middle to get four slips
 * halves that width to 105mm, and "Sunblock SPF50 90ml" starts wrapping onto
 * two lines while three quarters of the cell sits empty below it. Full-width
 * strips spend the paper where the content actually is.
 *
 * The cutting is easier too, and that matters when it is done forty times a
 * day: 1 × N means two straight cuts across the sheet with no cross-cut to
 * line up, and every piece comes off the same width.
 *
 * 4 stays for anyone who wants the absolute most bills per sheet and has short
 * product names. It is not the default and the screen says why.
 */
export type BillsPerPage = 2 | 3 | 4;

interface SheetLayout {
  cols: number;
  rows: number;
  /**
   * Item lines a slip shows before it stops and says how many it is hiding.
   *
   * Sized to the cell, deliberately conservative. A slip that silently drops
   * its last two lines is worse than useless — the owner files it, and the one
   * time he checks a bill against it the paper is wrong and he does not know
   * it. Over the cap the slip prints "+N more items" and the TOTAL still
   * counts every one of them.
   */
  maxItems: number;
  font: number;
  pad: number;
  /** Turn the PAPER, not the content. See the 3-up entry below. */
  landscape?: boolean;
  /**
   * Ruled blank lines the item table is padded out to.
   *
   * A five-line order on a 210mm column left the slip sitting in its top
   * quarter under a field of white, which reads as a document that failed to
   * print. Every paper invoice book in every shop solves this the same way:
   * the lines are ruled whether or not anything is written on them. The table
   * then has a predictable height, the totals sit where the eye expects them,
   * and the footer anchors the foot.
   *
   * Set BELOW `maxItems` so a full basket simply uses the rows instead.
   */
  minRows: number;
}

/**
 * Caps measured off a rendered A4, not guessed: at 6-up a slip's header,
 * totals and warranty come to roughly a third of the 99mm cell, which leaves
 * room for about twenty item rows. These sit near HALF that, because a product
 * name long enough to wrap takes two rows and the cell clips rather than
 * flowing. The "+N more" line is the backstop; it should be rare, not normal.
 */
const SHEET_LAYOUTS: Record<BillsPerPage, SheetLayout> = {
  // 210 × 148.5mm each — a landscape A5. One cut, and room for a long basket.
  2: { cols: 1, rows: 2, maxItems: 20, font: 11, pad: 9, minRows: 11 },
  // 99 × 210mm each on a LANDSCAPE sheet — the default. Three columns, cut
  // top to bottom.
  //
  // A bill is a receipt: header across the top, items down the page, total at
  // the foot. Wide horizontal strips put the header along the long edge and it
  // did not read as a receipt at all. Three portrait columns fixed that but on
  // a portrait sheet they came out 70mm wide and skinny, with two thirds of
  // the height empty. Turning the PAPER gives each slip 99mm — half again as
  // wide — and drops the wasted height. Same three per page, same two cuts.
  3: { cols: 3, rows: 1, maxItems: 14, font: 9, pad: 6, landscape: true, minRows: 13 },
  // 105 × 148.5mm each — A6. Densest, but the item name gets half the width.
  4: { cols: 2, rows: 2, maxItems: 14, font: 8.5, pad: 6, minRows: 10 },
};

export interface BillSlip {
  order: Order;
  shop: Shop;
  /**
   * Who wrote the order and who is carrying it. Names, already resolved — a
   * document generator has no business looking up a uid, and printing the uid
   * itself would be worse than printing nothing.
   *
   * Both optional and both stay optional: an order booked before these were
   * recorded, or by somebody since removed, simply omits the line rather than
   * printing "Removed employee" on a shop's bill.
   */
  bookedByName?: string;
  deliveredByName?: string;
  /**
   * Cash allocated to THIS bill by every payment that is not voided —
   * `Payment.orderIds`, summed. Not a guess and not the shop's balance: the
   * slip is a record of one bill, and a shop-wide figure printed on it would
   * be read as this bill's.
   */
  paid: number;
}

export interface BillSheetArgs {
  settings: CompanySettings;
  logo?: string;
  bills: BillSlip[];
  perPage: BillsPerPage;
  /**
   * Put the load sheet on the front — what to pull off the shelf for this
   * whole run, added up across every shop in it.
   *
   * One download, two jobs: page 1 loads the van, the rest is what the rider
   * hands over. They belong in the same PDF because they belong in the same
   * five minutes, and a picking list printed separately is a picking list that
   * gets left on the desk.
   */
  loadSheet?: boolean;
}

/**
 * Page one: the shelf list.
 *
 * Full A4, big type, and a tick box per line — this is read at arm's length by
 * somebody holding a carton, not at a desk. The tick box is the whole reason
 * it is on paper rather than on the phone: a picker marks the line he has
 * pulled, and the boxes he has not ticked are what is still missing when the
 * van is supposed to leave.
 */
function loadSheetPage(bills: BillSlip[], settings: CompanySettings, logo?: string): string {
  const lines = pickList(bills.map(b => ({ shopId: b.shop.id, shopName: displayName(b.shop.name), items: b.order.items })));
  const pieces = lines.reduce((sum, l) => sum + l.qty, 0);
  const shops = new Set(bills.map(b => b.shop.id)).size;

  const rows = lines.map(l => `<tr>
  <td class="l-box"></td>
  <td class="l-name">${esc(l.name)}
    <div class="l-split">${l.perShop.map(p => `${esc(p.name)} <b>${p.qty}</b>`).join(' · ')}</div>
  </td>
  <td class="l-shops">${l.shops} shop${l.shops === 1 ? '' : 's'}</td>
  <td class="l-qty">${l.qty}</td>
</tr>`).join('\n');

  return `<div class="page load">
  <div class="l-head">
    ${logo ? `<img class="l-logo" src="${esc(logo)}" alt="" />` : ''}
    <div class="l-brand">${esc(settings.brandName)}</div>
    <div class="l-tag">LOAD SHEET</div>
  </div>
  <div class="l-sub">${pieces} piece${pieces === 1 ? '' : 's'} · ${lines.length} product${lines.length === 1 ? '' : 's'} · ${shops} shop${shops === 1 ? '' : 's'}</div>
  <table class="l-items">
    <thead><tr><th class="l-box"></th><th>Product</th><th class="l-shops">For</th><th class="l-qty">Qty</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <div class="l-foot">Tick each line as you pull it, then split it by the shop names underneath. The shop copies follow — cut on the dotted lines.</div>
</div>`;
}

/** One slip: the document compressed to what survives being cut out and filed. */
function slipBody(slip: BillSlip, settings: CompanySettings, layout: SheetLayout, logo?: string): string {
  const { order, shop, paid } = slip;
  const symbol = settings.currencySymbol;
  /**
   * A slip is a BILL only once the goods have gone out.
   *
   * Before that the same order is an ORDER COPY, and the difference is not
   * cosmetic: a bill is priced on what the rider actually handed over and an
   * undelivered order on what was asked for, so the two carry different
   * quantities and different totals. Printing the second under the word BILL
   * is the exact lie `orderConfirmationHtml` prints "This is not a bill" to
   * avoid — and it would be worse here, because this slip is cut out and given
   * to somebody.
   */
  const isBill = order.status === 'delivered';
  const lines = isBill
    ? order.items.filter(it => (it.deliveredQty ?? 0) > 0)
    : order.items;
  const totals = isBill
    ? order.billedTotals ?? computeTotals(order.items, order.discountPercent, true)
    : order.orderedTotals;
  const shown = lines.slice(0, layout.maxItems);
  const hidden = lines.length - shown.length;
  const balance = totals.grandTotal - paid;

  const itemLines = shown.map(it => {
    const qty = isBill ? it.deliveredQty ?? 0 : it.qty;
    return `<tr><td class="s-name">${esc(it.name)}</td><td class="s-num">${qty}</td>` +
      `<td class="s-num">${formatAmount(qty * it.unitPrice)}</td></tr>`;
  }).join('\n');

  // Never silent. The count is the whole point of the line.
  // The ruled blanks. `&nbsp;` rather than an empty cell so the row keeps its
  // height in every renderer, and no dotted rule under the last one.
  const blanks = Math.max(0, layout.minRows - shown.length - (hidden > 0 ? 1 : 0));
  const blankRows = Array.from({ length: blanks },
    () => '<tr><td class="s-name">&nbsp;</td><td class="s-num"></td><td class="s-num"></td></tr>').join('\n');

  const moreLine = hidden > 0
    ? `<tr><td class="s-more" colspan="3">+ ${hidden} more item${hidden === 1 ? '' : 's'} — TOTAL below covers all ${lines.length}</td></tr>`
    : '';

  // An undelivered order has no bill number yet, and inventing one would put a
  // serial on paper that no bill will ever carry.
  const billNo = isBill ? order.invoiceNo ?? order.orderNo : order.orderNo;

  /**
   * Who handled it. Two names on a trade bill answer the question a shopkeeper
   * actually asks when something is wrong — "who brought this?" — without him
   * having to phone the office to find out.
   */
  const whoRows = [
    slip.bookedByName ? `<span>Booked by <b>${esc(slip.bookedByName)}</b></span>` : '',
    slip.deliveredByName ? `<span>Delivered by <b>${esc(slip.deliveredByName)}</b></span>` : '',
  ].filter(Boolean);
  const who = whoRows.length ? `  <div class="s-who">${whoRows.join('')}</div>` : '';
  const prov = isProvisional(billNo)
    ? ' <span class="s-prov">PROV</span>'
    : '';

  return `<div class="s-head">
  ${logo ? `<img class="s-logo" src="${esc(logo)}" alt="" />` : ''}
  <div class="s-brand">${esc(settings.brandName)}</div>
  <div class="s-tag">BILL</div>
</div>
<div class="s-meta">
  <div><b>${esc(displayName(shop.name))}</b> · ${esc(shop.area)}</div>
  <div>${esc(billNo)}${prov} · ${esc(order.deliveredAt !== undefined ? formatDate(order.deliveredAt) : formatDate(order.bookedAt))}</div>
</div>
<table class="s-items">
${itemLines}
${moreLine}
${blankRows}
</table>
<table class="s-tot">
${totals.discountTotal > 0 ? `<tr><td>Discount</td><td class="s-num">-${formatAmount(totals.discountTotal)}</td></tr>` : ''}
${totals.taxTotal ? `<tr><td>Sales tax</td><td class="s-num">${formatAmount(totals.taxTotal)}</td></tr>` : ''}
<tr class="s-grand"><td>TOTAL</td><td class="s-num">${formatMoney(totals.grandTotal, symbol)}</td></tr>
<tr><td>Paid</td><td class="s-num">${formatAmount(paid)}</td></tr>
<tr class="s-bal"><td>Balance</td><td class="s-num">${formatAmount(balance)}</td></tr>
</table>
<div class="s-foot">
${who}
  <div class="s-sign">
    <div class="s-signline">Received in good order</div>
    <div class="s-signline">For ${esc(settings.brandName)}</div>
  </div>
${warrantyBlock(settings, 's-warranty')}
</div>`;
}

/**
 * §8.2b — many bills on one A4, dashed cut lines between them.
 *
 * The owner asked for this and the reason is paper: the rider's WhatsApp bill
 * reaches the shop, but the owner wants a copy in his own hand, and printing
 * one A5 sheet per bill turns a forty-bill day into forty pages. Four to a
 * page makes it ten.
 *
 * The rider's `billHtml` is untouched and stays the real invoice. This is a
 * COPY — it says so on every slip — and it is compressed accordingly: no
 * amount in words, no previous balance, no footer. What it keeps is the pair
 * a filed bill is checked against later, the TOTAL and what is still owed on
 * it, and those are exact rather than reconstructed.
 *
 * The grid is drawn even where there is no bill to put in it, so the last
 * page of an odd run cuts on the same lines as every other page.
 */
export function billSheetHtml(args: BillSheetArgs): string {
  const { settings, bills, perPage, logo } = args;
  const layout = SHEET_LAYOUTS[perPage];
  const cells = layout.cols * layout.rows;
  const pages: BillSlip[][] = [];
  for (let i = 0; i < bills.length; i += cells) pages.push(bills.slice(i, i + cells));
  // A run of zero bills still produces a valid, empty document rather than
  // markup with no pages in it.
  if (pages.length === 0) pages.push([]);

  const cover = args.loadSheet && bills.length > 0
    ? loadSheetPage(bills, settings, logo)
    : '';

  const pageHtml = pages.map(page => {
    const filled = page.map(b => `<div class="cell">${slipBody(b, settings, layout, logo)}</div>`);
    // Blank cells keep the grid square so the cut lines run the full width of
    // the paper — a half-filled last page is still cut in one pass.
    while (filled.length < cells) filled.push('<div class="cell"></div>');
    return `<div class="page">${filled.join('\n')}</div>`;
  }).join('\n');

  const page = layout.landscape
    ? { size: 'A4 landscape', w: '297mm', h: '210mm' }
    : { size: 'A4 portrait', w: '210mm', h: '297mm' };

  const body = `<style>
  @page { size: ${page.size}; margin: 0; }
  html, body { background: #FFFFFF; }
  .page {
    width: ${page.w}; height: ${page.h}; display: grid;
    grid-template-columns: repeat(${layout.cols}, 1fr);
    grid-template-rows: repeat(${layout.rows}, 1fr);
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .cell {
    padding: ${layout.pad}mm; overflow: hidden;
    font-family: 'Menlo', 'Consolas', 'Courier New', monospace;
    font-size: ${layout.font}px; line-height: 1.35; color: #14201B;
    /* The cut guides. Dashed, hairline, and grey rather than black: it is a
       line to aim scissors at, not part of the document. */
    border-right: 1px dashed #8A9A94; border-bottom: 1px dashed #8A9A94;
  }
  /* No guide along the paper's own edge — there is nothing to cut there. */
  .cell:nth-child(${layout.cols}n) { border-right: none; }
  .cell:nth-child(n+${cells - layout.cols + 1}) { border-bottom: none; }
  .s-head { display: flex; align-items: center; gap: 4px; }
  .s-logo { width: ${layout.font + 6}px; height: ${layout.font + 6}px; object-fit: contain; flex: 0 0 auto; }
  .s-brand { font-weight: 800; font-size: ${layout.font + 1}px; flex: 1 1 auto; }
  .s-tag { font-size: ${layout.font - 2}px; font-weight: 800; letter-spacing: 0.5px; color: #4A5A54; }
  .s-meta { margin: 3px 0; padding-bottom: 2px; border-bottom: 1px solid #14201B; }
  .s-prov { color: #B3261E; font-weight: 800; }
  .s-items { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
  .s-items td { padding: 1px 0; border-bottom: 1px dotted #C7D0CC; }
  .s-name { word-break: break-word; }
  .s-num { text-align: right; white-space: nowrap; padding-left: 4px; }
  .s-more { font-style: italic; color: #B3261E; border-bottom: none; }
  .s-tot { width: 100%; border-collapse: collapse; }
  .s-tot td { padding: 1px 0; }
  .s-grand td { border-top: 1.5px solid #14201B; font-weight: 800; font-size: ${layout.font + 1}px; }
  .s-bal td { font-weight: 800; border-top: 1px solid #14201B; }
  /* These slips get CUT APART and handed to shops, so the terms travel with
     each one — a warranty that only exists on the sheet the owner keeps is a
     warranty the buyer never received. Sized down hard: it must not push the
     items out of a cell it shares. */
  /* Page one is a single full-page block, not a grid — it overrides the grid
     the cut-out pages use rather than defining a second .page class. */
  .page.load {
    display: block; padding: 14mm 12mm;
    font-family: 'Menlo', 'Consolas', 'Courier New', monospace; color: #14201B;
  }
  .l-head { display: flex; align-items: center; gap: 8px; }
  .l-logo { width: 14mm; height: 14mm; object-fit: contain; flex: 0 0 auto; }
  .l-brand { font-size: 20px; font-weight: 800; flex: 1 1 auto; }
  .l-tag { font-size: 16px; font-weight: 800; letter-spacing: 2px; }
  .l-sub { margin: 4px 0 10px; color: #4A5A54; font-size: 12px; }
  .l-items { width: 100%; border-collapse: collapse; font-size: 15px; }
  .l-items th {
    text-align: left; border-bottom: 2px solid #14201B; padding: 4px 6px;
    font-size: 11px; letter-spacing: 1px; color: #4A5A54;
  }
  .l-items td { padding: 7px 6px; border-bottom: 1px dashed #C7D0CC; }
  /* An actual empty square, drawn big enough to put a pen through. */
  .l-box { width: 9mm; }
  .l-items tbody .l-box { border-bottom: 1px dashed #C7D0CC; }
  .l-items tbody .l-box::before {
    content: ''; display: block; width: 6mm; height: 6mm; border: 1.5px solid #14201B;
  }
  .l-name { font-weight: 700; }
  .l-shops { text-align: right; color: #4A5A54; font-size: 12px; white-space: nowrap; }
  .l-qty { text-align: right; font-weight: 800; font-size: 19px; width: 20mm; white-space: nowrap; }
  /* Who gets what, under the total. This is the line that turns one heap of
     54 into nine piles — the counting the owner asked not to do by hand. */
  .l-split { font-size: 11px; font-weight: 400; color: #2F3E38; margin-top: 2px; line-height: 1.4; }
  .l-foot { margin-top: 10mm; font-size: 11px; color: #4A5A54; }
  /* The cell is a column, and the footer is pushed to the BOTTOM of it.
     Without this the whole slip sat in the top quarter of a 210mm column with
     a field of white below it — which reads as a document that failed to
     print rather than one that is simply short. The items table keeps its
     natural height at the top; the signature and small print anchor the foot,
     and the space between them is deliberate white space rather than a gap. */
  .cell { display: flex; flex-direction: column; }
  .s-foot { margin-top: auto; }
  .s-who {
    display: flex; justify-content: space-between; gap: 6px;
    padding-bottom: 3px; font-size: ${Math.max(layout.font - 1, 6)}px; color: #2F3E38;
  }
  .s-sign { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  /* A line to sign ON. Drawn with a border rather than underscores so it is
     the same length whatever the font does. */
  .s-signline {
    flex: 1 1 0; border-top: 1px solid #14201B; padding-top: 2px;
    margin-top: 22px; font-size: ${Math.max(layout.font - 2, 5.5)}px; color: #4A5A54;
    text-align: center;
  }
  .s-warranty {
    margin-top: 3px; padding-top: 2px; border-top: 1px solid #8A9A94;
    font-size: ${Math.max(layout.font - 2.5, 5)}px; line-height: 1.25;
    color: #2F3E38; text-align: justify;
  }
</style>
${cover}
${pageHtml}`;

  // Not the A5 `sheet()` wrapper: that one hard-codes a 148mm page and a grey
  // desk background, both wrong for something going straight to paper.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(`Bill copies — ${bills.length}`)}</title>
<style>* { box-sizing: border-box; } html, body { margin: 0; padding: 0; }</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ------------------------------------------------------------ 3. Receipt

export interface ReceiptArgs {
  settings: CompanySettings;
  /**
   * The company logo as a data: URI (`lib/logoCache.ts`). Optional forever —
   * a document without one prints the brand name alone.
   */
  logo?: string;
  payment: Payment;
  shopName: string;
  /** How the payment was split across bills, oldest first (FIFO) — label is the bill/order number. */
  allocations: { label: string; amount: number }[];
  /** Shop's outstanding balance AFTER this payment was applied. */
  newOutstanding: number;
}

const MODE_LABEL: Record<Payment['mode'], string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  cheque: 'Cheque',
};

/** §8.4 — payment receipt with the oldest-bill-first split printed. */
export function receiptHtml(args: ReceiptArgs): string {
  const { settings, payment, shopName, allocations, newOutstanding, logo } = args;
  const symbol = settings.currencySymbol;
  const splitRows = allocations
    .map((a) => totalRow(a.label, a.amount, symbol))
    .join('\n');

  const body = `${headerBlock(settings, logo)}
<hr class="rule" />
<div class="doc-title">PAYMENT RECEIPT</div>
<table class="meta">
${serialRow('Receipt no', payment.receiptNo)}
${metaRow('Date', formatDate(payment.createdAt))}
${metaRow('Shop', displayName(shopName))}
${metaRow('Paid by', MODE_LABEL[payment.mode])}
${metaRow('Collected by', payment.collectedBy)}
</table>
${provisionalNote(payment.receiptNo)}
<hr class="rule-soft" />
<div class="big">Amount received: ${formatMoney(payment.amount, symbol)}</div>
<hr class="rule-soft" />
<div>Applied to bills (oldest first):</div>
<table class="totals">
${splitRows}
${totalRow('New outstanding', newOutstanding, symbol, true)}
</table>
${settings.receiptFooter ? `<div class="footer">${esc(settings.receiptFooter)}</div>` : ''}`;

  return sheet(`Receipt ${payment.receiptNo}`, body);
}
