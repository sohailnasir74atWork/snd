/**
 * Which stops of today's sweep are already behind you.
 *
 * Device-local and deliberately so: this is not a record of work — the order
 * and the visit timestamp on the shop are — it is only which cards to grey
 * out. Losing it costs a person one glance at the list, so it never goes near
 * Firestore, never syncs, and never competes with the real data.
 *
 * Keyed by area AND working day, so yesterday's finished round does not open
 * this morning already complete.
 */
import { kv } from '../../lib/kv';

const key = (areaName: string, dayKey: string) => `snd.sweep.${dayKey}.${areaName}`;

export function loadDone(areaName: string, dayKey: string): Set<string> {
  try {
    const raw = kv.getString(key(areaName, dayKey));
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? new Set(ids.filter((i): i is string => typeof i === 'string')) : new Set();
  } catch {
    return new Set(); // a corrupt note is a fresh round, not a crash
  }
}

export function saveDone(areaName: string, dayKey: string, done: Set<string>): void {
  try {
    kv.set(key(areaName, dayKey), JSON.stringify([...done]));
  } catch {} // a phone that cannot write this still sweeps fine
}

export function clearDone(areaName: string, dayKey: string): void {
  try {
    kv.remove(key(areaName, dayKey));
  } catch {}
}
