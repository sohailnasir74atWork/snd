/**
 * Where this phone is, right now.
 *
 * Only ever called because a button was just pressed — there is no watch, no
 * background tracking, and nothing here runs on its own. The app finds out
 * where a person is at the moment they say "this is the shop", and never
 * otherwise. The distance maths that consumes these fixes is in `geo.ts`,
 * which stays free of this native import so it can be tested.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import type { GeoFix } from './geo';

/**
 * Two attempts, because one was failing bookers in the field.
 *
 * The report: "registering a shop and pinning its location gives an error —
 * sometimes, not always". That is the signature of a satellite fix, and the
 * reason is where the man is standing. He pins the shop from INSIDE it, under
 * a concrete roof in a packed bazaar, and a cold GPS chip in there routinely
 * never resolves at all. One high-accuracy attempt with no fallback meant the
 * only outcomes were a perfect pin or a refusal.
 *
 * So: ask the satellites first and briefly, then ask the phone what it knows
 * from wifi and cell towers, which answers indoors in a second or two and is
 * worth tens of metres rather than nothing. The pin screen already prints the
 * accuracy and warns past 30 m, so the worse fix arrives labelled as one —
 * and a shop pinned to the right street beats a shop not pinned at all, which
 * is what the app was choosing before.
 *
 * The first timeout is SHORTER than the old single one. Waiting 20 seconds and
 * then starting a fallback is a screen nobody stays on; 12 plus 10 gets a
 * usable answer sooner than the old path got its refusal.
 */
const PRECISE_TIMEOUT_MS = 12000;
const COARSE_TIMEOUT_MS = 10000;

/** Reasons a fix fails, each with something the person can actually do. */
export class GeoError extends Error {
  constructor(
    message: string,
    readonly kind: 'permission' | 'unavailable' | 'timeout',
  ) {
    super(message);
    this.name = 'GeoError';
  }
}

let configured = false;

function configure(): void {
  if (configured) return;
  // 'whenInUse' — the app has no business knowing where anyone is once it is
  // closed, and asking for more is how an app gets rejected from Play.
  Geolocation.setRNConfiguration({
    skipPermissionRequests: true, // asked for explicitly below, in our own words
    authorizationLevel: 'whenInUse',
    enableBackgroundLocationUpdates: false,
    locationProvider: 'auto',
  });
  configured = true;
}

/** What the OS is actually letting us have right now. */
export type GeoLevel = 'fine' | 'coarse';

/**
 * What this app is permitted, WITHOUT asking for anything.
 *
 * Split out from `ensurePermission` because the watch must never prompt. Two
 * refusals in a row is what moves a permission into "don't ask again" on
 * Android 11+, and the sweep screen produced exactly that pair inside one
 * second: `begin()` opens the round even when the fix failed, that flips the
 * focus effect's dependency, the watch starts and asks a second time. One Deny
 * plus the reflexive second Deny ended location for the app permanently. Only
 * a button press may ask.
 */
export async function hasPermission(): Promise<GeoLevel | null> {
  if (Platform.OS !== 'android') return 'fine';
  const P = PermissionsAndroid.PERMISSIONS;
  if (await PermissionsAndroid.check(P.ACCESS_FINE_LOCATION)) return 'fine';
  if (await PermissionsAndroid.check(P.ACCESS_COARSE_LOCATION)) return 'coarse';
  return null;
}

/**
 * Ask for location, once, in the moment it is needed — and actually get a
 * dialog.
 *
 * **Both permissions go in ONE request or Android shows nothing at all.** From
 * targetSdk 31 the framework refuses a runtime request for FINE that does not
 * carry COARSE with it: no dialog appears, the callback returns denied, and
 * logcat prints "ACCESS_FINE_LOCATION must be requested with
 * ACCESS_COARSE_LOCATION". React Native then reads
 * `shouldShowRequestPermissionRationale`, which is false on a phone that has
 * never been prompted, and reports `never_ask_again`.
 *
 * This app's own code then concluded the person had blocked location and told
 * him to go and fix it in Settings — about a dialog he was never shown. The
 * build targets SDK 36, so that was EVERY fresh install on Android 12 or
 * later. Both permissions are already declared in the manifest.
 *
 * `requestMultiple` does not re-prompt anyone who has already granted: React
 * Native checks `checkSelfPermission` first and resolves immediately.
 */
