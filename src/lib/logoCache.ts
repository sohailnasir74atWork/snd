/**
 * The logo, on THIS phone, as bytes.
 *
 * `settings.logoUrl` is the company's copy on the CDN — one short string that
 * syncs to everyone. A bill, though, is printed by a rider standing in a
 * street, and `react-native-html-to-pdf` renders a remote `<img>` by fetching
 * it: with no signal that is a broken image on the one document the shopkeeper
 * keeps. So each device holds its own copy and the bill always embeds bytes it
 * already has.
 *
 * Fetched at most once per URL per device. The URL is part of the key, so
 * changing the logo invalidates the old copy without any explicit clearing.
 */
import { kv } from './kv';
import { bytesToBase64 } from './base64';
import { logoDataUri } from './logo';

const KEY = 'snd.logo';

/** Remember the bytes the owner just uploaded — no round trip needed. */
export function rememberLogo(url: string, base64: string): void {
  kv.set(KEY, JSON.stringify({ url, base64 }));
}

function cached(url: string): string | undefined {
  const raw = kv.getString(KEY);
  if (!raw) return undefined;
  try {
    const saved = JSON.parse(raw) as { url?: string; base64?: string };
    return saved.url === url ? saved.base64 : undefined;
  } catch {
    return undefined; // corrupt entry is simply a cache miss
  }
}

/**
 * The logo bytes for `url`, or undefined if this phone cannot get them.
 *
 * Undefined is a perfectly good answer: `headerBlock` prints the brand name
 * alone, exactly as it did before logos existed. A bill must never fail to
 * generate because a picture could not be fetched.
 */
export async function logoBase64(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  // Preview mode stores the picked bytes straight into settings, and a data:
  // URI is already the answer — fetching one is at best pointless and on some
  // RN versions throws.
  if (url.startsWith('data:')) return url.slice(url.indexOf(',') + 1);
  const hit = cached(url);
  if (hit) return hit;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const base64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
    rememberLogo(url, base64);
    return base64;
  } catch {
    return undefined; // offline, and the bill goes out without the picture
  }
}

/**
 * What every document generator wants: the logo as a data: URI, or undefined.
 * One line at each of the four share sites, and never a reason to throw.
 */
export async function documentLogo(url: string | undefined): Promise<string | undefined> {
  return logoDataUri(await logoBase64(url));
}
