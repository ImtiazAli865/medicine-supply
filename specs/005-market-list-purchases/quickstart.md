# Quickstart and Verification Guide: Market List and Purchases

**Feature**: 005-market-list-purchases | **Status**: planned, nothing implemented or verified yet

This file says how the module will be run and checked. The "Results" sections stay empty until real runs exist; nothing here may be read as a claim that something passed.

## 1. Prerequisites

- Modules 001 to 004 are merged into master (merge commit `c452cf8`).
- `.env.local` has the DEV project values; `.env.test.local` has the TEST project values (same files as before; no secret is committed).
- Migration `supabase/migrations/0006_market_list_purchases.sql` is applied to the TEST project (by the owner's signed-in Supabase tab, with the owner's say-so) before the Supabase integration tests and the e2e run, and to the DEV project only when the owner asks.
- Port 3000 is free for the e2e run (the e2e builds a production build against the TEST project and does not reuse a server).

## 2. Commands (same as earlier modules)

```bash
npm run lint
npm run typecheck
npm test                  # unit + PGlite + Supabase integration
npm run test:e2e          # Playwright, mobile and desktop projects
npm run build             # run again after e2e so .next matches the DEV env
```

## 3. Manual walkthrough on a phone (owner, DEV project, after the module is built)

Use `npm run start -- -H 0.0.0.0 -p 3000` and open the PC's address on the phone. The owner reports what was seen; what is only reported and not visible in screenshots is recorded as such.

1. **Combined list (Story 1).** Confirm three orders today from three stores, each with Panadol (20, 10, 15) and one with a typed medicine. Open Market list from Home. Expect: Panadol total 45 with the three stores; the typed medicine under "Not yet registered".
2. **Draft and cancelled are ignored.** Leave one draft and cancel one order, both with Panadol. Expect: total stays 45.
3. **Partial purchase (Story 2).** On Panadol tap "Record purchase", enter 20, save. Expect purchased 20, remaining 25, "Partly bought". Record 10 more: 30 / 15. Tap "Bought all remaining": the form shows 15 and waits; confirm; expect "Fully bought". Record 5 more: "Bought extra 5". Pick an earlier purchase date in the dialog and check that it says which day's list the purchase will count for.
4. **Cancel an entry.** Cancel the 5 with a reason. Expect "Fully bought" again; the entry stays in the history as cancelled with the reason.
5. **Cost and price offer.** Record a purchase with a unit cost; expect the question about updating the medicine's purchase price; answer No, check the product price is unchanged; repeat and answer Yes, check it changed.
6. **Typed line.** On the typed row expect no purchase button and a "Register this medicine" link; register it; expect the row to move into the normal list.
7. **Print and CSV (Story 3).** Print preview (or "Save as PDF" in the browser): header, rows, the typed group marked "unregistered", no price or cost. Export the CSV and open it in a spreadsheet.
8. **Home and filters (Story 4).** Home card shows the number still to buy; search, status filter, store filter and date picker work; nothing scrolls sideways at the phone width.
9. **Time checks (for SC-012).** The owner times: find a medicine in a long list by typing part of its name and record a purchase. This is only recorded if the owner gives a time.

## 4. Master prompt Section 17 mapping

