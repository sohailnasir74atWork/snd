# Handoff — SnD Manager

**Written:** 2026-08-09 · **Last updated:** 2026-08-11 (§1h — three field bugs fixed, the bill book, `versionCode 22`)
**Read this first**, then `OPEN-BUGS.md` (the closed Round 8 backlog — nothing
outstanding, but the "before the next scan" note at the bottom is still live)
and `PROGRESS.md` (the SRS-facing plan).

---

## 1. Where things stand

| | |
|---|---|
| Branch | **`booker-screens-pass`**, 9 commits ahead of `main` and **not merged or pushed** — see §1b, §1c, §1d, §1e |
| Remote | `github.com/sohailnasir74atWork/snd` (**public**) |
| Uncommitted | none |
| Version | `versionCode 22` / `versionName "2.6"` — built 2026-08-11, see §5 |
| TypeScript | 0 errors |
| ESLint | 0 errors (112 warnings, all house style: `no-void`, `no-bitwise`, inline styles; 110 of them predate §1f/§1g) |
| Unit tests | **202 / 202**, 14 suites |
| Rules tests | **243 / 243**, 2 suites — `npm run test:rules` |
| CI | green on every push to `main` — [Actions](https://github.com/sohailnasir74atWork/snd/actions). **The branch above has never been through it.** |
| Device | debug build driven on the emulator (§1b); §1d driven on the emulator in **both debug and a real release build** (R8 on — see §4.0b). ❗ **Nothing in §1c or §1d has been on a real phone** — see §4.1 before publishing |

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
"Mumbai". The functions region is set per-function in `functions/index.js`
(all eight carry `region: 'asia-south1'`; `firebase.json` names no region at
all), and the database was assumed to match it. It does not. Consequences:
every Firestore call from
Pakistan crosses the Pacific (~250 ms vs ~50 ms), every function trigger
round-trips from Mumbai to the US, and multi-region costs more per read, write
and stored GB than a regional location — so any cost estimate computed at
`asia-south1` rates is **too low**.

A Firestore database's location can never be changed. With no real data the
fix is free (delete and recreate, or a new named database); the day a customer
signs up it becomes permanent. The owner has been told and has chosen to
stay on `nam5` for now — that is a decision, not an oversight.

### Deployed to `saleforec-10ce7`

- **2026-08-10, second deploy — staff logins (§1d).** `createStaffLogin` and
  `resetStaffPin` **created**; `admitSignIn` and `removeEmployee` **updated**.
  All four in `asia-south1`, `Deploy complete`, no errors. Backward-compatible:
  a Google sign-in from `versionCode 16` still admits exactly as before.
  ✅ **Email/Password is ENABLED** (confirmed 2026-08-11 against the live
  project — `signIn.email.enabled: true`). It was off when §1d was written, and
  that failed in the way that wastes the most time: the account is created
  server-side and the staff member's sign-in is then rejected, which reads as a
  wrong PIN. §1e made that error say so out loud; the toggle then removed the
  cause. Verify it yourself rather than trusting this line — one call, and the
  answer is not in the repo:
  ```bash
  TOKEN=$(gcloud auth print-access-token); curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: saleforec-10ce7" "https://identitytoolkit.googleapis.com/admin/v2/projects/saleforec-10ce7/config"
  ```
  > The deploy log warns that **Node.js 20 is decommissioned 2026-10-30** —
  > about eleven weeks out. Deployed functions keep serving past that date, but
  > you cannot deploy at all until the runtime is upgraded, and
  > `firebase-functions` is flagged outdated with breaking changes on upgrade.
  > That is its own testing pass, not a drive-by bump.
- **Cloud Functions** — all 8, redeployed in the SaaS round
- **`firestore.rules`** — including the `days` tenant fix (§1a) and, deployed
  **2026-08-09 ahead of the branch that needs it**, `allow delete` on shops for
  an admin (§1b). The live project therefore permits shop deletion whether or
  not `booker-screens-pass` ever ships. Nothing in the installed app calls it.
  - **2026-08-10 — a booker may no longer write `shops.name`.** Owner-only, on
    the same clause that already refused `outstanding`. ⚠️ This is the ONE
    backend change of the round that is **not** backward-compatible: it takes a
    permission away, so any older build that lets a booker rename a shop now
    fails that write. Deployed deliberately, with the owner's say-so, because
    there is no production and he is the only user. Covered by 3 rules tests.
- **`firestore.indexes.json`** — 3 new composite indexes, all `READY`
- **Billing budget** `snd-manager-guard` — $25/month, scoped to this project
  only (the `blox_fruit` billing account carries other projects), alerting at
  50/90/100/150%

> The backend is AHEAD of the installed app, deliberately: every change is
> backward-compatible with `versionCode 13` in the field **except the shops
> `name` restriction above**, which is what makes it safe to deploy the backend
> before the app is device-tested. Check that assumption before the next deploy
> rather than inheriting it — it stopped being free on 2026-08-10.

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

**Many bookers.** `Area.bookerIds` gives a round its territory.
`store.routeShops` is what a booker's screens read. Three cases: nothing
configured → everyone sees everything (so a one-booker business is unchanged);
he has rounds → only his; others have rounds and he does not → the rounds
nobody covers, never an empty screen. Territory is a CLIENT scope, not a rule —
covering a colleague's patch is normal, and the shop picker searches
company-wide on purpose.

> **A round may name SEVERAL bookers** (2026-08-10, owner's decision), so two
> men can work one bazaar on the same morning and both see it. Read it only
> through `bookersOf(area)` in `lib/assignment.ts` — that is the one place that
> knows the single `Area.bookerId` it replaced still exists. The old field is
> read, never written: `setAreaBooker(id, bookerIds[])` writes the whole array
> and deletes the legacy key in the SAME write, because `bookersOf` prefers the
> array and two writes would blink the old booker off his own round in between.
> Nothing splits the street between them — both see every shop on the round,
> and the screen says so. `removeEmployee` pulls one uid out of the array
> rather than deleting the field, or removing one man would take the round off
> his colleagues' screens too.

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

**Lazy collections.** `expenses`, `fixedCharges`, `employeeList` and
`floatMovements` sync only once a screen calls `useNeed(...)`.
Once started they never detach — Firestore re-bills a listener disconnected
over 30 minutes as a new query. **The failure mode is silent:** read one
without declaring it and you get a confident zero, not an error.

**Sales tax.** `computeTotals(items, discount, useDelivered, taxPercent)`.
At rate 0 it returns exactly what it always did, no `taxTotal` key — asserted
by a test. Sales figures use `netOfTax()`; profit needed nothing because
`profitFor` works per line from `unitPrice`.

> **`settings.priceIncludesTax`** (2026-08-10, owner's decision) decides what a
> price the booker TYPES means. Off (the default, and what every existing
> company keeps): he types the goods and tax goes on top — 700 at 17% means the
> shop pays 819. On: he types the final figure and the tax is split back out of
> it — 700 means the shop pays 700, of which Rs 102 is tax and Rs 598 goods.
> Both write the SAME order — a discount percent off the subtotal — so the
> rider's re-bill, the reports and the printed bill need not know which mode it
> was taken in. `discountPercentForTotal` inverts it, and it rounds **down**:
> at 17% no basket bills exactly 15,000 (12,820 → 14,999, 12,821 → 15,001), and
> a shop asked for a rupee more than the booker promised is an argument in the
> street. The Settings row hides itself at rate 0, where the question has one
> answer.

**No standing discount.** `Shop.standingDiscountPercent` is dead — read by
nothing, written by nothing, left on old documents. It applied itself to every
order for that shop without appearing on the order screen, the confirmation or
the bill: the same objection that removed the percent chips. Do not wire it
back up without putting the rate where the booker can see it.

---

## 1h. Three bugs off a real phone, and the bill the owner prints

2026-08-11. The owner ran `versionCode 17` in the field and reported three
things. All three were real, all three are fixed, and none of them was
reproducible on the emulator — which is the lesson worth keeping.

### The crash — `MainActivity` was missing four lines

```
Unable to instantiate fragment com.swmansion.rnscreens.D:
calling Fragment constructor caused an exception
```

`D` is `ScreenFragment` after R8. Its no-arg constructor **throws on purpose**
— react-native-screens refuses to be resurrected by Android behind React's
back. Android was reinstating saved fragment state after killing the process,
which MIUI/HyperOS does constantly. `super.onCreate(null)` throws that state
away. The reasoning and the field stack trace are in the file; do not pass the
bundle back.

> This is why it never showed up here: the emulator does not kill background
> apps the way a real Xiaomi does. A crash nobody can reproduce on a desk is
> the normal shape of an OEM-ROM bug, not a mystery.

### The map froze — three uncapped renders

`AreaSweepScreen` mounted a **native** `<Marker>` per pinned shop, plus a Card
per stop in a plain `ScrollView`. A hundred-shop area built a hundred of each.
Capped at `MAP_MARKERS = 12` and `LIST_STOPS = 25`, each saying what it holds
back. This was §4.12, raised and deferred; the booker hit it.

### Pinning failed "sometimes" — two causes, both fixed

1. **Android 12 "Approximate" was read as a refusal.** Granting approximate
   denies FINE and grants COARSE; the code only checked FINE, so a booker who
   HAD granted location was told he had not. Intermittent because it depends
   on a button he tapped months ago.
2. **One high-accuracy attempt, no fallback.** He pins from inside a shop under
   a concrete roof, where a cold GPS chip often never resolves. Now 12s
   precise, then a 10s wifi/cell fix rather than a refusal. `maximumAge: 0` on
   BOTH passes — the fallback buys speed with ACCURACY, never with staleness,
   because a stale fix pins this shop to the last one's doorway.

### The bill book — More → Bills

Every order with paper in it, undelivered first (the rider cannot leave
without those). Tick, download, and it moves to **Printed** and out of the way
— kept 30 days, re-printable, with a *Not printed* undo. The mark is
device-local (`lib/billLog.ts` + `features/admin/billDownloads.ts`) and the
trade is written up there: worst case is printing a copy twice, where the
Firestore version's worst case is believing a bill was handed over when it
never was.

**The sheet** is A4 **landscape**, three columns, cut top to bottom. It was
four-up portrait first and the owner rejected it on sight; then three portrait
columns, too skinny; turning the paper gave each slip 99mm. Item rows pad out
with **ruled blanks** to `minRows` the way a paper invoice book does, and the
footer — booker, rider, two signature lines, warranty — is pushed to the foot
with `margin-top: auto`. Page one is an optional **load sheet**: every product
totalled across the run with the per-shop split under it, which is what turns
one heap of 54 into nine piles.

- **`displayName`** (`lib/name.ts`) fixes shop names on paper only —
  `ss bakar` → `SS Bakar`, `u mart` → `U Mart`, `DOLLAR MALL` → `Dollar Mall`.
  Never written back: correcting what a person typed about their own shop is
  not the app's business, but a bill is the document they keep.
- **The warranty is Form 6** now, citing the DRAP Act 2012 and the Alternative
  Medicine and Health Products (Enlistment) Rules 2014. ⚠️ It is a
  RECONSTRUCTION, not a copy of the prescribed form, and nobody has had it
  checked. Settings → Company → *Bill small print* overrides it completely.

### The owner can reprice an order — More → Bills → Edit

`repriceOrder` changes unit prices on a `booked`/`assigned` order and
recomputes totals; the rules already allowed an admin to update orders, so
there was no rule change and no rules-test risk. **Prices only** — quantities
move `committedQty`, and a stock correction hidden inside a price screen is
how stock stops matching the shelf.

### What is NOT done

❗ **None of §1h has been driven on a device.** The three field fixes are
reasoned from a stack trace and from the library's own source, and the Bills
screen has only ever been rendered to PDF and read at full size. §4.1's
checklist has not moved.

---

## 1g. The bill book — the owner's own copies, three to a page — NOT COMMITTED

2026-08-11, same working tree as §1f. `npm run test:rules` not re-run (nothing
touches the rules); **159 tests**, 0 TS errors, 0 lint errors. Never bundled,
never on a device — see "what was NOT checked" at the end of §1f, which now
covers this too.

### Why it exists

The rider WhatsApps each shop its bill at the door and that is untouched. The
owner wanted the other copy: the stack in his own hand, to file and to hand
out. One A5 bill per sheet turns a forty-bill day into forty pages.

### Three to a page, cut straight across

`billSheetHtml` in `documents/templates.ts` — A4, `BillsPerPage` of 2, 3 or 4,
**default 3**. Not a taste decision:

> A bill's item table is four columns and the product NAME is the one that
> needs the width. A 2×2 grid halves it to 105mm and "Sunblock SPF50 90ml"
> wraps onto two lines while three quarters of the cell sits empty underneath.
> Full-width strips spend the paper where the content is. The cutting is also
> two straight passes with no cross-cut to line up — which matters when it is
> done every day. **4 was the first default and the owner rejected it on
> sight; do not quietly restore it.**

- **The caps are measured, not guessed.** `SHEET_LAYOUTS[n].maxItems` came off
  a rendered A4 (2→20, 3→12, 4→14) and sits near half of what fits, because a
  wrapping name takes two rows and a cell CLIPS rather than flows.
- **A long basket is summarised, never silently cut.** Over the cap the slip
  prints `+ N more items — TOTAL below covers all M`, and the TOTAL still
  counts every line. A slip that quietly dropped two lines would be filed, and
  wrong, and nobody would know.
- **Blank cells are drawn on a part-full last page**, so the last sheet cuts on
  the same lines as every other.
- Logo and warranty ride on **every** slip. These get cut apart and handed
  over: terms that exist only on the sheet the owner keeps were never given to
  the buyer.

### The warranty block

`settings.warrantyText`, free text, with `DEFAULT_WARRANTY` in `data/models.ts`
as a starting point. Modelled on the Form 2A block the pharma distributors
print, and **deliberately a fraction of its length** — that one is long because
the Drugs Act prescribes its wording nearly clause by clause, and none of that
applies here.

> ⚠️ **Cosmetics are not drugs.** In Pakistan they sit under the DRAP Act 2012
> and the Cosmetics Rules 2020, not the Drugs Act 1976. Printing a drugs
> warranty on a face wash claims a compliance the goods were never assessed
> for, so the default names the cosmetics instruments instead.
>
> ⚠️ **It is a TEMPLATE and nobody has had it checked by a lawyer.** It is
> editable for exactly that reason, and clearing the box prints no block at all
> rather than a wrong one. Settings → Company → *Bill small print*.

The Settings field seeds from `s.warrantyText ?? DEFAULT_WARRANTY` — absent
key, not empty string. `?? ''` would have been the bug: an owner who cleared
the box would find the default back on his next visit, and on his next bill.

### The screen

`features/admin/BillsScreen.tsx`, More → **Bills**. Delivered orders only
(nothing else has a bill), newest first, Today / 7 days / All, tick and
download. `Open full bill` per row still produces the rider's real A5 invoice.

- **`paidAgainstOrder`** (`lib/order.ts`) sums every non-voided payment's
  allocation to that order. It counts UNCONFIRMED payments deliberately:
  `confirmed` means the owner has the cash, not that the shop paid. Ignoring
  the rider's satchel would dun a shopkeeper for money he handed over that
  morning.
- **The reprint passes `previousBalance: 0` and that is not laziness.** The
  khata as it stood before a bill months ago cannot be reconstructed from a
  delivered order, and a wrong "previous balance" on a reprint is worse than
  none. The rider's copy at delivery time is the one that carries it.
- The screen says the window out loud — 90 days plus anything unpaid. "All"
  means all of THAT, and an owner hunting last year's bill deserves to know
  why it is not there.

---

## 1f. Rupees off, and what a morning was actually worth — NOT COMMITTED

2026-08-11, the owner's two asks. Green (0 errors / 0 errors / **141** tests,
up 9) but sitting in the working tree, and **nothing has been on a device or
even in an emulator** — not the screens, not a bundle. Two screens, one shared
piece of order math.

### The booker may now say it either way round

§1b replaced the percent chips with a typed **Discounted price**, and that was
right: rupees is what the two men are arguing about. But it only accepted the
haggle phrased one way. Half of them end on *"take forty off"* rather than
*"give it to me for six sixty"*, and the booker was left doing the subtraction
in his head at the counter with the shopkeeper watching — which is exactly
where a bill ends up a rupee away from what was said out loud.

There are two boxes behind the same chevron now: **Discount — rupees off** and
the existing price box. Type either, the other fills in **on every keystroke**,
not on blur: they disagree for precisely as long as somebody is looking at
them otherwise.

- **`priceText` is still the only source of truth.** The off box writes into
  it and nothing else reads the off box, so it cannot introduce a figure the
  stored percent will not reproduce. Everything §1b says about why the ORDER
  stores a rate — the rider re-bills against delivered quantities — is
  untouched.
- **Both derive against `priceCeiling`**, which is full price on whichever
  basis this company types in: goods, or goods with the tax already inside
  (`settings.priceIncludesTax`, §1a). Mix the two bases and "40 off" quietly
  becomes 47 off at 17%. There is a test pinning exactly that.
- **`priceForDiscountAmount` / `discountAmountForPrice` do NOT clamp to the
  owner's cap**, deliberately. The percent functions already clamp on the way
  to a stored rate, and clamping in the box as well rewrites digits under the
  booker's thumb — he types `4`, then `0`, and a cap-clamp on the first
  keystroke turns "40" into a number nobody asked for. The hint line tells him;
  the field does not argue back mid-keystroke.
- **Both boxes empty together, through `clearPrice()`.** Five call sites clear
  the price — a new shop, two quantity paths, reset, "Different shop" — and a
  cleared price beside a surviving "40 off" is a screen promising something the
  order does not contain. None of the five gets to remember only half.
- The hint quotes the cap **both ways** now (*"at most Rs 1,440 off, so
  Rs 12,960 is as low as you go"*), because either box may be the one he is
  staring at when he hits it.

### The dashboard said how many, never at what

The owner's tiles carried **Orders today** and no way to tell whether twelve
orders was a good morning or a poor one — 40 pieces and 400 pieces looked
identical, and the answer was three taps away in Reports. Two tiles added:
**Pieces booked today** and **Value booked today**.

> ⚠️ **They count a different set of orders from the two tiles beside them,
> and that is not a bug.** `todayOrders` is anything that MOVED today, which
> sweeps in yesterday's bookings going out on today's van — the right
> denominator for a delivered ratio, the wrong one for "how much business did
> we take". The new pair filters on `bookedAt`, so an order written this
> morning for Thursday lands in them and in neither of the others. The labels
> say **booked** out loud for that reason. Do not "fix" the two to agree.

Value is **net of tax**, matching TODAY'S SALES directly above it — tax inside
a booked order is money this business collects and hands straight on, and a
tile that quietly included it would disagree with every sales figure on the
same screen by exactly the tax rate.

`totalQty(items, useDelivered)` is new in `lib/order.ts` rather than a `reduce`
in the screen, per the rule at the top of that file. Its `useDelivered` twin
mirrors `computeTotals` for the same reason: an absent `deliveredQty` must
count as nothing delivered, or a van that left full reports a full delivery.
That case has a test.

### What HAS and has not been checked

✅ **§1f was driven on the emulator** (`Pixel9_API35_ARM`, demo store,
2026-08-11). Check 9 passes in full: typing 40 into *rupees off* moved the
price box to 860 on the keystroke, the Discount row read -40, TOTAL and the
Confirm button both read 860; changing a quantity then emptied BOTH boxes and
put the hint back to "up to Rs 240 off". Check 10 is **half** done — the two
new tiles render with the right labels, icons and grid, but their NUMBERS were
not verified: switching role in demo mode re-seeds the store, so the order
booked as the booker was gone by the time the owner's dashboard opened. The
arithmetic is covered only by the lib tests.

⚠️ Two traps cost an hour and will cost the next person the same:
> **A stale Metro on port 8081 serves a stale bundle**, silently — the first
> run showed the OLD single-field panel and looked like the code had not
> landed. `curl localhost:8081/status` says `running` either way. Kill it and
> restart with `--reset-cache`; do not trust a debug build's JS until you have.
>
> **`installDebug` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`** if the
> release APK from §1d is still on the device. `adb uninstall
> com.apptechsolutions.fieldsales` first; it costs the signed-in session and
> nothing else.

§1g is **static only** — `tsc`, `eslint`, `jest`, plus the A4 output rendered
through headless Chrome and read by eye at full size (that is how the item caps
were set). **No emulator, no bundle, no device** for the Bills screen.
`npm run test:rules` was not re-run: nothing in this round touches
`firestore.rules`, the stored order shape or any store method, so it should be
untouched — but "should be" is not the same as watched. See §4.1 checks 9–10.

---

## 1e. The ninth commit — `7016b37`, and why it is nearly obsolete

`auth/operation-not-allowed` fell through to a bare throw, so a rider whose PIN
was correct got a raw Firebase SDK string through the generic "Sign in failed"
alert. Every word of it pointed at the credentials and the credentials were
fine: Email/Password was switched off in the console and Firebase refuses
before it ever looks at the account. The message now leads with *"your PIN is
fine"* and names the console — the only place in the app that says the word
Firebase, and it earns the exception because this error has exactly one cause
and exactly one fix.

The provider was enabled the next day (§4.0), so this path should now be
unreachable in the live project. **Leave it in.** It is the error a fresh
Firebase project throws on day one, and the next person standing this app up
somewhere else meets it before they meet anything else.

⚠️ This commit is **not** in the `versionCode 17` AAB on disk — that bundle was
built at 20:31 and this landed at 22:08. See §5.

---

## 1d. Two doors — staff logins, the artwork, the eighth commit

The newest commit on the branch. As with §1c, no hash is quoted: this section
ships inside the commit it describes.

Green locally (0 / 0 / 132) and driven on the emulator — the welcome screen,
the two-door fork and the Credential Manager sheet were all screenshotted on
`Pixel9_API35`. **No real phone, and no release build has been opened**; the
AAB for `versionCode 17` was produced from this commit but not installed.

### The question that started it

*Is it logical to recruit an employee and make them sign in with Gmail?*

No, and the code said so louder than anyone did. The owner had to type his
rider's Gmail address **exactly** into the Employees screen — an address the
owner does not know and the rider frequently does not either, because his
handset was set up for him at the shop he bought it from. One wrong character
and the rider's first morning is a refusal screen and a phone call. That sat at
the highest-friction minute of the whole product.

Salesforce, Shopify POS, Square and every field-sales tool in this market do
the same thing instead: **the org provisions the identity**. Consumer OAuth is
for self-service signup — the person paying. So:

| | How they sign in |
|---|---|
| Owner / admin | Google. They are signing themselves up, they have a real address, and Google carries recovery so there is no helpdesk to build |
| Booker / rider | A login ID and a 6-digit PIN **the owner issues**. No Gmail, no SMS, no Play Services |

**The synthetic address.** Firebase Auth needs a globally unique email, so one
is made up from the company's own code — `ali@alitraders.snd.app` — and shown
to nobody. The man types `alitraders`, `ali` and six digits. `parseStaffEmail`
in `auth.ts` reads the pair back out of the address rather than storing them
separately, which is what keeps the "continue as" hint correct through
`refreshAdmission` — that function re-remembers the account on every restore
and has no idea which door the person came in by.

**Company codes.** `reserveCompanyCode` claims one in a transaction against
`companySlugs/{code}`, derived from the business name so a rider can be told it
once. Minted at business creation, and lazily by `companyCodeFor` for any
business that predates this. Mirrored onto `settings/company.companyCode`
because that is the document every client already listens to.

**This kills the one-email-one-business ceiling, for staff.** `employeeDirectory`
is keyed by email, so a person could only ever belong to one company — a real
problem for a generic app the moment a rider works for two distributors. Each
tenant now mints its own identity in its own namespace, so the same human can
hold three. **Owners still have the ceiling**; that is unchanged and still a
trap (§3).

**Six digits, never leading zero.** Firebase Auth rejects passwords under six
characters, so four was never available. A leading zero is dropped by half the
people who copy a number onto a slip, so `newPin()` starts at 100000.

**`removeEmployee` got harder.** It revoked refresh tokens, which leaves an
account that can still authenticate — it just gets a claimless token. It now
**disables** the account, and for a PIN login that is the only stop that
matters, because the ex-rider knows his own six digits. It also renames the
address to a tombstone so the next man on the round can be `ali` too; the uid
is untouched, so the old man's days, cash and orders stay attached to him.

**A PIN reset revokes tokens, and that needed its own sentence.** Removal and a
reset look identical to the phone — a dead token either way, with no way to ask
which. `strings.signIn.signedOutRemotely` covers both and accuses nobody;
telling a rider whose PIN was just reset that his access was "ended by the
owner" reads as being fired.

⚠️ **A 6-digit PIN is brute-forceable if a login ID leaks.** Firebase's own
throttling is the only thing standing there right now — `too-many-requests` is
handled and the refusal never says which of the three fields was wrong, which
is deliberate. **App Check plus a server-side lockout is the real fix and is
NOT done** (§4).

### The welcome screen was lying

`onSignIn('employee')` and `onSignIn('owner')` called the identical function.
The intent changed the wording of a REFUSAL and nothing else, so the screen
offered a choice, ignored it, and carried a line underneath — *"Both sign in
with Google — we know who you are"* — admitting as much. The fork is real now,
and that line is gone because it has nothing to apologise for.

**The wizard was the worse version of the same bug.** Its step 4 was Gmail-only,
so a brand-new owner on his very first run was walked straight into the friction
this whole round exists to remove, four screens before he would ever find the
Employees screen. It now carries the same App-login/Google toggle.

### The artwork

`react-native-svg@15.15.5` was added — a **native dependency**, so a JS reload
will not pick it up. It compiled clean against RN 0.86.2.

`BrandHero` draws the tagline instead of decorating around it: a van on a round,
a shop with a teal awning, a dashed route with a stop pin, and a khata page with
a line ticked off. `StaffHero` draws the slip the man is holding — three lines,
the last of them six dots. Every colour is a theme token; the two literals are
the logo teal and a deeper crimson used only as the van's own shading, neither
of which is a UI colour.

The dark SnD square that used to head this screen is **gone**. With a scene
above and the wordmark below it was a third brand statement competing with both.

`EmptyState` gained a concentric ring — one component, 21 screens. The ring is
absolutely positioned so the disc keeps the layout box; nothing shifted.

### Credential Manager — the bottom sheet

The centred "Choose an account" dialog is drawn by Play Services and **cannot be
styled, moved or themed by any app**. The bottom sheet is a different API —
Credential Manager — and the installed `@react-native-google-signin/google-signin`
is the free tier, which its own README says uses the legacy SDK. The premium
package has it; rather than buy a licence, there is now an app-local native
module.

`CredentialSignInModule.kt` — `GetGoogleIdOption` → `getCredentialAsync` →
`GoogleIdTokenCredential`. It returns **the same ID token** the legacy path
returns, so `GoogleAuthProvider.credential()`, `admitSignIn` and every claim
downstream are untouched; Firebase cannot tell which door it came through.

- **Plain `ReactContextBaseJavaModule`, not a codegen TurboModule.** The New
  Architecture's interop layer serves legacy modules unchanged, and a codegen
  spec for one method is machinery without benefit.
- **`reactApplicationContext.currentActivity`, not the module's own.**
  `ReactContextBaseJavaModule` no longer exposes `getCurrentActivity()` in RN
  0.86. Credential Manager requires an Activity and rejects an app context.
- **`setAutoSelectEnabled(false)`.** It will otherwise sign somebody in with
  zero taps. On a screen forking between two different people, silently picking
  the handset owner's account is the wrong answer on a shared phone.
- **Two passes.** Filtered first, so a returning owner gets a one-row sheet;
  that pass fails rather than showing an empty one, so the second asks for every
  account. **Only `no_credential` retries** — stale Play Services or a bad
  client id fail the same way twice. A cancel is never retried.
- **The legacy flow is still there and still reachable.** Any phone Credential
  Manager cannot serve gets `'unavailable'` and falls through to
  `GoogleSignin.hasPlayServices()` exactly as before. This is a nicer front
  door, not a replacement. iOS is untouched.

**ProGuard — checked, not assumed.** ✅ The Google credential classes are
resolved reflectively by type string, so R8 cannot see the use and would strip
them: the failure mode is a sheet that works in every debug build and dies only
in release. Keep rules are in `app/proguard-rules.pro`, and a release APK from
this commit was installed on the emulator and the sheet opened — no
`ClassNotFoundException`, clean logcat. `react-native-svg` survives R8 too.
Do not remove those rules because "nothing seems to use them"; nothing visibly
does, which is the entire point.

---

## 1c. The 2026-08-10 round — owner's requests, the seventh commit

The seventh and newest commit on the branch — `git log -1` on
`booker-screens-pass` while nothing newer has landed. No hash is quoted here on
purpose: this section ships INSIDE that commit, so any hash written in it names
the amend before last and is wrong the moment it is read.

One commit rather than seven, because the eight changes interleave in the same
screens and a per-theme split would have produced commits that claim one thing
and contain another. The message breaks them out; so does this section.

Green locally (0 / 0 / 132 / 243) and installed on the emulator. **None of it
has been driven on a real phone**, and §4.1 has grown from five checks to eight
because of it.

**Counter staff moved onto the shop, properly.** The register form on the
booker's My Day is gone — its third question was "which shop does he work at?",
asked of a man standing inside it. They are registered on the Add-shop form and
edited through `CounterStaffSection` behind Route → *Edit details*, which is
where the owner's shop editor already kept them. `ShopInput.counterStaff` lets
a shop be created with them in one write.

**A booker cannot rename a shop.** Rules-enforced (see §1 above), and the field
is read-only on his form. Everything else about a shop is still his to fix —
`settings.bookerEditsShops` (default ON, absent means ON) takes that UI away if
the owner wants it, but that switch is a CLIENT scope like territory: a rule
cannot read a settings document without a lookup and these rules do none. The
name is a right; the rest is a preference. Do not confuse the two.

**A logo on the bill.** `settings.logoUrl` is a CDN string; the bytes are
cached per device in `lib/logoCache.ts` and embedded as a `data:` URI, because
`react-native-html-to-pdf` fetches a remote `<img>` and the rider printing it
is standing in a street. Size standard and its reasoning in `lib/logo.ts`
(≥200px or it prints blurred, downscaled to 512, ≤200 KB). Absent is normal:
the header falls back to the brand name, and a bill never fails over a picture.

**WhatsApp opens the shop's own chat.** `sharePdf` takes a recipient and uses
`Share.shareSingle` with `whatsAppNumber`; react-native-share's Android code
starts `com.whatsapp.Conversation` first, so it works for a number that was
never a contact. The old comment in that file called this a platform limit — it
is not. The plain share sheet is still the fallback and must stay one.

**Two icons did not exist.** `receipt-text-outline` and `truck-alert-outline`
are not in the bundled MaterialCommunityIcons font and drew a "?" on device,
silently. Check `glyphmaps/MaterialCommunityIcons.json`, never the MDI website,
which lists icons newer than this package ships.

**`Tag` no longer sets its own `alignSelf`.** It carried `flex-start`, which
beats the parent's `alignItems` — so a pill overruled every container it was
dropped into: top-aligned beside a Chip (NO PIN), left-aligned inside a
right-aligned column (Employees). Every container holding one now states an
alignment; the one tag that lives in a column wraps itself in a `flex-start`
View. Do not put `alignSelf` back on it.

**`StoreApi.demo`.** True only in preview. Screens must NOT branch on it — that
is how the two stores drift — and it exists for the one thing preview cannot
do: reach a Cloud Function. Today that is the logo upload, which preview fakes
locally so the demo's bills carry a logo.

The app builds are **not** all uploaded. The owner uploaded `versionCode 8`; 9 through 13
were handed over as AABs and may or may not have been published.

---

## 1b. The booker round — six of the seven commits, NOT MERGED

Everything below is on that branch. `main` is still at `77ac64e`. It is green
locally (0 / 0 / 104 / 240) but has never been through CI, and CI is the only
thing that runs a real Metro bundle — see §5.

```
4104476  Release 2.1 (versionCode 16), and a handoff that matches it again
655e5dd  One shop list: the round, and everything else behind a magnifier
8f4bc33  Owner screens: type the rate, require the area, delete the shop
475b6ad  The owner may delete a shop, and booking starts on Tomorrow
a816124  Cards sit in the canvas rather than on top of it
f30b0ad  Negotiate an order in rupees, not in percent chips
```

**The discount is a typed price now.** The row of `0% 2% 5% 10%` chips on New
Order is gone — it sat at eye level on a phone the shopkeeper was looking at
across his own counter and announced there was money on the table before the
booker had decided to put it there. In its place, a chevron on the TOTAL row
opens a **Discounted price** field in rupees. Closed, nothing on the card
mentions a discount at all.

`discountPercentForPrice(subTotal, price, maxPercent)` in `lib/order.ts`
inverts it, and the percent it returns is **deliberately unrounded**:
`computeTotals` rounds the rupee amount, so an exact percent lands on exactly
the price that was typed. The order still STORES a rate, because the rider
re-bills against delivered quantities and a rate survives a short delivery
where a fixed rupee concession would not. Documents round it for display.

> Changing any quantity CLEARS the typed price. A price is agreed for a
> basket; keeping it while the basket changes turns "700" for one face wash
> into 700 for eleven of them. The owner's cap is a floor under the price,
> and a second confirmation is not involved — it simply clamps.

**New Order also shows tax now.** It computed its TOTAL without `taxPercent`
while `bookOrder` stored the order WITH it. Identical at rate 0, which is why
nobody saw it; wrong the moment a rate is set, and the new field's meaning
depends on it.

**Booking always starts on Tomorrow**, hardcoded. The `defaultDeliveryDay`
setting is off the Settings screen and nothing reads it; the field stays on
the model rather than migrating every company. The live company doc still
stores `"today"` — harmless, and left alone deliberately.

**Route was rebuilt.** It rendered the whole territory into a `ScrollView`, so
every card was mounted — seven areas at a hundred shops is 700 cards on a 3GB
phone. Now:

- **One area at a time, always.** A chip row with due counts, no "All" chip and
  no unfiltered state. It falls through to the first area with work rather than
  trusting the stored name, so an area renamed or retired under the booker's
  feet leaves him on a real round.
- **One line per shop** — name, owed, `Book`, chevron. The other five actions
  (Edit details, Shelf count, pin, photo, and the two money ones) live under the
  chevron, one card open at a time.
- **Capped at `shopsPerDay`** with `Show N more`. The *visited recently* toggle
  is capped as hard — it was quietly the worse offender, since most of a
  territory is not due.

**"New order" is no longer a tab.** Three tabs: `Route · Map · My Day`. A tab
has to stand on its own, so New Order opened on a picker listing his whole
round grouped by area — the Route screen drawn a second time from the same
shops, with none of the capping. Booking is now something you do TO a shop:
Route → `Book` → the order form, pushed onto a stack. The shop that is not due
today lives behind the **magnifier in the Route header** — `ShopSearchScreen`,
company-wide, capped at 40 results.

> `BookerRouteStack` in `navigation.tsx` carries `onSwitchRole` explicitly:
> the tab's own header is gone, so the account switch lives on the stack
> header beside the search. Losing it there would strand a two-role user.

**An area is required to save a shop** — booker form, owner form, shop editor
and the wizard. The wizard's silent `'Main area'` fallback is DELETED; that
default is where §4.10's invisible shops came from. Area also moved out from
behind "More" on the owner's form, because a required field behind a
disclosure link is a form that refuses to save for an invisible reason.

**The owner can delete a shop** (`isAdmin` only, rules-enforced). One alert
normally; a shop that owes money is asked twice, because orders keep a frozen
`shopSnapshot` but the live khata lives on the document being deleted.

**A booker can edit a shop's detail from the round.** The rules always let him
write a shop — everything except `outstanding` — and only the screen was
missing. The balance is deliberately absent from that form.

**Settings rates are typed, not picked.** Sales tax, shops per day and the
counter staff's reward per piece. `Max discount` and `Reward approval limit`
are off the screen but still ENFORCED on their stored values (10% and
Rs 1,000) — the controls went, the behaviour did not.

**Card shadows.** `elevation` is 0; depth is a hairline `color.cardEdge` plus a
wide, faint iOS shadow. At 2 it drew a grey Material bar under every card,
which on a hundred-shop round is a hundred grey bars.

### What was actually driven on a device

A debug build on the emulator (`Pixel9_API35_ARM`), signed in as a real booker
against `saleforec-10ce7`: the area chips and one-area list, the collapsed
row and its chevron, `Edit details` opening prefilled, the TOTAL-row chevron on
New Order, `Tomorrow` selected by default, three tabs, and the magnifier
opening `Find a shop`. **Not** driven: delete shop, the area-required guards,
the typed settings rows, and anything at all in a release build.

---

## 2. What the app does now that it did not

**Shop photos and GPS pins.** A booker or rider standing at a shop can save a shopfront
photo (camera → Bunny CDN → `shop.photoUrl`) and drop a GPS pin (`shop.location`). The pin
screen shows accuracy and warns past 30 m. **Saving never depends on the map loading** —
the pin is the GPS fix, so a grey square on one bar costs only the ability to double-check.

**Areas are a managed list.** `companies/{c}/areas`. The owner may rename, retire and put a
rider or booker on a round; a BOOKER may only create one, and only when what he typed
matches nothing — he is the one standing in a street the company has never worked. Shops still store
the area NAME (no migration; orders carry a frozen `shopSnapshot.area`), so renaming an
area fans the new name out to every shop under it in one batch. Every shop form picks from
a searchable sheet — `components/AreaSelect.tsx`. The **wizard is the one place a name may
still be typed**, because on first run there is nothing to pick from, and it registers what
was typed as a real area on the way past.

**The area sweep** (`features/shops/AreaSweepScreen.tsx`) — a Map tab for booker and rider.
Pick a round, get an ordered stop list nearest-first, a live map with your own dot, live
distance and heading, arrival detection at 40 m, mark-and-advance. Entirely in-app;
"Open in Google Maps" survives as a small link for the long hop into an area.

**Counter staff live ON the shop** — `Shop.counterStaff?: CounterStaff[]`, optional and
usually absent. They used to be their own `rewardStaff` collection, which put the answer to
"who sells for us here" a join away from the shop it was about. Phone is optional; a name is
the whole requirement. `features/admin/CounterStaffSection.tsx` sits inside the shop editor,
and the shops list shows "*n* counter staff" per row. The company-wide flat list
(`store.rewardStaff`) is DERIVED from the shops, never stored, so it cannot disagree with
what the shop editor shows. The old collection has no rule at all now, so an old build that
still writes there fails loudly rather than maintaining a second, divergent list.

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

0. ~~**Email/Password is NOT enabled in Firebase Auth.**~~ **DONE 2026-08-11.** ✅

   Confirmed on the live project, not taken on trust — `signIn.email.enabled`
   is `true` (the curl is in §1). The staff lane is no longer dead at the
   provider.

   What that does **not** prove is that the lane works end to end. Nobody has
   walked it: Employees → Add employee → App login → create → note the slip →
   sign out → **I work for a business** → type the three fields. Do that before
   believing §1d.

0a. **App Check and a PIN lockout are NOT done.** ⚠️

   A 6-digit PIN plus a known login ID is brute-forceable, and Firebase's own
   throttling is the only thing in the way. The refusal deliberately never says
   which of the three fields was wrong, and `too-many-requests` is handled — but
   that is mitigation, not a fix. App Check plus a server-side failed-attempt
   lockout is the real answer. Do it before a real customer holds real khata.

0b. **`versionCode 17` has not been on a real phone** — but the release build
   HAS been driven. ✅ ⚠️

   The ProGuard question is **settled**. A release APK from this exact commit
   (`assembleRelease` — R8, `minifyEnabled` and `shrinkResources` all on, the
   same pipeline the AAB uses) was installed on the emulator, and the Credential
   Manager sheet opens: no `ClassNotFoundException`, no crash, clean logcat. The
   keep rules in `app/proguard-rules.pro` are proven, not assumed. `react-native-svg`
   also survives R8 — both illustrations render in release.

   What that does **not** cover: a real handset, real Play Services, and an
   actual account tap. The emulator's Play Services is not the field's. Still
   worth five minutes on a real phone before anyone else holds it.

1. **`versionCode 16` HAS NOT BEEN DRIVEN ON A PHONE.** ❗

   The AAB is built and signed. Nobody has run it. The SaaS round replaced
   four load-bearing assumptions, the booker round (§1b) then rebuilt three
   screens and removed a tab, and `firestoreStore.tsx` still has no unit
   coverage — so 104 green tests say the code is internally consistent, not
   that a rider's phone behaves correctly on a market street. The emulator
   pass in §1b covers the new SCREENS; it covers none of the four checks
   below, which are about money.

   **Do these four before publishing to any track that reaches a real user.**
   Roughly 30 minutes with `./gradlew installDebug`:

   | # | Check | What it proves |
   |---|---|---|
   | 1 | Deliver an order, pay part of it, then Collect the rest at that shop | The open-slice listener. **Highest risk in the round** — if this is wrong, cash allocates to nothing and is booked as `unallocated`. |
   | 2 | Turn wifi and mobile data off, book an order | The window keys on `deliveryDate` precisely so this cannot break. If the order vanishes from the booker's own list, the window is wrong. |
   | 3 | Add a second rider, put him on a round in More → Areas, book into it | Multi-rider assignment. Before this round every order went to one rider regardless. |
   | 4 | Settings → Sales tax → 17%, deliver, open the bill PDF; then set it back to None | The tax line, and that sales in Reports stay net of it. New Order now shows the tax too, so the booker's TOTAL and the stored order must agree. |
   | 5 | Open the price chevron, type a price below the cap, book | The typed-price field (§1b). At the cap it clamps; the bill must charge the price on screen. |

   | 6 | Settings → Sales tax 17% → turn ON "Booker types the final price", type 700, book | The tax-inclusive mode (§1c). The card must read TOTAL 700 with a tax line inside it, not 819, and the stored order must agree. |
   | 7 | Send an order confirmation from the booker's confirmation screen | WhatsApp must open **that shop's chat**, not the contact list (§1c). Falls back to the share sheet if WhatsApp is absent — that is correct, not a failure. |
   | 8 | Set a logo in Settings, then deliver and open the bill PDF | The logo pipeline (§1c). Then turn the phone's data off and open a bill again: the logo must still be there, because it is embedded, not fetched. |
   | 9 | Open the chevron, type **40** in *rupees off*, watch the price box; then change a quantity | The two-box discount (§1f). The price box must follow every keystroke, the TOTAL must drop by exactly 40, and the quantity change must empty **both** boxes — a surviving "40 off" beside a cleared price is the failure to look for. |
   | 10 | Book two orders, then open the owner's dashboard | *Pieces booked today* and *Value booked today* (§1f). Pieces must match what was typed; value must be net of tax at a non-zero rate, and must NOT equal the delivered figure in the hero card. |

   If all of them behave, the round is safe to publish. If one misbehaves, that
   is the bug — start there, not in the rules.

   > Checks 6–8 were added on 2026-08-10 with §1c, 9–10 on 2026-08-11 with
   > §1f. The list grows because the round grows, not because the earlier ones
   > got easier: the tax mode changes what a bill totals, the logo changes what
   > a bill contains, and the discount box changes what the shop is charged.
   > None of them has been on a real phone.
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
9. **Not re-audited.** Nobody has run a fresh adversarial scan since Round 8. The
   largest new surfaces are the sweep, the areas migration path, the workday
   derivation, and now the whole booker round in §1b — the typed price in
   particular, because it is the one new control that moves money.
10. Two shops in the live database sit under "Main area" (the wizard's fallback) and two
   have no area at all, so they are invisible to every round. Fixable from
   More → Areas → *Found on shops, not on this list*. The wizard can no longer
   CREATE this state (§1b), but it does not clean up what it already made.
11. **Route and My Day still look alike**, and they are not the same thing: Route
   lists shops still to visit, My Day lists orders already booked. They never
   overlap — booking stamps `lastVisitAt`, so a shop leaves one screen exactly as
   it arrives on the other — but both lead with a bold shop name and a number on
   the right. Agreed fix, not built: lead a My Day row with the order number and
   status instead.
12. **The Map tab is not scoped like Route.** The sweep reads `store.shops`, so a
   booker sees every area in the company rather than his own, and it walks ALL
   active shops in an area rather than the ones that are due — at a hundred shops
   on a 35-day cycle that is 100 stops to reach about 3. Raised and deliberately
   deferred by the owner; unpinned shops staying listed-but-not-routed at the
   bottom is the behaviour he wants.
13. **The shop lists are still not virtualised.** Route, the sweep and
   `ShopSearchScreen` are all capped (a page of `shopsPerDay`, 40 results) which
   keeps a normal morning under twenty mounted cards — but a booker who taps
   *Show more* five times is back to a hundred. `FlatList` is the real fix and is
   now a small change, because each list is a single flat capped array.
14. **A provisional serial is never promoted.** Offline sync itself is sound —
   Firestore disk persistence is on (RNFirebase's default; nothing turns it
   off), no field flow awaits the server, sign-in works from the cached token's
   claims, and `flushPendingWrites` blocks sign-out while the queue is dirty
   ([App.tsx:42](App.tsx#L42)). The gap is only in the NUMBER. `serial()` races
   the counters transaction against a 4-second timeout and falls back to
   `LOCAL-ORD-7` from an MMKV device counter, and the header of
   `firestoreStore.tsx` says those "are promoted at sync" — **nothing
   implements that.** No client code rewrites the serial and none of the eight
   Cloud Functions touches `orderNo`/`invoiceNo`/`receiptNo`, so a document
   written with no signal keeps its local reference permanently.

   The reference is at least unique — the counter is per-device and
   synchronous, so two documents made back to back offline cannot collide —
   and since 2026-08-10 every screen and every printed sheet that shows one
   marks it `PROVISIONAL` and says where it came from, rather than passing it
   off as a company serial. That closes the honesty half; the promotion half is
   still open.

   Promotion is not a small change, and it is a business decision before it is
   a technical one: the shop is already holding paper with the old number on
   it, so a server-side rewrite means the phone and the customer's copy
   disagree. The cheap alternative is to keep the local reference as the
   permanent one and make it collision-proof across devices (seed the counter
   with a short device id), which needs no promotion at all. Decide which
   before building either.

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
  caller. Plus a named regression test for the `days` hole, and a DELETE
  group for shops — the one collection that permits it, which makes "which
  company's admin" load-bearing for the first time.
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
| Version | `versionCode 18` / `versionName "2.3"` — read out of the AAB's own manifest, not off `build.gradle` |
| File | `builds/SnD-Manager-v2.3-build18.aab` (66 MB, outside the repo — AABs are not committed). Also at `android/app/build/outputs/bundle/release/app-release.aab` until the next build overwrites it. |
| Signature | `jar verified` |
| Signer | `CN=sohail, OU=solana, O=solana, L=wah, ST=punjab, C=PK` — SHA-1 `D1:95:A1:22:F9:1D:23:F1:B1:AD:22:21:FC:CB:F0:99:93:08:7A:F1`, the upload key in §3. Checked on this file, not assumed. |
| Built | 2026-08-11 17:41, from `booker-screens-pass` — **not from `main`** |
| ❗ Contains uncommitted work | §1f, §1g and the load sheet were in the WORKING TREE when this was built and are still not committed. This bundle cannot be reproduced from any commit. Commit before it goes anywhere, or the day someone asks what is in `versionCode 18` there is no answer. |
| `versionCode 17` | gone — it lived only at `app/build/outputs/.../app-release.aab` and this build overwrote it. Rebuildable from `1f8eec1` if it is ever wanted; nothing depends on it. |

**Not published, and §4.1 has not moved.** Ten device checks, of which only 9 and half of 10 have been run. Building the file is safe; putting it on a track that reaches a real user is not.
| Needs | the rules deployed — done, including the shops `delete` rule and the `name` restriction (2026-08-10) |

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
| `src/components/AreaSelect.tsx` | the only way to set a shop's area — and an area is now required on every path that creates one |
| `src/components/theme.ts` | every colour, size and space — including `space.gutter`, `color.cardEdge` and `shadow.card` |
| `src/lib/order.ts` | all order money: `computeTotals`, `discountPercentForPrice`, `lowestPrice`, `netOfTax`, `totalQty`, and the `priceForDiscountAmount`/`discountAmountForPrice` pair that keeps the booker's two discount boxes agreeing. Screens never do arithmetic |
| `src/app/navigation.tsx` | `BookerRouteStack` is where Route, the order form and the shop search live; the booker has three tabs |
| `src/components/BrandHero.tsx` | both illustrations (`BrandHero`, `StaffHero`). Theme tokens only — an illustration that drifts off the palette is what makes an app look assembled |
| `src/app/credentialSignIn.ts` | the bottom-sheet wrapper. Returns `'unavailable'` on anything it cannot serve, which is what makes the legacy fallback real |
| `android/app/src/main/java/…/CredentialSignInModule.kt` | the only native code in this app that is not a library |
| `firestore.rules` | identity rides in the token; rules never do lookups. Shops are the ONLY collection with a live `delete` |
| `functions/index.js` | `admitSignIn` is the only door into the app — **but no longer the only way to reach it**: `createStaffLogin` mints an account and its claims directly (§1d) |

Firestore layout is `companies/{companyId}/…` for everything except `employeeDirectory`,
which is at the root because sign-in must resolve an email before it knows the company.
Clients cannot read or write that collection at all.

---

## 7. History

The chronological record of Round 8 (18 bugs), the design pass, the Welcome-screen fixes
and the shop-mapping build is in the message of commit `5346f05` and in `OPEN-BUGS.md`.
Every fix is also commented at the site it was made, explaining what the failure actually
was — grep for the wording rather than reconstructing it from the diff.

The booker round is the five commits in §1b, and the same rule applies: each one
says in its message what the old behaviour was and why it was wrong. Read those
before changing anything on Route or New Order — several of the decisions there
(the frozen sweep order, the cleared price on a quantity change, the missing
"All" chip) look like omissions and are not.
