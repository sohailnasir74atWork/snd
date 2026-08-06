/**
 * Photo storage — Bunny.net CDN, authorised server-side.
 *
 * The phone asks the `uploadUrl` Cloud Function for permission to upload one
 * file; the server picks the path (inside this company's folder) and hands
 * back the slot. Uploads therefore need signal — callers treat a failure as
 * "try again with signal", and nothing else in the field flow depends on it.
 */
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { base64ToBytes } from './base64';

export type PhotoKind = 'logo' | 'product' | 'shop' | 'proof' | 'reward' | 'expense';

interface UploadSlot {
  uploadUrl: string;
  accessKey: string;
  publicUrl: string;
}

/** Upload one base64 JPEG; resolves to its public CDN URL. Throws on failure. */
export async function uploadPhotoBase64(base64: string, kind: PhotoKind): Promise<string> {
  const ask = httpsCallable(getFunctions(undefined, 'asia-south1'), 'uploadUrl');
  const { data } = (await ask({ kind })) as { data: UploadSlot };

  const res = await fetch(data.uploadUrl, {
    method: 'PUT',
    headers: {
      AccessKey: data.accessKey,
      'Content-Type': 'application/octet-stream',
    },
    body: base64ToBytes(base64),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Photo upload failed ${res.status}: ${txt.slice(0, 200)}`);
  }
  return data.publicUrl;
}
