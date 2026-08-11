Verified every claim below against the files (and against `node_modules/react-native-maps` and `@react-native-community/geolocation` native sources). Line numbers are as of the working tree today.

---

# Map system review — v2.7 / versionCode 23

Only two files in the whole app import `react-native-maps` (`AreaSweepScreen.tsx`, `PinShopScreen.tsx`), so the blast radius of the Fabric class of bug is small and fully auditable. The bigger problem is upstream of the map: **on a fresh install on any Android 12+ phone, the location permission dialog never appears at all** — so the map system has nothing to draw.

---

## 0. The Fabric prop rule (the class of bug, stated once)

**Mechanism, confirmed in the installed native source.** `node_modules/react-native-maps/android/src/main/java/com/rnmaps/fabric/MarkerManager.java:222-228`:

```java
public void setPinColor(MapMarker view, @Nullable Integer value) {
    float[] hsv = new float[3];
    Color.colorToHSV(value, hsv);   // unboxes -> NPE when value is null
```

That is the exact reported crash. The siblings have the same shape: `CircleManager.java:71` and `:81` take `@Nullable Integer` and hand it to `MapCircle.setFillColor(int)` / `setStrokeColor(int)` (`MapCircle.java:52`, `:59`); `PolylineManager.java:76` likewise.

**The rule that matters, and it is narrower than "any nullable prop":**

> A prop **key that is present with the value `undefined`/`null`** arrives at the Java setter as `null` and unboxes to an NPE. A prop that is **omitted entirely** never reaches the props map and the native default stands.

So the dangerous pattern is a prop whose *expression* can evaluate to undefined — `pinColor={i === 0 ? BLUE : undefined}`, `strokeColor={color.typo}`, `radius={shop.radiusM}` read from a document. Omission is safe.

**Audit result — every native map prop in the two files:**

| Prop | Where | Verdict |
|---|---|---|
| `pinColor` | `AreaSweepScreen.tsx:363` | Already fixed — explicit string on both ternary branches. Correct. |
| `strokeColor` / `fillColor` | `AreaSweepScreen.tsx:372-374`, `:378` | Safe. All resolve to literals in `theme.ts:8-43` (`success #16A34A`, `border #E2E8F0`, `primary #2563EB`). |
| `radius`, `strokeWidth` | `:371`, `:374`, `:378` | Numeric literals / `ARRIVE_M`. Safe. |
| `title`, `description` | `:350-351` | `@Nullable String` setters, no unboxing (`MarkerManager.java:182`, `:194`). Safe even if a document has no `name`. |
| *(no `pinColor`)* | `PinShopScreen.tsx:98-106` | **Safe — leave it alone.** Do not "harden" it by adding `pinColor={undefined}`; that would *create* the crash. |
| `coordinate` / `initialRegion` | `AreaSweepScreen.tsx:335-338`, `:349`, `:370`; `PinShopScreen.tsx:92`, `:100` | **The remaining exposure.** These are `@Nullable ReadableMap` — no unboxing — but the native side reads their *contents* with `getDouble`, which throws on a null/missing key. See §2. |

**Systematic guard, not a per-instance one:** no expression handed to a native map component may be able to evaluate to `undefined`, and every lat/lng that originated in Firestore must pass a validator before it reaches one. §2 gives that validator.

---

## P0 — Location is dead on the phones in the field

These four are one chain. Fixing any one of them alone leaves the system broken; ship them together.

### 1. `ensurePermission()` requests `ACCESS_FINE_LOCATION` alone — Android 12+ silently ignores it, so no dialog ever appears
**`src/lib/location.ts:73-75`** · severity: **blocker, every fresh install**

`android/build.gradle:6` sets `targetSdkVersion = 36`. On targetSdk ≥ 31 the framework refuses a runtime request for FINE that does not also carry COARSE: no dialog, callback returns denied, logcat prints `ACCESS_FINE_LOCATION must be requested with ACCESS_COARSE_LOCATION`. RN's `PermissionsModule` then evaluates `shouldShowRequestPermissionRationale`, which is **false** on a phone that has never been prompted, and resolves `never_ask_again`. Line 89's `check(ACCESS_COARSE_LOCATION)` is false (nothing was granted), so control reaches line 95 and throws *"Location is blocked for this app. Turn it on in Settings…"*.

A booker on a fresh install is told his location is blocked by an app that never asked him anything, and the sentence repeats forever. Every consumer dies with it: `PinShopScreen.tsx:47`, `AreaSweepScreen.tsx:113`, `location.ts:197`.

`AndroidManifest.xml:16-17` already declares both permissions, so no manifest change is needed.

**Trigger:** fresh install of v2.7 on any Android 12+ phone. Shops → a shop → "Save location".

**Fix** — request both in one call, and return the granularity the rest of the file needs (§2 depends on this):

