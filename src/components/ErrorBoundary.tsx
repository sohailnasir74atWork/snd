/**
 * Last line of defence for a render throw.
 *
 * Without this, one malformed document takes the app down to the launcher —
 * and it dies again on every reopen, because the document is still there. A
 * field worker with a dead app has no second device and no support desk.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getCrashlytics, recordError } from '@react-native-firebase/crashlytics';
import { Icon, PrimaryButton, color, font, radius, space } from './ui';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('[snd] render error', error);
    try {
      recordError(getCrashlytics(), error);
    } catch {} // crash reporting must never crash

  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.screen}>
        <Icon name="alert-circle-outline" size={64} color={color.danger} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.hint}>
          Your data is safe — nothing was lost. Try again, and if this screen
          keeps coming back, show the message below to the owner.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={styles.detailPad}>
          <Text style={styles.detail}>{error.message || String(error)}</Text>
        </ScrollView>
        <PrimaryButton
          label="Try again"
          icon="refresh"
          onPress={() => this.setState({ error: null })}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1, backgroundColor: color.bg,
    justifyContent: 'center', alignItems: 'center', padding: space.xl,
  },
  title: {
    fontSize: font.h1, fontWeight: '800', color: color.text,
    marginTop: space.m, textAlign: 'center',
  },
  hint: {
    fontSize: font.body, color: color.textSub, textAlign: 'center',
    marginTop: space.s, marginBottom: space.l, lineHeight: 21,
  },
  detailBox: {
    alignSelf: 'stretch', maxHeight: 140, marginBottom: space.l,
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
  },
  detailPad: { padding: space.m },
  detail: { fontSize: font.sub, color: color.textSub },
});
