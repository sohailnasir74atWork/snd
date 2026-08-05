/**
 * Money utilities — SRS §4.3 / §13 "Data integrity".
 *
 * All money in the system is an integer in the smallest currency unit.
 * Floating point never touches an amount; these helpers are the only
 * formatting/parsing path (lint forbids `toFixed`/float math on money).
 */

/** Format an integer amount with thousands separators: 9139 -> "9,139". */
export function formatAmount(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new Error(`money must be an integer, got ${amount}`);
  }
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount).toString();
  // South-Asian grouping: last 3, then groups of 2 (12,34,567).
  if (digits.length <= 3) return sign + digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${rest},${last3}`;
}

/** "Rs 9,139" — symbol comes from company Settings (FR-12.1). */
export function formatMoney(amount: number, symbol: string): string {
  return `${symbol} ${formatAmount(amount)}`;
}

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(' ');
}

/**
 * Amount in words, South-Asian numbering (thousand, lakh, crore) —
 * printed under the TOTAL on every bill (§8.2).
 * amountInWords(9139) -> "nine thousand one hundred thirty-nine"
 */
export function amountInWords(amount: number): string {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`amountInWords needs a non-negative integer, got ${amount}`);
  }
  if (amount === 0) return 'zero';
  const crore = Math.floor(amount / 10_000_000);
  const lakh = Math.floor((amount % 10_000_000) / 100_000);
  const thousand = Math.floor((amount % 100_000) / 1000);
  const rest = amount % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${amountInWords(crore)} crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

/** The bill line: "Rupees nine thousand one hundred thirty-nine only". */
export function amountInWordsLine(amount: number, currencyWord = 'Rupees'): string {
  return `${currencyWord} ${amountInWords(amount)} only`;
}
