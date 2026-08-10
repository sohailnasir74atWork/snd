/**
 * Device-local key/value storage — MMKV.
 *
 * Replaces AsyncStorage, which was bridged and promise-based: every read
 * crossed to the native side and back. MMKV is memory-mapped and synchronous,
 * which buys two things that matter here:
 *
 *  - On cold start the stored session is readable in the same tick, so the app
 *    lands on the right screen instead of flashing Welcome first.
 *  - The offline serial counter no longer has an await between its read and
 *    its write. Two documents created in quick succession with no signal used
 *    to be able to read the same counter value before either had written it
 *    back, and both took the same provisional reference.
 *
 * This holds device state only — never money, never anything the server is the
 * record for. Firestore's own on-disk queue owns unsent writes.
 */
import { createMMKV } from 'react-native-mmkv';
import { localRef, type SerialKind } from './serials';

export const kv = createMMKV({ id: 'snd' });

const LOCAL_SERIAL_KEY = 'snd.localSerialCounter';

/**
 * Monotonic per-device counter so two offline documents never collide.
 *
 * Synchronous on purpose: read and write happen in one tick, so two documents
 * created back to back with no signal cannot both read the counter before
 * either has incremented it.
 *
 * It lives here rather than in `./serials` because it is the only part of
 * serial numbering that touches the device — keeping it out of that module is
 * what lets `src/documents` import `isProvisional` without pulling MMKV into a
 * pure HTML generator.
 */
export function nextLocalRef(kind: SerialKind): string {
  const n = (kv.getNumber(LOCAL_SERIAL_KEY) ?? 0) + 1;
  kv.set(LOCAL_SERIAL_KEY, n);
  return localRef(kind, n);
}
