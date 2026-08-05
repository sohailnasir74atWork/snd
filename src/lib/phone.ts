/**
 * Phone / WhatsApp number normalisation — FR-5.3, plan §6 unit-test spec:
 * "0300-1234567 with countryCode +92 becomes 923001234567, idempotent on re-save".
 *
 * Numbers are normalised once, at save time, so every later send just works.
 */

/** Keep digits only: "0300-123 4567" -> "03001234567". */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Normalise to international digits (no "+"), for wa.me links and dialing.
 * - strips punctuation and a leading "00"
 * - replaces a single leading "0" with the country code
 * - already-international numbers pass through unchanged (idempotent)
 */
export function normalizeWhatsApp(raw: string, countryCode: string): string {
  const cc = digitsOnly(countryCode);
  let d = digitsOnly(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(cc)) return d; // idempotent
  if (d.startsWith('0')) return cc + d.slice(1);
  return cc + d;
}

/** Display form for screens and bills: "0300-1234567" style local format. */
export function formatLocal(normalized: string, countryCode: string): string {
  const cc = digitsOnly(countryCode);
  const local = normalized.startsWith(cc) ? '0' + normalized.slice(cc.length) : normalized;
  if (local.length === 11) return `${local.slice(0, 4)}-${local.slice(4)}`;
  return local;
}