```ts
async function ensurePermission(): Promise<'fine' | 'coarse'> {
  if (Platform.OS !== 'android') return 'fine';
  const P = PermissionsAndroid.PERMISSIONS;
  const R = PermissionsAndroid.RESULTS;
  // targetSdk 36: a FINE-only runtime request is IGNORED by the framework — no
  // dialog, denied callback, logcat "ACCESS_FINE_LOCATION must be requested
  // with ACCESS_COARSE_LOCATION". Both go in ONE call or neither appears.
  const res = await PermissionsAndroid.requestMultiple([
    P.ACCESS_FINE_LOCATION,
    P.ACCESS_COARSE_LOCATION,
  ]);
  if (res[P.ACCESS_FINE_LOCATION] === R.GRANTED) return 'fine';
  if (res[P.ACCESS_COARSE_LOCATION] === R.GRANTED) return 'coarse';
  // "Use precise location" can be switched off in Settings long after the
  // grant, and the request result does not describe that. check() is the authority.
  if (await PermissionsAndroid.check(P.ACCESS_FINE_LOCATION)) return 'fine';
  if (await PermissionsAndroid.check(P.ACCESS_COARSE_LOCATION)) return 'coarse';
  const blocked =
    res[P.ACCESS_FINE_LOCATION] === R.NEVER_ASK_AGAIN &&
    res[P.ACCESS_COARSE_LOCATION] === R.NEVER_ASK_AGAIN;
  throw new GeoError(
    blocked
      ? 'Location is blocked for this app. Turn it on in Settings → Apps → SnD Manager → Permissions → Location, then try again.'
      : 'Location permission is needed to save where this shop is.',
    'permission',
  );
}
```

`requestMultiple` does not re-prompt anyone who already granted — `PermissionsModule` checks `checkSelfPermission` first and resolves those immediately.

---

### 2. An "Approximate" grant can never produce a fix, and the app blames the user's location switch
**`src/lib/location.ts:113-122`, `:165-168`** · severity: **blocker for coarse-only phones**

`ensurePermission` deliberately lets a COARSE-only grant through (`:89-92`), then `getCurrentFix` immediately calls `once(true, …)` — `enableHighAccuracy: true`. `AndroidLocationManager.getValidProvider(highAccuracy=true)` picks `GPS_PROVIDER`, finds it enabled so it does *not* flip to NETWORK, checks `ACCESS_FINE_LOCATION`, finds it missing, and returns null → `POSITION_UNAVAILABLE` (code 2), **not** a timeout. `once()` maps code 2 to *"Location is switched off on this phone"* — flatly false — and the retry at **`:120` only fires on `kind === 'timeout'`**, so the coarse pass this entire file was rewritten to add never runs for the exact user it was written for.

**Trigger:** any phone where "Approximate" was tapped (or precise was later switched off in Settings), Location on, GPS on. Instant wrong error, every time. Perverse corollary: turning GPS *off* makes it work, because `getValidProvider(true)` then flips to NETWORK.

**Fix** — stop asking for precision you do not hold, widen the retry, and stop lying:

```ts
export async function getCurrentFix(): Promise<GeoFix> {
  configure();
  const level = await ensurePermission();
  // A coarse-only grant makes enableHighAccuracy:true a guaranteed refusal:
  // getValidProvider picks GPS, fails its FINE check, and returns
  // POSITION_UNAVAILABLE — never a timeout, so the retry below could never fire.
  if (level === 'coarse') return once(false, PRECISE_TIMEOUT_MS + COARSE_TIMEOUT_MS);
  try {
    return await once(true, PRECISE_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof GeoError && (e.kind === 'timeout' || e.kind === 'unavailable')) {
      return once(false, COARSE_TIMEOUT_MS);
    }
    throw e;
  }
}
```

and at `:165-168` — code 2 means "no provider I am allowed to use", which is not the same claim:

```ts
reject(new GeoError(
  'This phone could not give a location. Check Location is switched on in the quick settings, then try again.',
  'unavailable',
));
```

Same root cause at **`location.ts:214`**: `watchFix` also passes `enableHighAccuracy: true` unconditionally. Pass `level === 'fine'` there too, or a coarse-only phone gets a watch that never registers a listener.

---

### 3. Denying the prompt immediately re-prompts, which can permanently kill the permission in one interaction
**`src/features/shops/AreaSweepScreen.tsx:127` → `:138-147` → `src/lib/location.ts:197`** · severity: **blocker, self-inflicted and permanent**

`begin()`'s catch still calls `setAreaName(name)` at `:127` (deliberate — open the round anyway). That changes the `useFocusEffect` dependency at `:146`, which starts `watchFix`, which calls `ensurePermission()` unconditionally at `location.ts:197`, which opens with a bare `PermissionsAndroid.request(...)` with no `check` first. So the refusal is followed by a second system dialog **within the same second**. On Android 11+ two denials in a row move the permission into "don't ask again" — a single Deny plus the reflexive second Deny permanently ends location for the app. It also means the dialog appears on every focus of the Map tab for anyone who has not granted it.

**Fix** — split check from request, and never request from the watch:

```ts
export async function hasPermission(): Promise<'fine' | 'coarse' | null> {
  if (Platform.OS !== 'android') return 'fine';
  const P = PermissionsAndroid.PERMISSIONS;
  if (await PermissionsAndroid.check(P.ACCESS_FINE_LOCATION)) return 'fine';
  if (await PermissionsAndroid.check(P.ACCESS_COARSE_LOCATION)) return 'coarse';
  return null;
}
```

In `watchFix`, replace `ensurePermission()` at `:197` with `hasPermission()` and fail via `onError` when it returns null. Only the explicit button press (`getCurrentFix`) may ever request. Do **not** take the alternative of skipping `setAreaName` on a permission error — that throws away the deliberate open-the-round-anyway behaviour documented at `AreaSweepScreen.tsx:123-124`.

