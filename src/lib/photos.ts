/**
 * Receipt-proof photo capture (FR-16) — the system camera via intent, so no
 * CAMERA permission is declared or requested. Downscaled + compressed to keep
 * uploads near the §10.3 ~200 KB budget.
 */
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { LOGO, base64Bytes, logoProblem } from './logo';

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

/**
 * Picks the company logo from the GALLERY, not the camera.
 *
 * A logo is a file somebody was sent by a designer, not something you point a
 * phone at — `capturePhotoBase64` above is for proof-of-delivery photos and is
 * the wrong door for this. The size standard in `./logo` is enforced here,
 * once, so no screen has to decide what "too small" means.
 *
 * Null ONLY on cancel; everything else throws with a sentence worth showing.
 */
export async function pickLogoBase64(): Promise<string | null> {
  const res = await launchImageLibrary({
    mediaType: 'photo',
    includeBase64: true,
    // The downscale happens before the bytes ever reach us, so a 4000px logo
    // off a designer's Mac never has to be held in memory at full size.
    quality: 0.8,
    maxWidth: LOGO.maxEdge,
    maxHeight: LOGO.maxEdge,
    selectionLimit: 1,
  });
  if (res.didCancel) return null;
  if (res.errorCode) throw new Error(res.errorMessage || res.errorCode);

  const asset = res.assets?.[0];
  const base64 = asset?.base64;
  if (!asset || !base64) {
    throw new Error('That image could not be read. Try another file.');
  }
  // Measured AFTER the downscale, which is the point: a big original is now
  // 512px and passes, a small one was never resized and fails honestly.
  const problem = logoProblem(asset.width ?? 0, asset.height ?? 0, base64Bytes(base64));
  if (problem) throw new Error(problem);
  return base64;
}
