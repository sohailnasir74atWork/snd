# Open bugs — Round 8 backlog

Found by the second crash scan (2026-08-06). **18 confirmed, 6 ruled out.** Every one
was verified by a second agent that tried to disprove it against the source.

**None of these are fixed yet.** The 25 findings from the *first* scan **are** fixed —
see `git log` for Round 7.

The class is always the same: bugs that pass TypeScript, pass all 35 unit tests, and are
invisible in demo mode, because the demo store never touches Firestore, never has a slow
network, and never has a stale auth token.

---

## P0 — a shipped feature that has never worked

### 1. Every PDF share is dead (`stuck-screen`)
**I verified this one by hand, not just by report.**

`react-native-html-to-pdf` exports `generatePDF` as a **named** export. Our code imports a
default and calls `.convert()`:

```ts
// src/documents/share.ts:9
import RNHTMLtoPDF from 'react-native-html-to-pdf';      // undefined at runtime
const { base64 } = await RNHTMLtoPDF.convert({ ... });   // TypeError
```

```bash
$ node -e "const p=require('./node_modules/react-native-html-to-pdf/package.json'); console.log(p.exports['.'])"
$ grep export node_modules/react-native-html-to-pdf/src/index.tsx
export function generatePDF(options: PDFOptions): Promise<PDFResult>
```

Our hand-written `src/types/react-native-html-to-pdf.d.ts` declares a default export that
does not exist, which is exactly why the type checker never caught it.

**Affects all four share buttons:** rider's bill after close-out, rider's receipt after a
collection, booker's order confirmation, and "Bill PDF" in rider History. Three of the four
swallow the error with `.catch(() => {})`, so the button does nothing at all — no PDF, no
share sheet, no message, forever.

**Fix:** `import { generatePDF } from 'react-native-html-to-pdf'`, call
`generatePDF({ html, fileName, base64: true })`, and **delete** the hand-written `.d.ts` —
the package ships its own types, which would have caught this.

---

## P1 — crash, or money/records wrong

### 2. Employees screen crashes permanently (`crash`)
`EmployeesScreen.tsx:126` does `ROLE_LABELS[emp.role].toUpperCase()` with no fallback. A
mirror doc missing `role` makes that `undefined.toUpperCase()` — an uncaught render throw,
and **there is no error boundary anywhere in the app**, so the app dies to the launcher and
dies again on every reopen. The owner can then never add, remove or re-role anyone.

Such a doc is reachable: `addEmployee` is non-atomic (callable first, mirror write second),
and `functions/index.js:49` does `.set({ joined: true }, { merge: true })`, which **creates**
`{joined:true}` with no role if the mirror is missing.

**Fix:** fallback on the render side; make the server write the full shape; drop role-less
docs in the listener. **Also worth adding an error boundary at the app root** — one bad
document should never be able to brick a screen forever.

### 3. Two admins double-subtract exception cash (`wrong-number`)
`confirmHandover` is idempotent for the `confirmed` flag but **not** for the khata
correction: each admin re-derives the exception adjustment from their own local state and
applies `increment(-amount)`. Two admins tapping the same card knock **double** off the
shop's balance.
**Fix:** apply inside a `runTransaction` that re-reads the payment and no-ops if already
confirmed — or move it into a Cloud Function on the `confirmed: false → true` transition.

### 4. Removing staff mid-day strands their cash forever (`wrong-number`)
The confirm card only renders for day docs where `handedOver === true`. A removed employee
can no longer write his day doc, so cash he collected before removal can never be confirmed
by anyone.
**Fix:** have `removeEmployee` flip the day doc to `handedOver: true` (Admin SDK bypasses
rules), and build the Action cards from *any* staff id with unconfirmed payments.

### 5. Bill PDF overstates the khata by the new bill (`wrong-number`)
`oldBalance` is read from `store.shops` on **every render**, not captured before the write.
By the time the success screen renders, Firestore's local latency compensation has already
applied the new bill to `shop.outstanding` — so "Previous balance" includes the invoice
being printed.
**Fix:** snapshot the balance before the write and carry it through `setResult`.
*(Note: Round 7 fixed a different bill-total bug — `paidToPrevious`. This one is separate
and still open.)*

### 6. `lastVisitAt` reads back as 0 while the write is pending (`wrong-number`)
`toMillis(null)` returns `0`, and it's the **only** serverTimestamp read in the file without
a `|| Date.now()` guard. So a shop the booker just ordered from reads "never visited" and
stays in "due today" — for the whole day if there's no signal.
**Fix:** read with `d.data({ serverTimestamps: 'estimate' })`, or write a plain client
timestamp alongside. *(Round 7 fixed the sibling `collectionFlagged` case this way.)*

