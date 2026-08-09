# Handoff — Round 8 and the UX pass

**Date:** 2026-08-09
**Branch state:** all work below is UNCOMMITTED in the working tree (`git status`).
**Baseline:** last commit is `dfd6b38` "Round 7: fix all 25 findings from the first crash scan".

Read this first, then `OPEN-BUGS.md` (now empty of open items) and `PROGRESS.md`.

---

## 1. Where things stand

| Check | Result |
|---|---|
| TypeScript | 0 errors |
| ESLint | 0 errors (72 warnings, all pre-existing house style: `no-void`, inline styles) |
| Unit tests | **35 passed / 35** (6 suites) |
| Debug build | `BUILD SUCCESSFUL`, installs and runs on Pixel 9 / API 35 emulator |
| Runtime | Clean start, no JS errors in logcat |
| Release AAB | **NOT rebuilt this session** — see §6 |

30 files changed, 3 new. Roughly +2,665 / −1,331 lines.

---

## 2. Round 8 — all 18 open bugs fixed

Every item in `OPEN-BUGS.md` is closed. The fix for each is commented in place at the
site, explaining what went wrong — search for the phrasing if you need the reasoning.

**P0**
1. **Dead PDF share** — `src/documents/share.ts` imported a *default* export from
   `react-native-html-to-pdf`, which only exports `generatePDF` as a *named* export, so
   all four share buttons threw `TypeError` forever. Fixed the import, and **deleted
   `src/types/react-native-html-to-pdf.d.ts`** — that hand-written declaration was what
   hid the bug from the type checker. The package ships its own types. Three of the four
   call sites swallowed the error with `.catch(() => {})`; they now surface it.

**P1 — crash / money**

2. **Employees screen crash** — `ROLE_LABELS[emp.role].toUpperCase()` with no fallback.
   Fixed in three places: a render fallback, a listener filter that drops role-less
   rows (`isUsableEmployee` in `firestoreStore.tsx`), and `functions/index.js` now
   writes the *whole* mirror row instead of a bare `{joined:true}` merge that created
   the malformed doc. Also added **`src/components/ErrorBoundary.tsx`** at the app root
   so no single bad document can ever brick the app to the launcher again.
3. **Two admins double-subtracted exception cash** — `confirmHandover` split: plain
   confirmations stay batched (idempotent), exception cash now goes through
   `applyExceptionCash`, a `runTransaction` that re-reads the payment and no-ops if
   another admin already confirmed it, and re-runs FIFO on *server* balances.
4. **Removing staff stranded their cash** — `removeEmployee` now closes their open day
   docs (Admin SDK, `db.getAll` on today+yesterday, existing docs only), and the Action
   screen builds cards from *any* staff id holding unconfirmed payments (`stranded`).
5. **Bill PDF overstated the khata** — the balance is now snapshotted *before* the write
   and carried through `setResult`, instead of being re-read on the success screen after
   latency compensation had already applied the new bill.
6. **`lastVisitAt` read back as 0** — the shops listener now uses
   `d.data({ serverTimestamps: 'estimate' })`.
7. **Rider's "N of M done" counted down** — `done` now counts by `deliveredAt >=` the
   working day's start, not by due date. The orders listener also uses `'estimate'` so
   `deliveredAt` is readable immediately.

**P2 — session / UX**

8, 9, 10, 11 all live in `src/app/auth.ts`, which was substantially rewritten:
   `restoreSession` returns the cached session immediately and refreshes in the
   **background** (was: up to 70 s of blank spinner); the session is persisted to disk
   so an **offline morning start works**; `refreshAdmission` builds the session from the
   callable's authoritative response so **role changes take effect**; and new
   `subscribeAuthPresence` / `startAccessWatch` (60 s forced token refresh) mean a
   **removed employee is dropped to Welcome within about a minute** instead of freezing.
12. **Midnight rollover** — a working day is now open until it is *handed over*, not
    until the calendar date flips (`openDayFor`). The days listener covers today AND
    yesterday. A rider still out at 00:05 keeps his route lock and his running total.