async function ensurePermission(): Promise<GeoLevel> {
  if (Platform.OS !== 'android') return 'fine';
  const P = PermissionsAndroid.PERMISSIONS;
  const R = PermissionsAndroid.RESULTS;
  const res = await PermissionsAndroid.requestMultiple([
    P.ACCESS_FINE_LOCATION,
    P.ACCESS_COARSE_LOCATION,
  ]);
  if (res[P.ACCESS_FINE_LOCATION] === R.GRANTED) return 'fine';
  if (res[P.ACCESS_COARSE_LOCATION] === R.GRANTED) return 'coarse';
  /**
   * "Use precise location" can be switched off in Settings long after the
   * grant, and the REQUEST result does not describe that state — only a check
   * does. Asking again here costs nothing and catches the person who granted
   * approximate months ago.
   */
  const held = await hasPermission();
  if (held) return held;
  // NEVER_ASK_AGAIN means the system dialog will not appear again no matter
  // how many times the button is pressed, so say where the switch actually is.
  const blocked = res[P.ACCESS_FINE_LOCATION] === R.NEVER_ASK_AGAIN
    && res[P.ACCESS_COARSE_LOCATION] === R.NEVER_ASK_AGAIN;
  throw new GeoError(
    blocked
      ? 'Location is blocked for this app. Turn it on in Settings → Apps → SnD Manager → Permissions → Location, then try again.'
      : 'Location permission is needed to save where this shop is.',
    'permission',
  );
}

/**
 * One high-accuracy fix, or a `GeoError` saying why not.
 *
 * `maximumAge: 0` on purpose: a cached fix from the last shop is worse than
 * useless here — it would silently pin this shop to the previous one's doorway,
 * and nothing downstream could ever tell the two apart.
 */
export async function getCurrentFix(): Promise<GeoFix> {
  configure();
  const level = await ensurePermission();
  /**
   * A coarse-only grant makes `enableHighAccuracy: true` a GUARANTEED refusal,
   * and this is the trap the staged fallback was written for and then fell
   * into itself.
   *
   * Android's `getValidProvider(highAccuracy = true)` picks GPS, finds GPS
   * enabled so it does NOT fall back to the network provider, then checks
   * ACCESS_FINE_LOCATION, does not have it, and returns nothing — reported as
   * POSITION_UNAVAILABLE, never as a timeout. The retry below only fired on a
   * timeout, so the coarse pass could never run for the one person it exists
   * to serve. Perversely, switching GPS OFF made it work.
   *
   * So: never ask for precision this app does not hold.
   */
  if (level === 'coarse') return once(false, PRECISE_TIMEOUT_MS + COARSE_TIMEOUT_MS);
  try {
    return await once(true, PRECISE_TIMEOUT_MS);
  } catch (e) {
    // A dead provider earns the second attempt as much as a slow one does:
    // `unavailable` is what a concrete roof and a missing provider both look
    // like from here. Permission refusals still fail once and stop.
    if (e instanceof GeoError && (e.kind === 'timeout' || e.kind === 'unavailable')) {
      return once(false, COARSE_TIMEOUT_MS);
    }
    throw e;
  }
}

/**
 * One attempt at a fix.
 *
 * `maximumAge: 0` on BOTH passes, on purpose: a cached fix from the last shop
 * would silently pin this one to the previous doorway, and nothing downstream
 * could ever tell the two apart. The fallback buys its speed by dropping
 * ACCURACY, never by accepting a stale answer — a coarse fix taken now is
 * honestly labelled, and an old precise one is a lie with a small number
 * next to it.
 */
