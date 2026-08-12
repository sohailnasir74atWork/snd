# Can this be sold? — the assessment, 2026-08-12

Written because the owner asked whether this app has scope as a SaaS product,
and the answer was worth keeping rather than repeating. Nothing here is a task
list yet; §4 of `HANDOFF.md` is where the work items live. This is the *why* and
the *order*.

**One-line answer:** the category is real and the domain insight in this code is
genuine, but nothing in the app can stop a customer from not paying, and one
security hole makes it unsafe to put another company's data on it. Neither of
those is a feature problem.

---

## 1. Why there is scope

**The category is proven.** Sales-force automation for FMCG distribution is an
established software market — FieldAssist and Bizom built real businesses on it
in India, and Pakistan has players such as SalesFlo. Demand does not have to be
invented. Distributors run bookers, riders and khata on paper and WhatsApp
today, and they know it costs them.

**The code carries domain truth that a generic tool does not.** This is the
thing that would be hardest for a competitor to copy and the easiest to
underrate:

- Booking works with no signal, and the order stays in the booker's own list —
  the window keys on `deliveryDate` rather than a server timestamp precisely so
  that a man with one bar does not watch his own order disappear (§1a).
- The khata carries pre-app debt (`openingBalance`), so a shop's balance is not
  wrong from the first day.
- Payment allocation counts UNCONFIRMED payments, because `confirmed` means the
  owner has the cash — not that the shop paid. Ignoring the rider's satchel
  would dun a shopkeeper for money he handed over that morning (§1g).
- The bill goes to that shop's own WhatsApp chat, at the door, for a number
  that was never a contact (§1c).
- A number that came from the phone rather than the company counter is labelled
  PROVISIONAL rather than passed off as a serial (§4.14).

**Tenant isolation is actually tested.** 243 rules assertions, covering company
B's admin, booker, rider, a signed-in stranger and an anonymous caller against
every collection. Most one-person SaaS attempts have nothing there at all.

---

## 2. What blocks revenue, in order of how much it blocks

1. **There is no billing gate.** No entitlement check, no trial, no expiry.
   Nothing in the codebase can stop a non-paying company from using it. This is
   not a missing feature — it is the business model, and it does not exist.

2. **The Bunny CDN write key ships inside every APK.** Zone-wide read, write
   and **delete**, no path scoping. Any customer can extract it and destroy
   every photo for every tenant. Rotating is a reset, not a fix — the new key
   ships to every phone within minutes. The fix is a server-side proxy
   (`uploadPhoto` callable) or Firebase Storage with rules keyed on the
   `companyId` claim. **This is the one item that makes it unsafe to hold
   another company's data.**

3. **`admitSignIn` allows unlimited free workspace creation**, unmetered and
   unverified — and the repo is public, so the fact is discoverable. That is
   your bill, not theirs. The $25 budget alert is a smoke alarm, not a lock.

4. **No App Check.** `google-services.json` ships in every APK, so the rules are
   reachable from `curl` with any Google account.

5. **No privacy policy, terms, or account-deletion path.** All three are hard
   Play requirements for an app that creates accounts. Deletion has to be
   server-side — the rules deny `delete` on essentially every collection.

6. **The Play Data Safety form is wrong.** The draft says "email address and
   name". The app also collects precise location, photos, third-party phone
   numbers, financial data and crash logs, and Bunny CDN makes "not shared with
   third parties" false. Misdeclaring risks suspension — and this keystore
   signs the whole Apptech portfolio, so a strike is not contained to this app.

7. **Nobody knows what one customer costs to serve.** Firestore is in `nam5`
   (US multi-region): more per read, write and stored GB than a regional
   location, and every query from Pakistan crosses the Pacific. That location
   can never be changed once real customer data exists. You cannot price a
   product without its cost of goods, and right now the only measurement is a
   $25 budget alert on a single test company.

---

## 3. The order I would do it in

Deliberately NOT "build the SaaS". Building billing for a product nobody has
paid for is two months spent on the wrong question.

1. **Run the ten device checks in HANDOFF §4.1.** They are about money —
   partial payment then collection, tax, the typed discount, multi-rider
   assignment. Roughly half a day. Until they pass, this cannot go in a
   stranger's hands.
2. **Fix the CDN key.** Non-negotiable before another company's data is on it.
3. **Get 3–5 distributors using it and invoice them by hand.** Provision
   manually. No signup flow, no payment integration, no self-serve anything.
   What you are buying is two numbers: do they still use it in month three, and
   what does each one cost in Firebase.
4. **Then** decide about self-serve SaaS, with real retention and real
   cost-per-tenant instead of guesses.

Step 3 is the whole answer. Nobody outside this business has used the app. That
is not a criticism, it is simply the missing evidence — and two distributors
paying and staying tells you more than any amount of feature work.

---

## 4. Risks worth naming out loud

- **Support is one person.** When a bill is wrong at a counter, somebody rings.
  That is a real job at ten customers and an impossible one at fifty, alone.
- **It is not generic yet.** HANDOFF §4.4 lists what a distributor asks for
  first, in order: per-van stock, cartons/units, returns after delivery, price
  lists, trade schemes, credit limits, batch/expiry, PJP/beat plans, Excel
  import, roles beyond the three. Every new customer will want two of them.
- **The incumbents have sales teams.** Selling is one distributor at a time, in
  person. Slow — but it is how this market buys, and it is a fair fight if the
  product is genuinely better at the field work.
- **2026-10-30: Node 20 is decommissioned.** After that no backend change can
  be deployed until the runtime is upgraded. Get ahead of it.

---

## 5. What this document is not

It is not a valuation, a forecast, or advice about what to do with money. It is
an engineering read of what stands between this repository and a first paying
customer, written by someone who has read the code and not met the market.
