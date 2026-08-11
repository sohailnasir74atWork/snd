/**
 * Day-key arithmetic — pure, and with **no native import**, for the same
 * reason `lib/geo.ts` has none: a screen file pulls in maps and MMKV and stops
 * being loadable under Jest, and this is the part worth testing.
 *
 * Day keys are `YYYY-MM-DD` strings throughout the app (`todayKey`). They are
 * compared as strings on purpose — no timezone rides along in a string, so a
 * rider working past midnight and a server in another region agree on what
 * day a delivery is due.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The day after a `YYYY-MM-DD` key, as another key. Month and year ends included. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * "Tomorrow · 12 Aug" — the word AND the date, never one alone.
 *
 * "Tomorrow" on its own is what a rider reads at 11pm and gets wrong. A bare
 * date is something he has to work out. Anything further off is just the date,
 * because "in 3 days" is a sum nobody should do standing next to a van.
 */
export function dueLabel(date: string, today: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d || !MONTHS[m - 1]) return date;
  const pretty = `${d} ${MONTHS[m - 1]}`;
  return date === nextDay(today) ? `Tomorrow · ${pretty}` : pretty;
}
