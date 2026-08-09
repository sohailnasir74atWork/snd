# Open bugs — none

The Round 8 backlog (18 confirmed findings from the second crash scan, 2026-08-06) was
**closed in full on 2026-08-09**. Nothing from it is outstanding.

Each fix is commented at the site it was made, explaining what the failure actually was —
grep for the wording if you need the reasoning behind a line.

| # | Was | Fixed in |
|---|---|---|
| 1 | Every PDF share dead (wrong import shape) | `src/documents/share.ts`, hand-written `.d.ts` deleted |
| 2 | Employees screen crashed permanently | `EmployeesScreen.tsx`, `firestoreStore.tsx`, `functions/index.js`, new `ErrorBoundary.tsx` |
| 3 | Two admins double-subtracted exception cash | `applyExceptionCash` transaction in `firestoreStore.tsx` |
| 4 | Removing staff stranded their cash | `functions/index.js`, `AdminScreens.tsx` |
| 5 | Bill PDF overstated the khata | `RiderScreens.tsx` — balance snapshotted before the write |
| 6 | `lastVisitAt` read back as 0 | shops listener uses `serverTimestamps: 'estimate'` |
| 7 | Rider's "N of M done" counted down | `RiderScreens.tsx` — counts by `deliveredAt` |
| 8 | Cold start hung up to 70 s | `auth.ts` — background refresh + timeout |
| 9 | Could not open the app offline next morning | `auth.ts` — session persisted (MMKV) |
| 10 | Role changes never took effect | `auth.ts` — session built from the callable's response |
| 11 | Removed employees kept access, then froze | `auth.ts` `startAccessWatch` + `subscribeAuthPresence`, wired in `App.tsx` |
| 12 | Midnight dropped the rider's route lock | `openDayFor` in `firestoreStore.tsx` |
| 13 | Camera failure looked identical to cancel | `src/lib/photos.ts` |
| 14 | Sign-out was one unguarded tap | `App.tsx` `useGuardedSignOut` + `pendingWrites` on the store |
| 15 | Push never appeared on Android 13+ | `firestoreStore.tsx` — real `PermissionsAndroid` request |
| 16–18 | Duplicates of #6 / #8 from other lenses | covered by those fixes |

**Verified at the time of closing:** TypeScript 0 errors · ESLint 0 errors · 35/35 tests ·
debug build installs and starts clean on Pixel 9 / API 35 with no JS errors in logcat.

---

## Worth knowing before the next scan

No fresh adversarial scan has been run against the Round 8 code. If you commission one,
point it at the two largest new surfaces:

- **`src/app/auth.ts`** — substantially rewritten (background admission refresh,
  persisted session, access watch, silent sign-in).
- **The busy-state layer** — every screen gained re-entrancy guards. The failure mode to
  hunt for is a guard that can latch permanently on an error path, or one that is missing
  where a `void` store method writes non-idempotently.

See `HANDOFF.md` for the full picture of what changed and what is still open.
