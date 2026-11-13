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

## 7. Migration 0006 on the TEST project (T015, 2026-11-13)

Applied to the TEST project (`medicine-supply-test`, ref `zhmsupwlanuxumtmaabx`) at the owner's request ("first apply for test then commit"), through the owner's signed-in Supabase tab (the session had expired; the owner signed in again themselves, no password was typed or requested). The SQL editor showed its generic "destructive operations" warning because the file contains `drop trigger if exists` and `drop policy if exists` for its own new objects; it was confirmed, and the result was "Success. No rows returned".

Read-only counts before and after, identical: 15 medicines, 3 stores, 1 order, 2 order lines, 0 order events. Before: no `purchase_entries` or `purchase_voids` table and none of the 7 new functions. After: both tables exist with 0 rows and Row Level Security on; 2 append-only triggers; 2 indexes (`orders_market_idx`, `purchase_entries_day_idx`); 2 select policies; the 7 functions exist and all 7 are executable by signed-in users and none by `anon`; signed-in users have no insert, update or delete privilege on either table; `anon` has no privilege on either table. The DEV project has NOT received this migration.
