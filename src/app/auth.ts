/**
 * Sign in with Google + employee-list admission — SRS FR-1.1–1.10, §10.1.
 *
 * Flow: Google account chooser → Firebase Auth → the `admitSignIn` Cloud
 * Function checks the email against employeeDirectory and writes
 * {companyId, role} into custom claims → the client force-refreshes its
 * token and lands on the role home. Refusals carry one of three specific
 * messages (FR-1.4) — never a generic error.
 */
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut as fbSignOut,
} from '@react-native-firebase/auth';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { strings } from '../i18n/strings';
import type { SessionUser } from './types';

// Web client id (OAuth type 3) from google-services.json — required by
// Google Identity Services to mint the idToken Firebase Auth consumes.
const WEB_CLIENT_ID =
  '210364311261-urf0khjrnfq34to3qp78b9bmr6lj391s.apps.googleusercontent.com';

export function configureGoogleSignIn(): void {
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
}

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: 'offline' | 'not_on_list' | 'access_ended' | 'cancelled'; message: string };

export async function signInWithGoogle(opts?: { createBusinessName?: string }): Promise<SignInResult> {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') {
      return { ok: false, reason: 'cancelled', message: '' };
    }
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('no idToken from Google');

    const credential = GoogleAuthProvider.credential(idToken);
    const { user } = await signInWithCredential(getAuth(), credential);

    // Server-side admission: employeeDirectory lookup + custom claims (§10.1).
    // The typed business name is what makes "Create your business" deliberate (FR-1.7).
    const admit = httpsCallable(getFunctions(undefined, 'asia-south1'), 'admitSignIn');
    const { data } = (await admit({ createBusinessName: opts?.createBusinessName })) as {
      data:
        | { status: 'admitted'; companyId: string; role: SessionUser['role']; name: string }
        | { status: 'not_on_list' }
        | { status: 'access_ended' };
    };

    if (data.status === 'not_on_list') {
      await signOutEverywhere();
      return {
        ok: false,
        reason: 'not_on_list',
        message: strings.signIn.notOnList(user.email ?? ''),
      };
    }
    if (data.status === 'access_ended') {
      await signOutEverywhere();
      return { ok: false, reason: 'access_ended', message: strings.signIn.accessEnded };
    }

    // Claims were just written server-side; refresh the token so rules see them.
    await user.getIdToken(true);
    return {
      ok: true,
      user: {
        uid: user.uid,
        email: user.email ?? '',
        name: data.name || user.displayName || '',
        companyId: data.companyId,
        role: data.role,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/network|offline|unavailable/i.test(msg)) {
      return { ok: false, reason: 'offline', message: strings.signIn.noInternetFirstTime };
    }
    throw e;
  }
}

export async function signOutEverywhere(): Promise<void> {
  await GoogleSignin.signOut().catch(() => {});
  await fbSignOut(getAuth()).catch(() => {});
}

/** Restore a still-signed-in session on app start (FR-1.5: stay signed in). */
export async function restoreSession(): Promise<SessionUser | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  try {
    const admit = httpsCallable(getFunctions(undefined, 'asia-south1'), 'admitSignIn');
    const { data } = (await admit({})) as { data: any };
    if (data.status !== 'admitted') {
      await signOutEverywhere(); // removed while away (FR-1.9)
      return null;
    }
    return {
      uid: user.uid,
      email: user.email ?? '',
      name: data.name || user.displayName || '',
      companyId: data.companyId,
      role: data.role,
    };
  } catch {
    return null; // offline start with cached auth — screens handle it
  }
}