function once(precise: boolean, timeout: number): Promise<GeoFix> {
  return new Promise<GeoFix>((resolve, reject) => {
    Geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy } = pos.coords;
        resolve({
          lat: latitude,
          lng: longitude,
          // Android can report a null or zero accuracy on some devices.
          // Calling that 0 would dress the worst fix the phone can give as a
          // perfect one; NaN makes every reader say "unknown" instead.
          accuracyM: typeof accuracy === 'number' && accuracy > 0 ? accuracy : Number.NaN,
        });
      },
      err => {
        if (err.code === 3) {
          // The precise pass's message is never read — `getCurrentFix` turns
          // that one into the coarse retry. Only the last attempt speaks.
          reject(new GeoError(
            'Could not find this phone’s location. Step towards the doorway and try again — it needs either a little sky or a wifi network in range.',
            'timeout',
          ));
          return;
        }
        if (err.code === 1) {
          reject(new GeoError('Location permission is needed to save where this shop is.', 'permission'));
          return;
        }
        /**
         * POSITION_UNAVAILABLE means "no provider I am allowed to use", which
         * is NOT the same claim as "you switched location off" — it is also
         * exactly what a coarse-only grant returns with GPS running perfectly.
         * Telling a man to turn on something that is already on is how he
         * decides the app is broken and stops reporting things.
         */
        reject(new GeoError(
          'This phone could not give a location. Check Location is switched on in the quick settings, then try again.',
          'unavailable',
        ));
      },
      { enableHighAccuracy: precise, timeout, maximumAge: 0 },
    );
  });
}

/**
 * Follow the phone until told to stop. Returns the unsubscribe.
 *
 * This is the only continuous sensor in the app, so it is deliberately
 * awkward to leave running: the caller must stop it, and the sweep screen
 * does so the moment it loses focus. High accuracy plus a 5 m filter is the
 * balance that matters in a bazaar — a 20 m filter would not move the dot
 * between two shops on the same street, and no filter at all just burns the
 * battery redrawing GPS jitter.
 *
 * Errors do not tear the watch down. A phone loses its fix under a market
 * awning constantly, and the last known position stays on screen with the
 * staleness visible rather than the guidance collapsing.
 */
export function watchFix(
  onFix: (fix: GeoFix) => void,
  onError?: (e: GeoError) => void,
): () => void {
  configure();
  let id: number | null = null;
  let stopped = false;

  /**
   * CHECKS, never requests. Prompting from here is what produced two system
   * dialogs inside one second — the button's refusal, then this one the
   * instant the screen opened the round anyway — and two refusals in a row is
   * what Android turns into "don't ask again". A single Deny plus the
   * reflexive second Deny used to end location for the app permanently.
   */
  void hasPermission()
    .then(level => {
      if (stopped) return;
      if (!level) {
        onError?.(new GeoError(
          'Location permission is needed to follow the round. Press "Re-order from where I am now" to allow it.',
          'permission',
        ));
        return;
      }
      id = Geolocation.watchPosition(
        pos => {
          const { latitude, longitude, accuracy } = pos.coords;
          onFix({
            lat: latitude,
            lng: longitude,
            accuracyM: typeof accuracy === 'number' && accuracy > 0 ? accuracy : Number.NaN,
          });
        },
        err => {
          /**
           * A dropped fix is normal under an awning and the staleness line
           * already covers it. Codes 1 and 2 are different in kind: Android's
           * `startObserving` emits POSITION_UNAVAILABLE and returns WITHOUT
           * ever calling `requestLocationUpdates`, so the watch is dead rather
           * than delayed and no fix will ever arrive. Saying nothing there
           * leaves the screen waiting forever.
           */
          if (err.code === 3) return;
          if (id !== null) { Geolocation.clearWatch(id); id = null; }
          onError?.(err.code === 1
            ? new GeoError(
              'Location permission was turned off. Turn it back on to keep the round guiding you.',
              'permission',
            )
            : new GeoError(
              'This phone stopped giving a location. Check Location is on in the quick settings, then press "Re-order from where I am now".',
              'unavailable',
            ));
        },
        {
          // Precision this app does not hold is a guaranteed refusal — the
          // same trap `getCurrentFix` documents. A coarse-only phone gets a
          // watch that registers rather than one that never starts.
          enableHighAccuracy: level === 'fine',
          distanceFilter: 5,
          interval: 4000,
          fastestInterval: 2000,
        },
      );
    })
    .catch(e => {
      if (!stopped && onError) onError(e instanceof GeoError ? e : new GeoError(String(e), 'unavailable'));
    });

  return () => {
    stopped = true;
    if (id !== null) { Geolocation.clearWatch(id); id = null; }
  };
}

/**
 * Which way to turn, in words rather than degrees.
 *
 * A compass bearing is useless to someone holding a phone at a junction; "NE"
 * is something they can act on without taking their eyes off the road.
 */
export function bearingLabel(from: GeoFix, to: { lat: number; lng: number }): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(((deg + 360) % 360) / 45) % 8];
}