13. **Camera failure looked like cancel** — `capturePhotoBase64` now throws on a missing
    payload; only a real user cancel returns `null`.
14. **Sign-out had no guard** — now a destructive confirm, and it refuses with a count if
    writes are still queued offline (`pendingWrites` / `flushPendingWrites` on the store,
    backed by `waitForPendingWrites` and `metadata.hasPendingWrites`).
15. **Push dead on Android 13+** — RNFirebase's `requestPermission()` is a no-op on
    Android; now calls `PermissionsAndroid.request(POST_NOTIFICATIONS)` on API 33+.

---

## 3. Design pass — compact and sleek

`src/components/theme.ts` is the single source. The scale came down one step:

```
font   h1 22→20   h2 17→16   body 15→14   sub 13→12   tiny 11→10   stat 20→18
space  xs 4  s 8→6   m 12→10   l 16→14   xl 24→20
radius card 14→12  pill 26→22  tile 12→10  chip 18→16
```

Everything else follows from those tokens. On top of that, every screen was swept for
**text cropping** — the recurring bug was a `<Text>` sitting directly in a
`space-between` row with no `flex`, so a long shop or product name pushed the amount off
the card. The fix pattern used throughout is a `flex: 1, minWidth: 0` label beside a
`flexShrink: 0` value, with `numberOfLines` on the label. `ListRow`, `Tile`, `OptionBar`
and `PrimaryButton` now shrink or wrap rather than clip.

**Booking screen:** quantity is now **typed only**. The `1 / 6 / 12 / +1 / +6 / clear`
chips were removed deliberately — they nudged the booker toward those numbers and any
other count meant fighting the widget. **Do not re-add them.**

---

## 4. New behaviour added this session

- **`src/components/ErrorBoundary.tsx`** — app-root render-error boundary.
- **`src/lib/kv.ts`** — MMKV. **AsyncStorage has been removed entirely.** MMKV is
  synchronous, which also closed a real race: `nextLocalRef` used to `await` between
  reading and writing the offline serial counter, so two documents created back to back
  with no signal could take the same provisional reference.
- **`src/app/updates.ts`** — Google Play in-app updates (`sp-react-native-in-app-updates`).
  Checked on cold start. Only a **priority ≥ 4** release (set per release in the Play
  Console) interrupts with the immediate flow; anything lower downloads in the background
  and asks to restart. Every failure path is silent so it can never block a field worker.
  **Only works on a Play-installed build** — a sideloaded/emulator build always reports
  no update, so this cannot be smoke-tested locally.
- **Busy state everywhere.** `PrimaryButton` gained `busy` / `busyLabel` (spinner +
  press blocked). Every async action across every screen is now guarded with an
  `if (busy) return;` re-entrancy check and a `finally` that always restores. This was
  not cosmetic — real double-write bugs it closes: close-out billing a shop twice,
  `collect` writing two receipts, duplicate orders and duplicate committed stock,
  double reward payouts from the float, double khata corrections, and `voidPayment`
  restoring a balance twice (its own `if (p.voided) return` read *local* state).
  Fire-and-forget `void` store methods use a keyed latch (`useWriteGuard` in
  `AdminScreens.tsx`) since there is no promise to await.
- **KeyboardAvoidingView** on every screen with a `TextInput`, plus
  `keyboardShouldPersistTaps="handled"` so the first tap on a button registers.
- **Welcome screen reworked** — three routes now: *I work for a business*, *I own a
  business*, and *Create a new business* demoted to a link. The first two are the **same
  sign-in**; `admitSignIn` reads the employee directory and returns the role, so the app
  never needed to be told. They are worded separately only so each person recognises
  themselves. A returning person on a phone that has signed in before instead gets a
  single **"Continue as {name}"** button which uses `GoogleSignin.signInSilently()` —
  no account chooser at all — falling back to the interactive flow if the grant is gone.
  The hint is stored in MMKV under `snd.lastAccount`, survives sign-out, holds no
  credentials, and is cleared on `not_on_list` / `access_ended` / "Use a different account".

