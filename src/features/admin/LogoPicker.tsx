/**
 * Pick / replace / remove the company logo — one component, used by the setup
 * wizard and by Settings, because "the logo you chose on day one" and "the
 * logo you are changing in month six" are the same job.
 *
 * Uploading needs signal (the CDN slot comes from a callable). That is stated
 * on the row rather than discovered: everything else in the wizard works with
 * no connection, so a step that quietly does nothing offline would read as a
 * broken app.
 */
import React from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { Chip, IconTile, Text, color, font, radius, space } from '../../components/ui';
import { useStore } from '../../data/store';
import { pickLogoBase64 } from '../../lib/photos';
import { uploadPhotoBase64 } from '../../lib/storage';
import { LOGO, logoDataUri } from '../../lib/logo';
import { rememberLogo } from '../../lib/logoCache';

export function LogoPicker() {
  const store = useStore();
  const [busy, setBusy] = React.useState(false);
  // The bytes we just uploaded, shown immediately: the CDN URL is live the
  // moment it is written, but a remote <Image> on a market street may take a
  // while to come back and an empty box reads as a failed upload.
  const [justPicked, setJustPicked] = React.useState<string | null>(null);
  const url = store.settings.logoUrl;
  const preview = justPicked ? logoDataUri(justPicked) : url;

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const base64 = await pickLogoBase64();
      if (!base64) return; // backed out of the gallery
      setJustPicked(base64);
      if (store.demo) {
        // Preview has nobody signed in, so there is no CDN slot to ask for.
        // The bytes go straight into settings and the demo's bills carry the
        // logo like the real thing — which is the whole point of a demo.
        // Nothing leaves the phone, and nothing survives the session.
        store.setLogo(logoDataUri(base64)!);
        return;
      }
      const publicUrl = await uploadPhotoBase64(base64, 'logo');
      // Cache before the write, so this phone can print a bill with the logo
      // the moment it is set — even if it goes offline immediately after.
      rememberLogo(publicUrl, base64);
      store.setLogo(publicUrl);
    } catch (e) {
      Alert.alert('Logo not saved', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    Alert.alert(
      'Remove the logo?',
      'Your bills go back to showing your business name on its own. Bills already sent keep the logo that was on them.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => { setJustPicked(null); store.setLogo(null); },
        },
      ],
    );
  };

  return (
    <View style={styles.row}>
      {preview
        ? <Image source={{ uri: preview }} style={styles.preview} resizeMode="contain" />
        : <IconTile name="image-outline" size={56} />}
      <View style={styles.text}>
        <Text style={styles.title}>Logo on your bills</Text>
        <Text style={styles.sub}>
          {preview
            ? 'Printed beside your business name on every bill and receipt.'
            : `A square picture works best. At least ${LOGO.minEdge}×${LOGO.minEdge}, and it is shrunk to ${LOGO.maxEdge}×${LOGO.maxEdge} so bills stay light to send.`}
        </Text>
        <View style={styles.chips}>
          <Chip
            small
            label={busy ? 'Uploading…' : preview ? 'Change' : 'Choose a picture'}
            onPress={busy ? undefined : () => { void choose(); }}
          />
          {preview && !busy && <Chip small danger label="Remove" onPress={remove} />}
        </View>
        <Text style={styles.note}>
          {store.demo
            ? 'Demo — the picture stays on this phone and is not saved.'
            : 'Needs internet — the picture is uploaded once.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s, paddingVertical: space.s },
  preview: {
    width: 56, height: 56, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.cardEdge, backgroundColor: color.surface,
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: font.body, fontWeight: '700', color: color.text },
  sub: { fontSize: font.sub, color: color.textSub, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  note: { fontSize: font.tiny, color: color.textFaint, marginTop: space.xs },
});
