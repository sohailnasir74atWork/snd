/**
 * The area sweep — pick a round, then be walked through it inside the app.
 *
 * Everything happens here: your own dot moves on the map as you ride, the next
 * shop is pinned with a line to it, the distance counts down live, and when
 * you get close the screen offers to mark the stop done and re-targets the
 * next one. Nobody leaves the app to do the round.
 *
 * What this deliberately does NOT do is road-following turn-by-turn with
 * voice. That is a whole product, it costs a billed API call per leg, and done
 * half-well on a motorbike it is worse than nothing. Between shops fifty
 * metres apart on the same street, a direction and a live distance is what a
 * person actually uses. "Open in Google Maps" survives as a small link for the
 * long hop into an area, where real road directions genuinely help.
 *
 * Stop order is fixed when the round starts, not re-planned on every GPS
 * twitch: a route that rearranges itself while someone is riding toward a shop
 * is worse than a slightly longer one they can trust. Re-ordering is a button.
 */
import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import {
  Card, Chip, EmptyState, Icon, PrimaryButton, SectionLabel,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import { todayKey } from '../../data/models';
import type { Shop } from '../../data/models';
import { distanceM, formatDistance, orderByNearest } from '../../lib/geo';
import type { GeoFix } from '../../lib/geo';
import { GeoError, bearingLabel, getCurrentFix, watchFix } from '../../lib/location';
import { clearDone, loadDone, saveDone } from './sweepProgress';

/**
 * Close enough to be standing at the shop.
 *
 * Wider than it sounds on purpose: a phone in a dense bazaar reports 15–25 m
 * of error routinely, so a 15 m gate would never open and the rider would
 * think the app was broken. 40 m is one shopfront either side — near enough to
 * offer the button, and the person still has to press it.
 */
const ARRIVE_M = 40;

/** Enough of the round to see the next stop and where you are. */
const SPAN = 0.006;

export function AreaSweepScreen() {
  const store = useStore();
  const dayKey = todayKey();
  const mapRef = React.useRef<MapView | null>(null);

  const [areaName, setAreaName] = React.useState<string | null>(null);
  const [here, setHere] = React.useState<GeoFix | null>(null);
  const [hereAt, setHereAt] = React.useState<number | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const [orderedIds, setOrderedIds] = React.useState<string[] | null>(null);
  // Panning the map is a deliberate act of looking somewhere else; the camera
  // stops chasing until the person asks for it back.
  const [followMe, setFollowMe] = React.useState(true);

  const areasWithShops = React.useMemo(() => {
    const live = store.areas.filter(a => a.active).map(a => a.name);
    const used = [...new Set(store.shops.filter(s => s.active).map(s => s.area))];
    return [...new Set([...live, ...used])]
      .filter(n => n.trim().length > 0)
      .map(name => {
        const inArea = store.shops.filter(s => s.active && s.area === name);
        return { name, total: inArea.length, pinned: inArea.filter(s => s.location).length };
      })
      .filter(a => a.total > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [store.areas, store.shops]);

  const begin = React.useCallback(async (name: string) => {
    setLocating(true);
    setError(null);
    try {
      const fix = await getCurrentFix();
      const inArea = store.shops.filter(s => s.active && s.area === name);
      setHere(fix);
      setHereAt(Date.now());
      setOrderedIds(orderByNearest(fix, inArea).map(s => s.id));
      setDone(loadDone(name, dayKey));
      setAreaName(name);
      setFollowMe(true);
    } catch (e) {
      setError(e instanceof GeoError ? e.message : 'Could not read this phone’s location.');
      // Still open the round: the ordering needs GPS, the shops and their pins
      // do not, and someone who knows the area can work from the list.
      setOrderedIds(store.shops.filter(s => s.active && s.area === name && s.location).map(s => s.id));
      setDone(loadDone(name, dayKey));
      setAreaName(name);
    } finally {
      setLocating(false);
    }
  }, [store.shops, dayKey]);

  /**
   * The only continuous sensor in the app, and it runs ONLY while this screen
   * is in front with a round open. Tabbing away stops it — a GPS watch left
   * running in the background is how a field phone dies by lunchtime.
   */
  useFocusEffect(
    React.useCallback(() => {
      if (!areaName) return undefined;
      const stop = watchFix(
        fix => { setHere(fix); setHereAt(Date.now()); },
        e => setError(e.message),
      );
      return stop;
    }, [areaName]),
  );

  const stops: Shop[] = React.useMemo(() => {
    if (!orderedIds) return [];
    // Resolved fresh each render so a shop renamed mid-round shows its new
    // name — the frozen thing is the ORDER, not the data.
    return orderedIds
      .map(id => store.shops.find(s => s.id === id))
      .filter((s): s is Shop => !!s && s.active);
  }, [orderedIds, store.shops]);

  const remaining = stops.filter(s => !done.has(s.id));
  const next = remaining[0] ?? null;
  const unpinned = areaName
    ? store.shops.filter(s => s.active && s.area === areaName && !s.location)
    : [];

  const toNext = here && next?.location ? distanceM(here, next.location) : null;
  const arrived = toNext !== null && toNext <= ARRIVE_M;
  // A fix older than half a minute is not where you are any more.
  const stale = hereAt !== null && Date.now() - hereAt > 30000;

  // Keep the camera on the person while they are following, and swing to the
  // next shop the moment one is marked done.
  React.useEffect(() => {
    if (!followMe || !mapRef.current) return;
    const target = here ?? (next?.location ? { lat: next.location.lat, lng: next.location.lng } : null);
    if (!target) return;
    mapRef.current.animateToRegion(
      { latitude: target.lat, longitude: target.lng, latitudeDelta: SPAN, longitudeDelta: SPAN },
      600,
    );
  }, [here, next, followMe]);

  const mark = React.useCallback((shopId: string, visited: boolean) => {
    setDone(prev => {
      const nextSet = new Set(prev);
      if (visited) nextSet.add(shopId); else nextSet.delete(shopId);
      return nextSet;
    });
    // Back to following: the next stop is the thing to look at now.
    if (visited) setFollowMe(true);
  }, []);

  // Persisted OUT here, not inside the updater above. A state updater can be
  // invoked more than once for a single update, and writing to storage from
  // inside one is a side effect in a place React is free to repeat.
  React.useEffect(() => {
    if (areaName) saveDone(areaName, dayKey, done);
  }, [areaName, dayKey, done]);

  /**
   * Advance to the next stop, once per press.
   *
   * The guard is not defensive padding. Marking a stop re-renders the card
   * with the NEXT shop under the same button, so a press that registers twice
   * — a bump in the road, a glove, a slow phone redrawing — marks a shop
   * visited that nobody has been to, and it disappears from the round in
   * silence. Round 8 closed exactly this class of bug for every async write
   * (`if (busy) return` plus a keyed latch); this is its synchronous twin, and
   * it was found by pressing the button once on a device and watching two
   * shops go green.
   */
  const lastMarkAt = React.useRef(0);
  const markNext = React.useCallback(() => {
    if (!next) return;
    const now = Date.now();
    if (now - lastMarkAt.current < 700) return;
    lastMarkAt.current = now;
    mark(next.id, true);
  }, [next, mark]);

  /** The long hop into an area is the one place road directions earn their keep. */
  const openExternally = (shop: Shop) => {
    if (!shop.location) return;
    const { lat, lng } = shop.location;
    const primary = `google.navigation:q=${lat},${lng}&mode=d`;
    const fallback = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    void Linking.openURL(primary).catch(() => {
      void Linking.openURL(fallback).catch(() => {
        Alert.alert('No maps app', 'This phone has no app that can open directions.');
      });
    });
  };

  const restart = () => {
    if (!areaName) return;
    Alert.alert(
      'Start this round again?',
      'Every stop goes back to not-visited. Nothing else changes — orders and payments stay exactly as they are.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Start again',
          style: 'destructive',
          onPress: () => { clearDone(areaName, dayKey); setDone(new Set()); },
        },
      ],
    );
  };

  // ---- Round picker ------------------------------------------------------
  if (!areaName) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.subLine}>Pick the round you are working today.</Text>
        {error ? <Text style={styles.errorLine}>{error}</Text> : null}
        {areasWithShops.map(a => (
          <Card key={a.name}>
            <View style={styles.rowBetween}>
              <Text style={[styles.areaName, styles.flexLabel]} numberOfLines={2}>{a.name}</Text>
              <Text style={styles.areaCount}>{a.pinned}/{a.total}</Text>
            </View>
            <Text style={styles.areaMeta}>
              {a.pinned === 0
                ? 'No shop here is on the map yet — save locations first and this round can guide you.'
                : a.pinned < a.total
                  ? `${a.total - a.pinned} not on the map yet; they will not appear as stops.`
                  : 'Every shop here is on the map.'}
            </Text>
            <PrimaryButton
              label={a.pinned === 0 ? 'Open anyway' : `Start ${a.name}`}
              variant={a.pinned === 0 ? 'quiet' : 'cta'}
              icon="map-marker-path"
              busy={locating}
              busyLabel="Finding you…"
              onPress={() => void begin(a.name)}
            />
          </Card>
        ))}
        {areasWithShops.length === 0 && (
          <EmptyState
            icon="map-marker-path"
            title="No rounds yet"
            hint="Areas with at least one shop show up here. Ask the owner to add areas in More → Areas."
          />
        )}
      </ScrollView>
    );
  }

  // ---- The sweep ---------------------------------------------------------
  const initial = here ?? next?.location ?? null;
  const leg = here && next?.location
    ? [
        { latitude: here.lat, longitude: here.lng },
        { latitude: next.location.lat, longitude: next.location.lng },
      ]
    : [];

  return (
    <View style={styles.screen}>
      {/* Everything the rider needs at a glance, above the map rather than
          under it: at arm's length on a bike this is the only line read. */}
      <View style={[styles.header, arrived && styles.headerArrived]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.areaName, styles.flexLabel]} numberOfLines={1}>
            {next ? next.name : areaName}
          </Text>
          <Text style={styles.progress}>{stops.length - remaining.length}/{stops.length}</Text>
        </View>
        {next ? (
          <Text style={[styles.guide, arrived && styles.guideArrived]} numberOfLines={2}>
            {toNext === null
              ? 'Waiting for your location…'
              : arrived
                ? `You are here — ${formatDistance(toNext)} away`
                : `${formatDistance(toNext)} • head ${bearingLabel(here!, next.location!)}${stale ? ' • location is a moment old' : ''}`}
          </Text>
        ) : (
          <Text style={styles.guide}>
            {stops.length > 0 ? 'Round complete — every stop is done.' : 'Nothing on the map in this round yet.'}
          </Text>
        )}
      </View>

      {initial ? (
        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={styles.fill}
            provider={PROVIDER_GOOGLE}
            initialRegion={{
              latitude: initial.lat, longitude: initial.lng,
              latitudeDelta: SPAN, longitudeDelta: SPAN,
            }}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
            onPanDrag={() => setFollowMe(false)}>
            {stops.filter(s => s.location).map((s, i) => (
              <Marker
                key={s.id}
                coordinate={{ latitude: s.location!.lat, longitude: s.location!.lng }}
                title={s.name}
                description={done.has(s.id) ? 'Done' : s.id === next?.id ? 'Next stop' : `Stop ${i + 1}`}
                opacity={done.has(s.id) ? 0.35 : 1}
                pinColor={done.has(s.id) ? '#9aa0a6' : s.id === next?.id ? '#1a73e8' : undefined}
              />
            ))}
            {/* The arrival ring is the honest version of "you have arrived":
                it shows the slack the gate actually allows. */}
            {next?.location && (
              <Circle
                center={{ latitude: next.location.lat, longitude: next.location.lng }}
                radius={ARRIVE_M}
                strokeColor={arrived ? color.success : color.border}
                fillColor={arrived ? 'rgba(52,168,83,0.15)' : 'rgba(0,0,0,0.04)'}
                strokeWidth={2}
              />
            )}
            {leg.length === 2 && (
              <Polyline coordinates={leg} strokeWidth={4} strokeColor={color.primary} />
            )}
          </MapView>
          {!followMe && (
            <View style={styles.recenter}>
              <Chip small selected label="Follow me" onPress={() => setFollowMe(true)} />
            </View>
          )}
        </View>
      ) : null}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {next && (
          <Card>
            <Text style={styles.stopName} numberOfLines={2}>{next.name}</Text>
            <Text style={styles.areaMeta} numberOfLines={2}>
              {next.ownerName ? `${next.ownerName} • ` : ''}{next.phone}
            </Text>
            {/* One button, and it is the one the rider presses at the counter. */}
            <PrimaryButton
              label={arrived ? 'Visited — next shop' : 'Mark visited — next shop'}
              icon="check-circle-outline"
              variant={arrived ? 'cta' : 'primary'}
              onPress={markNext}
            />
            <View style={styles.rowWrap}>
              <Chip small label="Skip for now" onPress={markNext} />
              {next.phone ? (
                <Chip small label="Call" onPress={() => { void Linking.openURL(`tel:${next.phone}`).catch(() => {}); }} />
              ) : null}
              {/* Demoted on purpose: the round runs in here now. */}
              <Chip small label="Open in Google Maps" onPress={() => openExternally(next)} />
            </View>
          </Card>
        )}

        {remaining.length > 1 && (
          <>
            <SectionLabel>After that</SectionLabel>
            {remaining.slice(1).map((s, i) => (
              <Card key={s.id}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.stopLine, styles.flexLabel]} numberOfLines={1}>
                    {i + 2}. {s.name}
                  </Text>
                  <Text style={styles.areaCount}>
                    {next?.location && s.location ? formatDistance(distanceM(next.location, s.location)) : ''}
                  </Text>
                </View>
              </Card>
            ))}
          </>
        )}

        {done.size > 0 && (
          <>
            <SectionLabel>{`Done (${done.size})`}</SectionLabel>
            {stops.filter(s => done.has(s.id)).map(s => (
              <Card key={s.id}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.stopDone, styles.flexLabel]} numberOfLines={1}>{s.name}</Text>
                  <Chip small label="Undo" onPress={() => mark(s.id, false)} />
                </View>
              </Card>
            ))}
          </>
        )}

        {unpinned.length > 0 && (
          <>
            <SectionLabel>{`Not on the map (${unpinned.length})`}</SectionLabel>
            <Card>
              <Text style={styles.areaMeta}>
                These shops are in {areaName} but have no saved location, so the round cannot
                guide you to them. Save a location while you are standing at one and it joins
                the sweep next time.
              </Text>
              <View style={styles.rowWrap}>
                {unpinned.map(s => (
                  <View key={s.id} style={styles.ghostRow}>
                    <Icon name="map-marker-off-outline" size={16} color={color.textFaint} />
                    <Text style={styles.ghostName} numberOfLines={1}>{s.name}</Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        )}

        {!next && stops.length > 0 && (
          <EmptyState
            icon="check-circle-outline"
            title={`${areaName} covered`}
            hint="Every stop in this round is done. Start it again tomorrow, or pick another round."
          />
        )}

        <View style={styles.footer}>
          <PrimaryButton
            variant="quiet"
            label="Re-order from where I am now"
            icon="crosshairs-gps"
            busy={locating}
            busyLabel="Finding you…"
            onPress={() => void begin(areaName)}
          />
          {done.size > 0 && (
            <PrimaryButton variant="quiet" label="Start this round again" icon="restart" onPress={restart} />
          )}
          <PrimaryButton
            variant="quiet"
            label="Pick another round"
            icon="format-list-bulleted"
            onPress={() => { setAreaName(null); setOrderedIds(null); setError(null); setHere(null); }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space.l, paddingBottom: 40 },
  header: { paddingHorizontal: space.gutter, paddingVertical: space.l, backgroundColor: color.surface },
  headerArrived: { backgroundColor: color.successSoft },
  subLine: { fontSize: font.sub, color: color.textSub, marginBottom: space.m },
  errorLine: { fontSize: font.sub, color: color.danger, marginBottom: space.m, lineHeight: font.sub + 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The recurring crop bug: a long name in a space-between row needs the flex
  // or it pushes the number off the card.
  flexLabel: { flex: 1, minWidth: 0 },
  areaName: { fontSize: font.h2, fontWeight: '700', color: color.text },
  areaCount: { flexShrink: 0, fontSize: font.sub, color: color.textSub, marginLeft: space.s },
  areaMeta: { fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6, marginTop: space.xs },
  // The one line read at arm's length, so it is the biggest thing on screen.
  guide: { fontSize: font.h2, fontWeight: '700', color: color.primary, marginTop: space.xs },
  guideArrived: { color: color.success },
  progress: { flexShrink: 0, fontSize: font.stat, fontWeight: '700', color: color.primary },
  mapWrap: { height: 260, backgroundColor: color.surfaceAlt },
  recenter: { position: 'absolute', right: space.m, bottom: space.m },
  list: { flex: 1 },
  listContent: { paddingHorizontal: space.gutter, paddingTop: space.l, paddingBottom: 40 },
  stopName: { fontSize: font.h2, fontWeight: '700', color: color.text, marginBottom: space.xs },
  stopLine: { fontSize: font.body, color: color.text },
  stopDone: { fontSize: font.body, color: color.textFaint, textDecorationLine: 'line-through' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  ghostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    borderRadius: radius.chip, backgroundColor: color.surfaceAlt,
    paddingHorizontal: space.s, paddingVertical: space.xs,
  },
  ghostName: { maxWidth: 160, fontSize: font.sub, color: color.textSub },
  footer: { marginTop: space.l, gap: space.s },
});
