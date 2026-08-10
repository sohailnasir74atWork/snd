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
 *
 * PURE ON PURPOSE — no MMKV, no React, no native import. `src/documents` is
 * held to "no native deps" so a bill can be rendered in a plain Node test, and
 * it needs `isProvisional` to mark an offline number on the printed page. The
 * one function that does touch the device counter, `nextLocalRef`, therefore
 * lives in `./kv` alongside the storage it depends on.
 */

export type SerialKind = 'order' | 'invoice' | 'receipt' | 'reward';

const PREFIX: Record<SerialKind, string> = {
  order: 'ORD', invoice: 'INV', receipt: 'RCP', reward: 'RWD',
};

/** Device-scoped, obviously-temporary shape: LOCAL-ORD-7. */
export function localRef(kind: SerialKind, n: number): string {
  return `LOCAL-${PREFIX[kind]}-${n}`;
}

export function formatSerial(kind: SerialKind, n: number, year = new Date().getFullYear()): string {
  return `${PREFIX[kind]}-${year}-${String(n).padStart(4, '0')}`;
}

export function isProvisional(serial: string | undefined): boolean {
  return !!serial && serial.startsWith('LOCAL-');
}
