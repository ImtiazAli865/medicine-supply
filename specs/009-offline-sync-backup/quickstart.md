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
3. Take a real order (search a few medicines, use Repeat or the checklist for a store you ordered for before). The screen should say "Saved on this device, not sent yet".
4. Close the app, open it again (still in airplane mode). The order is still there.
5. Switch airplane mode off and open the app. After a few seconds the order should show as sent ("Saved at ..."), once. Check Orders: it appears exactly once.
6. Report: did every step work, how long did it take compared with writing on paper, and anything that looked wrong. (Recorded as reported, not seen.)

## 6. Results

(Filled in during implementation: spike outcome, test runs with dates and counts, owner answers.)
