/**
 * App entry — the real auth gate (SRS FR-1.1–1.10).
 *
 * Welcome → Sign in with Google → the admitSignIn Cloud Function decides:
 * on the employee list → role home; unknown → refused with the address shown;
 * removed → "access ended". "Create a new business" requires the typed name
 * first (FR-1.7). A small "preview" link keeps the offline demo available.
 */
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Icon, IconTile, color, font, radius, shadow, space } from './src/components/ui';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppNavigation, WelcomeScreen } from './src/app/navigation';
import type { SignInIntent } from './src/app/navigation';
import {
  configureGoogleSignIn, forgetAccount, getLastAccount, restoreSession, signInWithGoogle,
  signOutEverywhere, startAccessWatch, subscribeAuthPresence, subscribeSession,
} from './src/app/auth';
import type { LastAccount } from './src/app/auth';
import { checkForAppUpdate } from './src/app/updates';
import { strings } from './src/i18n/strings';
import { DevStoreProvider } from './src/data/devStore';
import { FirestoreStoreProvider } from './src/data/firestoreStore';
import { useStore } from './src/data/store';
import { WizardScreen } from './src/features/admin/WizardScreen';
import type { Role, SessionUser } from './src/app/types';

/**
 * Sign-out, guarded.
 *
 * The account-switch icon sits in the top-right of every header, where a thumb
 * rests all day. It used to sign out of Google AND Firebase on one tap, with
 * no confirmation — throwing away any writes still queued offline, and needing
 * internet to get back in.
 */
function useGuardedSignOut(onSignOut: () => void) {
  const store = useStore();
  return React.useCallback(() => {
    const go = () => {
      void (async () => {
        const flushed = await store.flushPendingWrites();
        if (!flushed && store.pendingWrites > 0) {
          Alert.alert(
            'Not signed out',
            `${store.pendingWrites} ${store.pendingWrites === 1 ? 'change has' : 'changes have'} ` +
              'not reached the server yet. Signing out now would throw ' +
              `${store.pendingWrites === 1 ? 'it' : 'them'} away. Get a signal and try again.`,
          );
          return;
        }
        onSignOut();
      })();
    };
    Alert.alert(
      'Sign out?',
      'You need internet to sign back in.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: go },
      ],
    );
  }, [store, onSignOut]);
}

/**
 * First run for a brand-new Owner: an empty catalogue means the guided
 * wizard (FR-12.9) — skippable, reopenable later from Settings.
 */
function SignedInApp({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const store = useStore();
  const signOut = useGuardedSignOut(onSignOut);
  const [wizardDone, setWizardDone] = React.useState(false);
  // Latch the decision the first time the store is ready. Deriving it live
  // from products.length threw the owner out of setup the instant he added
  // his FIRST product on step 2 — the wizard unmounted mid-flow and steps 3
  // and 4 (shops, and inviting the team) were never seen.
  const [wizardLatched, setWizardLatched] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (wizardLatched === null && store.ready) {
      setWizardLatched(user.role === 'admin' && store.products.length === 0);
    }
  }, [wizardLatched, store.ready, store.products.length, user.role]);
  if (wizardLatched && !wizardDone) return <WizardScreen onDone={() => setWizardDone(true)} />;
  return <AppNavigation role={user.role} onSwitchRole={signOut} />;
}

type Stage =
  | { kind: 'loading' }
  | { kind: 'welcome' }
  | { kind: 'signedIn'; user: SessionUser }
  | { kind: 'previewPick' }
  | { kind: 'preview'; role: Role };

