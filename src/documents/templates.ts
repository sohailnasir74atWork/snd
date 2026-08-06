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
import type { CompanySettings, Order, Payment, Shop } from '../data/models';
import { formatAmount, formatMoney } from '../lib/money';
import { computeTotals } from '../lib/order';

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
  .doc-title { margin: 10px 0 2px; font-size: 15px; font-weight: 800; letter-spacing: 1px; }
  .doc-note { font-weight: 700; color: #B3261E; margin-bottom: 8px; }
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
</style>
</head>
<body>
<div class="sheet">
${body}
</div>
</body>
</html>`;
}

/** Company header: brand name, address, phone, tax number (from Settings). */
function headerBlock(settings: CompanySettings): string {
  const lines: string[] = [`<div class="brand">${esc(settings.brandName)}</div>`];
  if (settings.address) lines.push(`<div class="brand-sub">${esc(settings.address)}</div>`);
  if (settings.phone) lines.push(`<div class="brand-sub">Phone: ${esc(settings.phone)}</div>`);
  if (settings.taxNumber) lines.push(`<div class="brand-sub">Tax number: ${esc(settings.taxNumber)}</div>`);
  return lines.join('\n');
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

function metaRow(label: string, value: string): string {
  return `<tr><td class="label">${esc(label)}</td><td>${esc(value)}</td></tr>`;
}

// ------------------------------------------------- 1. Order confirmation

export interface OrderConfirmationArgs {
  settings: CompanySettings;
  order: Order;
  shop: Shop;
}

/**
 * §8.1 — the slip the booker leaves with the shop. Ordered quantities and
 * ordered totals; loudly NOT a bill.
 */
export function orderConfirmationHtml(args: OrderConfirmationArgs): string {
  const { settings, order, shop } = args;
  const symbol = settings.currencySymbol;
  const rows: ItemRow[] = order.items.map((it) => ({
    name: it.name,
    qty: it.qty,
    rate: it.unitPrice,
    amount: it.qty * it.unitPrice,
  }));
  const totals = order.orderedTotals;
  const deliveryLabel = order.deliveryDay === 'today' ? 'Today' : 'Tomorrow';

  const body = `${headerBlock(settings)}
<hr class="rule" />
<div class="doc-title">ORDER CONFIRMATION</div>
<div class="doc-note">This is not a bill</div>
<table class="meta">
${metaRow('Order no', order.orderNo)}
${metaRow('Date', formatDate(order.bookedAt))}
${metaRow('Shop', shop.name)}
${metaRow('Area', shop.area)}
</table>
${itemsTable(rows, symbol)}
<table class="totals">
${totalRow('Subtotal', totals.subTotal, symbol)}
${totalRow(`Discount (${order.discountPercent}%)`, totals.discountTotal, symbol)}
${totalRow('TOTAL', totals.grandTotal, symbol, true)}
</table>
<hr class="rule-soft" />
<div class="big">Delivery: ${deliveryLabel}</div>
<div class="footer"><span class="strong">Your bill comes with the delivery.</span></div>`;

  return sheet(`Order confirmation ${order.orderNo}`, body);
}

// --------------------------------------------------------------- 2. Bill

export interface BillArgs {
  settings: CompanySettings;
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
  const { settings, order, shop, received, previousBalance, paidToPrevious = 0 } = args;
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

  const body = `${headerBlock(settings)}
<hr class="rule" />
<div class="doc-title">BILL</div>
<table class="meta">
${metaRow('Bill no', order.invoiceNo ?? '—')}
${metaRow('Order no', order.orderNo)}
${metaRow('Booked', formatDate(order.bookedAt))}
${metaRow('Delivered', order.deliveredAt !== undefined ? formatDate(order.deliveredAt) : '—')}
${metaRow('Shop', shop.name)}
${metaRow('Area', shop.area)}
</table>
${itemsTable(rows, symbol)}
<table class="totals">
${totalRow('Subtotal', totals.subTotal, symbol)}
${totalRow(`Discount (${order.discountPercent}%)`, totals.discountTotal, symbol)}
${totalRow('TOTAL', totals.grandTotal, symbol, true)}
</table>
<div class="words">${esc(args.amountInWordsLine)}</div>
<table class="totals">
${totalRow('Received', received, symbol)}
${totalRow('Balance this bill', balanceThisBill, symbol)}
${totalRow('Previous balance', previousBalance, symbol)}
${totalRow('TOTAL OUTSTANDING', totalOutstanding, symbol, true)}
</table>
${settings.receiptFooter ? `<div class="footer">${esc(settings.receiptFooter)}</div>` : ''}`;

  return sheet(`Bill ${order.invoiceNo ?? order.orderNo}`, body);
}

// ------------------------------------------------------------ 3. Receipt

export interface ReceiptArgs {
  settings: CompanySettings;
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
  const { settings, payment, shopName, allocations, newOutstanding } = args;
  const symbol = settings.currencySymbol;
  const splitRows = allocations
    .map((a) => totalRow(a.label, a.amount, symbol))
    .join('\n');

  const body = `${headerBlock(settings)}
<hr class="rule" />
<div class="doc-title">PAYMENT RECEIPT</div>
<table class="meta">
${metaRow('Receipt no', payment.receiptNo)}
${metaRow('Date', formatDate(payment.createdAt))}
${metaRow('Shop', shopName)}
${metaRow('Paid by', MODE_LABEL[payment.mode])}
${metaRow('Collected by', payment.collectedBy)}
</table>
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