---

### 4. The sweep screen renders location errors nowhere — every failure is a silent "Waiting for your location…" forever
**`src/features/shops/AreaSweepScreen.tsx:259`** · severity: **blocker for diagnosis; makes 1-3 invisible**

`:259` is the *only* place `error` is drawn, and it sits inside the `if (!areaName)` round-picker branch that returns at `:255-291`. `begin()`'s catch sets the error at `:122` and then sets `areaName` at `:127` **in the same tick**, switching the component to the sweep JSX at `:303-515`, where `error` is never referenced. `watchFix`'s `onError` at `:143` sets into the same void.

Net: on any permission failure the round opens, the header reads "Waiting for your location…" (`:317`) permanently, and nothing says why. Every actionable sentence `location.ts` carefully writes is thrown away here.

**Fix** — render it in the sweep header, after the guide `<Text>` at `:321` (`styles.errorLine` already exists at `:525`):

```tsx
{error ? <Text style={styles.errorLine}>{error}</Text> : null}
```

and clear it *conditionally* on the next good fix at `:142`, so a healthy phone is not writing state on every GPS tick:

```tsx
fix => { setHere(fix); setHereAt(Date.now()); setError(prev => (prev ? null : prev)); },
```

Also give `watchFix` a real error callback (`location.ts:209-212`) — code 3 (TIMEOUT) is the awning case and must stay quiet, but codes 1 and 2 mean the watch is **dead, not delayed**: `AndroidLocationManager.startObserving` emits `POSITION_UNAVAILABLE` and returns *without ever calling `requestLocationUpdates`*, so no fix will ever arrive and today nothing is said:

```ts
err => {
  if (err.code === 3) return;                       // dropped fix — staleness line covers it
  if (id !== null) { Geolocation.clearWatch(id); id = null; }
  if (!onError) return;
  onError(err.code === 1
    ? new GeoError('Location permission was turned off. Turn it back on to keep the round guiding you.', 'permission')
    : new GeoError('This phone stopped giving a location. Check Location is on in the quick settings, then press "Re-order from where I am now".', 'unavailable'));
},
```

Clearing the watch matters — otherwise the dead `watchID` leaves `stopObserving` bookkeeping out of step and the screen cannot re-arm.

---

## P1 — The crash surface

### 5. Nothing validates `ShopLocation.lat/lng` — one half-written document is five native crash sites, and one of them is uncatchable
**`AreaSweepScreen.tsx:181`, `:335-338`, `:349`, `:370`, `:296-301`; `PinShopScreen.tsx:63`, `:92`, `:100`** · severity: **crash (hardening — no in-app path produces it)**

Every gate is truthiness-only: `geo.ts:81` (`!!i.location`), `AreaSweepScreen.tsx:103, 164-168, 227, 295-301, 368`. `firestoreStore.tsx:357` spreads the raw doc through `...(data as unknown as Omit<Shop,'id'>)` with no shape check, and `firestore.rules` validates affected *keys*, never the shape of `location`.

A document with `location: {lat: null}` therefore reaches native. Four of the five sites throw a catchable JS/native error; **one does not**:

```java
// fabric/MapViewManager.java:537-553
public void animateToRegion(MapView view, String regionJSON, int duration) {
    try {
        JSONObject region = new JSONObject(regionJSON);
        double lng = region.getDouble("longitude");   // throws on null/missing
        ...
    } catch (JSONException e) {
        throw new RuntimeException(e);                // uncatchable
    }
}
```

`createFabricMap.tsx:125-141` `JSON.stringify`s the region on the way in, so `undefined` keys vanish and `NaN` serialises to `null` — both make `getDouble` throw. `AreaSweepScreen.tsx:177-185` fires this within 600 ms of opening the round because `followMe` defaults to true. The bad document is still there, so it fires again on every reopen of the Map tab.

Before it crashes it also lies quietly: `distanceM` returns NaN, so `orderByNearest` (`geo.ts:88`) never picks that shop and leaves it where it sat; `formatDistance` returns `''`; `bearingLabel` indexes `points[NaN]` and the guide line at `:320` prints "head undefined"; and the picker at `:103` counts the shop as pinned, so the card claims "Every shop here is on the map".

**Fix — one predicate, applied at the choke points.** In `src/lib/geo.ts`, next to `Placed` (`:59-62`):

```ts
export function isPlaced<T extends Placed>(s: T): s is T & { location: ShopLocation } {
  const l = s.location;
  return !!l && Number.isFinite(l.lat) && Number.isFinite(l.lng)
    && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180;
}
```

- `geo.ts:81` — use it in place of `!!i.location`. This is the choke point that decides what becomes a stop at all, so it removes the bad shop from `orderedIds` and therefore from `mapStops`, `Circle`, `Polyline` and `next` in one move.
- `AreaSweepScreen.tsx:103` — the `pinned` count in the picker must use the same predicate, or the picker keeps claiming "Every shop here is on the map" while the round drops the shop.
- `AreaSweepScreen.tsx:125, 164-168, 295-301, 368` — same.
- `AreaSweepScreen.tsx:178-180` — guard the animate *target*, not the shop (`here` is a `GeoFix`, not a `ShopLocation`), and early-return rather than throw:
  ```tsx
  if (!target || !Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return;
  ```
