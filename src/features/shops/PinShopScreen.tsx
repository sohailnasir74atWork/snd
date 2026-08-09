/**
 * Pin a shop — stand at the counter, check the dot, save.
 *
 * The map is here to let someone SEE that the dot landed on the right door,
 * and to nudge it when it did not. It is not here to be the source of the
 * pin: the GPS fix is, and the fix arrives (and can be saved) whether or not
 * a single map tile ever loads. That is the whole design constraint — this
 * screen runs in a bazaar on a phone with one bar, and a grey square must
 * cost the person nothing but the ability to double-check.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import { Icon, PrimaryButton, color, font, space } from '../../components/ui';
import { POOR_ACCURACY_M, formatAccuracy } from '../../lib/geo';
import type { GeoFix } from '../../lib/geo';
import { GeoError, getCurrentFix } from '../../lib/location';

/** Roughly a two-street box — close enough to recognise the shopfront. */
const SPAN = 0.0012;

export function PinShopScreen({
  shopName,
  existing,
  onSave,
  onCancel,
}: {
  shopName: string;
  /** Re-pinning a shop that already has one: start where it is now. */
  existing?: GeoFix | null;
  onSave: (fix: GeoFix) => void;
  onCancel: () => void;
}) {
  const [fix, setFix] = React.useState<GeoFix | null>(existing ?? null);
  const [locating, setLocating] = React.useState(!existing);
  const [error, setError] = React.useState<string | null>(null);
  // Dragging the marker means the person is overriding the chip with their
  // own eyes, so the phone's accuracy number no longer describes the pin.
  const [moved, setMoved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const locate = React.useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      const next = await getCurrentFix();
      setFix(next);
      setMoved(false);
    } catch (e) {
      setError(e instanceof GeoError ? e.message : 'Could not read this phone’s location.');
    } finally {
      setLocating(false);
    }
  }, []);

  React.useEffect(() => {
    // Ask the moment the screen opens: the person is standing at the door
    // right now, and every second of tapping is a second they are not.
    if (!existing) void locate();
  }, [existing, locate]);

  const region: Region | undefined = fix
    ? { latitude: fix.lat, longitude: fix.lng, latitudeDelta: SPAN, longitudeDelta: SPAN }
    : undefined;

  const poor = !!fix && (!Number.isFinite(fix.accuracyM) || fix.accuracyM > POOR_ACCURACY_M);

  const save = () => {
    if (!fix || saving) return;
    setSaving(true);
    // A dragged pin is the person's word against the chip's. Their word wins,
    // and the accuracy is recorded as unknown rather than borrowing a figure
    // that described a spot they have just told us was wrong.
    onSave(moved ? { ...fix, accuracyM: Number.NaN } : fix);
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{shopName || 'This shop'}</Text>
        <Text style={styles.sub}>
          Stand at the shop door, then save. This is how the route finds it next time.
        </Text>
      </View>

      <View style={styles.mapWrap}>
        {region ? (
          <MapView
            style={styles.fill}
            provider={PROVIDER_GOOGLE}
            initialRegion={region}
            // No follow-me: the marker is the answer, and a map that keeps
            // re-centring fights the thumb that is trying to nudge it.
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}>
            <Marker
              draggable
              coordinate={{ latitude: fix!.lat, longitude: fix!.lng }}
              onDragEnd={e => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                setFix(prev => (prev ? { ...prev, lat: latitude, lng: longitude } : prev));
                setMoved(true);
              }}
            />
          </MapView>
        ) : (
          <View style={[styles.fill, styles.center]}>
            {locating ? (
              <>
                <ActivityIndicator size="large" color={color.primary} />
                <Text style={styles.waiting}>Finding where you are…</Text>
              </>
            ) : (
              <Text style={styles.waiting}>No location yet.</Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.panel}>
        {error ? (
          <View style={styles.noteRow}>
            <Icon name="alert-circle-outline" size={18} color={color.danger} />
            <Text style={[styles.note, styles.noteBad]}>{error}</Text>
          </View>
        ) : fix ? (
          <View style={styles.noteRow}>
            <Icon
              name={poor ? 'crosshairs-question' : 'crosshairs-gps'}
              size={18}
              color={poor ? color.danger : color.success}
            />
            <Text style={[styles.note, poor && styles.noteBad]}>
              {moved
                ? 'Pin moved by hand — it will be saved exactly where you put it.'
                : poor
                  ? `Weak fix (${formatAccuracy(fix.accuracyM)}). Step outside and read again, or drag the pin onto the shop.`
                  : `Good fix (${formatAccuracy(fix.accuracyM)}). Drag the pin if it is off the door.`}
            </Text>
          </View>
        ) : null}

        <PrimaryButton
          label={fix ? 'Save this spot' : 'Waiting for location…'}
          disabled={!fix}
          busy={saving}
          busyLabel="Saving…"
          icon="map-marker-check"
          onPress={save}
        />
        <PrimaryButton
          variant="quiet"
          label={fix ? 'Read location again' : 'Try again'}
          busy={locating}
          busyLabel="Finding…"
          icon="crosshairs-gps"
          onPress={() => void locate()}
        />
        <PrimaryButton variant="quiet" label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { padding: space.l, backgroundColor: color.surface },
  title: { fontSize: font.h1, fontWeight: '700', color: color.text },
  sub: { fontSize: font.sub, color: color.textSub, marginTop: space.xs, lineHeight: font.sub + 6 },
  // The map takes what is left after the panel, rather than a fixed height:
  // on a short phone a fixed map is what pushes the save button off-screen.
  mapWrap: { flex: 1, backgroundColor: color.surfaceAlt },
  panel: { padding: space.l, backgroundColor: color.surface, gap: space.s },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s, marginBottom: space.xs },
  // flex + minWidth 0 so a long message wraps instead of shoving the icon out.
  note: { flex: 1, minWidth: 0, fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6 },
  noteBad: { color: color.danger },
  waiting: { fontSize: font.body, color: color.textSub, marginTop: space.m, textAlign: 'center' },
});
