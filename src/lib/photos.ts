/**
 * Receipt-proof photo capture (FR-16) — the system camera via intent, so no
 * CAMERA permission is declared or requested. Downscaled + compressed to keep
 * uploads near the §10.3 ~200 KB budget.
 */
import { launchCamera } from 'react-native-image-picker';

/**
 * Opens the camera.
 *
 * Resolves to a base64 JPEG, or null ONLY when the user backed out. Every
 * other outcome throws: a missing payload used to return null too, so an
 * encode that failed — a full phone, most often — was indistinguishable from
 * a cancel. The claim form just refused the photo with no message, and
 * retrying never worked because nothing said what was wrong.
 */
export async function capturePhotoBase64(): Promise<string | null> {
  const res = await launchCamera({
    mediaType: 'photo',
    includeBase64: true,
    quality: 0.5,
    maxWidth: 1024,
    maxHeight: 1024,
    saveToPhotos: false,
  });
  if (res.didCancel) return null;
  if (res.errorCode) throw new Error(res.errorMessage || res.errorCode);
  const base64 = res.assets?.[0]?.base64;
  if (!base64) {
    throw new Error('The photo could not be saved. The phone may be out of space — free some up and try again.');
  }
  return base64;
}
