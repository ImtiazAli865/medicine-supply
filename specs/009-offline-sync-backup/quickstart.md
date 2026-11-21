# Quickstart: Verifying Module 009 (offline order taking, sync and backup)

Nothing here is claimed until it was run. Results go in section 6 as they happen; owner answers are recorded as "reported, not seen".

## 1. Prerequisites

- Node and the repository dependencies installed (`npm install`); no new package is added by this module.
- `.env.test.local` with the TEST Supabase project (used by Playwright and the integration tests) and `.env.local` for the DEV project (used by the owner's phone), exactly as in Modules 001 to 008. No new variable is needed.
- Port 3000 free before `npm run test:e2e` (Playwright starts `npm run build && npm run start`). After the e2e run, `.next` is built with the TEST settings: run `npm run build` again before starting the app for DEV.
- The build now also writes `public/sw-assets.json` (the list of files the service worker keeps). It is generated, ignored by git, and must exist for the offline tests.

## 2. Commands

```powershell
npm run lint
npm run typecheck
npm test
npx playwright test --project=mobile tests/e2e/offline-*.spec.ts
npx playwright test            # the full suite, once, before the PR
```

## 3. Gating spike (task T001, before anything else is built on it)

Question: does `context.setOffline(true)` stop requests made by the service worker, so that a real offline reload can be tested?

1. Build and start the app, sign in on the mobile project, wait until the worker controls the page.
2. Call `context.setOffline(true)`, reload `/orders/new`, and read the result.
3. Decision rule:
   - The page shows the offline shell (redirect to `/offline?go=/orders/new`) and a fetch from inside the worker fails: use `setOffline` in the offline specs (helper `goOffline(context)`).
   - The worker still reaches the server (the normal page loads): use the stop-the-server fallback. The helper `startSecondServer()` starts a second `next start` on another port with the TEST settings, the spec signs in on that origin, and "going offline" kills that process (the origin is then unreachable for the page and the worker alike); "coming back online" starts it again on the same port.
4. Write the outcome and the chosen helper in section 6.

## 4. Scenarios and the tests that prove them

| # | Scenario (spec) | Test (planned name) |
|---|-----------------|---------------------|
| 1 | SC-001, US1: ten-line offline order survives reload, restart, and arrives once | `offline-take-order.spec.ts` |
| 2 | SC-002, US2: connection cut three times during sending, no duplicate | `offline-sync-once.spec.ts` (+ integration `offline-replay.test.ts`) |
| 3 | SC-003: wording never says synced / saved too early | assertions in 1, 2 and `offline-honest-states.spec.ts`; unit `autosave-journal.test.ts` |
| 4 | SC-004, US3: all conflict kinds, nothing overwritten silently | `offline-conflicts.spec.ts`; unit `sync-center.test.ts` |
| 5 | SC-005: two businesses on one phone | `offline-two-businesses.spec.ts`; unit `device-identity.test.ts` |
| 6 | SC-006: 20 orders sent within 60 s | `offline-sync-scale.spec.ts` |
| 7 | SC-007, US5: backup round trip, double import, no secret, damaged file | `offline-backup.spec.ts`; unit `backup.test.ts`; integration `backup-export.test.ts` (two tenants) |
| 8 | SC-008: offline search of 5,000 medicines under 300 ms | `offline-search-scale.spec.ts` |
| 9 | SC-009: 360 px, loading/error/empty states | `offline-touch-targets.spec.ts`, `offline-states.spec.ts` |
| 10 | US4: offline store and typed medicine | `offline-new-store.spec.ts` |
| 11 | US6: Settings status, Retry | `offline-settings.spec.ts` |
| 12 | Online screens unchanged | the existing Module 003 to 008 specs (some wording updated, listed in 6) |

## 5. Owner's trial (SC-010) on a real phone, in airplane mode

1. Open the app on the phone while online and wait a few seconds (the lists and files are kept).
2. Switch on airplane mode. Reload the app. It should open and say "Offline".
3. Take a real order (search a few medicines, use Repeat or the checklist for a store you ordered for before). The screen should say "Saved on this device, not yet sent".
4. Close the app, open it again (still in airplane mode). The order is still there.
5. Switch airplane mode off and open the app. After a few seconds the order should show as sent ("Saved at ..."), once. Check Orders: it appears exactly once.
6. Report: did every step work, how long did it take compared with writing on paper, and anything that looked wrong. (Recorded as reported, not seen.)

## 6. Results

### Baseline (T001, 2026-11-21, branch `009-offline-sync-backup`, before any Module 009 change to existing files)

- `npm run lint`: passed (including the secrets check). `npm run typecheck`: passed.
- `npm test`: **128 test files, 1327 tests, all passed**, duration 1,704 s (28 minutes). Note: while this run was in progress, new Module 009 files and some edits of existing files were being written; vitest had already collected its file list, and every test passed, so no result was influenced. The Supabase TEST project was reachable.

### Gating spike (T002, 2026-11-21): does `context.setOffline(true)` cut the service worker's network?

Run on the Playwright mobile project against the production build (`npm run build && npm run start`, TEST project), with a throwaway worker that forwards every request to the network and answers `SW-FALLBACK` when the network fails. After `context.setOffline(true)`: a `fetch` made from inside the worker **failed** (`SW-NETWORK-FAILED`), a `fetch` made by the page was answered through the worker with the fallback, and a page reload was answered by the worker with the fallback. So the emulation also cuts the worker's requests.

**Decision: the offline specs use `context.setOffline` (`goOffline` / `goOnline` in `tests/helpers/offline.ts`). The stop-the-server fallback is not needed.** The throwaway worker, the throwaway spec and the temporary proxy matcher entry were deleted. The production build with the new `make-sw-assets` step also succeeded (`public/sw-assets.json` written).

### Final verification (T069, 2026-11-21 to 2026-11-22, branch `009-offline-sync-backup`, TEST Supabase project, production build)

| Check | Result |
|---|---|
| `npm run lint` and `npm run typecheck` | passed |
| `npm test` (unit and integration) | **151 test files, 1,511 tests.** First run: 1,509 passed and 2 failed. The two failures were latency measurements against the hosted TEST database (`market-scale`: a searched market list took 6.9 s against a 3 s budget; `search-5000`: 37 of 40 searches under 1 s against 95 % needed). Neither touches Module 009 code. Run alone, both files passed (6 tests). |
| `npm run build` (includes `make-sw-assets`) | passed; `public/sw-assets.json` written with 54 files |
| `npm run test:e2e`, both projects, whole suite | **772 tests: 473 passed, 19 failed, 280 skipped** (skipped by design: mobile-only specs on the desktop project and the other way round). The computer went to sleep during this run (`ERR_NETWORK_IO_SUSPENDED` in the log), so most failures were 60-second timeouts. |
| The 19 failures, run again alone | 17 passed unchanged. 2 needed a test change and then passed: `market-home` (the page adds the date to the address, so the regular expression now allows it) and `touch-targets` pending screens (it opens many screens, so its timeout is now 150 s). |
| New Module 009 specs | `offline-take-order`, `offline-honest-states`, `offline-search-scale`, `offline-sync-once`, `offline-sync-scale`, `offline-conflicts`, `offline-protect`, `offline-two-businesses`, `offline-new-store`, `offline-backup`, `offline-settings`, `offline-touch-targets`, `offline-states`, `offline-upgrade`: all passed on the mobile project; the integration specs `offline-replay` and `backup-export` (11 tests) passed. |

Not done as one clean run: after the last two test edits only those two specs, not the whole suite, were run again. The suite also had to be run twice in full because the first full run found real defects, listed next.

Real defects found by the full run and fixed (not test changes):

1. **Two copies of the page content for a moment after opening a page.** The offline provider shared its state through a React context whose value changed while the page was still arriving, which made React draw the waiting page content a second time in the browser. The state now goes through a small external store and the context carries only that store; 40 page opens in a row showed no duplicate (before: 6 to 14 of 40).
2. **A second tab could not send its own changes.** Only the tab holding the sender role sent anything, so an order edited in another tab stayed "Saved on this device, not yet sent" for good. Now a tab always sends the draft that is open on its own screen, and the sender tab looks at the journal every 30 seconds for drafts another tab left unsent.
3. **Retry did nothing while the connection flag still said offline** after an earlier failed request. The person's own Retry is now always tried (it does not override a pause).
4. "Open the full app" link on the offline page was only 19 px high; it is now a proper 44 px target.

Older specs of Modules 002 to 008 that expected "Not saved" or "Changed elsewhere" for an edit made with the device storage on now expect the Module 009 wording (`on_device`, "not yet sent", and the side-by-side `conflict-panel`); the failure states with no device storage are still tested through `blockDeviceStorage`.

Measured: an offline search of a 5,000-medicine list answered in about 38 to 66 ms on the test machine.

Still to do by the owner (T074): the airplane-mode walkthrough in section 5 on a real phone against the DEV project. Until the owner reports, this is recorded as **not tried on a real phone**; the owner's answers are recorded as "reported, not seen".