function AuthGate() {
  const [stage, setStage] = React.useState<Stage>({ kind: 'loading' });
  const [busy, setBusy] = React.useState(false);
  // Read once, synchronously — MMKV, so there is no frame where the returning
  // person sees the first-run question before the "continue" button appears.
  const [lastAccount, setLastAccount] = React.useState<LastAccount | null>(() => getLastAccount());
  // The create-business form lives up here because a refused "I own a
  // business" has to be able to open it — see handleResult.
  const [creating, setCreating] = React.useState(false);
  const [createNote, setCreateNote] = React.useState<string | null>(null);
  const closeCreate = React.useCallback(() => {
    setCreating(false);
    setCreateNote(null); // the reason dies with the form it explained
  }, []);
  // These screens live OUTSIDE the navigator, so nothing applies the system
  // bar insets for them — and Android 15+ forces edge-to-edge (targetSdk 36).
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    configureGoogleSignIn();
    restoreSession()
      .then(user => setStage(user ? { kind: 'signedIn', user } : { kind: 'welcome' }))
      .catch(() => setStage({ kind: 'welcome' }));
    // Fire and forget: a shipped fix reaches phones whose owner never opens
    // the Play Store. Deliberately not awaited — startup does not wait on it.
    void checkForAppUpdate();
  }, []);

  // While signed in for real, watch for the owner ending this person's access
  // (FR-1.9) or changing their role. Without this the app froze in place
  // rather than returning to Welcome, and a role change never arrived.
  React.useEffect(() => {
    if (stage.kind !== 'signedIn') return;
    const endAccess = () => {
      setStage({ kind: 'welcome' });
      setLastAccount(null);
      Alert.alert('Access ended', strings.signIn.accessEnded);
    };
    const stopWatch = startAccessWatch(endAccess);
    const stopPresence = subscribeAuthPresence(() => setStage({ kind: 'welcome' }));
    const stopSession = subscribeSession(user => {
      if (user) setStage({ kind: 'signedIn', user });
      else endAccess();
    });
    return () => {
      stopWatch();
      stopPresence();
      stopSession();
    };
  }, [stage.kind]);

  const handleResult = (
    r: Awaited<ReturnType<typeof signInWithGoogle>>,
    intent?: SignInIntent,
  ) => {
    if (r.ok) {
      setStage({ kind: 'signedIn', user: r.user });
      setLastAccount(getLastAccount()); // this phone now has a "continue as"
      // Left latched, this would drop the next sign-out straight onto the
      // create form, for a business that already exists.
      closeCreate();
      // Signed in, but not the way it was asked for — a business name was
      // typed, and the answer was the business they already belong to.
      if (r.notice) Alert.alert('Signed in', r.notice);
      return;
    }
    if (r.reason === 'cancelled') return;
    // not_on_list / access_ended already cleared the stored hint.
    setLastAccount(getLastAccount());
    // Someone who presses "I own a business" and is on nobody's list is, far
    // more often than not, an owner who has not made the workspace yet.
    // "Ask your owner" is the wrong sentence and a dead end for that person:
    // hand them the create form instead, with the reason above it.
    if (r.reason === 'not_on_list' && intent === 'owner') {
      setCreateNote(strings.welcome.ownerNotOnList(r.email ?? ''));
      setCreating(true);
      return;
    }
    Alert.alert('Sign in', r.message);
  };

  const doSignIn = async (
    opts?: { createBusinessName?: string; silent?: boolean },
    intent?: SignInIntent,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      handleResult(await signInWithGoogle(opts), intent);
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Entry-screen taps only: a stage move is one-way per press, so a fast
  // double tap cannot queue a second transition before the re-render lands.
  // The auth effects above keep calling setStage directly.
  const goStage = (next: Stage) => setStage(prev => (prev.kind === next.kind ? prev : next));

  // Cold start only, before we know the session. `busy` no longer lands here:
  // sign-in keeps the Welcome screen on screen with its buttons spinning,
  // rather than swapping the whole tree for an unexplained blank blue screen.
  if (stage.kind === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={color.primary} />
        <Text style={styles.centerHint}>Checking your sign-in…</Text>
      </View>
    );
  }

  if (stage.kind === 'welcome') {
    return (
      <View style={[styles.fill, { paddingTop: insets.top }]}>
        <WelcomeScreen
          busy={busy}
          lastAccount={lastAccount}
          creating={creating}
          createNote={createNote}
          onCreatingChange={open => (open ? setCreating(true) : closeCreate())}
          onSignIn={intent => doSignIn(undefined, intent)}
          onCreateBusiness={name => doSignIn({ createBusinessName: name })}
          // Google still holds the grant, so this normally goes straight
          // through with no account chooser at all.
          onContinue={() => doSignIn({ silent: true })}
          onUseAnother={() => {
            forgetAccount();
            setLastAccount(null);
          }}
        />
        <Pressable
          // Sign-in is in flight and the account chooser may still be open:
          // dropping into the demo now would strand it.
          style={[styles.demoRow, { marginBottom: 20 + insets.bottom }, busy && styles.demoRowOff]}
          disabled={busy}
          accessibilityState={{ disabled: busy }}
          onPress={busy ? undefined : () => goStage({ kind: 'previewPick' })}>
          <Icon name="play-circle-outline" size={24} color={color.primary} />
          {/* This column now does the pushing (flex + minWidth 0) instead of a
              spacer view, so the sub line wraps rather than run under the
              chevron. */}
          <View style={styles.demoText}>
            <Text style={styles.demoTitle}>See a demo first</Text>
            <Text style={styles.demoSub}>Explore with sample data — nothing is saved</Text>
          </View>
          <Icon name="chevron-right" size={20} color={color.textFaint} />
        </Pressable>
      </View>
    );
  }

  if (stage.kind === 'previewPick') {
    const roles: { role: Role; icon: string; tint: string; bg: string; title: string; desc: string }[] = [
      { role: 'admin', icon: 'shield-account-outline', tint: color.primary, bg: color.primarySoft,
        title: 'Owner', desc: 'Watch sales, confirm cash, see who owes you' },
      { role: 'booker', icon: 'cart-outline', tint: color.success, bg: color.successSoft,
        title: 'Order Booker', desc: 'Book shop orders in seconds — almost no typing' },
      { role: 'rider', icon: 'truck-outline', tint: color.warn, bg: color.warnSoft,
        title: 'Delivery Rider', desc: 'Load the van, deliver, bill and collect' },
    ];
    return (
      <View style={[styles.pick, { paddingTop: 20 + insets.top, paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.demoBadge}>
          <Icon name="play-circle-outline" size={14} color={color.primary} />
          <Text style={styles.demoBadgeText}>DEMO</Text>
        </View>
        <Text style={styles.pickTitle}>Who do you want to be?</Text>
        <Text style={styles.pickHint}>Sample data — nothing is saved. Each person sees only their own screens.</Text>
        {roles.map(r => (
          <Pressable key={r.role} style={styles.roleCard} onPress={() => goStage({ kind: 'preview', role: r.role })}>
            <IconTile name={r.icon} tint={r.tint} bg={r.bg} size={44} />
            <View style={styles.roleText}>
              <Text style={styles.roleTitle}>{r.title}</Text>
              <Text style={styles.roleDesc}>{r.desc}</Text>
            </View>
            <Icon name="chevron-right" size={20} color={color.textFaint} />
          </Pressable>
        ))}
        <Pressable style={styles.previewLink} onPress={() => goStage({ kind: 'welcome' })}>
          <Text style={styles.previewLinkText}>← Back to sign in</Text>
        </Pressable>
      </View>
    );
  }

  if (stage.kind === 'preview') {
    return (
      <DevStoreProvider>
        <AppNavigation role={stage.role} onSwitchRole={() => setStage({ kind: 'previewPick' })} />
      </DevStoreProvider>
    );
  }

  // Signed in for real: role from the owner's employee list, data from Firestore.
  return (
    <FirestoreStoreProvider user={stage.user}>
      <SignedInApp
        user={stage.user}
        onSignOut={async () => {
          await signOutEverywhere();
          setStage({ kind: 'welcome' });
        }}
      />
    </FirestoreStoreProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      {/* Dark clock/battery on the light canvas. The theme sets this too, for
          the launch frame; this keeps it from being reset at runtime. */}
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <ErrorBoundary>
        <AuthGate />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg },
  centerHint: { marginTop: space.m, color: color.textSub, fontSize: font.sub },
  pick: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: color.bg },
  pickTitle: { fontSize: font.h1, fontWeight: '700', color: color.text, textAlign: 'center' },
  pickHint: {
    fontSize: font.sub, color: color.textSub, textAlign: 'center',
    lineHeight: 16, marginTop: space.s, marginBottom: space.xl,
  },
  roleCard: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: space.m, marginBottom: space.m,
    minHeight: 44, flexDirection: 'row', alignItems: 'center', ...shadow.card,
  },
  // flex + minWidth 0: the title and description wrap inside the column
  // between the tile and the chevron instead of being clipped by them.
  roleText: { flex: 1, minWidth: 0, marginLeft: space.m },
  roleTitle: { color: color.text, fontSize: font.h2, fontWeight: '800' },
  roleDesc: { color: color.textSub, fontSize: font.sub, marginTop: 1, lineHeight: 16 },
  demoBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
    backgroundColor: color.primarySoft, borderRadius: radius.chip, paddingHorizontal: space.m, paddingVertical: space.xs,
    marginBottom: space.m, gap: space.xs,
  },
  demoBadgeText: { color: color.primary, fontSize: font.tiny, fontWeight: '800', letterSpacing: 1 },
  demoRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surface, borderRadius: radius.card, padding: space.m,
    // marginHorizontal matches the Welcome screen's 24pt gutter above it.
    marginHorizontal: 24, marginBottom: space.xl, borderWidth: 1, borderColor: color.border,
  },
  // Flat, low-contrast card while sign-in runs, so it reads as unavailable.
  demoRowOff: { backgroundColor: color.surfaceAlt, opacity: 0.6 },
  demoText: { flex: 1, minWidth: 0, marginLeft: space.m },
  demoTitle: { color: color.text, fontSize: font.body, fontWeight: '700' },
  demoSub: { color: color.textSub, fontSize: font.sub, marginTop: 1, lineHeight: 16 },
  // Padding alone no longer reaches 44pt at the tighter type scale.
  previewLink: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: space.m },
  previewLinkText: { color: color.textSub, fontSize: font.sub, fontWeight: '600' },
});
