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
 * Give up before the person does.
 *
 * A cold GPS chip indoors can take minutes and often never resolves at all.
 * Twenty seconds is long enough for a warm fix on a phone that has been
 * outside, and short enough that the spinner does not become the experience.
 */
const FIX_TIMEOUT_MS = 20000;

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

/**
 * Ask for location, once, in the moment it is needed.
 *
 * Declaring the permission in the manifest is not enough on any Android the
 * field runs — the same trap that made push silently dead on Android 13+
 * (Round 8, #15). This asks for real and reports what came back.
 */
async function ensurePermission(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  if (granted === PermissionsAndroid.RESULTS.GRANTED) return;
  // NEVER_ASK_AGAIN means the system dialog will not appear again no matter
  // how many times the button is pressed, so say where the switch actually is.
  if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    throw new GeoError(
      'Location is blocked for this app. Turn it on in Settings → Apps → SnD Manager → Permissions → Location, then try again.',
      'permission',
    );
  }
  throw new GeoError('Location permission is needed to save where this shop is.', 'permission');
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
  await ensurePermission();
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
          reject(new GeoError(
            'Could not get a GPS fix in time. Step outside, away from the roof, and try again.',
            'timeout',
          ));
          return;
        }
        if (err.code === 1) {
          reject(new GeoError('Location permission is needed to save where this shop is.', 'permission'));
          return;
        }
        // POSITION_UNAVAILABLE is overwhelmingly "location services are
        // switched off", which no amount of waiting fixes.
        reject(new GeoError(
          'Location is switched off on this phone. Turn on Location in the quick settings, then try again.',
          'unavailable',
        ));
      },
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 },
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

  void ensurePermission()
    .then(() => {
      if (stopped) return;
      id = Geolocation.watchPosition(
        pos => {
          const { latitude, longitude, accuracy } = pos.coords;
          onFix({
            lat: latitude,
            lng: longitude,
            accuracyM: typeof accuracy === 'number' && accuracy > 0 ? accuracy : Number.NaN,
          });
        },
        () => {
          // Deliberately quiet: a dropped fix mid-round is normal and the
          // screen already shows how old the last one is.
        },
        {
          enableHighAccuracy: true,
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
    if (id !== null) Geolocation.clearWatch(id);
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
