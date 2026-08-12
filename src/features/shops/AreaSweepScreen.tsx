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
import {
  POOR_ACCURACY_M, distanceM, formatAccuracy, formatDistance, isPlaced, orderByNearest,
} from '../../lib/geo';
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

/**
 * Hard caps on what this screen mounts, and the reason is a field report: on a
 * real phone the Map tab froze, and a booker gave up pinning shops because of
 * it.
 *
 * Every `<Marker>` is a NATIVE view. An area with a hundred pinned shops built
 * a hundred of them, plus a Card each in a plain `ScrollView` that mounts
 * everything it is given. On a 3GB handset that is not slow, it is stuck.
 *
 * These are hard caps rather than a "Show more" button. Route uses Show-more
 * because a list that grows is only slower; here the thing being protected IS
 * the frame rate, and a button that re-freezes the phone is not a kindness.
 * Nothing is hidden silently — each cap prints what it is holding back, and
 * the whole round is still in the list underneath.
 *
 * Twelve is about what fits on screen at sweep zoom before markers start
 * overlapping into a smear, so the cap costs nothing anybody could see.
 */
const MAP_MARKERS = 12;

/**
 * Marker colours, spelled out rather than defaulted.
 *
 * `pinColor` must always be a real colour string — see the note at the Marker
 * itself. These are the two states the map draws: the stop you are heading to,
 * and the ones after it. Done stops are not on the map at all.
 */
const PIN_NEXT = '#1a73e8';
const PIN_AHEAD = '#EA4335';
const LIST_STOPS = 25;