---

## 5. Things a new agent must know

- **Offline auto-sync already exists** and is not something to build. Firestore's native
  persistence is on by default (nothing sets `persistence: false`), writes queue on disk
  and sync when connectivity returns, and `serials.ts` issues provisional `LOCAL-…`
  references that are promoted at sync (FR-5.8).
- **Three native modules were added**, so a JS-only reload is not enough — the app must
  be rebuilt: `sp-react-native-in-app-updates`, `react-native-mmkv`, and their
  dependencies. **`react-native-device-info` and `react-native-nitro-modules` had to be
  added as *direct* dependencies**; autolinking does not pick them up transitively, and
  the symptoms are confusing (`NativeModule.RNDeviceInfo is null` at runtime, and
  `Project with path ':react-native-nitro-modules' could not be found` at build time).
- **The project moved** from `/Users/apple/testing/FieldSales` to its current path. Stale
  absolute paths in `android/app/.cxx` and `android/app/build` broke the Gradle
  configure step; deleting `android/build`, `android/app/build`, `android/app/.cxx` and
  `android/.gradle` fixed it. Do that first if you see a path error mentioning
  `/Users/apple/testing`.
- **`android/app/build.gradle` is bumped** to `versionCode 7` / `versionName "1.6"` and
  was already bumped before this session started.
- Two store implementations, one interface (`devStore` / `firestoreStore`). Any
  behaviour that differs between them is a bug — that is exactly how two production bugs
  hid until the field audit.

---

## 6. What is NOT done

1. **No commit.** Everything is in the working tree. Nothing has been committed or pushed.
2. **No release AAB.** Only `installDebug` was run. `./gradlew bundleRelease` still needs
   to be run and the output verified before any Play upload.
3. **The in-app update flow is untested end to end** — by nature it cannot be, until a
   build is live on Play. First real test: publish, then publish a second build and
   confirm the prompt appears.
4. **`Chip` has no `busy`/`disabled` prop.** A few chip-fired writes (record payment,
   CSV export) fall back to a label swap plus `onPress={undefined}`. If you want them to
   match the pill CTAs, give `Chip` the same treatment `PrimaryButton` got.
5. **The Play Console release runbook in `PROGRESS.md` §6 is still entirely open** — it
   needs the publisher account. The critical item is registering **all three** Play
   signing SHA-1 certificates in Firebase; skipping it makes Google Sign-In fail with
   `DEVELOPER_ERROR` for everyone who installs from Play, while working perfectly on
   sideloaded builds.
6. **Not re-audited.** Round 8 fixed what the previous scan found; nobody has run a fresh
   adversarial scan against the new code. The busy-state and auth rewrites are the
   largest new surfaces and would be the place to point one.

---

## 7. How to run it

```bash
cd /Volumes/Sohail/AI_Projects/testing/FieldSales
npx tsc --noEmit && npx eslint . && npm test
```

Emulator (AVD `Pixel9_API35_ARM`):

```bash
cd android && ./gradlew installDebug
```


Metro must be running (`npx react-native start`). The app is
`com.apptechsolutions.fieldsales/.MainActivity`. "See a demo first" on the Welcome screen
reaches every screen with sample data and no sign-in.

---

## 8. Round 9 — the Welcome screen's two refusals (2026-08-09, after the above)

An audit of the sign-in logic found the screen turned the right people away for
the right reason with the **wrong sentence**, and let one person through in silence.

1. **"I own a business" was a dead end for a real owner.** Both top buttons fire the
   same `admitSignIn` with no business name, so an owner who has not created the
   workspace yet got the employee refusal — *"Ask your owner to add exactly this
   address"* — with nothing but the demoted link they had already walked past. The two
   buttons now carry a `SignInIntent` (`'employee' | 'owner'`); a `not_on_list` after
   the owner button opens the create-business form with `strings.welcome.ownerNotOnList`
   above it instead of alerting. `creating` moved from `WelcomeScreen`'s own state up
   to `AuthGate`, because the screen cannot open that form on its own behalf.
   It is cleared on a successful sign-in — latched, it would ambush the next sign-out.
