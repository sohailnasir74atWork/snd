/**
 * The rules about which printed bills are still remembered — pure, and with
 * **no native import**, for the same reason `lib/geo.ts` has none: the moment a
 * file reaches MMKV it stops being loadable under Jest, and this is the part
 * worth testing. The storage half lives in `features/admin/billDownloads.ts`.
 */

/**
 * How long a mark is kept.
 *
 * The owner asked for "at least a week"; this is a month, because the cost of
 * keeping one is a few bytes and the cost of dropping one too early is a bill
 * that reappears in the to-print list and is handed over twice. Pruning exists
 * at all so the record cannot grow without limit on a phone that is never
 * reinstalled.
 */
export const KEEP_DAYS = 30;

/** `{ [orderId]: epoch millis it was downloaded }` — last download wins. */
export type DownloadLog = Record<string, number>;

/**
 * Whatever was on disk, reduced to entries this code can trust.
 *
 * Anything that is not `id -> finite number` is dropped rather than believed:
 * a half-written or hand-edited blob must never put a `NaN` into a date
 * comparison, where it would silently answer `false` to every question and
 * make a bill immortal.
 */
export function parseLog(raw: unknown): DownloadLog {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: DownloadLog = {};
  for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
  }
  return out;
}

/**
 * The log with anything past `KEEP_DAYS` removed.
 *
 * `now` is a parameter so this is testable without faking the clock, and so
 * one render cannot disagree with itself by calling `Date.now()` twice.
 */
export function prune(log: DownloadLog, now: number): DownloadLog {
  const cutoff = now - KEEP_DAYS * 86400_000;
  const out: DownloadLog = {};
  for (const [id, at] of Object.entries(log)) if (at >= cutoff) out[id] = at;
  return out;
}
