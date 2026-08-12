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
import { POOR_ACCURACY_M, formatAccuracy, isPlaced } from '../../lib/geo';
import type { GeoFix } from '../../lib/geo';
import { GeoError, getCurrentFix } from '../../lib/location';
import type { ShopLocation } from '../../data/models';

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
  /**
   * Seeded only from a pin the map can actually draw. A half-written document
   * ({lat: null}) reaching `initialRegion` or a `coordinate` is a native
   * `getDouble` throw, and on the region path it is uncatchable — see
   * `isPlaced` in lib/geo.ts. A broken existing pin is treated as no pin,
   * which puts this screen straight into "read the phone", which is the
   * repair the shop needs anyway.
   */
  const usable = isPlaced({ location: (existing ?? undefined) as ShopLocation | undefined })
    ? existing!
    : null;
  const [fix, setFix] = React.useState<GeoFix | null>(usable);
  const [locating, setLocating] = React.useState(!usable);
  const [error, setError] = React.useState<string | null>(null);
  // Dragging the marker means the person is overriding the chip with their
  // own eyes, so the phone's accuracy number no longer describes the pin.
  const [moved, setMoved] = React.useState(false);
  /**
   * Did THIS screen measure the fix it is showing?
   *
   * Opened to correct a pin, the GPS is deliberately never read on the way in
   * (see the effect below), so `fix` is a reading somebody else took months
   * ago somewhere else. Without this flag the panel described that stored
   * accuracy in the present tense and Save wrote it straight back with a fresh
   * `savedAt`/`savedBy` — telling the owner a stale pin had been verified
   * today, and destroying the one staleness signal he has, on the visit that
   * happened BECAUSE the pin was wrong.
   */
  const [fresh, setFresh] = React.useState(!usable);
  const [saving, setSaving] = React.useState(false);

  const locate = React.useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      const next = await getCurrentFix();
      setFix(next);
      setMoved(false);
      setFresh(true);
    } catch (e) {
      setError(e instanceof GeoError ? e.message : 'Could not read this phone’s location.');
    } finally {
      setLocating(false);
    }
  }, []);

  React.useEffect(() => {
    // Ask the moment the screen opens: the person is standing at the door
    // right now, and every second of tapping is a second they are not.
    if (!usable) void locate();
  }, [usable, locate]);

  const region: Region | undefined = fix
    ? { latitude: fix.lat, longitude: fix.lng, latitudeDelta: SPAN, longitudeDelta: SPAN }
    : undefined;

  const poor = !!fix && (!Number.isFinite(fix.accuracyM) || fix.accuracyM > POOR_ACCURACY_M);

  const save = () => {
    if (!fix || saving) return;
    // Nothing was measured and nothing was dragged, so the pin being "saved"
    // is the pin already on the document. Writing it back would change only
    // `savedAt` and `savedBy` — a stale fix laundered as freshly verified.
    // Close instead; the button says "Keep this spot" in this state.
    if (!moved && !fresh) { onCancel(); return; }
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
              {/* Provenance first: how the pin got here decides what may
                  honestly be said about it. A stored fix is reported in the
                  past tense, whatever its accuracy figure says. */}
              {moved
                ? 'Pin moved by hand — it will be saved exactly where you put it.'
                : !fresh
                  ? `Saved earlier (${formatAccuracy(fix.accuracyM)}). Press “Read location again” to check it from where you are standing.`
                  : poor
                    ? `Weak fix (${formatAccuracy(fix.accuracyM)}). Step outside and read again, or drag the pin onto the shop.`
                    : `Good fix (${formatAccuracy(fix.accuracyM)}). Drag the pin if it is off the door.`}
            </Text>
          </View>
        ) : null}

        <PrimaryButton
          // "Keep this spot" rather than "Save this spot" when nothing on this
          // screen has been measured or moved: somebody who came to nudge the
          // pin should not be told he is saving a new reading when he is not.
          label={!fix ? 'Waiting for location…' : !fresh && !moved ? 'Keep this spot' : 'Save this spot'}
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
  header: { paddingHorizontal: space.gutter, paddingVertical: space.l, backgroundColor: color.surface },
  title: { fontSize: font.h1, fontWeight: '700', color: color.text },
  sub: { fontSize: font.sub, color: color.textSub, marginTop: space.xs, lineHeight: font.sub + 6 },
  // The map takes what is left after the panel, rather than a fixed height:
  // on a short phone a fixed map is what pushes the save button off-screen.
  mapWrap: { flex: 1, backgroundColor: color.surfaceAlt },
  panel: { paddingHorizontal: space.gutter, paddingVertical: space.l, backgroundColor: color.surface, gap: space.s },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s, marginBottom: space.xs },
  // flex + minWidth 0 so a long message wraps instead of shoving the icon out.
  note: { flex: 1, minWidth: 0, fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6 },
  noteBad: { color: color.danger },
  waiting: { fontSize: font.body, color: color.textSub, marginTop: space.m, textAlign: 'center' },
});