export function AreaSweepScreen() {
  const store = useStore();
  const mapRef = React.useRef<MapView | null>(null);

  /**
   * The round, and the working day it belongs to — stamped ONCE, when it opens.
   *
   * The day used to be a bare `todayKey()` call in the render body. The GPS
   * watch re-renders this screen every few seconds, so the first render after
   * midnight changed the string and the persist effect below immediately wrote
   * the whole completed set into TOMORROW's key. The next evening the round
   * opened already finished and those stops vanished from the rider's day —
   * precisely what a day key exists to prevent.
   *
   * `useState(todayKey)` and a memo are the same bug one day later: this is a
   * tab screen that stays mounted for the life of the app, so a phone left
   * running overnight would carry yesterday's key into today's first round.
   * The day belongs to the ROUND. Stamp it at the start and never reach for
   * the clock again.
   */
  const [round, setRound] = React.useState<{ area: string; day: string } | null>(null);
  const areaName = round?.area ?? null;
  const [here, setHere] = React.useState<GeoFix | null>(null);
  const [hereAt, setHereAt] = React.useState<number | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Set<string>>(new Set());
  const [orderedIds, setOrderedIds] = React.useState<string[] | null>(null);
  // Panning the map is a deliberate act of looking somewhere else; the camera
  // stops chasing until the person asks for it back.
  const [followMe, setFollowMe] = React.useState(true);
  /**
   * A clock for `stale`, and nothing else.
   *
   * `stale` is a `Date.now()` comparison, so it can only change on a re-render
   * — and every re-render source here (the watch callback, a Firestore
   * snapshot, a touch) stops at the same moment the signal does. Under a market
   * awning the flag was structurally unable to fire in the one situation it was
   * written for. It ticks inside the focus effect below so it dies on blur;
   * a standalone interval would keep a native MapView re-rendering while the
   * rider is on another tab, which is the battery cost the watch itself refuses.
   */
  const [, setTick] = React.useState(0);

  const areasWithShops = React.useMemo(() => {
    const live = store.areas.filter(a => a.active).map(a => a.name);
    const used = [...new Set(store.shops.filter(s => s.active).map(s => s.area))];
    return [...new Set([...live, ...used])]
      .filter(n => n.trim().length > 0)
      .map(name => {
        const inArea = store.shops.filter(s => s.active && s.area === name);
        // Same predicate the round uses, or the picker claims "every shop is
        // on the map" while the round silently drops one.
        return { name, total: inArea.length, pinned: inArea.filter(isPlaced).length };
      })
      .filter(a => a.total > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [store.areas, store.shops]);

  const begin = React.useCallback(async (name: string) => {
    setLocating(true);
    setError(null);
    /**
     * The day is stamped when a round OPENS, and re-stamped never.
     *
     * This function has two callers: the picker, which opens a round, and the
     * footer's "Re-order from where I am now", which does not. Reading the
     * clock unconditionally would let the second one walk a round across
     * midnight into tomorrow's key — the rider presses re-order at 00:05 and
     * his morning's progress disappears off the screen. Same bug as the one
     * `round` exists to kill, through the other door.
     */
    const day = round && round.area === name ? round.day : todayKey();
    try {
      const fix = await getCurrentFix();
      const inArea = store.shops.filter(s => s.active && s.area === name);
      setHere(fix);
      setHereAt(Date.now());
      setOrderedIds(orderByNearest(fix, inArea).map(s => s.id));
      setDone(loadDone(name, day));
      setRound({ area: name, day });
      setFollowMe(true);
    } catch (e) {
      setError(e instanceof GeoError ? e.message : 'Could not read this phone’s location.');
      /**
       * A FAILED re-order keeps the order this round already has.
       *
       * The footer's "Re-order from where I am now" calls this same function
       * mid-round, and indoors the GPS takes 22 s to give up (12 s precise,
       * then 10 s coarse). This used to overwrite the frozen nearest-first
       * route with raw Firestore document order and name a "next" shop three
       * kilometres away — silently, because it is the same code path that
       * legitimately opens a NEW round unordered when there is no GPS.
       *
       * `prev` is null exactly when a genuinely new round is opening, because
       * "Pick another round" nulls it. Functional update so nothing is
       * stale-captured from this callback's closure.
       */
      setOrderedIds(prev => prev ?? store.shops
        .filter(s => s.active && s.area === name && isPlaced(s)).map(s => s.id));
      setDone(loadDone(name, day));
      setRound({ area: name, day });
    } finally {
      setLocating(false);
    }
  }, [store.shops, round]);

  /**
   * The only continuous sensor in the app, and it runs ONLY while this screen
   * is in front with a round open. Tabbing away stops it — a GPS watch left
   * running in the background is how a field phone dies by lunchtime.
   */
  useFocusEffect(
    React.useCallback(() => {
      if (!areaName) return undefined;
      const stop = watchFix(
        // Cleared CONDITIONALLY: a healthy phone ticks a fix every few seconds
        // and an unconditional setError(null) would write state on every one.
        fix => {
          setHere(fix);
          setHereAt(Date.now());
          setError(prev => (prev ? null : prev));
        },
        e => setError(e.message),
      );
      // The clock behind `stale`. Same lifetime as the sensor, deliberately.
      const tick = setInterval(() => setTick(n => n + 1), 15000);
      return () => { stop(); clearInterval(tick); };
    }, [areaName]),
  );

  const stops: Shop[] = React.useMemo(() => {
    if (!orderedIds) return [];
    // Resolved fresh each render so a shop renamed mid-round shows its new
    // name — the frozen thing is the ORDER, not the data.
    //
    // Indexed rather than `store.shops.find` per id: this memo rebuilds on
    // every shops snapshot, which is every time any colleague writes any shop
    // document, and the scan is O(stops × company). A 150-stop round against
    // 3,000 shops was ~450k comparisons landing on the frame budget of a screen
    // animating a map camera under a moving rider. The memo has to re-run
    // either way, so the index is strictly cheaper.
    const byId = new Map(store.shops.map(s => [s.id, s]));
    return orderedIds
      .map(id => byId.get(id))
      .filter((s): s is Shop => !!s && s.active);
  }, [orderedIds, store.shops]);

  const remaining = stops.filter(s => !done.has(s.id));
  /**
   * The done stops, derived ONCE from the same population the cards render.
   *
   * `done` is a raw MMKV set and is never intersected with `stops`, so the
   * header counted ids that are no longer stops: deactivating a shop mid-day
   * is one tap and lands through the live snapshot immediately, leaving
   * "Done (7)" above six cards while the progress figure — correctly derived
   * from `stops` — read 6. Three populations on one screen, two of them wrong.
   *
   * Deliberately NOT pruned back into `done` itself: `stops` resolves against
   * `store.shops`, which is empty on the first render before the snapshot lands
   * and empties again on a listener error, so a prune would write an empty set
   * over the day's real progress at exactly the moment the app is least sure of
   * itself.
   */
  const doneStops = React.useMemo(() => stops.filter(s => done.has(s.id)), [stops, done]);
  const next = remaining[0] ?? null;
  /**
   * What the map is allowed to draw: the next few stops that actually have a
   * pin, nearest-first in the order already frozen for this round.
   */
  const mapStops = remaining.filter(isPlaced).slice(0, MAP_MARKERS);
  const mapHidden = remaining.filter(isPlaced).length - mapStops.length;
  // A pin that cannot be drawn belongs in this list, not on the map — which is
  // what makes `isPlaced` the right test here rather than `!s.location`.
  // Memoized: unmemoized it re-reconciled the whole block on every GPS tick.
  const unpinned = React.useMemo(
    () => (areaName ? store.shops.filter(s => s.active && s.area === areaName && !isPlaced(s)) : []),
    [areaName, store.shops],
  );

  const toNext = here && next && isPlaced(next) ? distanceM(here, next.location) : null;
  /**
   * How wide the phone says its own uncertainty is.
   *
   * NaN stays permissive — `location.ts` uses it to mean "this handset will not
   * say", and a phone that can never arrive is worse than the bug below.
   */
  const acc = here && Number.isFinite(here.accuracyM) ? here.accuracyM : 0;
  /**
   * Arrival is distance AND certainty.
   *
   * This was distance-only, and `accuracyM` was read nowhere on this screen.
   * When `getCurrentFix` falls back to the coarse wifi/cell pass the phone can
   * report a position 300 m out; if that phantom landed within 40 m of the pin
   * the header went green, the guide read "You are here — 0 m away" and the
   * button turned into the CTA — telling a rider he had arrived at a shop two
   * streets away. An uncertainty wider than the arrival ring cannot support the
   * claim, so it is measured against the same constant the ring is drawn from.
   */
  const arrived = toNext !== null && acc <= ARRIVE_M && toNext <= ARRIVE_M;
  /**
   * 120 s, not 30 s. `watchFix` uses `distanceFilter: 5`, so a rider standing
   * still at a counter receives no callbacks at all — his fix is perfectly good
   * and `hereAt` stops advancing within half a minute of arriving, which is the
   * exact moment the old threshold started calling it stale.
   */
  const stale = hereAt !== null && Date.now() - hereAt > 120000;

  // Keep the camera on the person while they are following, and swing to the
  // next shop the moment one is marked done.
  React.useEffect(() => {
    if (!followMe || !mapRef.current) return;
    const target = here ?? (next && isPlaced(next)
      ? { lat: next.location.lat, lng: next.location.lng }
      : null);
    /**
     * The TARGET is guarded, not the shop — `here` is a GeoFix straight off
     * the sensor and has no `location` to test. This is the one site where a
     * bad number is uncatchable: `animateToRegion` JSON-serialises the region,
     * NaN becomes null, and the native `getDouble` throws inside a catch that
     * rethrows as a RuntimeException. An early return costs nothing; the
     * alternative takes the whole app down.
     */
    if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
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
    if (round) saveDone(round.area, round.day, done);
  }, [round, done]);

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

  /**
   * "Skip for now" — push the stop to the back of the round, do not mark it.
   *
   * This chip was wired to `markNext`, the identical handler as the CTA three
   * lines above it: a skipped shutter entered `done`, was persisted, counted in
   * the n/n progress and rendered struck through under "Done", indistinguishable
   * from a shop that was served. "For now" promised a return that nothing
   * implemented, and the only way back was an Undo chip in a list capped at 25
   * and ordered for the stop you had just mis-tapped.
   *
   * Rotating the id inside `orderedIds` keeps ONE source of truth. A separate
   * `skipped` Set would have to be persisted alongside `done` under the same
   * area+day key or the first unmount returns every skipped shutter to the
   * front of the round while `done` survives. The frozen-order comment at the
   * top of this file defends against GPS-driven re-planning, not against a stop
   * the rider has explicitly pushed back.
   *
   * With one stop left this is a visible no-op — there is nowhere behind it to
   * go. That is the honest answer, because the round is not finished and the
   * shop was not served, but it is a control that appears to do nothing. If
   * that ever confuses anyone in the field, hide the chip at
   * `remaining.length === 1`; do not go back to marking the stop done.
   */
  const skipNext = React.useCallback(() => {
    if (!next) return;
    const now = Date.now();
    if (now - lastMarkAt.current < 700) return; // same latch as markNext
    lastMarkAt.current = now;
    setOrderedIds(prev => (prev ? [...prev.filter(id => id !== next.id), next.id] : prev));
  }, [next]);

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
    if (!round) return;
    Alert.alert(
      'Start this round again?',
      'Every stop goes back to not-visited. Nothing else changes — orders and payments stay exactly as they are.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Start again',
          style: 'destructive',
          onPress: () => { clearDone(round.area, round.day); setDone(new Set()); },
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
  /**
   * Both suffixes ride on BOTH branches of the guide line.
   *
   * The staleness note used to sit inside the not-arrived branch only, so the
   * single most dangerous state — a green "You are here" computed from a
   * ten-minute-old fix — was silent by design.
   *
   * The accuracy note appears only when the fix is worse than the app's own
   * "pointing at the block, not the door" threshold. That is also roughly what
   * now holds `arrived` shut, so without it a rider would watch the button
   * refuse to go green with nothing on screen saying why.
   */
  const ageNote = stale ? ' • location is a moment old' : '';
  const accNote = acc > POOR_ACCURACY_M ? ` • ${formatAccuracy(acc)}` : '';

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
                ? `You are here — ${formatDistance(toNext)} away${accNote}${ageNote}`
                : `${formatDistance(toNext)} • head ${bearingLabel(here!, next.location!)}${accNote}${ageNote}`}
          </Text>
        ) : (
          <Text style={styles.guide}>
            {stops.length > 0 ? 'Round complete — every stop is done.' : 'Nothing on the map in this round yet.'}
          </Text>
        )}
        {/* The ONLY place this was drawn sat inside the round-picker branch,
            which returns before the sweep ever renders. `begin()` sets the
            error and opens the round in the same tick, so every permission
            failure showed as "Waiting for your location…" forever and every
            actionable sentence lib/location.ts writes was thrown away. */}
        {error ? <Text style={styles.errorLine}>{error}</Text> : null}
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
            {/* The road ahead only. Shops already done are greyed markers
                nobody navigates by — they are in the Done list below, which is
                where you look to undo one. */}
            {mapStops.map((s, i) => (
              <Marker
                key={s.id}
                coordinate={{ latitude: s.location!.lat, longitude: s.location!.lng }}
                title={s.name}
                description={i === 0 ? 'Next stop' : `Stop ${i + 1}`}
                // NEVER undefined. Under the New Architecture the generated
                // MarkerManager unboxes this to a Java Integer and calls
                // .intValue() on it, so a missing value is a hard
                // NullPointerException rather than a fall back to the default
                // pin — which is the crash reported from the field on v2.7:
                //
                //   NullPointerException: 'int java.lang.Integer.intValue()'
                //     at com.rnmaps.fabric.MarkerManager.setPinColor
                //
                // The old Paper bridge tolerated null here. Fabric does not.
                // Every colour on this screen is now an explicit string.
                pinColor={i === 0 ? PIN_NEXT : PIN_AHEAD}
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
          {/* The cap, said out loud. A map showing twelve pins on a round of
              sixty otherwise reads as a round of twelve. */}
          {mapHidden > 0 && (
            <View style={styles.mapNote}>
              <Text style={styles.mapNoteText}>
                {`Next ${MAP_MARKERS} stops · ${mapHidden} more ahead`}
              </Text>
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
              {/* Pushes this stop to the back of the round. NOT `markNext` —
                  a skip is not a visit, and it used to be recorded as one. */}
              <Chip small label="Skip for now" onPress={skipNext} />
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
            {remaining.slice(1, 1 + LIST_STOPS).map((s, i) => (
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
            {remaining.length - 1 > LIST_STOPS && (
              <Text style={styles.capNote}>
                {`+ ${remaining.length - 1 - LIST_STOPS} more on this round. They appear as you work down the list.`}
              </Text>
            )}
          </>
        )}

        {doneStops.length > 0 && (
          <>
            <SectionLabel>{`Done (${doneStops.length})`}</SectionLabel>
            {/* Newest first and capped: Undo is for the one just marked by
                mistake, not for something forty shops ago. */}
            {doneStops.slice(-LIST_STOPS).reverse().map(s => (
              <Card key={s.id}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.stopDone, styles.flexLabel]} numberOfLines={1}>{s.name}</Text>
                  <Chip small label="Undo" onPress={() => mark(s.id, false)} />
                </View>
              </Card>
            ))}
            {doneStops.length > LIST_STOPS && (
              <Text style={styles.capNote}>{`+ ${doneStops.length - LIST_STOPS} more done earlier.`}</Text>
            )}
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
              {/* Capped like every other list on this screen. This was the one
                  that escaped the policy, and it is longest in exactly the
                  state the caps exist for — a freshly imported area where
                  nothing is pinned, which the picker actively invites with
                  "Open anyway". The SectionLabel above still prints the true
                  total, so nothing is hidden. */}
              <View style={styles.rowWrap}>
                {unpinned.slice(0, LIST_STOPS).map(s => (
                  <View key={s.id} style={styles.ghostRow}>
                    <Icon name="map-marker-off-outline" size={16} color={color.textFaint} />
                    <Text style={styles.ghostName} numberOfLines={1}>{s.name}</Text>
                  </View>
                ))}
              </View>
              {/* Outside the rowWrap, or it becomes a flex child of it. */}
              {unpinned.length > LIST_STOPS && (
                <Text style={styles.capNote}>
                  {`+ ${unpinned.length - LIST_STOPS} more not on the map. Save a location at any of them and it joins the round.`}
                </Text>
              )}
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
            onPress={() => { setRound(null); setOrderedIds(null); setError(null); setHere(null); }}
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
  // What a cap is holding back. Never silent — a list that stops without
  // saying so reads as a round that is shorter than it is.
  mapNote: {
    position: 'absolute', left: space.s, bottom: space.s,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6,
    paddingHorizontal: space.s, paddingVertical: 3,
  },
  mapNoteText: { color: '#FFFFFF', fontSize: font.tiny },
  capNote: {
    fontSize: font.tiny, color: color.textSub, paddingHorizontal: space.gutter,
    paddingVertical: space.s, lineHeight: font.tiny + 5,
  },
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
