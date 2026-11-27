# Quickstart: Store-specific selling prices (Module 012)

Every result is recorded in section 4 only after it really ran. Steps that need the owner are marked.

## 1. Prepare

1. Branch `012-store-rates` (from master 7b7c1b6). No new package.
2. Apply `supabase/migrations/0012_store_rates.sql` to the TEST project (owner, SQL editor).
3. Apply it to the DEV project before the app is tried there (owner).

## 2. Checks

`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run test:e2e` (stop `npm run dev` first; scale tests alone).

## 3. Try it (owner)

1. Add a medicine with selling price 200.
2. New order for store A: change the line to 200, tick "remember", confirm, invoice.
3. New order for store B: change to 220, remember, confirm.
4. Change the medicine's selling price to 210.
5. New orders: store A offers 200 with a note about the catalog change; change to 220, remember. Store B offers 220; change to 230. A third store offers 210; change to 215.
6. Check the three invoices show 220, 230 and 215 and the older invoices did not change.
7. With the signal off, take an order for store A and check 220 is shown; reconnect and confirm.

## 4. Results

**Baseline (T001, 2026-11-26).** On `012-store-rates` before any code: `npm run lint` and `npx tsc --noEmit` passed. The full `npm test` was not re-run; the last full run is Module 011's (193 files, 1,921 tests, all passed).

**Migration on TEST (2026-11-27).** Applied by the owner. The TEST project still had the dropped voice work's eight-argument `order_save` (migration 0009), so the first version of 0012 left two `order_save` functions and orders could not be saved. 0012 now drops that leftover first (test: `db-store-rates` "a project that still has the dropped voice work"); the owner applied the fixed file again. The first check right after it failed once from the API's schema cache and passed afterwards.

**Scale (T037, run alone on TEST, 2,000 rates, an order of 200 lines).** `order_get` median 939 ms (max 1,048), `order_list` 456 ms, `store_rates_list` of 2,000 rates 1.5 to 2.0 s, the phone copy (3 pages) 1.0 s.

**Found by the browser tests and fixed.** The phone saved the store rates after the medicine list, so going offline right away showed no rates; rates are now saved first, and the phone copy is refreshed as soon as a rate is saved.

**Unit and database tests (`npm test`, 2026-11-27).** 198 files: 197 passed, 1 failed. 1,989 tests: 1,988 passed, 1 failed. The failure was the timing check of `pending-scale` ("To register list within 2 s") while the whole suite was running; the file passed alone (5 of 5). Two unit tests were added after that run (a version 2 backup file is still read; version 3 of the phone database only adds the store rates); their two files passed alone (11 tests).

**Browser tests (`npm run test:e2e`, 934 tests, 2026-11-27).** Not one uninterrupted run: the first run stopped with the session after 240 tests, and the rest ran afterwards in three parts. Every one of the 934 tests ran: 576 passed (467 mobile, 109 desktop) and 358 desktop tests are skipped by design (mobile only). Nine tests failed on their first attempt and passed when run again: `invoice-print` (2), `invoices-list` (2), `offline-backup` (1), `offline-payments-states` (1), `pending-home` (1), `reports-states` (1), `reports-two-businesses` (1). The cause was not established; the `pending-home` failure showed the app's "This needs the internet" screen. A loading check added afterwards to the price list test passed alone.

**Other checks (2026-11-27).** `npm run lint` (with the secrets check) and `npx tsc --noEmit` passed. `npm run build` passed as the first step of each browser run. `git diff --stat master -- package.json package-lock.json` is empty: no package added.

**Not covered.** The new price tests in the browser run on the mobile project only. The number of taps to change a price is not asserted (the flow is two taps plus typing, and one more for the far-price question or the remember tick). The upgrade of a phone database in the browser is tested from version 1; from version 2 only the list of upgrade steps is checked.

**DEV project (2026-11-27).** The owner applied 0012 and reported success. A read-only check with the public key found the replaced and new functions, the two new tables and the two new columns, and a single `order_save`. The owner's walk through section 3 has not been done yet (T042 stays open).

**Found during the owner's walk and fixed (2026-11-27).** On the development server, with the phone storage not running in the owner's browser, an added medicine showed "Added" but no line appeared and nothing was saved. Without the storage the order screen owns its save machine, and React's development double run of effects disposed it while the screen stayed open. This was there since Module 009; the production build does not run effects twice, so the browser tests did not see it. The disposal now waits until the screen is really gone (`src/lib/orders/dispose-when-gone.ts`, 2 unit tests). Reproduced on the development server with a test account before the fix (no line) and passed after it. A version 2 phone database opened by the development server upgraded to version 3 without trouble. Why the storage did not start in the owner's browser is not yet known. After the fix: lint and type check passed, the unit tests passed (83 files, 926 tests), and 35 related browser tests on a production build passed (`orders-confirm-edit-cancel`, `orders-take`, `orders-recovery`, `offline-honest-states`, `order-store-rate`, mobile). The full suite was not run again after this change.

**Owner's retry on DEV (2026-11-27).** Reported working, with screenshots of two confirmed orders of the same medicine for two stores at PKR 195.00 and PKR 200.00. The connection indicator is still missing in those screenshots, so the phone storage is still not running in that browser. The rest of section 3 (remembered rate on the next order, catalog price change, invoices, offline) has not been reported yet.

**Why the phone storage did not start (2026-11-27).** The owner's Settings showed no "Sync and backup" section, which happens only when the app decides the sign-in cookie belongs to someone else. The app read the first Supabase sign-in cookie it found, of any project, and cookies are shared by everything served from one host name. It now reads only its own project's cookie. This was there since Module 009 and also applied to production builds. A unit test failed before the change and passed after; the unit tests (83 files, 927 tests), lint, type check and 8 browser tests including a new one (`offline-other-project-cookie`) passed. The owner then reloaded and reported that the section appears.

**Full run after the two fixes (2026-11-27).** Before it, a Settings line that still said invoices are not printed yet was corrected (the setting already starts the print page's choice). `npm run lint`, `npx tsc --noEmit` and the unit tests (83 files, 927 tests) passed, and no package was added. The whole browser suite was then run in four shards on a production build (port 3100, while the development server on 3000 stayed up): 936 tests, 568 passed (462 mobile, 106 desktop), 359 desktop tests skipped by design (mobile only) and 9 failed on their first attempt: `import` (5,000-row xlsx), `market-list`, `products` (inactive duplicate), `states` (purchase history), `stores` (version conflict, mobile), `touch-targets` (order screens), `responsive` (desktop), `stores` (2, desktop). The errors seen were timeouts and elements that did not appear in time, and one database statement timeout while a test was preparing its medicines. All 9 passed when run again one at a time (the rerun also picked up a second 5,000-row import case: 7 mobile and 3 desktop tests, all passed). The cause of the first failures was not established. The failing tests differ from those of the earlier run. The full `npm test` recorded above is from before the two fixes; after them the unit tests were run, not the database tests.

