/**
 * The bottom-sheet door to Google, via the native Credential Manager module.
 *
 * This adds no capability. It returns the same Google ID token the legacy
 * Sign-In SDK returns, and Firebase cannot tell which one produced it — the
 * only difference is that Credential Manager's account picker slides up from
 * the bottom instead of appearing as a centred dialog Play Services owns and
 * an app cannot style.
 *
 * Everything here is best-effort. Credential Manager needs recent Play
 * Services, a Google account on the device, and a working network; when any of
 * those is missing this returns `null` and `signInWithGoogle` carries on with
 * the legacy flow. A field phone that cannot raise the pretty sheet must still
 * be able to sign its owner in.
 */
import { NativeModules, Platform } from 'react-native';

type CredentialResult = { idToken: string; email: string; displayName: string };

type CredentialSignInNative = {
  signIn(serverClientId: string, filterByAuthorized: boolean): Promise<CredentialResult>;
};

const native: CredentialSignInNative | undefined =
  Platform.OS === 'android'
    ? (NativeModules as { CredentialSignIn?: CredentialSignInNative }).CredentialSignIn
    : undefined;

/** Mirrored from CredentialSignInModule.kt — change both or neither. */
const NO_CREDENTIAL = 'no_credential';
const CANCELLED = 'cancelled';

export type CredentialOutcome =
  | { type: 'success'; idToken: string; email: string; displayName: string }
  /** The person dismissed the sheet. NOT a failure — do not fall back. */
  | { type: 'cancelled' }
  /** Credential Manager cannot serve this phone. Use the legacy flow. */
  | { type: 'unavailable' };

const codeOf = (e: unknown) => (e as { code?: string })?.code ?? '';

/**
 * Two passes, because one would show the wrong sheet.
 *
 * The first asks only for accounts already authorised for this app, which is
 * what makes a returning owner's sheet a single row he taps once. That pass
 * fails outright rather than showing an empty sheet the first time anybody
 * signs in — so the second asks for every Google account on the phone.
 *
 * A cancel is never retried. Re-opening a sheet somebody just dismissed reads
 * as the app arguing with them.
 */
export async function signInWithCredentialManager(
  serverClientId: string,
): Promise<CredentialOutcome> {
  if (!native) return { type: 'unavailable' };

  for (const filterByAuthorized of [true, false]) {
    try {
      const r = await native.signIn(serverClientId, filterByAuthorized);
      if (!r?.idToken) return { type: 'unavailable' };
      return {
        type: 'success',
        idToken: r.idToken,
        email: r.email ?? '',
        displayName: r.displayName ?? '',
      };
    } catch (e) {
      const code = codeOf(e);
      if (code === CANCELLED) return { type: 'cancelled' };
      // Only "nothing to show" is worth widening the net for. Anything else —
      // stale Play Services, no network, a bad client id — will fail the same
      // way on the second pass, so stop and let the caller fall back.
      if (code !== NO_CREDENTIAL) return { type: 'unavailable' };
    }
  }
  // Both passes came back empty: this phone has no Google account at all.
  return { type: 'unavailable' };
}
