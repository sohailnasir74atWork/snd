/**
 * Photo storage — Bunny.net CDN, authorised server-side.
 *
 * The storage key is NOT in this app. The phone asks the `uploadUrl` Cloud
 * Function for permission to upload one file; the server picks the path
 * (inside this company's folder) and hands back a one-shot URL. A stolen or
 * decompiled APK therefore yields nothing: no key, no ability to list,
 * overwrite or delete anything — including the publisher's other apps' assets,
 * which share the same storage zone.
 *
 * Photos are compressed to ~200 KB before upload (§10.3); callers queue the
 * local file path and retry when signal returns (§12).
 */
import RNFS from 'react-native-fs';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

export type PhotoKind = 'logo' | 'product' | 'shop' | 'proof' | 'reward' | 'expense';

interface UploadSlot {
  uploadUrl: string;
  accessKey: string;
  publicUrl: string;
}

/**
 * Upload one local image file; resolves to its public CDN URL.
 * Throws on failure so the offline queue can retry.
 */
export async function uploadPhoto(localUri: string, kind: PhotoKind): Promise<string> {
  const ask = httpsCallable(getFunctions(undefined, 'asia-south1'), 'uploadUrl');
  const { data } = (await ask({ kind })) as { data: UploadSlot };

  const base64 = await RNFS.readFile(localUri.replace('file://', ''), 'base64');
  const atobFn = (globalThis as { atob?: (s: string) => string }).atob!;
  const binary = Uint8Array.from(atobFn(base64), (c: string) => c.charCodeAt(0));

  const res = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: {
      AccessKey: data.accessKey,
      'Content-Type': 'application/octet-stream',
    },
    body: binary,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Photo upload failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  return data.publicUrl;
}
