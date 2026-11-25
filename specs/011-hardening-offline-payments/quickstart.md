# Quickstart: Hardening and Offline Payments (Module 011)

How to build, check and try the module. Every result is recorded in section 6 only after it really ran (constitution Principle VIII); steps that need the owner are marked as not done.

## 1. Prepare

1. Branch `011-hardening-offline-payments` (from master at `a010bec`). No new package. No migration unless D10 or D14 of the research says so (then `0012`).
2. For the browser tests: the TEST project as before (`.env.test.local`). Stop `npm run dev` first. Scale tests run alone, never together with other runs.
3. For the phone trial: the same local-network server as the Module 010 trial, built with the DEV settings (`.env.local`). Reports and payments need no service worker, but **offline reloads need an `https://` address or the Chrome flag of the Module 009 trial** (guides/offline-and-sync.md will say so).

## 2. Automated checks

| Check | Command | Must show |
|-------|---------|-----------|
| Lint and secrets | `npm run lint` | no error |
| Types | `npm run typecheck` | no error |
| Unit, PGlite and TEST-project tests | `npm test` | all pass; includes the payment queue tests, the narrowed guards, the backup version 2 tests, the route-auth scan, the RLS audit and the traceability check |
| Build | `npm run build` | no error |
| Browser tests | `npm run test:e2e` (new `offline-payments*`, `pending-sync-notes`, `password-reset`, `hardening-*` first) | flows, honest states, 360 px targets, five navigation items |
| Dependency audit | `npm audit` | the real summary is written into `security-review.md` |

## 3. Hand checks (the owner's example)

| Step | Do | Expect |
|------|----|--------|
| 1 | Open the app once online (so the phone has the stores). Turn the signal off. Offline home, **Record payment**, pick a store, enter 5000, today, reference "R1", Save. | "Saved on this phone. It is not in the store's account until it is sent." The payment is listed as Waiting. The word "recorded" is not used. |
| 2 | Close the app, open it again offline. | The payment is still there, once. |
| 3 | Record a second payment for a store made on the phone that is itself waiting. | Accepted as Waiting; shown after the store in the list. |
| 4 | Turn the signal on. | Within a minute the payments are sent once, in order, and leave the waiting list. The store's account (online) shows the entries; the balance is right. |
| 5 | Before step 4, open the same store's account while online with a payment still waiting (pause sending in Settings). | The balance carries "pending sync" and "1 payment waiting on this phone, PKR 5,000.00, not counted yet". Home's total says it excludes waiting payments. |
| 6 | Record a payment for a store, then remove the store on the server (test project only), then send. | The payment is shown in the conflict panel as "The store is not on the server"; nothing is dropped; Remove asks first. |
| 7 | Export a backup with a waiting payment, clear the site data, restore the file, go online. | The payment is back as Waiting and ends up recorded once. |
| 8 | Open the app on a `http://192.168...` address. | A notice says offline mode cannot start on this address. On `localhost` or `https` there is none. |
| 9 | Sign-in screen, **Forgot password**, enter the email. | A neutral message. The email arrives (after the template is set), the link opens the reset page, a new password works, the old link then says it expired. |

## 4. Owner's trial (recorded as reported, not seen)

Take a payment with the signal off on the phone (SC-013), then check after the signal returns that the amount is recorded once on the server. Also try one real password reset and one backup restore on real data (the restore drill of D16).

| Date | What the owner did | What the owner reported |
|------|--------------------|-------------------------|
| 2026-11-25 | Phone on the same Wi-Fi, production build against the DEV project, Chrome flag for the insecure address. Recorded a test payment with the signal off, then turned the signal on. | Reported by the owner, not seen: the payment appeared once as recorded (not twice). The password reset by real email was tried on DEV and not completed (the built-in email service allowed only 2 emails, then answered 429, and the first one-time link was used before the owner's click); the owner chose to skip it for now. The owner then exported a backup file on the phone and imported it again: a payment that was already on the phone was not added a second time. |

## 5. Documents to read

`traceability.md` (47 rows) and `security-review.md` (real results) in this folder, and the four guides in `guides/`.

## 6. Results

**Baseline (T001, 2026-11-24).** On branch `011-hardening-offline-payments` (cut from master a010bec) `npm run lint` (eslint and the secrets check) and `npx tsc --noEmit` both pass. The full `npm test` was **not** re-run before the first change, because it takes about 33 minutes; the last known baseline is the Module 010 result of 172 files and 1,659 of 1,660 tests. The final full run of this module is recorded in this section when it is done, and any difference from that baseline is explained there.

**Final runs (2026-11-24 and 2026-11-25), all real.**

- `npm run lint` (eslint and the secrets check): passed. `npx tsc --noEmit`: passed with no output.
- `npm test` (unit, PGlite and TEST-project integration, scale tests included): **193 files, 1,921 tests, all passed**, about 41 minutes. The baseline was 172 files and 1,659 of 1,660 tests (Module 010).
- `npm run build`: ran as the first step of the browser run and succeeded.
- `npm run test:e2e` (mobile 360 px and desktop, TEST project, 1.4 hours): **560 passed, 349 skipped (mobile-only or desktop-only tests in the other project), 7 failed**. Each failure was re-run alone:
  - `offline-settings` (mobile): a **real race in the test**, found by the new honest clean-up. The page was still sending a held order when the test business was removed, so a new order event was written after the clean-up and the order could not be deleted. The test now goes offline and closes the page before it ends. It passes (5 of 5).
  - `password-reset` (mobile): the locator `getByText("Use at least 8 characters.")` also matched the help text below the field (strict mode). The test now reads `#password-error`. The file passed when re-run (7 of 7).
  - `offline-take-order`, `products`, `purchase-record` (mobile) and `stores` (desktop): modules 003 to 009, none touched by Module 011. They timed out under the long full run and **passed when run alone** (offline-take-order in the three-file re-run, products and purchase-record 17 of 17, stores 5 of 5). They are recorded as load-related flakes, not as fixed.
- Leftover test businesses: the sweep dry run (`npm run test:sweep`) found 167 test businesses on the TEST project, older than 30 minutes, from before the clean-up helper was fixed. **Nothing was deleted.** The `--delete` run waits for the owner's yes (T065).
- Why the old clean-up left businesses behind: the old helper did not know `business_settings`, `voice_parse_attempts` and `voice_diagnostics` (read-only finding), so the business row could not be deleted, and it ignored the error. The new helper finds the tables itself from `rls_audit()`.
- Reports speed (T054): three runs of `reports-scale.test.ts` alone gave warm medians from 0.2 s to 1.9 s (the 90-day sales report by day, 1.86 s, is the largest), under the 2 s target in every run. No index was added.
- Not done here (owner steps): password reset email setup on DEV (T064), the leftover sweep `--delete` (T065), the phone trial and a real backup restore drill (T066), the pull request (T067).

**Leftover sweep run (T065, 2026-11-25, after the owner said yes).** The dry run listed 170 test businesses on the TEST project (167 earlier, plus a few from the last browser run), all with test labels. `npm run test:sweep -- --delete` removed them: a second dry run shows **0 businesses** and the project has **0 users**. 15 businesses had no user at all (orphans), so the script reported "Expected parameter to be UUID" for them after their data was already gone; that was a bug in the script (it asked to delete a missing user). It now skips the user for an orphan, with a unit test (`delete-tenant-helper.test.ts`, 28 tests in the two sweep files pass).
