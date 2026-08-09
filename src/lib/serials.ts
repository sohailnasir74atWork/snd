/**
 * Serial numbers, offline-first (SRS §8.1 + FR-5.8).
 *
 * The old implementation awaited a Firestore transaction, which needs a live
 * connection — so booking and billing failed in a market with no signal, the
 * exact situation the app exists for. The spec's own answer is used instead:
 *
 *   offline → a provisional local reference is issued immediately and the
 *             document is written into the offline queue;
 *   online  → the counters transaction runs and the final serial replaces it.
 *
 * A provisional document is flagged so every screen and every printed page can
 * say "Provisional" honestly, and the shop is never shown two different
 * "final" numbers.
 */
import { kv } from './kv';

export type SerialKind = 'order' | 'invoice' | 'receipt' | 'reward';

const PREFIX: Record<SerialKind, string> = {
  order: 'ORD', invoice: 'INV', receipt: 'RCP', reward: 'RWD',
};

const LOCAL_KEY = 'snd.localSerialCounter';

/**
 * Monotonic per-device counter so two offline documents never collide.
 *
 * Synchronous on purpose: read and write now happen in one tick, so two
 * documents created back to back with no signal cannot both read the counter
 * before either has incremented it.
 */
export function nextLocalRef(kind: SerialKind): string {
  const n = (kv.getNumber(LOCAL_KEY) ?? 0) + 1;
  kv.set(LOCAL_KEY, n);
  // Device-scoped, obviously-temporary shape: LOCAL-ORD-7
  return `LOCAL-${PREFIX[kind]}-${n}`;
}

export function formatSerial(kind: SerialKind, n: number, year = new Date().getFullYear()): string {
  return `${PREFIX[kind]}-${year}-${String(n).padStart(4, '0')}`;
}

export function isProvisional(serial: string | undefined): boolean {
  return !!serial && serial.startsWith('LOCAL-');
}
