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

0. **The phone must open the app through a secure address.** A browser starts a service worker only on `https://` or on `localhost`. On a plain `http://192.168.x.x:3000` address from a computer on the same network the worker does not start, so steps 2 and 4 (reloading or reopening the app without a signal) cannot work there, although taking an order on a screen that is already open still does. Use one of: the deployed `https://` address of the app; or, on an Android phone only, Chrome's `chrome://flags/#unsafely-treat-insecure-origin-as-secure` set to the computer's address (a test-only setting, switch it off afterwards); or a USB cable with port forwarding so the phone reaches the computer as `localhost`. The server must be a production build (`npm run build`, then `npm run start`), not `npm run dev`.
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

### Owner's real-phone trial (T074, 2026-11-23, Android Chrome, production build served from the computer, DEV project)

Reported by the owner in chat. Where a screenshot was sent, the screenshot was seen; everything else is **reported, not seen**.

| Step | Result |
|---|---|
| 0. Secure address | The first attempts failed: with airplane mode on, a reload showed Chrome's own "No internet" page, because the phone did not treat `http://192.168.1.4:3000` as a secure address and so no service worker started. After the Chrome flag `unsafely-treat-insecure-origin-as-secure` was set correctly for that address and Chrome was relaunched, the offline reload worked. The same worker was checked on the computer at `localhost`: it registered, activated and kept all 54 app files. Not a defect of the app; the need is documented in step 0 above. |
| 1 to 2. Reload in airplane mode | Reported and seen in screenshots: the app's own "Offline" page opened with its header, bottom navigation and the buttons New order, Orders on this phone, Sync status. |
| 3. Take a real order offline | Reported: the owner took an order with New order and it was taken. Seen in screenshots: the offline order screen with search and "Added Panadol." with Undo; the header showed "Offline · 1 waiting". |
| Bottom navigation offline | Reported and seen in screenshots: Home shows the Offline page; Orders shows the orders kept on this phone with the note that the other orders need the internet; Settings shows "Sync and backup"; Products and Stores show "This needs the internet" with a "Take an order" button. No Chrome error page. |
| 4. Close and reopen the app offline | Reported: Chrome was closed completely and opened again in airplane mode; the order was still saved. |
| 5. Reconnect: the order arrives once | Reported and seen in a screenshot: Settings showed "Last successful send: 23 Nov 2026, 01:07", "0 waiting, 0 sending, 0 failed, 0 need a decision", "Everything is sent as of 01:07". The owner switched Wi-Fi on briefly to use WhatsApp, which is when the send happened, so the send was not triggered by the planned "airplane mode off" step. Reported: the order appears exactly once in Orders. |
| 6. Time against paper | Reported: taking the order in the app was faster than writing it on paper; writing on paper took about 15 seconds longer. (First time on the phone; no speed target is set for offline order taking, SC-010 is about keeping and sending the order.) |

SC-010 is **confirmed by the owner's report**: every step worked (offline reload, order taken offline, order kept after closing and reopening Chrome offline, order sent once, order appears once in Orders). One caveat: the send happened when Wi-Fi was switched on briefly for WhatsApp, not at a planned "airplane mode off" moment. Everything except the screenshots listed above is reported, not seen.

### Before the pull request (T075, 2026-11-24, branch `009-offline-sync-backup`, TEST Supabase project)

- The branch was 0 commits behind `origin/master` (8853c64) and 6 ahead, so no merge was needed.
- `npm run lint` (including the secrets check) and `npm run typecheck`: passed. `npm run build` (includes `make-sw-assets`): passed, `public/sw-assets.json` written with 54 files.
- `npm test`: **151 test files, 1,511 tests, all passed** (1,363 s). The two hosted-database latency tests that failed once in the earlier run (`market-scale`, `search-5000`) passed in this run.
- The full Playwright suite was **not** run again for the pull request; the last full run and the reruns of its failures are recorded in the "Final verification" table above (473 passed, 19 failed on that full run, all 19 passing on rerun, 2 after test edits). One clean full run after the last two test edits was not done.