- `PinShopScreen.tsx:35-36, 60` — see finding 9; seed state only from a *valid* `existing`.
- `ShopPlace.tsx:72-73` — `selected={!isPlaced(shop)}` / label `'Save location'` for a broken pin, so the chip routes the rider to the repair screen instead of showing "Move pin" for a pin that cannot be shown.

A shop with an unusable pin then falls into the existing "Not on the map" list, which is exactly where it belongs.

---

## P2 — Wrong numbers on the biggest line on the screen

### 6. `dayKey` is recomputed every render, so a round open at midnight writes its progress into tomorrow's key
**`AreaSweepScreen.tsx:82`, `:200-202`** · severity: **wrong data, silent, loses a day of stops**

`const dayKey = todayKey();` is a bare render-time call (`models.ts:326-329` reads `new Date()`), and the persist effect at `:200-202` lists it in its deps. The GPS watch re-renders this screen every few seconds, so the first render after 00:00 changes the string and immediately fires `saveDone(areaName, <tomorrow>, done)` with the whole completed set. `done` is never cleared on a day boundary. The next evening `begin()` calls `loadDone(name, dayKey)` (`:118`/`:126`) and gets last night's finished round straight back — the round opens pre-greyed or goes straight to the "<area> covered" EmptyState at `:486-492`, and those shops silently vanish from the rider's day. That is precisely what `sweepProgress.ts:9-10` says the day key exists to prevent. `restart` (`:248`) then clears only one of the two keys.

**Fix** — make the day part of the *round*, not of the clock:

```tsx
const [round, setRound] = React.useState<{ area: string; day: string } | null>(null);
// in begin(), first line:
const day = todayKey();
// success path (:117-120) and catch path (:125-127): setRound({ area: name, day });
// loadDone(name, day) in BOTH branches
// persist effect: if (round) saveDone(round.area, round.day, done);   deps [round, done]
// restart: clearDone(round.area, round.day)
```

Delete the render-time `dayKey` entirely and drop it from `begin`'s dep array at `:131`, so nothing can reach for the clock mid-round.

**Reject** the one-line alternatives. `React.useState(todayKey)` and `useMemo(() => todayKey(), [areaName])` both swap this bug for its mirror image: `AreaSweepScreen` is a tab screen that stays mounted for the life of the app, so a phone left running overnight would carry yesterday's key into today's first `begin()` — the same harm, one day later.

---

### 7. A failed GPS re-read replaces the nearest-first route with Firestore document order
**`AreaSweepScreen.tsx:125`** · severity: **wrong data, and silent (see finding 4)**

`begin()`'s catch does `setOrderedIds(store.shops.filter(...).map(s => s.id))` — a raw snapshot-order filter with **no `orderByNearest`**. The footer button at `:501` calls the same `begin(areaName)` *mid-round*, so a 22 s indoor timeout (12 s precise + 10 s coarse) silently reshuffles the entire remaining round into document order and names a "next" shop that may be 3 km away. The comment at `:123-124` justifies *opening* a round unordered when there is no GPS; it does not cover destroying an order that already exists, and the code makes no distinction between the two callers.

