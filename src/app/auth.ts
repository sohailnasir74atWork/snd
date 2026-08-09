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
  onIdTokenChanged,
  signInWithCredential,
  signOut as fbSignOut,
} from '@react-native-firebase/auth';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { kv } from '../lib/kv';
import { strings } from '../i18n/strings';
import type { Role, SessionUser } from './types';

// Web client id (OAuth type 3) from google-services.json — required by
// Google Identity Services to mint the idToken Firebase Auth consumes.
const WEB_CLIENT_ID =
  '210364311261-urf0khjrnfq34to3qp78b9bmr6lj391s.apps.googleusercontent.com';

export function configureGoogleSignIn(): void {
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
}

const SESSION_KEY = 'snd.session';
const LAST_ACCOUNT_KEY = 'snd.lastAccount';

export type LastAccount = { email: string; name: string };

/**
 * A Welcome-screen hint that deliberately OUTLIVES sign-out.
 *
 * "I work for a business" vs "Create a new business" is the right question
 * exactly once. Every time after that the answer is already known, and asking
 * again puts a wrong button — the one that starts a second business — under
 * the thumb of someone who just wants back into their own.
 *
 * Holds no credentials. Google and Firebase own those; this is a name and an
 * address used to label a button.
 */
function rememberAccount(u: SessionUser): void {
  try {
    kv.set(LAST_ACCOUNT_KEY, JSON.stringify({ email: u.email, name: u.name }));
  } catch {}
}

