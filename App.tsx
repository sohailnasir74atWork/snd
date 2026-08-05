/**
 * App entry — the real auth gate (SRS FR-1.1–1.10).
 *
 * Welcome → Sign in with Google → the admitSignIn Cloud Function decides:
 * on the employee list → role home; unknown → refused with the address shown;
 * removed → "access ended". "Create a new business" requires the typed name
 * first (FR-1.7). A small "preview" link keeps the offline demo available.
 */
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, IconTile, color, shadow } from './src/components/ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigation, WelcomeScreen } from './src/app/navigation';
import { configureGoogleSignIn, restoreSession, signInWithGoogle, signOutEverywhere } from './src/app/auth';
import { DevStoreProvider } from './src/data/devStore';
import { FirestoreStoreProvider } from './src/data/firestoreStore';
import { useStore } from './src/data/store';
import { WizardScreen } from './src/features/admin/WizardScreen';
import type { Role, SessionUser } from './src/app/types';

/**
 * First run for a brand-new Owner: an empty catalogue means the guided
 * wizard (FR-12.9) — skippable, reopenable later from Settings.
 */
function SignedInApp({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const store = useStore();
  const [wizardDone, setWizardDone] = React.useState(false);
  const needsWizard =
    user.role === 'admin' && store.ready && store.products.length === 0 && !wizardDone;
  if (needsWizard) return <WizardScreen onDone={() => setWizardDone(true)} />;
  return <AppNavigation role={user.role} onSwitchRole={onSignOut} />;
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

  React.useEffect(() => {
    configureGoogleSignIn();
    restoreSession()
      .then(user => setStage(user ? { kind: 'signedIn', user } : { kind: 'welcome' }))
      .catch(() => setStage({ kind: 'welcome' }));
  }, []);

  const handleResult = (
    r: Awaited<ReturnType<typeof signInWithGoogle>>,
  ) => {
    if (r.ok) {
      setStage({ kind: 'signedIn', user: r.user });
    } else if (r.reason !== 'cancelled') {
      Alert.alert('Sign in', r.message);
    }
  };

  const doSignIn = async (createBusinessName?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      handleResult(await signInWithGoogle(createBusinessName ? { createBusinessName } : undefined));
    } catch (e) {
      Alert.alert('Sign in failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (stage.kind === 'loading' || busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={color.primary} />
      </View>
    );
  }

  if (stage.kind === 'welcome') {
    return (
      <View style={{ flex: 1 }}>
        <WelcomeScreen
          onSignIn={() => doSignIn()}
          onCreateBusiness={name => doSignIn(name)}
        />
        <Pressable style={styles.demoRow} onPress={() => setStage({ kind: 'previewPick' })}>
          <Icon name="play-circle-outline" size={26} color={color.primary} />
          <View style={{ marginLeft: 10 }}>
            <Text style={styles.demoTitle}>See a demo first</Text>
            <Text style={styles.demoSub}>Explore with sample data — nothing is saved</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Icon name="chevron-right" size={22} color={color.textFaint} />
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
      <View style={styles.pick}>
        <View style={styles.demoBadge}>
          <Icon name="play-circle-outline" size={16} color={color.primary} />
          <Text style={styles.demoBadgeText}>DEMO</Text>
        </View>
        <Text style={styles.pickTitle}>Who do you want to be?</Text>
        <Text style={styles.pickHint}>Sample data — nothing is saved. Each person sees only their own screens.</Text>
        {roles.map(r => (
          <Pressable key={r.role} style={styles.roleCard} onPress={() => setStage({ kind: 'preview', role: r.role })}>
            <IconTile name={r.icon} tint={r.tint} bg={r.bg} size={52} />
            <View style={styles.roleText}>
              <Text style={styles.roleTitle}>{r.title}</Text>
              <Text style={styles.roleDesc}>{r.desc}</Text>
            </View>
            <Icon name="chevron-right" size={24} color={color.textFaint} />
          </Pressable>
        ))}
        <Pressable style={styles.previewLink} onPress={() => setStage({ kind: 'welcome' })}>
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
      <AuthGate />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bg },
  pick: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: color.bg },
  pickTitle: { fontSize: 20, fontWeight: '700', color: color.text, textAlign: 'center' },
  pickHint: { fontSize: 13, color: color.textSub, textAlign: 'center', marginTop: 8, marginBottom: 24 },
  roleCard: {
    backgroundColor: color.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', ...shadow.card,
  },
  roleText: { flex: 1, marginLeft: 14 },
  roleTitle: { color: color.text, fontSize: 17, fontWeight: '800' },
  roleDesc: { color: color.textSub, fontSize: 13, marginTop: 2, lineHeight: 18 },
  demoBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
    backgroundColor: color.primarySoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5,
    marginBottom: 14, gap: 6,
  },
  demoBadgeText: { color: color.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  demoRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surface, borderRadius: 16, padding: 14,
    marginHorizontal: 28, marginBottom: 28, borderWidth: 1, borderColor: color.border,
  },
  demoTitle: { color: color.text, fontSize: 15, fontWeight: '700' },
  demoSub: { color: color.textSub, fontSize: 12, marginTop: 1 },
  previewLink: { alignItems: 'center', padding: 16 },
  previewLinkText: { color: color.textSub, fontSize: 13, fontWeight: '600' },
});