| Item | Covered by |
|------|-----------|
| 8 Aggregating identical products across stores | PGlite `db-market-list`, e2e `market-list.spec` |
| 9 Keeping different strengths and pack sizes separate | PGlite `db-market-list` (separate products and separate units), unit test of the key rule |
| 10 Recalculating market quantities when orders change | PGlite `db-market-recalc` (edit, cancel, confirm, register, link), e2e |
| 11 Partial wholesale purchases | PGlite `db-purchase-record`, Supabase `purchases-api`, e2e `purchase-record.spec` |
| 23 Market list showing unregistered lines in their own group | PGlite `db-market-list`, e2e |
| 19 (this module's tables and functions) RLS | PGlite `db-market-rls`, Supabase `rls-market` with two real users |
| 20 Print output (market list only) | e2e `market-print.spec` with print-media emulation and a generated PDF; no real printer |

Items 12 to 18, 24 to 31 belong to later modules and are not claimed here.

## 5. What the automated checks must prove (summary of the plan's test list)

- Sum of the list quantities equals the sum of the day's confirmed order line quantities, typed lines included; draft and cancelled orders are never counted; the Pakistan day boundary is respected (23:59 and 00:00).
- Same medicine in two units gives two rows; different strength, form, manufacturer or pack size gives separate rows; typed text grouped ignoring case and repeated spaces.
- Partial, full, extra and cancelled purchase figures; remaining never negative.
- 10 identical and 10 simultaneous record requests give one entry; a repeated cancel gives one void; the same id with different content is refused.
- Entries and voids cannot be updated or deleted (trigger tests); a cancelled entry stops counting and stays in the history.
- Recording and cancelling change no order, line, delivered quantity or price snapshot, and no product price (compare rows before and after).
- The list, summary, print data and CSV have no price, cost or MRP keys (key-name test on the JSON and a text test on the PDF and CSV); CSV formula characters are neutralised.
- Another business's ids get the same answer as a missing record and change nothing (PGlite and two real Supabase users).
- 360 px: no target under 44 px, no sideways scroll, loading / error / empty states on the list and on the purchase history.
- Scale: 200 orders and 1,000 lines on the TEST project, list time recorded (goal 3 seconds), purchase save time recorded (goal 2 seconds).

## 6. Results

Recorded as the work goes; anything not listed here has not been run.

### Baseline before any change (T001, 2026-11-13, branch 005-market-list-purchases from master c452cf8)

- `npm run lint` exit 0 and `npm run typecheck` exit 0.
- `npm test`: 60 files, 628 passed and 2 failed in the first run. The two failures were timing tests (`product-search` 5,000 products took 1,165 ms against a 1,000 ms goal, and `import-5000`); that run overlapped with my own parallel test runs on the same PC. Both passed when rerun alone (2 files, 5 tests). So the baseline is green, and these two tests are sensitive to a busy machine: the final full run must be done with nothing else running.

### Supabase integration and scale (TEST project, 2026-11-13, after migration 0006 was applied)

- `market-api` 10 tests, `purchases-api` 8, `market-concurrency` 4 (10 simultaneous identical records give one entry; 10 simultaneous cancels give one cancellation; 10 different ids give 10 entries), `rls-market` 7 (two real users, crafted ids, direct writes refused, anon refused), plus the PGlite `db-market-rls` 8: all passed.
- Scale (T051, 200 confirmed orders, 1,000 lines, 150 medicines, 20 stores, 300 purchase entries; database calls including the network round trip, 5 runs each, max in ms): first run: list 311, search 286, to_buy 276, 3 stores 268, summary 277, purchase history 335, purchase save 337. Second run: list 422, search 386, to_buy 337, 3 stores 635, summary 1,514 (one slow run, the other four 352 to 925), purchase history 1,298 (one slow run), purchase save 791. Every maximum is under the goals (list 3,000 ms, save 2,000 ms); the spread between runs is network noise to the hosted project. SC-010 holds on these runs. No performance migration was needed (no `0007`).
- The first scale run had one failing assertion that was my own arithmetic error in the test (typed texts counted as 50 instead of 5); it was fixed and the test rerun.

### Browser tests on the mobile project (360 px, production build against the TEST project, 2026-11-13)

- First run of the four new specs (`market-list`, `purchase-record`, `market-print`, `market-home`): 24 passed, 2 failed. Both failures were mistakes in my tests, not in the app: one counted the rows before the list had loaded; the other read the printed text from the wrong element (`main`, which held "Loading…" at that moment), which also made its no-money check empty. Both were fixed (the print tests now read the printed article and first check that it contains the medicine), then rerun together with the new touch-target, states and shell tests: 8 passed.
- Together: 26 tests in the four specs plus 4 new tests in `touch-targets`, `states` and `shell` (every new screen and dialog at 360 px: no control under 44 x 44 px, no sideways scroll; loading, error with Retry and empty states of the list, the purchase history and the Home card; the bottom navigation still has five items). The desktop project has not been run yet; the specs are mobile-only by design.
- Print is checked with print-media emulation (navigation and toolbar hidden, header, rows, unregistered group marked, no money words) and a generated PDF that is checked only to be a real, non-empty PDF, because no PDF text reader is installed (no dependency was added). A real printer was NOT used.
- Security and honesty sweep (T053) of the Module 005 source: cost, price and MRP words appear only in the purchase entry paths (the entry type, the record request, the repository call, the record dialog, the history dialog and the price offer); no browser storage, no secret or service key, no "synced" or "saved on this device" wording, no `any` and no `@ts-ignore`; one `eslint-disable` for exhaustive-deps in the price offer (it must run once per recorded purchase); the only checkbox is the store filter; no control marks something bought without a quantity; no profit or margin wording except a comment saying they are never printed.

### Full verification run (T055, 2026-11-13, nothing else running on the PC, TEST project)

- `npm run lint` exit 0; `npm run typecheck` exit 0.
- `npm test`: 76 files, 816 tests, all passed (exit 0). The two timing tests (`product-search`, `import-5000`) passed because the PC was otherwise idle.
- `npm run test:e2e` (mobile and desktop projects, production build against the TEST project, 1.2 hours): 318 passed, 116 skipped, 2 failed. The skips are by design: the Module 005 market-list, purchase, print and home specs and the new touch-target, states and shell tests run on the mobile project only, and a few older specs are mobile- or desktop-only as written. The desktop project ran 102 passing tests; the mobile project 216.
- The 2 failures were older Module 003 specs, not Module 005 ones: `orders-take` ("add a store on the spot, take three lines...", the medicine search result did not appear within the 60 s test timeout) and `orders-recovery` ("opening New order and leaving without a change creates nothing", the order's store element was not found). The cause was not established from the run itself. Rerun alone (`orders-recovery` and `orders-take` specs, both projects): 16 passed, 16 skipped, 0 failed, including both failed tests on mobile. So they did not fail on rerun, which points to slowness or a transient network delay to the hosted TEST project during the long run, but this is an inference, not a proven cause; the full run itself is recorded here as 2 failed.
- `npm run build` after the e2e run: exit 0, so `.next` matches the DEV environment again.
- Not covered: a real printer; the owner's phone walkthrough and SC-012 timing (T057); the DEV project (migration 0006 not applied there yet).

## 7. Migration 0006 on the TEST project (T015, 2026-11-13)

Applied to the TEST project (`medicine-supply-test`, ref `zhmsupwlanuxumtmaabx`) at the owner's request ("first apply for test then commit"), through the owner's signed-in Supabase tab (the session had expired; the owner signed in again themselves, no password was typed or requested). The SQL editor showed its generic "destructive operations" warning because the file contains `drop trigger if exists` and `drop policy if exists` for its own new objects; it was confirmed, and the result was "Success. No rows returned".

Read-only counts before and after, identical: 15 medicines, 3 stores, 1 order, 2 order lines, 0 order events. Before: no `purchase_entries` or `purchase_voids` table and none of the 7 new functions. After: both tables exist with 0 rows and Row Level Security on; 2 append-only triggers; 2 indexes (`orders_market_idx`, `purchase_entries_day_idx`); 2 select policies; the 7 functions exist and all 7 are executable by signed-in users and none by `anon`; signed-in users have no insert, update or delete privilege on either table; `anon` has no privilege on either table. The DEV project has NOT received this migration.

## 8. Migration 0006 on the DEV project (T056, 2026-11-13)

Applied to the DEV project (`medicine-supply-dev`, ref `sdzacjtlltiggvajxato`) at the owner's request ("keep continue T056 now"), through the owner's already signed-in Supabase tab (no password was typed or requested). The SQL editor showed the same generic "destructive operations" warning as on the TEST project (the file contains `drop trigger if exists` and `drop policy if exists` for its own new objects); it was confirmed, and the result was "Success. No rows returned". There is no `0007` migration.

Read-only counts before and after, identical: 158 medicines, 2 stores, 8 orders, 24 order lines, 20 order events. Before: neither new table and none of the 7 new functions existed. After: `purchase_entries` and `purchase_voids` exist with 0 rows and Row Level Security on (2 of 2); 2 append-only triggers; 2 indexes (`orders_market_idx`, `purchase_entries_day_idx`); 2 select policies; the 7 functions exist, all 7 executable by signed-in users and none by `anon`; signed-in users have no insert, update or delete privilege on either table; `anon` has no privilege on either table. These are catalog checks only: no purchase was recorded on the DEV project, and the screens were not yet used there (that is the owner's phone walkthrough, T057).

## 9. Owner phone walkthrough on the DEV project (T057, 2026-11-14)

The owner ran the section 3 walkthrough on a real phone (Android Chrome, address `http://192.168.1.7:3000`, a production build against the DEV project) and answered in chat. What was seen by me and what was only reported:

- **Reported, not seen:** steps 1 to 4 and 6 to 8 (combined list, draft and cancelled ignored, partial purchases, "Bought all remaining", cancel with reason, the typed line and its "Register this medicine" link, print and CSV, Home card and filters) all "passed" (the owner said everything else passed, translated from Roman Urdu). No screenshots or per-step detail were given for these.
- **Seen in a screenshot:** the "Update the purchase price?" dialog for Nimer (cost 58.00 against a current purchase price of 55.00, the text "Your selling price and the prices on orders do not change", the buttons "No, keep the current price" and "Yes, update"), and the Market list header "0 medicines, 2 not registered yet" with the unregistered "Disprien" group (25 strip, two stores) and its "Register this medicine" link.
- **Step 5 (cost and price offer), confirmed by the database and by the owner:** read-only queries on the DEV project after the owner's tests showed Nimer: a purchase entry with cost 58.00 at 01:39 left the purchase price at 55.00 (the owner answered No), and after later entries with cost 65.00 the purchase price was 65.00 three seconds after the last entry (Yes), selling price unchanged at 60.00. ACOLD TAB: one entry with cost 40.00 and the purchase price 40.00 three seconds later (Yes), selling price unchanged at 33.00. The owner first thought the update had failed because the Products list shows only the selling price (33.00 for ACOLD TAB); after opening the Edit page the owner confirmed in chat that "Purchase price" shows 40 and "Selling price" still shows 33 (reported, not seen by me). So the offer behaves as designed. Finding: the Products list does not show the purchase price at all (by design in Module 001); the owner may want it shown later, which would be a separate change.
- **Note:** the selling price is below the purchase price for both tested medicines (33 against 40, 60 against 65). The product form only warns about this ("You can still save"); the owner decides.
- **SC-012 (find a medicine and record a purchase in under 30 seconds): NOT met on the reported timing.** The owner reported 30 to 40 seconds and confirmed (2026-11-14) that this covered finding the medicine and saving the purchase together, which is above the 30-second goal. This is one reported timing by hand on a phone; the length of the list and the number of taps were not recorded, so the cause (typing, scrolling, the dialog steps or the save) is not known. The server side is not the cause on the measured numbers (purchase save at most 791 ms, list at most 422 ms in the scale test). Whether to shorten the steps is the owner's decision and is not part of this module so far.
