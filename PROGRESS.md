# SnD Manager — build status & release runbook

**Sales & Delivery Manager** — Android app for a 3-person skincare distribution
business in Pakistan (owner, order booker, delivery rider).

| | |
|---|---|
| Package | `com.apptechsolutions.fieldsales` |
| Current build | **v1.6 (versionCode 7)** — bumped in `build.gradle`, AAB not yet rebuilt |
| Signing | `solanalab.keystore` (the publisher's existing Play upload key, alias `solanalabdev`) |
| Firebase project | `saleforec-10ce7` (functions in `asia-south1`) |
| Stack | React Native 0.86 · Hermes · New Architecture · RN Firebase v26 (modular API only) |
| Status | **Feature-complete for v1, field-audited, two crash-scan rounds closed** |
| Last updated | 2026-08-09 |

> **Uncommitted work in the tree.** Round 8 and a full UX pass are done but not
> committed — read `HANDOFF.md` first. `OPEN-BUGS.md` is now empty of open items.

---

## 1. Where the app stands

All v1 scope from the SRS (v1.9) is built, and the app has been through a
day-in-the-life audit against the three real jobs it has to do. Every gap that
audit confirmed has been closed.

**Verification at HEAD (`6d6cea9`)**

| Check | Result |
|---|---|
| TypeScript | 0 errors |
| ESLint | 0 errors (69 style warnings) |
| Unit tests | **35 passed / 35** (6 suites) |
| Release build | `BUILD SUCCESSFUL` — APK + AAB |
| AAB signature | `jar verified` (SOLANALA) |
| On-device | Release build driven through all three roles on Pixel 9 / API 35 |

Source: ~8,600 lines of TypeScript across `src/`.

---

## 2. Build history

Seven commits, each a complete round of work.

| Commit | Round | What landed |
|---|---|---|
| `80be536` | — | Full app skeleton: navigation, screens, dev store, UI kit |
| `faeaa4f` | 1 | Made the app actually work for booker and rider |
| `508ed4e` | 2 | Security hardening (rules matrix, admission functions) |
| `8bfcb44` | 3 | **Production hardening** — see below |
| `1ee8e70` | 4 | Rewards, push notifications, exception cash, shelf counts, CSV |
| `96574ee` | 5 | Visibility toggles + first on-device smoke pass |
| `6d6cea9` | 6 | **Closed all 39 field-audit gaps** |
| `29c1f27` | — | Fixed the system nav bar covering the app's bottom tabs |
| `dfd6b38` | 7 | Fixed all 25 findings from the first crash scan |
| *uncommitted* | 8 | **Closed all 18 findings from the second crash scan + UX pass** |

### Round 8 — the second crash scan, plus a UX pass
All 18 open bugs closed (see `OPEN-BUGS.md` for the table, `HANDOFF.md` for detail).
The headline was that **every PDF share had never worked once** — the code imported a
default export the package does not have, and a hand-written `.d.ts` hid it from the type
checker. Alongside the fixes: an app-root error boundary, AsyncStorage replaced with
MMKV, Google Play in-app updates, busy/disabled state on every async action (closing
several real double-write paths in a cash app), keyboard avoidance on every input screen,
a one-step-down type scale with cropping fixed app-wide, typed-only quantity entry on the
booking screen, and a Welcome screen that no longer asks a returning owner to pick
between "I work for a business" and "Create a new business".

### Round 3 — production hardening
Found by a prod-readiness audit; all fixed:
- **Cost prices moved off product docs** into admin-only `productCosts/{id}`.
  Margins were syncing to every staff phone. Includes a self-healing migration.
- **All counter math uses `increment()`** (`committedQty`, `stockQty`,
  `outstanding`, `amountPaid`) — read-modify-write was corrupting stock
  whenever booker and rider worked at the same time.
- **Write failures are loud** — every rejected write raises an alert and a
  Crashlytics record. Silent `console.warn` was the worst failure mode in a
  cash app.
- **Per-staff handover confirm** — confirming the rider no longer silently
  confirms the booker's uncounted cash. Chunked under the 500-write batch cap.
- Crashlytics added; `profitFor` extracted so tests exercise shipped code.

### Round 4 — the rest of v1 scope
Rewards (FR-16) with system-camera photo proof and float ledger; FCM with four
server-side triggers; the booker's forced-cash exception (FR-7.13); shelf
counts; CSV export.

### Round 5 — visibility + first device pass
Owner-controlled "What staff can see" switches, wired through every screen.
The device pass caught a real bug: **the share sheet never opened** — RNShare
decodes `data:` URLs into external cache, which its own FileProvider doesn't
cover. Fixed for both CSV and the WhatsApp bill PDFs (which had never been
device-tested).

### Round 6 — the field audit
A 44-agent audit walked each person's real working day through the code
(5 persona reviewers + an adversarial verifier per finding). **39 gaps
confirmed, 0 refuted.** Two were production bugs that the demo mode had been
hiding:

1. **"Tell the rider" was dead in production.** The code wrote a *timestamp*
   but every screen read a *boolean* that only the demo store ever set. The
   booker's main way to direct collections reached nobody.
2. **The route freeze checked the wrong phone.** `bookOrder` guarded on the
   *booker's* day doc, but only the *rider* ever starts a route — so afternoon
   "Today" orders silently joined a van loaded that morning.

Everything else was a missing door: no way to cancel an order, no failed-
delivery flow, no undo, no way to fix a wrong payment, no opening khata
balance, no restock. All now exist — see §4.

---

## 3. What each person can do

### Order booker
- Route grouped by area with a **visit cycle** (due today vs. visited recently)
- **Book order** straight from a route card
- Searchable, area-grouped shop picker
- **Typed quantity entry** beside 1/6/12/+1/+6 chips — any number is bookable
- "Same as last time" prefill
- **Per-order discount** up to the owner's cap (standing rate marked)
- Today/Tomorrow delivery, auto-forced to tomorrow once the rider's van is loaded
- Register a **new shop in the field**
- Shelf counts; flag a shop for collection
- **Forced-cash exception** (FR-7.13) — deliberately loud, pushes the owner
- **Cancel** his own undelivered orders
- Counter-staff rewards: register staff, photo-proof claims, float balance
- Evening **"My cash"** — what he's carrying, hand over, watch for confirmation

### Delivery rider
- Morning load list summed across stops; **Start route** freezes the van
  (**Undo** available until the first close-out)
- Stops include **overdue orders** from earlier days (tagged FROM EARLIER)
- Close-out: **typed delivered quantity** + all/half/none chips, bill written
  at the door for delivered pieces only
- Payment: full / + old khata / part / nothing · cash / transfer / cheque
- **Confirm dialog** before the irreversible "Delivered"
- Failed deliveries: **Try tomorrow** (defers the stop) or **Send back**
  (returns it, releases stock)
- **Collect** tab for khata visits with no delivery, FIFO across oldest bills
- Receipt PDF after collecting; **re-send any bill PDF** from History
- Call the shop from a stop
- Evening handover: **cash in hand separated from bank transfers**

### Owner
- Action screen: exception cash, reward claims, per-person handover confirms,
  cancelled/returned orders, old credit
- Dashboard scoped to **today** (sales, cash confirmed vs. with staff, stock)
- Products: cost price (owner-only), **selling price**, **stock in/out**
- Shops: full editor, **opening khata balance**, manual khata adjustment,
  record a payment made directly to her, deactivate
- Employees: invite by Gmail, remove (revokes access within a minute),
  **cash float** issue/take-back per person
- Reports: today / week / month / **last month** — sales, profit, collections,
  who owes me, deliveries, **every receipt with a Void button**
- **Void a wrong payment** — the row stays crossed out, the khata is restored
- Expenses + fixed charges, both editable and deletable
- CSV export (orders, payments) via the share sheet
- Settings: brand, daily rules, rewards, cheques, **what staff can see**

---

## 4. Money integrity rules

The parts that must never be wrong:

- **Money is integer rupees.** No floats anywhere.
- **Payments are append-only.** Nothing is ever deleted. A wrong entry is
  *voided* — the row stays visible, marked, and every total skips it.
- **Cash is "with staff" until the owner confirms it.** Only an admin can flip
  `confirmed`, and only for one person at a time.
- **The booker cannot move a shop's balance.** His exception cash writes a
  flagged payment only; the khata moves when the owner confirms, applied FIFO
  from the owner's full view.
- **Counters only ever increase**, one at a time (enforced in rules).
- **Cost prices are admin-only** — a separate collection staff cannot read.
- **Cancel, never delete** (FR-5.7). Cancelled and returned orders release
  their committed stock.

---

## 5. Backend (deployed to `saleforec-10ce7`)

**Cloud Functions** (`asia-south1`, all live):

| Function | Job |
|---|---|
| `admitSignIn` | The only door in — employee-list check, custom claims, business bootstrap |
| `addEmployee` | Owner invites by Gmail; one email = one business |
| `removeEmployee` | Revokes tokens, refuses the last admin, **clears the auto-assign rider slot** |
| `uploadUrl` | Server-picked path for one photo upload |
| `pushOrderAssigned` | New order → the rider |
| `pushExceptionCash` | Booker took cash → every admin |
| `pushHandoverConfirmed` | Owner confirmed → the staff member |
| `pushClaimPending` | Reward claim → every admin |

**Firestore rules** — default deny; identity rides in the token
(`companyId` + `role` custom claims), so rules never do a lookup. Every
listener query carries the same filter its rule checks.

> Note: 2nd-gen Firestore triggers need Eventarc permissions to propagate on a
> project's first deploy. If `firebase deploy --only functions` fails on the
> push triggers, wait a few minutes and run it again — that's the documented fix.

---

## 6. Play Console release runbook

The AAB is built, signed and verified. Remaining steps are all in the Play
Console and need the publisher account.

1. **Upload** the latest AAB from `builds/` to **Internal testing**
   (not production — pilot with the real team first).
2. **Add testers** — the booker's and rider's Gmail addresses. They must be the
   *same* addresses the owner adds inside the app on the Employees screen.

2a. ⚠️ **REGISTER THE PLAY SIGNING CERTIFICATES IN FIREBASE — or Google
    Sign-In fails with `DEVELOPER_ERROR` for everyone who installs from Play.**

   Play App Signing strips your upload signature and re-signs the app with
   Google's own key, which Firebase has never seen. Worse, this project uses
   the **quantum-ready hybrid** setup, so Play issues **three** certificates —
   and the one that actually signs the delivered APK is *not* the one the
   console shows most prominently.

   Play Console → App signing → **Download certificates**, then:

   | File | Role | SHA-1 |
   |---|---|---|
   | `deployment_cert.der` | **signs what devices install — the one that matters** | `CD:41:93:F5:5D:E1:0C:14:69:E2:4B:FB:F7:6A:B5:9E:6B:A6:DE:9A` |
   | `hybrid_classical_cert.der` | classical half of the upgrade pair | `D8:B6:6C:BA:E1:AB:31:9F:26:36:48:B4:BF:E3:73:46:9E:0F:29:25` |
   | `hybrid_pqc_cert.der` | post-quantum half | `1D:43:6F:AA:48:96:5C:9E:6D:9B:5E:2B:B3:32:A9:5F:DF:94:9E:F7` |

   Add **all three SHA-1s** (and their SHA-256s) in Firebase Console →
   Project settings → Your apps → Android → **Add fingerprint**. Read any
   certificate's fingerprints with:

   ```bash
   keytool -printcert -file ~/Downloads/certificates/deployment_cert.der
   ```

   No rebuild or re-upload is needed — the check is server-side. Allow ~5
   minutes, then clear **Google Play services** cache on the test device and
   force-stop the app.

   Registering only the upload key (`D1:95:A1:22…`) and the debug key is what
   makes sign-in work perfectly on sideloaded builds and fail only on Play —
   the symptom that cost us an afternoon.
3. **Data safety form** — the app collects **email address and name** (Google
   sign-in) for app functionality and account management. Data is encrypted in
   transit. Users can request deletion via the owner.
4. **Privacy policy URL** — required before the data-safety form can be saved.
5. **Content rating** questionnaire — business/productivity app, no ads, no UGC.
6. **App content**: no ads, no in-app purchases; target audience 18+.
7. Once the pilot is clean, promote the same build to **Production**.

**Version bumping** — `android/app/build.gradle`:
`versionCode` must increase by 1 for every upload (currently `4`).
Build with:

```bash
cd android && ./gradlew bundleRelease
```

Output lands at `android/app/build/outputs/bundle/release/app-release.aab`.

**Signing** — credentials live in `android/keystore.properties`, which is
gitignored and must never be committed. The same key signs the publisher's
whole Play portfolio.

---

## 7. First-run setup for the owner

1. Install, tap **Create a new business**, type the brand name, sign in with Google.
2. The setup wizard walks through products, first shop, and inviting staff.
3. **Add the two employees by their exact Gmail addresses** with roles
   (booker / rider). They appear as "Invited" until their first sign-in.
4. Enter **opening khata balances** on each shop (Shops → Edit) so the paper
   debts come across on day one.
5. Set **cost prices** on both products so profit reports are real.
6. Issue each staff member a **cash float** if they'll pay counter rewards.
7. Check **Settings → What staff can see** and decide what to hide.

---

## 8. Deliberately parked for v1.1

The owner's own scope-trim decision (SRS v1.9) — specified, not built:

- Sold-through order suggestion (FR-13.3a)
- Automatic reward plausibility check (part of FR-16.5)
- Assembled net-profit ladder (FR-17.3)
- Urdu + RTL (strings are already centralised in `src/i18n/strings.ts`)
- Server-side order profit (FR-15.2) — computed client-side today

Known platform limit, written into the spec: Android's share intent **cannot**
pre-select a WhatsApp recipient for a file, so sending a bill costs one extra
tap in WhatsApp's own contact list. One-tap needs the WhatsApp Business API (v2).

---

## 9. Code map

```
src/
  app/          auth.ts (Google + admission), navigation.tsx, orderIntent.ts
  components/   theme.ts, ui.tsx  — the whole design system
  data/         store.ts (the API every screen imports)
                firestoreStore.tsx (real backend)  devStore.tsx (demo mode)
                models.ts (mirrors the Firestore schema)
  documents/    templates.ts (order/bill/receipt HTML), share.ts (PDF + CSV)
  features/
    admin/      Action, Dashboard, Products, Shops, Employees, Reports,
                Expenses, Settings, Wizard
    booker/     Route, NewOrder, MyDay, RewardsSection
    rider/      Route + CloseOut, Collect, History, Handover
  lib/          money, fifo, order, profit, serials, csv, base64, photos, storage
functions/      index.js — all 8 Cloud Functions
firestore.rules the full security matrix
```

**Two store implementations, one interface.** Preview mode is backed by an
in-memory store; a signed-in session is backed by Firestore. Screens cannot
tell the difference — which is the point, and also the reason two bugs hid in
the demo until the field audit. Any behaviour that differs between the two is
a bug.
