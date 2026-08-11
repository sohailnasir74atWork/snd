/**
 * Which bill copies have already been printed and handed over — the MMKV half.
 *
 * The owner's working question on this screen is not "which bills exist" — it
 * is "which ones do I still have to give somebody". A printed bill has left
 * his desk, so it leaves the list; it is kept, findable and re-printable, just
 * not in the way of the ones he has not done yet.
 *
 * DEVICE-LOCAL, and that is a real trade rather than an oversight. In its
 * favour: no rule change, no new field on `orders`, no store method to write
 * twice (§3 — every behaviour that differs between `devStore` and
 * `firestoreStore` is a bug, and the cheapest way not to have that bug is not
 * to add the method). Against it: sign in on a second phone, or reinstall, and
 * every bill looks un-printed again.
 *
 * That is survivable in a way the opposite is not. The worst case here is
 * printing a copy twice — paper. If this lived in Firestore and a write were
 * lost or a rule refused it, the owner would believe a bill was handed over
 * when it never was. Cheap mistake beats expensive one.
 *
 * The rules about the keep window live in `lib/billLog.ts`, which has no
 * native import and is therefore testable; this file is only the disk.
 */
import { kv } from '../../lib/kv';
import { parseLog, prune, type DownloadLog } from '../../lib/billLog';

export { KEEP_DAYS } from '../../lib/billLog';
export type { DownloadLog } from '../../lib/billLog';

const KEY = 'snd.billsDownloaded';

function read(): DownloadLog {
  try {
    const raw = kv.getString(KEY);
    return raw ? parseLog(JSON.parse(raw)) : {};
  } catch {
    return {}; // a corrupt note means "nothing printed", never a crash
  }
}

function write(log: DownloadLog): void {
  try {
    kv.set(KEY, JSON.stringify(log));
  } catch {} // a phone that cannot write this still prints bills fine
}

/** Every mark still inside the keep window, pruned on the way out. */
export function loadDownloads(now: number): DownloadLog {
  return prune(read(), now);
}

/**
 * Stamp a batch as printed.
 *
 * Called AFTER the share sheet closes, never before: a sheet the owner backs
 * out of has not handed anything to anybody, and marking on intent would hide
 * a bill he never printed. Re-printing restamps, so the keep window runs from
 * the last time it actually left the phone.
 */
export function markDownloaded(ids: readonly string[], now: number): DownloadLog {
  const log = prune(read(), now);
  for (const id of ids) log[id] = now;
  write(log);
  return log;
}

/** Undo — for the owner who printed the wrong batch and wants it back. */
export function unmarkDownloaded(ids: readonly string[], now: number): DownloadLog {
  const log = prune(read(), now);
  for (const id of ids) delete log[id];
  write(log);
  return log;
}
