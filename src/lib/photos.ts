/**
 * Receipt-proof photo capture (FR-16) — the system camera via intent, so no
 * CAMERA permission is declared or requested. Downscaled + compressed to keep
 * uploads near the §10.3 ~200 KB budget.
 */
import { launchCamera } from 'react-native-image-picker';

/** Opens the camera; resolves to base64 JPEG, or null if the user backed out. */
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
  return res.assets?.[0]?.base64 ?? null;
}
