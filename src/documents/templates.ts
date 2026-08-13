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

/**
 * The company pad, in three colours.
 *
 * Sampled off the owner's own printed letterhead rather than picked: the
 * bills, the letters and the compliment slips a shop receives should look like
 * they came from one business. `#205088` is the navy of the masthead and the
 * headings, `#3880C0` the lighter blue of the logo mark and the accents, and
 * `#98B0C8` the muted rule that separates without shouting.
 *
 * Deliberately NOT read from `components/theme.ts`. That palette dresses an
 * app — it changes when the app's design changes, and a bill printed last year
 * must not stop matching the letterhead because a button went a different
 * blue. Paper is its own brand surface.
 */
const PAD = {
  navy: '#205088',
  blue: '#3880C0',
  rule: '#98B0C8',
  panel: '#F5F8FC',
  ink: '#1B2733',
  quiet: '#5A6B7C',
};

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

/**
 * Shared A5 sheet + print CSS, cut to the company's own letterhead.
 *
 * The pad it copies: a navy masthead rule under the business name, the
 * document type in a navy pill, details in a light panel with a thick blue
 * left edge, and a footer band carrying the address. A shop that receives a
 * letter from this business and a bill from it should not have to be told they
 * came from the same place.
 *
 * The body font is now a real typeface rather than monospace. Monospace was
 * chosen so the same markup read well on a 58mm thermal printer; nothing in
 * this app has ever printed to one, and it made every document look like a
 * receipt from a machine instead of paper from a company. Only the NUMBERS
 * stay monospace — a column of figures has to line up on the decimal.
 */
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
    width: 148mm; min-height: 210mm; margin: 0 auto;
    background: #FFFFFF; color: ${PAD.ink};
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 11px; line-height: 1.45;
    display: flex; flex-direction: column;
  }
  @media print { html, body { background: #FFFFFF; } .sheet { margin: 0; } }
  .body { padding: 6mm 9mm 4mm; flex: 1 1 auto; }
  /* ---- masthead ---------------------------------------------------- */
  .mast { padding: 6mm 9mm 0; position: relative; }
  /* The navy wedge in the pad's top-left corner. A gradient rather than a
     border triangle: the PDF renderer draws gradients reliably and clips
     borders at the page edge. */
  .mast::before {
    content: ''; position: absolute; top: 0; left: 0; width: 26mm; height: 9mm;
    background: linear-gradient(135deg, ${PAD.navy} 0 50%, transparent 50% 100%);
  }
  /* Centred against the mark rather than top-aligned: a 26mm logo beside a
     two-line name looks dropped in when their tops line up. */
  .letterhead { display: flex; align-items: center; gap: 8px; min-height: 26mm; }
  .brand { font-size: 25px; font-weight: 800; letter-spacing: 0.3px; color: ${PAD.navy}; line-height: 1.1; }
  .brand-sub { color: ${PAD.quiet}; font-size: 10px; }
  .brand-ntn { color: ${PAD.navy}; font-size: 10px; font-weight: 700; margin-top: 1px; }
  /* Bounded on BOTH axes and never stretched: a wide logo and a tall one both
     have to sit in the same header without pushing the address off the sheet. */
  /* Bigger than the text beside it is tall. On the printed pad the mark is
     the thing you recognise across a counter before you read anything, and at
     18mm it read as a bullet point next to the name. Bounded on BOTH axes and
     never stretched, so a wide logo and a tall one both sit in the same
     header without pushing the rule down the sheet. */
  .logo { width: 26mm; height: 26mm; object-fit: contain; flex: 0 0 auto; margin-left: auto; }
  .rule { border: 0; border-top: 2px solid ${PAD.navy}; margin: 3mm 0 0; }
  .rule-soft { border: 0; border-top: 1px dashed ${PAD.rule}; margin: 8px 0; }
  /* ---- reference row + title pill ---------------------------------- */
  .refrow {
    display: flex; justify-content: space-between; gap: 8px;
    font-size: 10px; color: ${PAD.ink}; margin-bottom: 4mm;
  }
  .refrow b { color: ${PAD.navy}; }
  .doc-title {
    display: block; margin: 0 auto 4mm; padding: 2mm 6mm; width: fit-content;
    background: ${PAD.navy}; color: #FFFFFF; border-radius: 3px;
    font-size: 13px; font-weight: 800; letter-spacing: 1.5px; text-align: center;
  }
  .doc-note { font-weight: 700; color: #B3261E; margin: -2mm 0 3mm; text-align: center; }
  /* ---- the details panel ------------------------------------------- */
  .panel {
    background: ${PAD.panel}; border-left: 3px solid ${PAD.navy};
    border-radius: 2px; padding: 3mm 4mm; margin-bottom: 4mm;
  }
  .panel-title {
    color: ${PAD.navy}; font-size: 10px; font-weight: 800; letter-spacing: 1px;
    padding-bottom: 1.5mm; margin-bottom: 1.5mm; border-bottom: 1px solid ${PAD.rule};
  }
  .meta { width: 100%; border-collapse: collapse; }
  .meta td { padding: 1px 0; vertical-align: top; }
  .meta .label { color: ${PAD.quiet}; padding-right: 10px; white-space: nowrap; font-weight: 600; }
  .prov {
    font-size: 9px; font-weight: 800; letter-spacing: 0.5px; color: #B3261E;
    border: 1px solid #B3261E; border-radius: 3px; padding: 0 3px; white-space: nowrap;
  }
  .prov-note { margin-top: 4px; color: #B3261E; font-size: 10px; line-height: 1.4; }
  /* ---- items ------------------------------------------------------- */
  table.items { width: 100%; border-collapse: collapse; margin: 0 0 3mm; }
  table.items th {
    text-align: left; padding: 2mm 2mm; font-size: 9px; letter-spacing: 0.8px;
    background: ${PAD.navy}; color: #FFFFFF; font-weight: 700;
  }
  table.items td { padding: 1.6mm 2mm; border-bottom: 1px solid #E3EAF2; }
  /* Zebra, faint. On a twenty-line order the eye loses the row it is on. */
  table.items tbody tr:nth-child(even) td { background: #FAFCFE; }
  .num { text-align: right; white-space: nowrap; font-family: 'Menlo', 'Consolas', monospace; }
  /* A th selector carrying a class plus two elements outranks a bare .num, so
     the heading sat left while its column ran right. The correction has to
     match that specificity — a plain .num here silently loses and the columns
     drift apart again. (No backticks in this comment: the CSS lives inside a
     JS template literal and one would end the string.) */
  table.items th.num { text-align: right; font-family: inherit; }
  /* ---- totals ------------------------------------------------------ */
  table.totals { width: 60%; margin-left: auto; border-collapse: collapse; }
  table.totals td { padding: 1.2mm 2mm; }
  table.totals td:last-child { text-align: right; font-family: 'Menlo', 'Consolas', monospace; }
  table.totals .grand td {
    background: ${PAD.navy}; color: #FFFFFF;
    font-size: 13px; font-weight: 800; padding: 2mm;
  }
  .words { margin: 3mm 0 0; font-style: italic; color: ${PAD.quiet}; font-size: 10px; }
  .big { font-size: 15px; font-weight: 800; color: ${PAD.navy}; }
  /* ---- signatures + footer band ------------------------------------ */
  .signs { display: flex; justify-content: space-between; gap: 10mm; margin-top: 12mm; }
  .signline {
    flex: 1 1 0; border-top: 1px solid ${PAD.ink}; padding-top: 1.5mm;
    font-size: 9px; color: ${PAD.quiet};
  }
  .footer { margin-top: 4mm; text-align: center; color: ${PAD.quiet}; font-size: 10px; }
  .footer .strong { color: ${PAD.navy}; font-weight: 700; }
  /* Small print, and it should LOOK like small print: set apart above the
     line, smaller than the bill, and justified so a dense paragraph does not
     end in a ragged half-line. It is a legal statement, not a message. */
  .warranty {
    margin-top: 4mm; padding-top: 2mm; border-top: 1px solid ${PAD.rule};
    font-size: 8px; line-height: 1.35; color: ${PAD.quiet}; text-align: justify;
  }
  /* The pad's footer band, with the blue wedge at its right end. */
  .band {
    margin-top: auto; background: ${PAD.panel}; border-top: 2px solid ${PAD.navy};
    padding: 2.5mm 9mm; display: flex; justify-content: space-between; gap: 6px;
    font-size: 9px; color: ${PAD.navy}; position: relative; overflow: hidden;
  }
  .band::after {
    content: ''; position: absolute; right: 0; bottom: 0; width: 18mm; height: 100%;
    background: linear-gradient(225deg, ${PAD.blue} 0 50%, transparent 50% 100%);
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
  const sub: string[] = [];
  if (settings.address) sub.push(`<div class="brand-sub">${esc(settings.address)}</div>`);
  if (settings.phone) sub.push(`<div class="brand-sub">Phone: ${esc(settings.phone)}</div>`);
  return `<div class="mast">
  <div class="letterhead">
    <div>
      <div class="brand">${esc(settings.brandName)}</div>
      ${settings.taxNumber ? `<div class="brand-ntn">NTN No. ${esc(settings.taxNumber)}</div>` : ''}
    </div>
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="" />` : ''}
  </div>
  <hr class="rule" />
</div>`;
}

/** The address strip along the foot of the pad. */
function footerBand(settings: CompanySettings): string {
  // No email on CompanySettings, and this is not the place to invent one — the
  // pad carries what the business has already told the app about itself.
  const bits = [settings.address, settings.phone, settings.taxNumber && `NTN ${settings.taxNumber}`]
    .filter(Boolean)
    .map(x => `<span>${esc(String(x))}</span>`);
  if (bits.length === 0) return '';
  return `<div class="band">${bits.join('')}</div>`;
}

/** Ref number on the left, date on the right — the pad's own top row. */
function refRow(ref: string, dateMs: number): string {
  return `<div class="refrow">
  <span><b>Ref No:</b> ${esc(ref)}</span>
  <span><b>Date:</b> ${esc(formatDate(dateMs))}</span>
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
<div class="body">
${refRow(order.invoiceNo ?? order.orderNo, order.deliveredAt ?? order.bookedAt)}
<div class="doc-title">SALES INVOICE</div>
<div class="panel">
  <div class="panel-title">BILL TO</div>
  <table class="meta">
${metaRow('Shop', displayName(shop.name))}
${metaRow('Area', shop.area)}
${shop.phone ? metaRow('Phone', shop.phone) : ''}
${serialRow('Bill no', order.invoiceNo ?? '—')}
${serialRow('Order no', order.orderNo)}
${metaRow('Booked', formatDate(order.bookedAt))}
${metaRow('Delivered', order.deliveredAt !== undefined ? formatDate(order.deliveredAt) : '—')}
  </table>
</div>
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
<div class="signs">
  <div class="signline">Received in good order</div>
  <div class="signline">For ${esc(settings.brandName)}</div>
</div>
${warrantyBlock(settings, 'warranty')}
${settings.receiptFooter ? `<div class="footer"><span class="strong">${esc(settings.receiptFooter)}</span></div>` : ''}
</div>
${footerBand(settings)}`;

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
   * Lay the tail — totals beside the signature and small print — instead of
   * stacking it.
   *
   * Only 2-up sets it, and it is not a style choice. That cell is 210mm wide
   * and 148.5mm tall: it runs out of HEIGHT while a third of its width sits
   * empty. Stacked, the totals block alone cost five item rows, which is what
   * made the widest layout hold the shortest basket. Turned on its side it
   * costs none. The narrow cells keep the stack, where two columns would
   * squeeze the product name that is already the tightest thing on the slip.
   */
  wide?: boolean;
}

/**
 * Caps and type sizes, MEASURED off a rendered A4 rather than guessed.
 *
 * ⚠️ These numbers were wrong, and the wrongness was invisible. `maxItems`
 * read 20 / 14 / 14 on the theory that a half-page cell holds the longest
 * basket. It does not, because **only the 3-up layout is tall**:
 *
 * | layout | cell | rows it really holds |
 * |---|---|---|
 * | 2-up | 210 × 148.5mm | wide and short — the FEWEST of the three |
 * | 3-up | 99 × 210mm | the tall one, roughly double either other |
 * | 4-up | 105 × 148.5mm | 2-up's height at smaller type, so more rows |
 *
 * So 2-up promised twenty lines, held eleven, and lines twelve onward were
 * dropped by `overflow: hidden` with no "+N more" to say so — silent loss on a
 * document about money, which is the one failure this layout may not have.
 *
 * **Re-measure rather than adjusting by eye.** A sweep harness that renders
 * baskets of 1..26 lines and reports `scrollHeight - clientHeight` per cell is
 * half an hour's work and is how these were set; nudging a number because a
 * slip "looks a bit empty" is how the last set stopped being true. Keep
 * `maxItems` at or under the measured ceiling, and keep the margin: a product
 * name long enough to wrap costs two rows, and the "+N more" line is the
 * backstop, not the normal case.
 *
 * The measured ceilings at the sizes below are 11 / 19 / 10, and each cap sits
 * one under its ceiling to pay for a single wrapped name.
 */
const SHEET_LAYOUTS: Record<BillsPerPage, SheetLayout> = {
  // 210 × 148.5mm each — a landscape A5. One cut and the biggest type. It is
  // short, so `wide` lays the tail out sideways to buy the rows back.
  2: { cols: 1, rows: 2, maxItems: 9, font: 12, pad: 9, wide: true },
  // 99 × 210mm each on a LANDSCAPE sheet — the default. Three columns, cut
  // top to bottom.
  //
  // A bill is a receipt: header across the top, items down the page, total at
  // the foot. Wide horizontal strips put the header along the long edge and it
  // did not read as a receipt at all. Three portrait columns fixed that but on
  // a portrait sheet they came out 70mm wide and skinny, with two thirds of
  // the height empty. Turning the PAPER gives each slip 99mm — half again as
  // wide — and drops the wasted height. Same three per page, same two cuts.
  //
  // The tall cell is also why this one holds the longest basket AND carries
  // legible type at the same time. It is the default for both reasons.
  3: { cols: 3, rows: 1, maxItems: 18, font: 11, pad: 6, landscape: true },
  // 105 × 148.5mm each — A6. Densest, and the item name gets half the width.
  4: { cols: 2, rows: 2, maxItems: 9, font: 10, pad: 5 },
};

/**
 * How many item lines a slip shows at this layout before it starts
 * summarising.
 *
 * Exported so the screen can tell the owner BEFORE he prints, and — more to
 * the point — so it cannot tell him a different number from the one the sheet
 * enforces. The button used to carry its own hand-written figures; they
 * disagreed with `SHEET_LAYOUTS` and both were wrong.
 */
export function itemsPerSlip(perPage: BillsPerPage): number {
  return SHEET_LAYOUTS[perPage].maxItems;
}

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
  <div class="s-shop">${esc(displayName(shop.name))}</div>
  <div class="s-ref">
    <span>${esc(shop.area)}</span>
    <span>${esc(order.deliveredAt !== undefined ? formatDate(order.deliveredAt) : formatDate(order.bookedAt))}</span>
  </div>
  <div class="s-ref"><span>${esc(billNo)}${prov}</span></div>
</div>
<table class="s-items">
<tr><th>Product</th><th class="s-num">Qty</th><th class="s-num">Amount</th></tr>
${itemLines}
${moreLine}
</table>
<div class="s-fill"></div>
<div class="s-bottom">
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
</div>
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

  /**
   * The height of one item row, and the pitch the ruled filler repeats at.
   *
   * Derived, not typed in: line-height 1.35 on the cell's font, plus 2.5px of
   * padding top and bottom, plus the 1px rule. If any of those three change in
   * the CSS below, this follows them or the ruling steps at the join between
   * the last written line and the blanks under it.
   */
  const ROW_H = Math.round(layout.font * 1.35) + 6;

  const body = `<style>
  @page { size: ${page.size}; margin: 0; }
  html, body { background: #FFFFFF; }
  /* Print the backgrounds.
     A print renderer drops background colours and images by default — it is
     saving somebody's toner on a web page. Everything that carries meaning on
     this sheet is a background: the navy TOTAL bar, the banded Balance, the
     tinted table head, the panel behind the shop name, and the ruled lines the
     blank half of a short bill is filled with. Without this the slip prints as
     text floating on white with no structure at all, and the ruling — which is
     a background image, the first thing any renderer discards — goes first.
     Set on every element, because the property does not inherit reliably
     across the WebView versions this ships to. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page {
    width: ${page.w}; height: ${page.h}; display: grid;
    grid-template-columns: repeat(${layout.cols}, 1fr);
    grid-template-rows: repeat(${layout.rows}, 1fr);
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .cell {
    padding: ${layout.pad}mm; overflow: hidden;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: ${layout.font}px; line-height: 1.35; color: ${PAD.ink};
    /* The cut guides. Dashed, hairline, and grey rather than black: it is a
       line to aim scissors at, not part of the document. */
    border-right: 1px dashed #8A9A94; border-bottom: 1px dashed #8A9A94;
  }
  /* No guide along the paper's own edge — there is nothing to cut there. */
  .cell:nth-child(${layout.cols}n) { border-right: none; }
  .cell:nth-child(n+${cells - layout.cols + 1}) { border-bottom: none; }
  /* The pad, compressed. Same navy, the same order of things — masthead,
     rule, panel, items, totals, band — but the weight is now carried by TYPE
     and white space instead of by filled blocks. Three reasons, none of them
     taste:

     - Small white-on-navy text FILLS IN. The item header used to be a solid
       navy bar carrying 6.5px white capitals; at that size the counters close
       up on a tired laser drum and it prints as a dark smear with a word
       somewhere inside it. Tinted panel, navy ink, same emphasis, legible.
     - Ink is a running cost the owner pays. Three slips to a page, forty bills
       a day, and the old slip laid down two solid navy bars each.
     - ONE filled element per slip means the eye lands on it. When the header,
       the table head and the total are all filled, none of them is emphasis.
       TOTAL keeps the fill because TOTAL is the number being looked for. */
  .s-head { display: flex; align-items: center; gap: 5px; padding-bottom: 3px;
            border-bottom: 2px solid ${PAD.navy}; }
  .s-logo { width: ${layout.font + 14}px; height: ${layout.font + 14}px; object-fit: contain; flex: 0 0 auto; }
  .s-brand { font-weight: 800; font-size: ${layout.font + 4}px; flex: 1 1 auto;
             color: ${PAD.navy}; letter-spacing: -0.2px; line-height: 1.15; }
  .s-tag {
    font-size: ${Math.max(layout.font - 2, 6)}px; font-weight: 800; letter-spacing: 1.2px;
    background: ${PAD.navy}; color: #FFFFFF; border-radius: 3px; padding: 1.5px 6px;
    flex: 0 0 auto;
  }
  .s-meta {
    margin: 4px 0 5px; padding: 3px 5px; background: ${PAD.panel};
    border-left: 3px solid ${PAD.navy}; border-radius: 0 3px 3px 0;
  }
  /* The shop name is what a filed stack is thumbed through by, so it is the
     largest thing on the slip after the brand and it gets its own line. It
     used to share one with the area, in the body size, in the same weight as
     the bill number. */
  .s-shop { font-weight: 800; font-size: ${layout.font + 1.5}px; line-height: 1.25; }
  .s-ref { display: flex; justify-content: space-between; gap: 6px;
           font-size: ${Math.max(layout.font - 1, 6)}px; color: ${PAD.quiet}; }
  .s-prov { color: #B3261E; font-weight: 800; }
  .s-items { width: 100%; border-collapse: collapse; margin-bottom: 3px; }
  .s-items th {
    background: ${PAD.panel}; color: ${PAD.navy}; font-size: ${Math.max(layout.font - 2, 6)}px;
    text-align: left; padding: 2.5px 3px; letter-spacing: 0.7px; font-weight: 800;
    text-transform: uppercase; border-bottom: 1.5px solid ${PAD.navy};
  }
  /* Same specificity trap as the A5 table above: the th selector beats a bare
     .s-num, so the heading is corrected at its own weight. */
  .s-items th.s-num { text-align: right; font-family: inherit; }
  /* Ruled like an invoice book, in a hairline rather than a line: these rows
     run on past the last item as blanks, and a rule dark enough to read as
     content would make an eight-line bill look like a twenty-line one. */
  .s-items td { padding: 2.5px 3px; border-bottom: 1px solid #E6EDF4; }
  .s-items tbody tr:nth-child(even) td { background: #FAFCFE; }
  .s-name { word-break: break-word; }
  .s-num { text-align: right; white-space: nowrap; padding-left: 4px;
           font-family: 'Menlo', 'Consolas', monospace; font-variant-numeric: tabular-nums; }
  .s-more { font-style: italic; color: #B3261E; border-bottom: none; }
  /* The ruled blanks, and the reason they are a GRADIENT rather than empty
     table rows.

     A short order used to sit in the top quarter of the cell under a field of
     white, which reads as a document that failed to print; every paper invoice
     book solves that the same way, by ruling the lines whether or not anything
     is written on them. That much is unchanged. What changed is who counts
     them. A fixed minRows had to be guessed against a cell height it cannot
     see, and a guess that is one row high does not look slightly wrong — it
     pushes the small print off the bottom of a cell that clips, so the terms
     silently stop being on the paper. This fills whatever is actually left
     over, at any basket size, and cannot overflow because it only ever takes
     free space. The min-height of 0 is load-bearing: a flex item defaults to
     min-content and would otherwise refuse to shrink on a full basket.
     (No backticks anywhere in here — this CSS lives inside a JS template
     literal and one would end the string.)

     The pitch matches the item rows exactly, so the ruling carries on through
     the join rather than stepping at it. Change the row padding and this
     number changes with it — it is derived from the same two figures. */
  .s-fill {
    flex: 1 1 auto; min-height: 0;
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0, transparent ${ROW_H - 1}px,
      #E6EDF4 ${ROW_H - 1}px, #E6EDF4 ${ROW_H}px);
  }
  .s-tot { width: 100%; border-collapse: collapse; margin-top: 1px; }
  .s-tot td { padding: 2px 3px; color: ${PAD.quiet}; }
  .s-grand td {
    background: ${PAD.navy}; color: #FFFFFF; font-weight: 800;
    font-size: ${layout.font + 2}px; padding: 3.5px 3px; letter-spacing: 0.3px;
  }
  /* What is still owed, and it is the second thing looked for after the total
     — so it is banded rather than left as one more quiet row. Weight and rules
     rather than a colour: these are printed in black by most of the people who
     print them, and a red number that comes out grey is not a warning. */
  .s-bal td {
    font-weight: 800; font-size: ${layout.font + 0.5}px; color: ${PAD.ink};
    background: ${PAD.panel}; border-top: 1px solid ${PAD.navy};
    border-bottom: 1px solid ${PAD.navy}; padding: 3px;
  }
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
  /* The cell is a column: head and items keep their natural height at the top,
     the filler eats whatever is left, and the tail is therefore anchored to
     the foot without anything needing an auto top margin. */
  .cell { display: flex; flex-direction: column; }
  /* Wide cells only (2-up). Totals to the right of the signature and the small
     print instead of above them — see SheetLayout.wide. Reversing the row puts
     the totals on the right while leaving them FIRST in source order, so the
     stacked layouts and this one read from the same markup, and bottom-aligned
     because the two columns are different heights and it is their feet that
     want to line up on the cut. */
  ${layout.wide ? `.s-bottom {
    display: flex; flex-direction: row-reverse; align-items: flex-end; gap: 10mm;
  }
  .s-bottom .s-tot { flex: 0 0 46%; width: auto; }
  .s-bottom .s-foot { flex: 1 1 0; min-width: 0; }` : ''}
  .s-foot { margin-top: 6px; }
  .s-who {
    display: flex; justify-content: space-between; gap: 6px;
    padding: 2.5px 5px; margin-bottom: 4px; background: ${PAD.panel};
    border-left: 3px solid ${PAD.blue}; border-radius: 0 3px 3px 0;
    font-size: ${Math.max(layout.font - 1.5, 6)}px; color: ${PAD.ink};
  }
  .s-sign { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  /* A line to sign ON. Drawn with a border rather than underscores so it is
     the same length whatever the font does. */
  .s-signline {
    flex: 1 1 0; border-top: 1px solid ${PAD.rule}; padding-top: 2.5px;
    margin-top: 20px; font-size: ${Math.max(layout.font - 2.5, 5.5)}px; color: ${PAD.quiet};
    text-align: center;
  }
  .s-warranty {
    margin-top: 4px; padding-top: 3px; border-top: 1px solid ${PAD.rule};
    font-size: ${Math.max(layout.font - 3, 5.5)}px; line-height: 1.3;
    color: ${PAD.quiet}; text-align: justify;
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
