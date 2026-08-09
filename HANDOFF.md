# Handoff — SnD Manager

**Written:** 2026-08-09
**Read this first**, then `OPEN-BUGS.md` (empty) and `PROGRESS.md` (the SRS-facing plan).

---

## 1. Where things stand

| | |
|---|---|
| Branch | `main`, pushed to `github.com/sohailnasir74atWork/snd` (**public**) |
| Uncommitted | none |
| Version | `versionCode 14` / `versionName "1.9"` |
| TypeScript | 0 errors |
| ESLint | 0 errors (86 warnings, all pre-existing house style: `no-void`, inline styles) |
| Unit tests | **97 / 97**, 10 suites |
| Rules tests | **240 / 240**, 2 suites — `npm run test:rules` |
| CI | green on every push — [Actions](https://github.com/sohailnasir74atWork/snd/actions) |
| Device | ❗ **NOT driven by hand since the SaaS round** — see §4.1 before publishing |

> **There is no production.** The app is not on a public track and there is no
> real customer data anywhere. "Evolver Skin Care"
> (`companies/e1Wt5vq2zzcFCBUlnUb2`) in `saleforec-10ce7` is TEST data and can
> be deleted at any time. Every warning in this file about protecting live
> data is about the day that stops being true, not today.

Firebase project `saleforec-10ce7`. Owner `sohailnasir74business@gmail.com`.

### Regions — check before you assume

| | |
|---|---|
| Firestore database | **`nam5` — United States multi-region** |
| Cloud Functions | `asia-south1` (Mumbai) |

This surprised everyone, including three rounds of documentation that said
"Mumbai". The functions region was read off `firebase.json` and the database
was assumed to match; it does not. Consequences: every Firestore call from
Pakistan crosses the Pacific (~250 ms vs ~50 ms), every function trigger
round-trips from Mumbai to the US, and multi-region costs more per read, write
and stored GB than a regional location — so any cost estimate computed at
`asia-south1` rates is **too low**.

A Firestore database's location can never be changed. With no real data the
fix is free (delete and recreate, or a new named database); the day a customer
signs up it becomes permanent. The owner has been told and has chosen to
stay on `nam5` for now — that is a decision, not an oversight.

### Deployed to `saleforec-10ce7`

- **Cloud Functions** — all 8, redeployed in the SaaS round
- **`firestore.rules`** — including the `days` tenant fix (§1a)
- **`firestore.indexes.json`** — 3 new composite indexes, all `READY`
- **Billing budget** `snd-manager-guard` — $25/month, scoped to this project
  only (the `blox_fruit` billing account carries other projects), alerting at
  50/90/100/150%

> The backend is AHEAD of the installed app, deliberately and safely: every
> change is backward-compatible with `versionCode 13` in the field, which is
> what makes it safe to deploy the backend before the app is device-tested.

---

## 1a. The SaaS round — what changed and why

Read this before touching the store or the rules; four load-bearing
assumptions were replaced.

**Many riders.** `settings.autoAssignRiderId` was one uid stamped on every
order with no UI, so riders 2..n saw a permanently empty app — and it was a
race, whichever rider signed in first captured the whole company. Assignment
is now a ladder: `Area.riderId` → `settings.defaultRiderId` →
`autoAssignRiderId` (migration shim, read never written) → nobody. Nobody is a
legitimate outcome; those orders appear on the owner's Action screen as
**Unassigned**. Logic in `src/lib/assignment.ts`, tested.

**Many bookers.** `Area.bookerId` gives a round a territory. `store.routeShops`
is what a booker's screens read. Three cases: nothing configured → everyone
sees everything (so a one-booker business is unchanged); he has rounds → only
his; others have rounds and he does not → the rounds nobody covers, never an
empty screen. Territory is a CLIENT scope, not a rule — covering a colleague's
patch is normal, and the shop picker searches company-wide on purpose.

**The 100-day visit cycle.** `cycleDays = shops / shopsPerDay` was fed every
shop in the company: 2,000 shops at 20/day meant a shop was "due" once a
quarter and the booker's morning screen was empty. Same formula, measured over
his territory now.

**Bounded listeners.** Orders and payments were whole-collection subscriptions
with no limit — ~80MB of heap at 40k orders, held three times over. Each is now
two listeners merged behind the same array: a 90-day window plus an **open
slice with no age limit** (`paymentStatus in [unpaid,partial]`,
`confirmed == false`). The open slice is not optional: a shop that owed money
four months ago is what a collection visit is FOR, and a naive window would
have made `collect()` allocate that cash to nothing. See `src/lib/window.ts`.

> **The window keys on `deliveryDate`, never `bookedAt`.** `deliveryDate` is a
> client-written string; `bookedAt` is a `serverTimestamp()`, and a range
> filter on an unresolved server timestamp does not match locally — booking
> with no signal would drop the order out of the booker's own list as he wrote
> it. Same reason the owner's unsynced-payment count comes from the
> `confirmed == false` listener.

**Lazy collections.** `expenses`, `fixedCharges`, `employeeList`,
`floatMovements`, `rewardStaff` sync only once a screen calls `useNeed(...)`.
Once started they never detach — Firestore re-bills a listener disconnected
over 30 minutes as a new query. **The failure mode is silent:** read one
without declaring it and you get a confident zero, not an error.

**Sales tax.** `computeTotals(items, discount, useDelivered, taxPercent)`.
At rate 0 it returns exactly what it always did, no `taxTotal` key — asserted
by a test. Sales figures use `netOfTax()`; profit needed nothing because
`profitFor` works per line from `unitPrice`.

The app builds are **not** all uploaded. The owner uploaded `versionCode 8`; 9 through 13
were handed over as AABs and may or may not have been published.

---

## 2. What the app does now that it did not

**Shop photos and GPS pins.** A booker or rider standing at a shop can save a shopfront
photo (camera → Bunny CDN → `shop.photoUrl`) and drop a GPS pin (`shop.location`). The pin
screen shows accuracy and warns past 30 m. **Saving never depends on the map loading** —
the pin is the GPS fix, so a grey square on one bar costs only the ability to double-check.

**Areas are a managed list.** `companies/{c}/areas`, owner-writes-only. Shops still store
the area NAME (no migration; orders carry a frozen `shopSnapshot.area`), so renaming an
area fans the new name out to every shop under it in one batch. Every shop form picks from
a searchable sheet — `components/AreaSelect.tsx`. The **wizard is the one place a name may
still be typed**, because on first run there is nothing to pick from, and it registers what
was typed as a real area on the way past.

**The area sweep** (`features/shops/AreaSweepScreen.tsx`) — a Map tab for booker and rider.
Pick a round, get an ordered stop list nearest-first, a live map with your own dot, live
distance and heading, arrival detection at 40 m, mark-and-advance. Entirely in-app;
"Open in Google Maps" survives as a small link for the long hop into an area.

**Counter staff live in the shop.** They always carried `shopId`; what was missing was any
admin UI. `features/admin/CounterStaffSection.tsx` sits inside the shop editor, and the
shops list shows "*n* counter staff" per row.

**Team today** (`features/admin/TeamDayScreen.tsx`, logic in `lib/workday.ts`) — when each
person started and stopped, hours, shops touched, orders, deliveries, cash. There is no
clock-in button on purpose: a button someone forgets, or presses from bed, measures
nothing. The day is read off the work. The rider gets the better answer because he already
presses Start route and Hand over, and both now carry timestamps (`routeStartedAt`,
`handedOverAt`). A booker's start is tagged **FROM FIRST SHOP** so nobody mistakes it for
when he actually left.

**The 7px gutter.** `space.gutter` in `theme.ts` is the single number for the distance from
screen edge to card edge. `Card`, `OptionBar` and `SectionLabel` read it, so any screen
built from those is aligned for free. Do not reach for `space.l` for a horizontal inset.

---

## 3. Traps that have already cost real time

**The Play "quantum-ready" certificate.** A blank grey map with a Google watermark, working
GPS, and no error anywhere in the app. The cause: this app signing key is on Google's
Quantum-ready (beta) scheme, which produces THREE certificates, and the Play Console's
*"SHA-1 certificate fingerprint"* button gives you the wrong one. Only
`deployment_cert.der` signs the APKs Play actually delivers, and the Console never shows
its fingerprint. Download the zip from App signing and read them yourself:

```bash
keytool -printcert -file deployment_cert.der
```

All fingerprints, package `com.apptechsolutions.fieldsales`:

| Which | SHA-1 |
|---|---|
| Debug | `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` |
| Upload (`solanalab.keystore`) | `D1:95:A1:22:F9:1D:23:F1:B1:AD:22:21:FC:CB:F0:99:93:08:7A:F1` |
| Play hybrid classical | `D8:B6:6C:BA:E1:AB:31:9F:26:36:48:B4:BF:E3:73:46:9E:0F:29:25` |
| **Play DEPLOYMENT** ← the one that matters | `CD:41:93:F5:5D:E1:0C:14:69:E2:4B:FB:F7:6A:B5:9E:6B:A6:DE:9A` |
| Play hybrid PQC | `1D:43:6F:AA:48:96:5C:9E:6D:9B:5E:2B:B3:32:A9:5F:DF:94:9E:F7` |

They go in **two** places, and both restrictions are server-side — a fingerprint added now
fixes builds ALREADY installed, no upload needed:

1. **Cloud Console → Credentials → the Maps key** (`AIzaSyDrCphNWV8ROS…`, *not* the
   Firebase auto-created `AIzaSyB2e9…`). Missing → blank map.
2. **Firebase → Project settings → SHA fingerprints.** Missing → Google Sign-In fails with
   `DEVELOPER_ERROR` for Play installs only.

**Demo mode saves nothing.** "See a demo first" runs an in-memory store. Anything added
there vanishes and never reaches Firestore — this was mistaken for data loss once already.
The seeded shops (Beauty Corner, Glow Mart, City Cosmetics) are the tell.

**Native modules mean a rebuild.** `react-native-maps` and
`@react-native-community/geolocation` were added; a JS reload is not enough. Both autolink
correctly. `react-native-device-info` and `react-native-nitro-modules` had to be **direct**
dependencies — autolinking does not pick them up transitively, and the symptoms are
confusing (`NativeModule.RNDeviceInfo is null`, and `Project with path
':react-native-nitro-modules' could not be found`).

**Two store implementations, one interface** (`devStore` / `firestoreStore`). Any behaviour
that differs between them is a bug — that is exactly how two production bugs hid until the
field audit. Every store method must be written twice, deliberately identically.

**Stale absolute paths.** The project moved from `/Users/apple/testing/FieldSales`. If
Gradle complains about that path, delete `android/build`, `android/app/build`,
`android/app/.cxx`, `android/.gradle`.

**Fire-and-forget writes.** Most store methods return `void` — there is no promise to await
and nothing tells the screen the write landed. Every one of them needs a re-entrancy guard
(`useWriteGuard` for keyed latches, `busy` on `PrimaryButton`, a `useRef` for the rest).
A double-press bug of exactly this shape was found on-device in the sweep: one press marked
two shops visited, because marking one puts the next under the same button.

---

## 4. What is NOT done

1. **`versionCode 14` HAS NOT BEEN DRIVEN ON A PHONE.** ❗

   The AAB is built and signed. Nobody has run it. The SaaS round replaced
   four load-bearing assumptions and `firestoreStore.tsx` still has no unit
   coverage, so 97 green tests and a green CI say the code is internally
   consistent — not that a rider's phone behaves correctly on a market street.

   **Do these four before publishing to any track that reaches a real user.**
   Roughly 30 minutes with `./gradlew installDebug`:

   | # | Check | What it proves |
   |---|---|---|
   | 1 | Deliver an order, pay part of it, then Collect the rest at that shop | The open-slice listener. **Highest risk in the round** — if this is wrong, cash allocates to nothing and is booked as `unallocated`. |
   | 2 | Turn wifi and mobile data off, book an order | The window keys on `deliveryDate` precisely so this cannot break. If the order vanishes from the booker's own list, the window is wrong. |
   | 3 | Add a second rider, put him on a round in More → Areas, book into it | Multi-rider assignment. Before this round every order went to one rider regardless. |
   | 4 | Settings → Sales tax → 17%, deliver, open the bill PDF; then set it back to None | The tax line, and that sales in Reports stay net of it. |

   If all four behave, the round is safe to publish. If one misbehaves, that
   is the bug — start there, not in the rules.
2. **Untested at volume.** Nobody has seeded a tenant with 40,000 orders and
   opened every screen on a 3GB device. Until that passes, the memory claim
   behind the windowing work is reasoning, not measurement.
3. **Blockers still open before selling to strangers.**

   | Blocker | Note |
   |---|---|
   | No Firebase App Check | Not a dependency, not initialised. `google-services.json` ships in every APK, so without it the rules are reachable from `curl` with a real Google account. Register Play Integrity in the console, then wire the SDK. |
   | `uploadUrl` hands the Bunny storage-zone **write key** to every signed-in client | `functions/index.js:350` → `src/lib/storage.ts:28`. Zone-wide read/write/**delete**, no path scoping available. Rotating alone is a reset, not a fix — the new key ships to every phone within minutes. The fix is a proxy (`uploadPhoto` callable that does the PUT server-side) or moving to Firebase Storage with rules keyed on the `companyId` claim. Owner has deliberately deferred this while there is no real data. |
   | `admitSignIn` allows unlimited free workspace creation | No rate limit, no verification. A direct, unmetered cost attack — and the repo is public, so the fact is discoverable. The $25 budget alert is the current backstop, not a fix. |
   | No billing or entitlement gate | Nothing in the codebase can stop a non-paying company from using it. |
   | No privacy policy, terms, or account-deletion path | All three are hard Play requirements for an app that creates accounts. Deletion must be server-side: the rules deny `delete` on essentially every collection. |
   | Play Data Safety form | The draft in `PROGRESS.md` says "email address and name". The app also collects precise location, photos, third-party phone numbers, financial data and crash logs, and Bunny CDN makes "not shared with third parties" false. Misdeclaring risks suspension, and this keystore signs the whole Apptech portfolio. |

   Closed since the audit: the rules emulator suite now exists (240
   assertions, `npm run test:rules`), CI runs it on every push, Crashlytics
   identifies the tenant, and a $25 budget alert is live.
4. **Still not generic**, in rough order of what a distributor asks for first:
   per-van stock (one global `stockQty` pool today), cartons/units, returns
   *after* delivery, price lists, trade schemes, credit limits, batch/expiry,
   PJP/beat plans, Excel import, roles beyond the three.
   > Note: pre-delivery "send back" is CORRECT as written — `stockQty` only
   > moves at close-out by `deliveredQty`, so a returned order releasing only
   > `committedQty` is right. An audit flagged this as a bug; it is not. Do
   > not "fix" it or you will inflate stock on every return.
5. **Node 20 for Cloud Functions is decommissioned 2026-10-30** — after that, deploys fail
   until the runtime is upgraded. `firebase-functions` is also a major version behind, and
   that upgrade has breaking changes worth testing rather than firing off.
6. **In-app updates never interrupt.** `updates.ts` forces an update at Play priority ≥ 4,
   but **update priority cannot be set in the Play Console at all** — only through the Play
   Developer Publishing API. Published from the Console, every release is priority 0, so
   the forced path is unreachable and only the quiet flexible flow runs. The fix is to
   trigger on `clientVersionStalenessDays` instead, which Play does report; agreed in
   principle, not built.
7. **`Chip` has no `busy`/`disabled` prop.** Chip-fired writes fall back to a label swap
   plus `onPress={undefined}`.
8. **No component-level tests.** `orderByNearest`, `computeWorkday` and the money/serial
   libraries are tested; not one screen is.
9. **Not re-audited.** Nobody has run a fresh adversarial scan since Round 8. The largest
   new surfaces are the sweep, the areas migration path, and the workday derivation.
10. Two shops in the live database sit under "Main area" (the wizard's fallback) and two
   have no area at all, so they are invisible to every round. Fixable from
   More → Areas → *Found on shops, not on this list*.

---

## 5. How to run it

Everything, the way CI runs it:

```bash
cd /Volumes/Sohail/AI_Projects/testing/FieldSales
npx tsc --noEmit && npx eslint . && npm test && npm run test:rules
```

### The rules suite — `npm run test:rules`

240 assertions against a local Firestore emulator, ~7 seconds. **This is the
only thing that checks the boundary between two businesses**, so treat a red
run as a release blocker, not a flaky test.

- `firestore-tests/tenant-isolation.test.js` — every collection under
  `companies/{id}`, tried for read, write AND list, by company B's admin,
  booker and rider, a signed-in stranger with no claims, and an anonymous
  caller. Plus a named regression test for the `days` hole.
- `firestore-tests/money-integrity.test.js` — company A's *own* booker and
  rider, which is the likelier theft. Maps one-to-one onto `PROGRESS.md` §4.

Three things about it that will otherwise cost someone an afternoon:

1. **`JAVA_HOME` is defaulted, not hardcoded.** firebase-tools refuses Java
   below 21; Gradle wants 17 for the Android build. The npm script honours an
   existing `JAVA_HOME` (CI's `setup-java` supplies 21) and falls back to the
   Homebrew JDK on this Mac, where `JAVA_HOME` is unset. Do not "fix" this by
   setting a system-wide `JAVA_HOME` — you will break the other one.
2. **Each test gets its own pair of company ids** (`co()` / `cob()`), and
   there is no `clearFirestore()` between tests. Sharing one company and
   wiping between tests was quietly flaky: the wipe races the clients'
   caches, failures moved between runs, and every one passed in isolation.
3. **Use `patch()`, not `.update()`.** `update()` carries a client-side
   "document must exist" precondition that a cached client trips over.
   `patch()` is a merging set — an `update` to the rules, no precondition.

**The suite is verified to fail.** Reintroduce the missing `inCompany()` on
`days` and exactly three tests go red. If you ever substantially change it,
re-do that check: a green suite proves nothing until you have watched it go
red.

### CI

`.github/workflows/ci.yml` runs all of the above plus a real Metro bundle on
every push and PR. The bundle step catches what `tsc` cannot — an import
cycle or missing asset that only appears when Metro resolves the graph.
**Do not delete the rules step to make a build go green.** That step is the
difference between a multi-tenant product and one that looks like one.

Emulator (AVD `Pixel9_API35_ARM`), with Metro running (`npx react-native start`):

```bash
cd android && ./gradlew installDebug
```

A release APK is the better way to test on a device — it bundles the JS, so it needs no
Metro, and it is signed with the upload key whose fingerprint is registered:

```bash
cd android && ./gradlew assembleRelease
```

Release bundle for Play:

```bash
cd android && ./gradlew bundleRelease
```

### The current build

| | |
|---|---|
| Version | `versionCode 14` / `versionName "1.9"` |
| File | `builds/SnD-Manager-v1.9-build14.aab` (62 MB, outside the repo — AABs are not committed) |
| Also at | `android/app/build/outputs/bundle/release/app-release.aab` |
| Signature | `jar verified` |
| Signer | `CN=sohail, OU=solana, C=PK` — SHA-1 `D1:95:A1:22:F9:1D:23:F1:B1:AD:22:21:FC:CB:F0:99:93:08:7A:F1`, the upload key in §3 |
| Built | 2026-08-09, from `main` |

**Not published, and not yet safe to publish.** See §4.1 — the four device
checks have not been run. Building the file is safe; putting it on a track
that reaches a real user is not, until they pass.

Verify any future AAB the same way rather than trusting `BUILD SUCCESSFUL`,
which says nothing about which key signed it:

```bash
jarsigner -verify android/app/build/outputs/bundle/release/app-release.aab
unzip -p android/app/build/outputs/bundle/release/app-release.aab "META-INF/SOLANALA.RSA" | keytool -printcert
```

**Before any build that shows a map**, `android/local.properties` (git-ignored) must carry:

```
MAPS_API_KEY=AIza...
```

Without it the app still compiles and runs — the map is a grey square and Gradle warns.
That soft failure is deliberate: a missing key must not stop the whole app building.

**Cost:** the Maps SDK mobile-native SKU is free and unlimited. Nothing in this app calls a
billed Maps endpoint — the GPS fix comes from the OS, distances are haversine on-device,
and directions hand off to the Google Maps app. Do not add reverse-geocoding or the Routes
API without deciding to start a bill (10,000 free/month, then $5 per 1,000).

Reading the live database without the console:

```bash
TOKEN=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $TOKEN" "https://firestore.googleapis.com/v1/projects/saleforec-10ce7/databases/(default)/documents/companies/e1Wt5vq2zzcFCBUlnUb2/shops"
```

---

## 6. Where things live

| | |
|---|---|
| `src/lib/geo.ts` | distance + nearest-neighbour ordering. **No native import** — keep it that way so it stays testable |
| `src/lib/location.ts` | the GPS fix and the watch. The only continuous sensor in the app |
| `src/lib/workday.ts` | what counts as a person's working day |
| `src/features/shops/` | pin screen, sweep screen, the shared photo/pin chips, sweep progress (MMKV) |
| `src/components/AreaSelect.tsx` | the only way to set a shop's area |
| `src/components/theme.ts` | every colour, size and space — including `space.gutter` |
| `firestore.rules` | identity rides in the token; rules never do lookups |
| `functions/index.js` | `admitSignIn` is the only door into the app |

Firestore layout is `companies/{companyId}/…` for everything except `employeeDirectory`,
which is at the root because sign-in must resolve an email before it knows the company.
Clients cannot read or write that collection at all.

---

## 7. History

The chronological record of Round 8 (18 bugs), the design pass, the Welcome-screen fixes
and the shop-mapping build is in the message of commit `5346f05` and in `OPEN-BUGS.md`.
Every fix is also commented at the site it was made, explaining what the failure actually
was — grep for the wording rather than reconstructing it from the diff.