export function getLastAccount(): LastAccount | null {
  try {
    const raw = kv.getString(LAST_ACCOUNT_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<LastAccount>;
    return a.email ? { email: a.email, name: a.name ?? '' } : null;
  } catch {
    return null;
  }
}

/** Someone else is taking this phone, or this account is no longer welcome. */
export function forgetAccount(): void {
  try {
    kv.remove(LAST_ACCOUNT_KEY);
  } catch {}
}

/**
 * A background admission must never hold the app hostage. The callable's
 * default is 70 s, which on a half-dead cell is 70 s of bare spinner — and a
 * half-dead cell is the realistic field case, not airplane mode, which fails
 * fast and looks fine.
 */
const ADMIT_TIMEOUT_MS = 15000;

function admitCallable(timeout?: number) {
  return httpsCallable(
    getFunctions(undefined, 'asia-south1'),
    'admitSignIn',
    timeout ? { timeout } : undefined,
  );
}

type AdmitResponse =
  | { status: 'admitted'; companyId: string; role: Role; name: string }
  // Asked to create a business, but the directory already knows this address.
  // Admitted to the business they belong to — with something to say about it.
  | {
      status: 'already_in_business';
      companyId: string;
      role: Role;
      name: string;
      businessName: string;
    }
  | { status: 'not_on_list' }
  | { status: 'access_ended' };

/**
 * The last admitted identity, kept on the device.
 *
 * `getIdTokenResult(false)` does NOT hand back an expired token: past the
 * one-hour mark it silently attempts a network refresh, which fails with no
 * signal. Without this copy the field worker who opens the app on a market
 * street next morning is bounced to Welcome and cannot work at all.
 */
function storeSession(u: SessionUser): void {
  try {
    kv.set(SESSION_KEY, JSON.stringify(u));
  } catch {} // a phone that cannot write this still works, it just re-admits
}

function loadStoredSession(uid: string): SessionUser | null {
  try {
    const raw = kv.getString(SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<SessionUser>;
    // Only ever restore the account that is actually signed in on this phone.
    if (u.uid !== uid || !u.companyId || !u.role) return null;
    return { uid, email: u.email ?? '', name: u.name ?? '', companyId: u.companyId, role: u.role };
  } catch {
    return null;
  }
}

type SessionListener = (u: SessionUser | null) => void;
const sessionListeners = new Set<SessionListener>();

/**
 * Fires when the server changes the session out from under a running app —
 * a role change, or access ending while the phone was away (FR-1.9).
 */
export function subscribeSession(fn: SessionListener): () => void {
  sessionListeners.add(fn);
  return () => {
    sessionListeners.delete(fn);
  };
}

function emitSession(u: SessionUser | null): void {
  sessionListeners.forEach(fn => {
    try {
      fn(u);
    } catch {} // one bad listener must not stop the others
  });
}

/**
 * Fires the moment Firebase itself drops the user — sign-out from anywhere,
 * a disabled account, a token that will not renew. Nothing watched this
 * before, so the app just sat there frozen.
 */
export function subscribeAuthPresence(onGone: () => void): () => void {
  return onIdTokenChanged(getAuth(), u => {
    if (!u) onGone();
  });
}

/**
 * FR-1.9 — cut a removed employee's access within about a minute.
 *
 * `revokeRefreshTokens()` only kills the REFRESH token: the ID token already
 * on the phone stays valid for up to an hour, and the rules do not check
 * revocation, so nothing would otherwise notice. Forcing a refresh on a timer
 * is what turns the server-side revocation into a real sign-out.
 */
export function startAccessWatch(onRevoked: () => void, everyMs = 60000): () => void {
  let stopped = false;
  const tick = async () => {
    const user = getAuth().currentUser;
    if (!user || stopped) return;
    try {
      await user.getIdToken(true);
    } catch (e) {
      // No signal is not revocation. Only a definite server "no" ends a day.
      const msg = e instanceof Error ? e.message : String(e);
      if (/network|unavailable|timeout|deadline/i.test(msg)) return;
      if (stopped) return;
      await signOutEverywhere();
      onRevoked();
    }
  };
  const id = setInterval(() => {
    void tick();
  }, everyMs);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

export type SignInResult =
  /** `notice`: signed in, but not the way the person asked — say so. */
  | { ok: true; user: SessionUser; notice?: string }
  | {
      ok: false;
      reason: 'offline' | 'not_on_list' | 'access_ended' | 'cancelled';
      message: string;
      /** The address that was refused — the caller words its own refusal. */
      email?: string;
    };

export async function signInWithGoogle(
  opts?: { createBusinessName?: string; silent?: boolean },
): Promise<SignInResult> {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // A returning person on their own phone should not have to pick their
    // account out of a list again — Google still holds the grant, so ask for
    // it without any UI and fall back to the chooser only if it has gone.
    const response = opts?.silent
      ? await GoogleSignin.signInSilently()
      : await GoogleSignin.signIn();
    if (response.type !== 'success') {
      if (opts?.silent) return signInWithGoogle({ ...opts, silent: false });
      return { ok: false, reason: 'cancelled', message: '' };
    }
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('no idToken from Google');

    const credential = GoogleAuthProvider.credential(idToken);
    const { user } = await signInWithCredential(getAuth(), credential);

    // Server-side admission: employeeDirectory lookup + custom claims (§10.1).
    // The typed business name is what makes "Create your business" deliberate (FR-1.7).
    const admit = admitCallable();
    const { data } = (await admit({ createBusinessName: opts?.createBusinessName })) as {
      data: AdmitResponse;
    };

    if (data.status === 'not_on_list') {
      await signOutEverywhere();
      forgetAccount(); // do not offer to continue as an account that is refused
      return {
        ok: false,
        reason: 'not_on_list',
        message: strings.signIn.notOnList(user.email ?? ''),
        email: user.email ?? '',
      };
    }
    if (data.status === 'access_ended') {
      await signOutEverywhere();
      forgetAccount();
      return { ok: false, reason: 'access_ended', message: strings.signIn.accessEnded };
    }

    // Claims were just written server-side; refresh the token so rules see them.
    await user.getIdToken(true);
    const session: SessionUser = {
      uid: user.uid,
      email: user.email ?? '',
      name: data.name || user.displayName || '',
      companyId: data.companyId,
      role: data.role,
    };
    storeSession(session);
    rememberAccount(session);
    return {
      ok: true,
      user: session,
      notice:
        data.status === 'already_in_business'
          ? strings.signIn.alreadyInBusiness(data.businessName, data.role)
          : undefined,
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
  try {
    kv.remove(SESSION_KEY);
  } catch {}
  await GoogleSignin.signOut().catch(() => {});
  await fbSignOut(getAuth()).catch(() => {});
}

/**
 * Restore a still-signed-in session on app start (FR-1.5: stay signed in).
 *
 * Offline-first: the identity already lives in the cached ID token's custom
 * claims, so a morning with no signal opens straight into the app on cached
 * Firestore data. The server is asked only to REFRESH the claims when it is
 * reachable — and only a definite "you are out" signs the person out. A
 * network failure never locks a field worker out of his own day.
 */
export async function restoreSession(): Promise<SessionUser | null> {
  const user = getAuth().currentUser;
  if (!user) return null;

  const fromClaims = async (forceRefresh: boolean): Promise<SessionUser | null> => {
    const res = await user.getIdTokenResult(forceRefresh);
    const companyId = res.claims.companyId as string | undefined;
    const role = res.claims.role as Role | undefined;
    if (!companyId || !role) return null;
    return {
      uid: user.uid,
      email: user.email ?? '',
      name: user.displayName ?? '',
      companyId,
      role,
    };
  };

  // Cached claims are instant while the token is still inside its hour. Past
  // that they need the network, so fall back to the copy written at the last
  // successful admission — that is what makes an offline morning start work.
  const cached =
    (await fromClaims(false).catch(() => null)) ?? loadStoredSession(user.uid);

  // Refresh in the BACKGROUND once we have something to show. Awaiting it
  // here is what cost up to 70 s on a weak connection, and the answer only
  // ever changes on the rare day a role changed or access ended — both of
  // which reach the UI through subscribeSession instead.
  if (cached) {
    void refreshAdmission(cached);
    return cached;
  }

  // Nothing cached: there is no honest way to skip the round trip.
  return refreshAdmission(null);
}

/**
 * Re-admit against the server. The callable's answer is authoritative: the
 * previous version read the new role out of it and then returned the session
 * built from the PRE-change cached claims, so a role change never took effect.
 */
async function refreshAdmission(cached: SessionUser | null): Promise<SessionUser | null> {
  const user = getAuth().currentUser;
  if (!user) return null;
  try {
    const admit = admitCallable(ADMIT_TIMEOUT_MS);
    const { data } = (await admit({})) as { data: AdmitResponse };

    if (data.status === 'access_ended' || data.status === 'not_on_list') {
      await signOutEverywhere(); // removed while away (FR-1.9)
      forgetAccount(); // never offer "continue as" an account that is out
      emitSession(null);
      return null;
    }

    // Claims may have just been rewritten server-side; refresh so the rules
    // agree with the session we hand back.
    await user.getIdToken(true).catch(() => {});

    const fresh: SessionUser = {
      uid: user.uid,
      email: user.email ?? cached?.email ?? '',
      name: data.name || user.displayName || cached?.name || '',
      companyId: data.companyId,
      role: data.role,
    };
    storeSession(fresh);
    rememberAccount(fresh);
    if (cached && (cached.role !== fresh.role || cached.companyId !== fresh.companyId)) {
      emitSession(fresh); // the app is already running under the old role
    }
    return fresh;
  } catch {
    return cached; // offline: carry on with what the phone already knows
  }
}
