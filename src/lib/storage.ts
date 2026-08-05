/**
 * Photo storage — Bunny.net CDN (owner decision; replaces Firebase Storage).
 *
 * Upload pattern mirrors the publisher's existing app: HTTP PUT of raw bytes
 * with the AccessKey header, then serve from the pull-zone URL. Works offline
 * -first: callers queue the local file path and retry when signal returns
 * (SRS §12); photos are compressed to ~200 KB before upload (§10.3).
 *
 * Path convention (multi-company isolation by folder):
 *   snd/{companyId}/{kind}/{yyyymm}/{timestamp}-{rand}.jpg
 * kind: logo | product | shop | proof | reward | expense
 */
import RNFS from 'react-native-fs';
import { BUNNY } from '../config/bunny';

export type PhotoKind = 'logo' | 'product' | 'shop' | 'proof' | 'reward' | 'expense';

export function remotePathFor(companyId: string, kind: PhotoKind, now = new Date()): string {
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
  return `${BUNNY.pathPrefix}/${encodeURIComponent(companyId)}/${kind}/${yyyymm}/${filename}`;
}

/** Public CDN URL a stored path is served from (goes into Firestore docs). */
export function cdnUrl(remotePath: string): string {
  return `${BUNNY.cdnBase}/${remotePath}`;
}

/**
 * Upload one local image file; resolves to its public CDN URL.
 * Throws on non-2xx so the offline queue can retry.
 */
export async function uploadPhoto(
  localUri: string,
  companyId: string,
  kind: PhotoKind,
): Promise<string> {
  const remotePath = remotePathFor(companyId, kind);
  const uploadUrl = `https://${BUNNY.storageHost}/${BUNNY.storageZone}/${remotePath}`;

  const base64 = await RNFS.readFile(localUri.replace('file://', ''), 'base64');
  // Hermes provides atob at runtime (proven in the publisher's existing app);
  // RN's TS config just doesn't declare it.
  const atobFn = (globalThis as { atob?: (s: string) => string }).atob!;
  const binary = Uint8Array.from(atobFn(base64), (c: string) => c.charCodeAt(0));

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      AccessKey: BUNNY.accessKey,
      'Content-Type': 'application/octet-stream',
    },
    body: binary,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Bunny upload failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  return cdnUrl(remotePath);
}