2. **An existing employee who tapped "Create a new business" was swallowed.**
   `dirSnap.exists` wins in the callable, so the typed name was dropped and they landed
   on their employer's home screen with no explanation. The callable now returns
   `status: 'already_in_business'` (with the company's real `businessName`) on that
   path only; they are still admitted — they *are* an employee — and
   `SignInResult.notice` carries the reason to a one-line alert.

**Not changed, deliberately:** a refused sign-in still leaves a Firebase Auth account
behind (`signInWithCredential` runs before admission). It holds no claims, every rule
keys on claims, and `employeeDirectory` is `allow read, write: if false`, so it grants
nothing — deleting a real user account on a refusal is the larger risk.

TypeScript 0 errors · ESLint 0 errors · 35/35 tests. **Not run on a device.**

---

## 9. Shop photos and locations — Phase 1 (2026-08-09)

The field wants two things recorded about the place itself: a photo of the shopfront,
and a GPS pin dropped while standing at the door. **Phase 2 — the guided shop-by-shop
area sweep — is not built.** It cannot usefully be: every shop in the database today has
no pin, so a route feature would have nothing to route. Phase 1 is what fills the map in.

### YOU MUST DO THIS BEFORE THE MAP WORKS

The map renders as a blank grey square until a Google Maps key is on the phone's build:

1. In Google Cloud console for **`saleforec-10ce7`**, enable **Maps SDK for Android**.
2. Create an API key, restrict it to Android apps, package
   `com.apptechsolutions.fieldsales`, with **both** SHA-1s (debug and the Play upload
   key — the same three-certificate trap as Google Sign-In, see §6.5).
3. Add one line to **`android/local.properties`** (git-ignored, never committed):
   ```
   MAPS_API_KEY=AIza...
   ```
4. Rebuild. A build with no key still compiles and runs — deliberately, since only the
   pin screen is affected — and Gradle prints a warning saying so.

**Cost: nothing.** The Maps SDK mobile-native SKU (`6DE1-4D9C-5B67`) is free and
unlimited. Nothing here calls a billed endpoint: the fix comes from the phone's own GPS,
distances are haversine computed on-device, and there is no Geocoding, Routes or
Distance Matrix call anywhere. Do not add reverse-geocoding ("show the pin's street
address") without deciding to start a bill — that one is $5 per 1,000 past 10,000/month.

### What was built

- **`src/lib/geo.ts`** — distance maths, no native import at all, so it is testable and
  Phase 2's ordering never drags the GPS chip in. 11 tests against real Lahore
  coordinates, including that it resolves the width of one bazaar street (~11 m), which
  is the accuracy the whole feature stands or falls on.
- **`src/lib/location.ts`** — the one-shot fix. Runtime `ACCESS_FINE_LOCATION` request
  (manifest alone is not enough — the trap that made push dead on Android 13+),
  20 s timeout, `maximumAge: 0` so a cached fix from the *last* shop can never be saved
  as this one's, and errors that name the fix: permission blocked vs location switched
  off vs no fix yet. A null accuracy from the device becomes `NaN`, never `0` — the
  worst fix a phone can give must not read as a perfect one.
- **`src/features/shops/PinShopScreen.tsx`** — full-screen map, draggable marker,
  accuracy shown and called weak past 30 m. **Saving never depends on the map loading**:
  the pin is the GPS fix, so a grey square on one bar costs the person only the ability
  to double-check. A dragged pin records accuracy as unknown rather than borrowing the
  number that described a spot they just said was wrong.
- **`src/features/shops/ShopPlace.tsx`** — one implementation of the photo/pin chips for
  all three call sites, rather than the same behaviour written three times and drifting.
- **Wired into:** the booker's add-shop form and route cards, the rider's stop cards
  (the rider is at more doors per day than anyone, so that is where the map gets filled
  in fastest), and the admin shop list — which shows `NO PIN` per shop and
  "*n* of *m* pinned" at the top, the feature's real progress bar.

### Deployed

`firestore.rules` is **released to production**. The rider previously could not write to
a shop doc at all beyond the collection-flag keys; there is now a separate `hasOnly`
clause for `['location', 'photoUrl']`. Separate on purpose — folding the two names into
the existing list would have let a pin write also carry a balance key. The change is
purely additive, so it was safe to release ahead of the app.

### Verified

TypeScript 0 errors · ESLint 0 errors (3 new warnings, all `no-void`, house style) ·
**46/46 tests** (35 + 11 new) · `./gradlew assembleDebug` **BUILD SUCCESSFUL** with both
new native modules autolinked · merged manifest confirmed to carry both location
permissions and the Maps key placeholder resolved.

**Not verified:** nothing has been run on a device or emulator. The camera, the GPS
prompt and the map itself are all things only a real phone can answer — and the map
specifically cannot show anything until step 3 above is done.

### Native modules — the app must be REBUILT

`react-native-maps` and `@react-native-community/geolocation` were added. A JS reload is
not enough. Both were confirmed to autolink (`npx react-native config`), so the
device-info trap from §5 did not repeat here.

---

## 10. Areas as a real list, and Phase 2 — the area sweep (2026-08-09)

### Areas are picked now, never typed

Area was a free-text box on every shop form, so each typo made a new place:
"Saddar", "saddar" and "Sadar " were three rounds where the owner meant one. That is
fatal to a route feature, which has to be able to say what "the area" IS.

- New **`companies/{c}/areas`** collection, `Area {id, name, active}` — read by everyone,
  **written only by the owner** (rules deployed). That split is the whole point:
  defining a round is an owner decision made once, filing a shop under one is a field
  decision made daily.
- New **`src/features/admin/AreasScreen.tsx`** at More → Areas: add, rename, retire,
  bring back. **Rename fans out to every shop under the old name** in one batch — shops
  store the area NAME, so without the fan-out a rename would orphan them all.
- **No migration was needed or done.** Shops keep storing the name, and orders keep their
  frozen `shopSnapshot.area`. Existing typed names appear on the Areas screen under
  *"Found on shops, not on this list"* with a one-tap import — offered rather than
  adopted silently, because some of those names are typos that should be merged, not
  enshrined.
- Every form now picks: booker add-shop, admin add-shop, admin shop editor, all via
  chips. The **wizard is the one place a name may still be typed**, because on first run
  there is nothing to pick from — and it registers what was typed as a real area on the
  way past.
- Pickers always include the shop's CURRENT area even if retired, or opening an old
  shop's editor and pressing Save would quietly move it out of its own round.

### Phase 2 — the sweep

New **Map** tab for booker and rider (`src/features/shops/AreaSweepScreen.tsx`):
pick a round → ordered stop list, nearest-first from where you are standing → map with
every pin and the remaining path → **Navigate** hands off to the Google Maps app →
Done/Skip advances → "Round complete".

- **`orderByNearest`** in `geo.ts` — greedy nearest-neighbour, pure, no native import,
  7 tests. Not an optimal tour on purpose: a true TSP for twenty stops is not something
  to make someone wait for on a phone, and greedy is *stable* — the next stop is always
  the nearest unvisited one, so skipping a shop or wandering off still gives an answer
  the person recognises. Unpinned shops are **dropped, not parked at the end**, or the
  sweep would claim to finish at a shop nobody can find.
- **The order is frozen when the sweep starts**, not recomputed on every GPS twitch. A
  route that rearranges itself while someone is riding toward a shop is worse than a
  slightly longer one they can trust. Re-ordering is a button.
- Progress is **device-local (MMKV), keyed by area AND working day** — see
  `sweepProgress.ts`. It is not a record of work (the order and the shop's visit
  timestamp are); it only decides which cards look done, so it never goes near Firestore
  and yesterday's finished round does not open complete this morning.
- **GPS failure does not close the round**: the shops and pins still show, just unordered,
  with the reason on screen. Someone who knows the area can still work.
- Shops in the round with no pin get their own *"Not on the map"* section, so the gap is
  visible rather than silent.

### Deviation worth knowing

§7 says **three fixed tabs per role**. Booker and rider now have **four** — the Map tab
was added rather than buried behind the Route screen, because "open the app, open the
map" is the whole request. Easy to reverse into a Route-screen button if four feels wrong
on a real phone.

### Built and verified

TypeScript 0 errors · ESLint 0 errors (79 warnings, all house-style `no-void`/inline) ·
**53/53 tests** (35 original + 18 geo) · `assembleDebug` and **`bundleRelease` both
BUILD SUCCESSFUL**.

**`android/app/build/outputs/bundle/release/app-release.aab` — 62 MB, versionCode 8,
versionName 1.7**, signed with the upload key, release manifest confirmed to carry both
location permissions and the real 39-character Maps key.

**Still not run on a device.** Nothing in §9 or §10 has been seen working on real
hardware — the camera, the location prompt, the map render, the Google Maps hand-off and
the four-tab layout are all things only a phone can answer. Do that before uploading.

---

## 11. The three certificates (2026-08-09)

Fingerprints are public — they can be read out of any APK — so they live here rather
than being rediscovered every time something breaks. Package is
`com.apptechsolutions.fieldsales` for all three.

| Which | SHA-1 |
|---|---|
| Debug (`app/debug.keystore`) | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |
| Upload (`solanalab.keystore`) | `D1:95:A1:22:F9:1D:23:F1:B1:AD:22:21:FC:CB:F0:99:93:08:7A:F1` |
| Play App Signing — hybrid classical | `D8:B6:6C:BA:E1:AB:31:9F:26:36:48:B4:BF:E3:73:46:9E:0F:29:25` |
| **Play App Signing — DEPLOYMENT** (signs what phones receive) | `CD:41:93:F5:5D:E1:0C:14:69:E2:4B:FB:F7:6A:B5:9E:6B:A6:DE:9A` |
| Play App Signing — hybrid PQC | `1D:43:6F:AA:48:96:5C:9E:6D:9B:5E:2B:B3:32:A9:5F:DF:94:9E:F7` |

All three must be registered in **two** places, and forgetting the third one in either
place produces a failure that only ever appears for people who installed from Play:

1. **Google Cloud → Credentials → the Maps key → Android apps.** Missing the Play
   fingerprint = the map renders as a blank grey square with the Google watermark and
   dead zoom. This is exactly what happened on the first Play upload of 1.7.
2. **Firebase → Project settings → the Android app → SHA fingerprints.** Missing it =
   Google Sign-In fails with `DEVELOPER_ERROR` for every Play installer while working
   perfectly on sideloaded builds (the long-standing `PROGRESS.md` §6 item).

Both restrictions are server-side, so a fingerprint added now takes effect on builds
ALREADY installed — no upload needed to test the fix. Give it about five minutes and
force-stop the app.

### The quantum-ready trap — read this before debugging a blank map again

This app signing key is on Google's **"Quantum-ready (beta)"** scheme, which generates
THREE certificates, and the Play Console's *"SHA-1 certificate fingerprint"* copy button
gives you the **wrong one**.

`Download certificates` on the App signing page yields a zip of three `.der` files:

- `deployment_cert.der` — **this signs the APKs Play actually delivers to phones.** It is
  the fingerprint every API provider needs, and the UI does not surface it anywhere.
- `hybrid_classical_cert.der` — what the *SHA-1 certificate fingerprint* button copies.
- `hybrid_pqc_cert.der` — the post-quantum half.

Registering only the hybrid classical one (the obvious, documented action) produces a map
that is a blank grey square with a Google watermark, working GPS, working everything else,
and no error visible anywhere in the app. It cost most of a day. Register all three.

To read a SHA-1 out of one of these files:

```
keytool -printcert -file deployment_cert.der
```