**Fix** — a failed re-order keeps the order the round already has. Use a functional update so nothing is stale-captured (`begin`'s deps are `[store.shops, dayKey]`); `prev` is null exactly when a genuinely new round is opening, because "Pick another round" nulls `orderedIds` at `:510`:

```tsx
} catch (e) {
  setError(e instanceof GeoError ? e.message : 'Could not read this phone’s location.');
  // A FAILED re-order keeps the order this round already has. Replacing a frozen
  // nearest-first route with Firestore document order is worse than not re-ordering.
  setOrderedIds(prev => prev ?? store.shops
    .filter(s => s.active && s.area === name && isPlaced(s)).map(s => s.id));
  setDone(loadDone(name, day)); setRound({ area: name, day });
}
```

This is only visible to the rider once finding 4 renders `error` in the sweep view. Ship them together.

---

### 8. The arrival gate ignores GPS accuracy, and the staleness warning can essentially never render
**`AreaSweepScreen.tsx:171`, `:173`, `:318-320`** · severity: **wrong data, on the one line read at arm's length**

Two defects on the same three lines; several lenses found them separately.

**(a) `arrived` is distance-only.** `here.accuracyM` is read nowhere on this screen (grep for `accuracy` returns nothing), although the app already carries the honest number (`location.ts:146`, `geo.ts:26`, `geo.ts:99-102`). When `getCurrentFix` falls back to the coarse pass (`location.ts:120`), the phone can report a position 300 m out. If that phantom lands within 40 m of the pin, the header flips to `successSoft` (`:307`), the guide prints "You are here — 0 m away" (`:319`), the button goes green (`:407-409`), and the ring at `:371` presents the *arrival slack* as if it were the position uncertainty. The rider is told he has arrived at a shop two streets away.

**(b) `stale` is a render-time `Date.now()` comparison with no clock behind it.** The only `setInterval` in `src/` is `auth.ts:272` (token refresh, does not touch this screen). The re-render sources are the watch callback (`:142` — which sets `hereAt` to now, making `stale` false by construction), Firestore snapshots, and touches. Under a market awning all three stop together, so the flag is structurally unable to fire in the only situation it was written for. And the suffix at `:320` sits **inside the not-arrived branch only** — the arrived branch at `:319` carries no staleness text at all, so the single most dangerous state (green "you have arrived", computed from a ten-minute-old fix) is silent by design.

**Fix (a)** — derive the gate from the constant the screen already stands behind. An uncertainty wider than the arrival ring cannot support the claim "you are here":

```tsx
const acc = here && Number.isFinite(here.accuracyM) ? here.accuracyM : 0;
const arrived = toNext !== null && acc <= ARRIVE_M && toNext <= ARRIVE_M;
```

Keep NaN permissive — `location.ts:143-146` makes NaN mean "this handset will not say", and refusing to ever arrive on those phones would be worse than the bug. Append `formatAccuracy(acc)` to the guide line when `acc > POOR_ACCURACY_M` so the rider can see *why* the button is not going green.

**Fix (b)** — tick from a clock, inside the **same** `useFocusEffect` as the watch (`:138-147`) so it dies on blur; a standalone effect keyed on `[areaName]` keeps re-rendering a native MapView while the rider is on another tab, which is the exact battery cost the comment at `:133-137` refuses for the sensor:

```tsx
const [, setTick] = React.useState(0);
// inside the existing focus callback, after `const stop = watchFix(...)`:
const t = setInterval(() => setTick(n => n + 1), 15000);
return () => { stop(); clearInterval(t); };
```

Raise the threshold at `:173` from 30 s to **120 s** and move the suffix out of the ternary so it appends to *both* branches. 30 s is wrong because `distanceFilter: 5` (`location.ts:215`) means a rider standing still at a counter receives no callbacks at all — his fix is perfectly good and `hereAt` stops advancing within half a minute of arriving.

**Reject** two things suggested in passing: do **not** gate `arrived` on `stale` (it would flip the header out of green and change the CTA exactly while the rider stands at the door), and do **not** blank the distance to "Waiting for a fresh location…" (same reason). Show the age, keep the number. Leave the `Circle` at `radius={ARRIVE_M}` — a 500 m ring would swallow the map and every other pin on it, and the comment at `:366-367` is explicit that the ring's job is to draw the slack the gate allows.

---

### 9. Re-pinning never reads the phone, shows a months-old accuracy as a live reading, and Save launders the pin as freshly verified
**`PinShopScreen.tsx:36`, `:60`, `:67`, `:135-141`, `:75`** · severity: **wrong data on a permanent record**

`useState(!existing)` plus `if (!existing) void locate();` mean that when the screen is opened to **correct** a pin — every "Move pin" entry point: `RiderScreens.tsx:92` and `BookerScreens.tsx:290`, both `existing={pinningShop.location ?? null}` — the GPS is never read. `poor` (`:67`) is computed from the **stored** `accuracyM` and `:140` renders, in the present tense, *"Good fix (±8 m). Drag the pin if it is off the door."* — a sentence about a reading somebody else took months ago somewhere else.

Press Save without dragging and `save()` passes `existing` straight through to `firestoreStore.tsx:1212-1216`, which writes `{ ...fix, savedAt: Date.now(), savedBy: user.uid }`. The pin has not moved, but it now reads as just-verified by this person today — and `models.ts:79-84` says `savedAt` exists precisely so the owner can see how old a pin is. The rider who opened this screen *because* the pin was wrong is shown a screen telling him it is right, and then quietly resets the only staleness signal the owner has.

**Fix** — track provenance rather than forcing a read. Do **not** simply drop the `!existing` guard: `existing` is documented at `:30` as the starting camera, and auto-jumping the pin to a fresh coarse fix is how a good hand-placed pin gets destroyed by someone who only came to look.

```tsx
const usable = isPlaced({ location: existing as ShopLocation | undefined }); // §5 predicate
const [fix, setFix]         = React.useState<GeoFix | null>(usable ? existing! : null);
const [locating, setLocating] = React.useState(!usable);
const [fresh, setFresh]     = React.useState(!usable);   // this screen measured it
// :48, in locate()'s success path:  setFresh(true);
// :60:  if (!usable) void locate();
```

Panel text at `:135-141`, branching on provenance first:

```tsx
{moved
  ? 'Pin moved by hand — it will be saved exactly where you put it.'
  : !fresh
    ? `Saved earlier (${formatAccuracy(fix.accuracyM)}). Press "Read location again" to check it from where you are standing.`
    : poor
      ? `Weak fix (${formatAccuracy(fix.accuracyM)}). Step outside and read again, or drag the pin onto the shop.`
      : `Good fix (${formatAccuracy(fix.accuracyM)}). Drag the pin if it is off the door.`}
```

And stop the false re-stamp at the write, not just the label — in `save()` (`:69-76`):

```tsx
if (!moved && !fresh) { onCancel(); return; }   // nothing was measured; do not re-stamp
```

Also relabel the primary button to "Keep this spot" while `!fresh && !moved`, so someone who genuinely wants to nudge the pin is not told he is saving a new reading. Note `usable` also closes the §5 crash on this screen — a broken stored pin drops through to a fresh GPS read instead of being handed to `initialRegion` and `Marker.coordinate`.

---

### 10. A photo upload that resolves after "Save shop" attaches the previous shop's shopfront to the next one
**`ShopPlace.tsx:36`** · severity: **wrong data on a permanent record**

`useShopPhoto`'s async IIFE calls `onUrl(url)` with no generation or mounted check. In the new-shop form `onPhotoUrl` is `setNewPhotoUrl` (`BookerScreens.tsx:611`) — state on the **parent**, which stays mounted when `saveShop` closes the card. `saveShop` (`BookerScreens.tsx:340-354`) never consults `capturing`: it reads `newPhotoUrl` (still null), calls `addShop` with `photoUrl: undefined`, and resets the form. The upload then resolves and sets `newPhotoUrl` to shop A's CDN URL. The next "Add shop" renders "✓ Photo added" and shop B is created carrying shop A's shopfront, with nothing downstream able to tell.

The window is real: `capturePhotoBase64` returns as soon as the camera closes; the Cloud-Function-backed upload runs after it, visible as the "Saving photo…" chip while "Save shop" stays enabled.

The existing-shop path is **not** affected — `onPhotoUrl={url => store.setShopPhoto(shop.id, url)}` (`BookerScreens.tsx:414`) closes over the right id, so a late resolve there is correct behaviour.

**Fix** — a generation ref in `useShopPhoto`:

```tsx
export function useShopPhoto() {
  const [capturing, setCapturing] = React.useState(false);
  const gen = React.useRef(0);
  React.useEffect(() => () => { gen.current++; }, []);      // unmount invalidates
  const reset = React.useCallback(() => { gen.current++; }, []);
  const capture = React.useCallback((onUrl: (url: string) => void) => {
    if (capturing) return;
    setCapturing(true);
    const mine = gen.current;
    void (async () => {
      try {
        const base64 = await capturePhotoBase64();
        if (base64 === null) return;
        const url = await uploadPhotoBase64(base64, 'shop');
        if (gen.current === mine) onUrl(url);               // the form that asked
      } catch (e) {
        if (gen.current === mine) Alert.alert('Photo not saved', ...);
      } finally { setCapturing(false); }
    })();
  }, [capturing]);
  return { capturing, capture, reset };
}
```

Guarding the Alert matters too — a failure belonging to an abandoned form should not pop over the next shop's screen. Note the "cheapest partial fix" of adding `|| capturing` to the Save button's `disabled` at `BookerScreens.tsx:620` is **not applicable as written**: `capturing` lives inside `useShopPhoto`, which `NewShopPlaceChips` instantiates itself (`ShopPlace.tsx:100`), so it is not in scope there.

---

### 11. "Done (N)" counts ids that are no longer stops
**`AreaSweepScreen.tsx:446`, `:448`, `:459-460`** · severity: minor, but two contradictory numbers on one screen

The label counts `done.size`; the cards below render `stops.filter(s => done.has(s.id))` (`:451`); the cap note tests `done.size` again — three different populations. `done` comes straight from MMKV (`sweepProgress.ts:16-25`) and is never intersected with `stops`, which drops anything inactive or missing (`:149-156`). Deactivating a shop mid-day is one tap (`ShopsScreen.tsx:210-213`) and lands through the live snapshot immediately, so the header says "Done (7)" above six cards while the progress figure at `:312` (correctly derived from `stops`) falls to 6.

**Fix** — derive once and use it for all four, including the section gate:

```tsx
const doneStops = React.useMemo(() => stops.filter(s => done.has(s.id)), [stops, done]);
// :446  {doneStops.length > 0 && (
// :448  {`Done (${doneStops.length})`}
// :451  doneStops.slice(-LIST_STOPS).reverse().map(...)
// :459  doneStops.length > LIST_STOPS   /   doneStops.length - LIST_STOPS
```

Leave the two `done.size` tests at `:503` alone — that button offers to clear the MMKV entry and should still appear when the only thing left in storage is orphan ids. **Reject** the suggestion to prune `done` of ids missing from `stops` inside the persist effect: `stops` resolves against `store.shops`, which is empty on the first render before the snapshot lands and empties again on a listener error, so a prune would write an empty set over the day's real progress at exactly the moment the app is least sure of itself.

---

## P3 — UX and frame rate

### 12. "Read location again" moves the marker but never moves the camera
**`PinShopScreen.tsx:92`** · severity: ux, defeats the screen's stated purpose

The MapView has `initialRegion` and nothing else — no `ref`, no `region` prop, no `animateToRegion` anywhere in the file. The native side latches it: `MapView.java:816-824` guards on `if (!initialRegionSet && map != null)` and sets the flag, with a second latch at `:834-838`. Only the Marker's coordinate (`:100`) follows a new fix. `SPAN = 0.0012` is roughly a 130 m box, so a correction of more than ~65 m puts the only pin off-screen — and that is the **normal** case, because `location.ts:120` deliberately falls back to a coarse wifi/cell fix. The person sees a blank map, no pin, nothing explaining it, on the one screen whose header comment (`:4-9`) says it exists "to let someone SEE that the dot landed on the right door". A pin off the viewport is also a pin he cannot drag.

**Fix** — one-shot recentre on an explicit read only, never on drag:

```tsx
const mapRef = React.useRef<MapView | null>(null);
const pending = React.useRef<GeoFix | null>(null);
const centre = (f: GeoFix) => {
  if (!mapRef.current) { pending.current = f; return; }
  try {
    mapRef.current.animateToRegion(
      { latitude: f.lat, longitude: f.lng, latitudeDelta: SPAN, longitudeDelta: SPAN }, 400);
  } catch {}   // handle not ready yet — must not surface as a GPS error
};
```

`ref={mapRef}` on `:89`, `onMapReady={() => { if (pending.current) { centre(pending.current); pending.current = null; } }}`, and call `centre(next)` **after** `setFix(next)` — placed *outside* `locate()`'s try block or wrapped as above. This matters: `createFabricMap.tsx:136-139` throws `'animateToRegion is only supported on iOS with Fabric.'` when the native handle is not attached, and inside the try at `:46-54` that would land in the catch and be reported to the rider as *"Could not read this phone's location"* — a GPS failure message for a camera problem.

**Reject** the controlled `region` prop as an alternative: `MapView.java:838-839` re-applies it on every prop change, and `fix` changes on drag-end, so it would recentre under the thumb — exactly what the comment at `:93-94` exists to prevent.

---

### 13. "Skip for now" marks the shop visited and inflates the progress counter
**`AreaSweepScreen.tsx:413`** · severity: ux, but it silently ends a rider's day early

The chip is wired to `markNext` — the identical handler as the "Mark visited — next shop" CTA three lines above — which calls `mark(next.id, true)` (`:217-223`). A skipped shutter enters `done`, is persisted to MMKV, counts in the `n/n` at `:312`, and renders struck through under "Done". It is indistinguishable from a shop that was served. "For now" promises a return that nothing implements; the only route back is an Undo chip in a list capped at 25 and ordered for the stop you just mis-tapped (`:449-450` says exactly that).

**Fix (minimal, one source of truth)** — rotate the stop to the back of the round instead of inventing a second persisted set:

```tsx
const skipNext = React.useCallback(() => {
  if (!next) return;
  const now = Date.now();
  if (now - lastMarkAt.current < 700) return;      // same latch as markNext
  lastMarkAt.current = now;
  setOrderedIds(prev => (prev ? [...prev.filter(id => id !== next.id), next.id] : prev));
}, [next]);
```

Bind `:413` to `skipNext`. The frozen-order comment at `:16-18` defends against GPS-driven re-planning, not against a stop the rider explicitly pushed to the back, so this does not violate it.

A separate `skipped` Set is worse unless it is **persisted alongside `done`** in `sweepProgress.ts` under the same area+day key — component-only state means the first unmount returns every skipped shutter to the front of the round while `done` survives, and the two halves of the round disagree. If neither change fits this release, the honest one-liner is to relabel the chip so it stops promising a return.

---

### 14. "Not on the map" is the one uncapped list on a screen whose entire design is hard caps
**`AreaSweepScreen.tsx:475`** · severity: ux/jank

`unpinned` (`:166-168`) is every active shop in the area with no pin, and `:475` maps **all** of them into a plain `ScrollView` that already holds up to 25 stop cards and 25 done cards. Every sibling list is capped — map at `:164` (`MAP_MARKERS`), "After that" at `:426`, Done at `:451` — and the header comment at `:49-66` states the policy in the words of a field report. This is the one list that escaped it, and it is longest in exactly the state the caps exist for: a freshly imported area where nothing is pinned yet, which the picker actively invites with "Open anyway" at `:274`.

`unpinned` is also computed unmemoized in the render body, so the whole block is re-reconciled on every GPS callback.

**Fix:**

```tsx
const unpinned = React.useMemo(
  () => (round ? store.shops.filter(s => s.active && s.area === round.area && !isPlaced(s)) : []),
  [round, store.shops],
);
// :475
{unpinned.slice(0, LIST_STOPS).map(...)}
// AFTER the closing </View> of styles.rowWrap — not inside it, or it becomes a flex child:
{unpinned.length > LIST_STOPS && (
  <Text style={styles.capNote}>
    {`+ ${unpinned.length - LIST_STOPS} more not on the map. Save a location at any of them and it joins the round.`}
  </Text>
)}
```

`styles.capNote` already exists at `:540` and the `SectionLabel` at `:467` already prints the true total, so nothing is hidden. **Calibration:** these are three cheap views per shop (`View` + icon `Text` + `Text`), not the native `<Marker>` per shop that caused the documented freeze — this is jank and memory, not the Map-tab lockup. Fix it for consistency with the file's own stated invariant, not because it is the freeze.

---

### 15. `stops` does a linear `Array.find` per ordered id
**`AreaSweepScreen.tsx:154`** · severity: minor

`orderedIds.map(id => store.shops.find(s => s.id === id))` scans the whole company shop array once per stop, inside a memo whose deps include `store.shops` — rebuilt on every shops snapshot (`firestoreStore.tsx:347-365`), i.e. whenever any colleague writes any shop document. A 150-stop round against 3,000 shops is ~450k comparisons per unrelated write. On Hermes that is single-digit milliseconds, not the freeze — but it lands on the frame budget of a screen animating a map camera while the rider is moving, and it scales with company size without bound. The memo has to re-run regardless, so the index is strictly cheaper:

```tsx
const byId = new Map(store.shops.map(s => [s.id, s]));
return orderedIds.map(id => byId.get(id)).filter((s): s is Shop => !!s && s.active);
```

---

## Not worth fixing

- **MMKV growth in `sweepProgress.ts:14`.** One key per (day × area), never pruned. Real, but a booker works one to three areas a day and a 60-shop round serialises to ~1.4 KB, so the honest figure is a few hundred KB a year of small keys that MMKV parses in single-digit milliseconds. The "cold start gets progressively slower on a 3GB handset" story is not supportable at that size. Adding a `getAllKeys()` walk buys a real risk of deleting a live round's key (the midnight case in finding 6) for no measurable win. **Leave it.**
- **Cancelling the in-flight fix in `PinShopScreen.locate()` (`:43-55`).** Backing out during a read leaves `requestLocationUpdates(provider, 100ms, 1m, …)` running for the remainder of its 22 s budget, and `getCurrentFix`'s catch will *start a second native request after the component is gone*. But the library exposes no cancel for `getCurrentPosition`, so an `AbortSignal` would only settle the JS promise early — the chip stays hot either way. Actually releasing it means re-implementing the fix on `watchPosition` + `clearWatch`. The setState-after-unmount calls are React 18 no-ops. If you want the cheap half, have the aborted path skip the coarse retry (that 10 s is purely wasted) — but this is the lowest-value item on the list and does not justify a rewrite of `once()`.
- **Adding `pinColor` to `PinShopScreen.tsx:98-106`.** The prop is omitted, which is safe; passing it as a possibly-undefined expression is what crashes. Do not "harden" this.
- **Gating `arrived` on `stale`** (finding 8) and **blanking the distance when stale** — both fire on every successful arrival because of `distanceFilter: 5`. Rejected above.
- **Pruning `done` of ids missing from `stops`** (finding 11) — data-loss risk during the pre-snapshot window. Rejected above.
- **A controlled `region` prop on `PinShopScreen`** (finding 12) — fights the drag. Rejected above.
- **Doubling the cap note and the SectionLabel total** — `:467` already prints the true count; ship one or the other, not both.

---

## Ordered action list

**Commit 1 — "Location works on Android 12+" (ship first, alone, and test on a real Xiaomi with a fresh install)**
1. `location.ts:71-102` — `ensurePermission` → `requestMultiple([FINE, COARSE])`, return `'fine' | 'coarse'`. *(finding 1)*
2. `location.ts:111-123` — `getCurrentFix` uses the granularity; widen the retry to `timeout || unavailable`. *(finding 2)*
3. `location.ts:165-168` — stop claiming "Location is switched off" for `POSITION_UNAVAILABLE`. *(finding 2)*
4. `location.ts:197, 214` — add `hasPermission()`; `watchFix` **checks only**, never requests, and passes `precise = level === 'fine'`. *(findings 2, 3)*
5. `location.ts:209-212` — forward codes 1 and 2 via `onError` and `clearWatch`; keep code 3 silent. *(finding 4)*
6. `AreaSweepScreen.tsx:321` — render `error` in the sweep header; clear it conditionally at `:142`. *(finding 4)*

**Commit 2 — "No coordinate reaches native unvalidated"**
7. `geo.ts` — add `isPlaced()`; use it at `geo.ts:81`. *(finding 5)*
8. `AreaSweepScreen.tsx:103, 125, 164-168, 178-180, 295-301, 368` and `PinShopScreen.tsx:35-36, 60`, `ShopPlace.tsx:72-73` — apply it. *(findings 5, 9)*

**Commit 3 — "The round does not lie about the day, the order, or the distance"**
9. `AreaSweepScreen.tsx:82, 118, 126, 200-202, 248` — round-scoped `{area, day}`, delete render-time `dayKey`. *(finding 6)*
10. `AreaSweepScreen.tsx:125` — failed re-order keeps the existing order. *(finding 7)*
11. `AreaSweepScreen.tsx:171` — `arrived` gates on accuracy. *(finding 8a)*
12. `AreaSweepScreen.tsx:138-147, 173, 318-320` — 15 s tick inside the focus effect, 120 s threshold, staleness suffix in **both** branches. *(finding 8b)*

**Commit 4 — "Pins say what they are"**
13. `PinShopScreen.tsx:36, 48, 60, 69-76, 135-141` — `fresh` provenance flag, honest panel text, no re-stamp when nothing was measured, "Keep this spot" label. *(finding 9)*
14. `PinShopScreen.tsx:46-54, 89` — `mapRef` + guarded one-shot `animateToRegion` on an explicit read. *(finding 12)*
15. `ShopPlace.tsx:26-48` — generation ref on `useShopPhoto`, guarding both `onUrl` and the Alert. *(finding 10)*

**Commit 5 — "Counts and caps"**
16. `AreaSweepScreen.tsx:413` — `skipNext` rotates instead of marking done. *(finding 13)*
17. `AreaSweepScreen.tsx:446-460` — single `doneStops` derivation for gate, label, list and cap note. *(finding 11)*
18. `AreaSweepScreen.tsx:166-168, 475` — memoize `unpinned`, cap at `LIST_STOPS`, cap note outside `rowWrap`. *(finding 14)*
19. `AreaSweepScreen.tsx:153-155` — `Map` index instead of `Array.find` per id. *(finding 15)*

Commits 1 and 2 are the release. Everything from 3 down can follow.