### 7. Rider's "N of M done" counter shrinks as he works (`wrong-number`)
`stops` uses `deliveryDate <= today` (so overdue orders appear) but `done` uses `=== today`.
Deliver an overdue stop and it belongs to neither list — the header goes "0 of 6" → "0 of 4".
**Fix:** make `done` mirror `isDueNow`, or count `deliveredAt >= dayStart`.

---

## P2 — stuck screens and access control

### 8. Cold start hangs up to 70 s on a weak connection
`restoreSession` awaits `admitSignIn` unconditionally *after* the cached claims already
produced a good session. `httpsCallable` has no timeout set, so it uses the 70 s default.
The user stares at a bare spinner. A half-dead cell is the realistic case — airplane mode
actually fails fast and looks fine.
**Fix:** return the cached session immediately, refresh in the background; and pass a short
`timeout`.

### 9. Cannot open the app offline the next morning
`getIdTokenResult(false)` does **not** return a token past its 1-hour expiry — it silently
tries a network refresh, which fails offline. There is no persisted copy of the session, so
the field worker is bounced to Welcome and cannot work at all.
**Fix:** persist `{uid, email, name, companyId, role}` locally on every successful
admission and fall back to it on network failure. This is the single worst one for a
no-signal field app.

### 10. Role changes don't take effect
`restoreSession` gets the authoritative new role from `admit({})` and then **throws it away**,
returning `cached` built from the pre-change claims.
**Fix:** build the session from the callable's response; use the cache only in the offline
catch branch.

### 11. Removed employees keep access, then freeze
Nothing subscribes to `onAuthStateChanged` / `onIdTokenChanged`. `revokeRefreshTokens` only
kills the *refresh* token — the ID token on the phone stays valid up to 60 minutes, and
rules don't check revocation. So FR-1.9's "access cut within about a minute" is not met, and
afterwards the app sits permanently frozen rather than returning to Welcome.
**Fix:** subscribe in `AuthGate` and drop to Welcome with the "access ended" message.

### 12. Midnight rollover drops the rider's route lock
`day` is derived from `rawDay.date === todayKey()` at render time. Past midnight that flips,
`routeStarted` goes false, and the rider is thrown back to the morning "Load the van" screen
mid-route. "Collected today" resets to Rs 0.
**Fix:** treat the working day as open until explicitly closed (handed over), not until the
calendar date changes.

### 13. Camera failure looks identical to cancel
`capturePhotoBase64` returns `null` both when the user cancels **and** when the encode fails
(full storage). The claim form silently refuses the photo with no message; retrying never
works.
**Fix:** return a discriminated result and throw on the failure case so the existing catch
shows a message.

### 14. Sign-out is one unlabelled icon tap, no confirm
The account-switch icon sits in the top-right of every header — where a thumb reaches all
day. It signs out of Google **and** Firebase instantly, with no confirmation and no check
for unsynced offline writes. Signing back in requires internet.
**Fix:** destructive confirm; `waitForPendingWrites()` with a timeout first; refuse with a
count if writes are pending.

---

## P3

### 15. Push notifications never appear on Android 13+ (`cosmetic` — but the whole feature is dead)
`POST_NOTIFICATIONS` is declared in the manifest but never **requested**. RNFirebase's
`requestPermission()` is a hard-coded no-op on Android; it resolves `1 = AUTHORIZED`, so the
app believes it succeeded, saves the token, and the Cloud Functions send happily into
nothing.
**Fix:** `PermissionsAndroid.request(PERMISSIONS.POST_NOTIFICATIONS)` on Android 13+ before
`getToken`.

### 16–18. Duplicates of #6/#8 from other lenses
Same root causes, found independently by the `dates-and-boundaries` and `auth-session-edges`
lenses — kept in the raw output for cross-reference.

---

## Raw output

Full JSON, with per-finding evidence and the verifier's reasoning:

```
/private/tmp/claude-501/-Users-apple-testing/308a07dd-e498-4eab-913d-b3337399a98e/tasks/w3ahvb3tq.output
```

(That path is a session scratchpad and will not survive indefinitely — the summaries above
are the durable record.)

## Suggested order for Round 8

1. **#1 PDF share** — a headline feature that has never worked once
2. **#2 Employees crash** + an app-root error boundary
3. **#9 offline morning start** — worst-case for the actual field environment
4. **#3, #4, #5, #6, #7** — money and records
5. **#8, #10, #11, #12, #13, #14** — session and UX
6. **#15** — push permission
