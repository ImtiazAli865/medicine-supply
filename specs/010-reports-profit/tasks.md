---

description: "Task list for Module 010: Reports and Profit"
---

# Tasks: Reports and Profit

**Input**: Design documents from `/specs/010-reports-profit/`
**Prerequisites**: plan.md, spec.md, research.md (decisions D1-D13), data-model.md, contracts/api.openapi.yaml, quickstart.md
**Tests**: INCLUDED. Constitution Principles II, IV, V, VII and VIII and spec success criteria SC-001 to SC-011 require them. Within each story, write its tests first and confirm they fail for the right reason before the implementation (database function tests first, then the route, then the screen).
**Organization**: Grouped by user story. Priority order: US1 sales and profit, honestly (P1), US2 purchases (P2), US3 sales by store and by medicine (P3), US4 outstanding balances (P3), US5 CSV export (P4), then the cross-cutting entry points, guards and owner steps.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 sales and profit · US2 purchases · US3 stores and medicines · US4 balances · US5 export
- Paths are relative to the repository root `D:\my project\medicine-supply`. Do not touch `docs/`, `.specify/`, `.claude/`, `CLAUDE.md`, the constitution, or the specs of Modules 001 to 009 while implementing (checking boxes in this file is allowed).
- **One migration, `supabase/migrations/0011_reports.sql`** (read-only functions, one index, grants; no table, no column, no write path; plan D1). It is built up story by story in the same file (every statement is `create or replace` or `if not exists`, so it can be applied again). Never edit migrations 0001 to 0008. The dropped voice work (migrations 0009 and 0010, applied on the TEST and DEV projects but not in this repository) must not be used or recreated. **Ask the owner before applying 0011 to the TEST project (needed for the integration tests) and again before applying it to DEV.** **No new npm package.**
- Every function is `SECURITY INVOKER`, `STABLE`, `set search_path = public`, filters by `current_business_id()`, is revoked from `public` and `anon`, and granted to `authenticated` only. Cost, profit and margin keys may appear only in `/api/reports/*` responses (plan D11). Never use the service-role key in `src/`; tests may use it only to seed.
- Money: the server returns decimal strings and the browser only formats them with `src/lib/money.ts`; **never add, subtract or compare money with JavaScript numbers** (plan D4). A profit may be negative or `null` (not available), never zero standing for unknown.
- Never store report data in `localStorage`, `sessionStorage`, IndexedDB or the service worker cache; nothing in `src/lib/device/**`, `src/lib/backup/**` or `public/sw.js` may name the report code (plan D11). Offline, Reports show "Reports need the internet" and no old numbers.
- Test ids used by the new screens: `report-period`, `report-group`, `report-total-sales`, `report-estimated`, `report-realized`, `report-status` (Estimate, Incomplete, Complete), `report-excluded`, `report-row`, `report-export`, `report-empty`, `report-error`, `report-retry`, `cost-missing-row`.
- Tests use the separate TEST Supabase project (`.env.test.local`) and PGlite, never the owner's dev project. The owner signs in themselves (never ask for or type passwords or the secret key). The browser tests start their own production build, so stop `npm run dev` first. End-to-end tests can only issue invoices dated today (the app sets the date), so day-by-day rules are tested on PGlite where dates can be set.
- All repository text (code, comments, tests, docs, commit messages) is English only (CLAUDE.md "Language"). Chat replies to the owner stay in Roman Urdu.
- This branch starts from `master` (Module 009 merged, merge commit `ae00244`). Do not commit, push, or open a pull request unless the owner says so.

## Path Conventions

Same single Next.js project: `src/app`, `src/components`, `src/lib`, `tests/{unit,integration,e2e,helpers}`. Reuse existing code: `src/lib/ids.ts`, `src/lib/money.ts` (`formatPKR`, `paisaToMoney`), `src/lib/api/{auth,errors,client}.ts` (`requireBusinessUser`, `requirePageContext`, `handle()`, `ApiError`, `fetchJson`), `src/lib/hooks/useApiResource.ts`, `src/lib/market/csv.ts` (`csvCell`), `src/lib/accounts/repository.ts` (`listAccounts`, `getAccountsSummary`), `src/components/ui/*`, the PGlite helpers (`tests/helpers/{pglite,invoices-db,market-db,pending-db,orders}.ts`) and the TEST-project helpers (`tests/helpers/{supabase-test,market,accounts,invoices}.ts`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A green baseline and the seeding helpers every report test needs

- [x] T001 Baseline: on this branch run `npm run lint`, `npm run typecheck` and `npm test` before any change and record the real counts in `specs/010-reports-profit/quickstart.md` section 5 (a "Baseline" line). Confirm the Supabase TEST project is reachable. Rerun a failing test once to tell a flaky one from a real one and say so in the note.
- [x] T002 [P] Create `tests/helpers/reports-db.ts` (PGlite): `dbReport(db, userId, fn, args)` (calls a report function as the signed-in user, like `withRole` in the other helpers); `seedIssuedInvoice(db, tenant, { storeId, date, marketDate?, lines: [{ product, unit, qty, price, purchaseSnapshot? }] })` that creates the order and invoice through the real functions (`createPendingOrder`, `createInvoiceDraft`, `issueInvoice`) and then backdates in one helper `backdate(db, { invoiceId, orderId, invoiceDate, confirmedAt })` that disables the guard triggers (`alter table public.invoices disable trigger invoices_guard`, the same for orders) inside the call and always re-enables them; `seedPurchase(db, userId, { product, unit, date, qty, unitCost })` over the existing `dbRecord`; `voidPurchase`; `bulkInvoices(db, tenant, { invoices, linesEach, days })` that inserts issued invoices, lines and orders directly as the table owner for scale tests; and the owner's example `seedPanadolExample(db, tenant)` (23 Nov bought 10 at 50.00 and sold 10 at 55.00; 24 Nov bought 10 at 58.00 and sold 10 at 65.00). No other file edits.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The migration skeleton with the shared base function, the pure TypeScript layer, the repository and the shared screen kit. No story can start before these. T004 to T008 are independent of each other; T009 needs T003 and T004; T010 needs T005 to T009; T011 needs T010.

- [x] T003 Migration `supabase/migrations/0011_reports.sql` (first part), with a header like 0006 (what it does, that it is read-only, rollback note: drop the functions and the index; safe to run more than once): the partial index `invoices_report_idx on public.invoices (business_id, invoice_date) where status in ('issued','cancelled')`; the internal helper `report_check_period(p_from date, p_to date, p_group text)` that raises `invalid_period` (SQLSTATE 22023) when a date is null, `p_to < p_from`, `p_from` is after today in Pakistan time, the period is longer than 731 days, or the group is not day, week or month; and the base function `report_sales_lines(p_biz uuid, p_from date, p_to date)` exactly as in data-model.md (issued invoices whose `invoice_date` is in the period; lines with billed quantity above 0; `market_date`; `est_unit_cost` from `order_lines.purchase_price_snapshot`; `real_unit_cost` as the weighted average `sum(quantity*unit_cost)/sum(quantity)` of the non-cancelled purchase entries with a cost for the same product, `norm_text(unit)` and market date, computed once per (product, unit key, day) in a grouped CTE restricted to the dates the lines need and joined by key; unrounded `est_cost` and `real_cost` as `billed_qty * unit cost`; `est_missing`, `real_missing`). `SECURITY INVOKER`, `STABLE`, `set search_path = public`, explicit `business_id` filters, `revoke all ... from public, anon`, `grant execute ... to authenticated`. Test first: `tests/integration/db-report-schema.pglite.test.ts` (the migration applies twice without error; the functions exist; none is `SECURITY DEFINER`; `anon` cannot execute them; no new table exists; every function is `STABLE`).
- [x] T004 [P] `src/lib/reports/types.ts`: response types that mirror `contracts/api.openapi.yaml` exactly (`SalesReport`, `PurchaseReport`, `StoreReport`, `MedicineReport`, `CostMissingReport`, `NotInAccount`, `ProfitFigure`, `Bucket`, `Period`). Money is `string`; `profit` is `string | null`.
- [x] T005 [P] `src/lib/reports/period.ts` (pure) and `tests/unit/reports-period.test.ts` (write the test first): `pakistanToday(now)`, presets `today`, `this_week` (Monday start), `this_month`, `last_month`, `resolvePeriod({ from, to })`, `validatePeriod` (the same rules as `report_check_period`, with the messages shown on screen), `defaultPeriod()` (this month), `bucketLabel(group, start, end, partial)` ("Mon 3 Nov", "Week of 3 Nov", "Nov 2026", "from 3 Nov", "to 30 Nov"). Cover a week that crosses a month and a year, a leap day, the Pakistan date at 23:30 UTC, a period over 731 days, an end before the start, and a start in the future.
- [x] T006 [P] `src/lib/reports/validation.ts` (Zod) and `tests/unit/reports-validation.test.ts`: query schemas for sales, purchases, stores, medicines, cost-missing and export (dates `YYYY-MM-DD`, `group` default day, `q` trimmed and at most 100, `sort` in sales, profit, name, `limit` 1 to 50 default 20, `offset` at least 0, `report` in the five names). A bad value gives a `validation_error` that names the field.
- [x] T007 [P] `src/lib/reports/labels.ts` and `tests/unit/reports-labels.test.ts`: the one place for the wording: "Estimate", "Realized", "Complete", "Incomplete", the missing-cost sentence ("3 lines (PKR 12,500.00 of sales) have no cost"), the "profit not available" text, the exclusion sentence ("1 cancelled invoice and 2 drafts are not counted"), the unit-cost explanation of each figure, and the cost-missing reasons (`no_purchase_price_saved`, `no_purchase_on_market_day`, `typed_line`, `unit_differs`). Test: every label is English and non-empty, and the plural forms are right for 0, 1 and 2.
- [x] T008 [P] `src/lib/reports/csv.ts` (pure, no report data yet) and `tests/unit/reports-csv.test.ts`: `csvNumber(value)` that writes a money or count string as it is, including `-12.50`, and refuses (throws) anything that is not a plain number; text goes through `csvCell` from `src/lib/market/csv.ts`; `toCsv(headers, rows)` with `\r\n` line ends. Pin: `csvCell("=1+1")`, `"+x"`, `"-x"`, `"@x"` get an apostrophe, `csvNumber("-12.50")` stays `-12.50`, a name with a comma or a quote is quoted.
- [x] T009 `src/lib/reports/repository.ts` (server only; uses the signed-in user's client like `src/lib/market/repository.ts`): `call(supabase, name, args)` that turns `no_business` into `noBusiness()` and `invalid_period` into a `validation_error`; one function per database function added later (`getSalesReport`, `getPurchaseReport`, `getStoreReport`, `getMedicineReport`, `getCostMissing`, `getNotInAccount`), each returning the typed object. Add only the pieces whose database function exists; later tasks add the rest. Depends on T003 and T004.
- [x] T010 Shared screen kit in `src/components/reports/`: `PeriodChooser.tsx` (presets today, this week, this month, last month plus two date inputs; writes `from` and `to` to the address; refuses a bad period with the message from T005; every control at least 44 by 44 px; `data-testid="report-period"`), `GroupSwitch.tsx` (Day, Week, Month; `report-group`), `StatusBadge.tsx` (Estimate, Realized, Complete, Incomplete; colour plus text, never colour alone; `report-status`), `MoneyFigure.tsx` (large PKR amount through `formatPKR`, "Not available" for `null`), `BarList.tsx` (CSS-width bars, `aria-hidden`, every value also as text, no library) and `ReportShell.tsx` (title, back link to Reports, period and group controls, the three states: loading, error with `report-retry`, empty with a next action; the offline sentence "Reports need the internet" when the request fails and the device reports offline; an optional export button slot). Stacked cards under 640 px; no sideways scroll at 360 px. Depends on T005 and T007.
- [x] T011 Reports hub: `src/app/(app)/reports/page.tsx` (calls `requirePageContext`, `metadata` title "Reports · Medicine Supply", `dynamic = "force-dynamic"`) and `src/components/reports/ReportsHub.tsx`, driven by one exported constant `REPORTS` (`href`, `title`, `description`, icon from lucide-react). It starts empty and each story adds its own entry when its screen exists, so the hub never links to a screen that is not there (no dead links); the Home card (T049) is added only after the first entry exists. A short note on the hub: "Reports are for you only. They never appear on invoices, statements, prints or backups." Depends on T010.

**Checkpoint**: the migration skeleton applies on PGlite, the pure layer is proven by unit tests, and stories can start.

---

## Phase 3: User Story 1 - See sales and profit for a period, honestly (Priority: P1) 🎯 MVP

**Goal**: The owner picks a period and sees sales, the invoice count, the estimated profit and the realized profit, each labelled and with the missing-cost count, grouped by day, week or month, with a Cost missing list.

**Independent Test**: Seed issued, cancelled and draft invoices plus purchases with and without costs; the summary equals the issued invoices only, both profit figures carry their own label, a line without a cost makes its figure Incomplete with the count and amount, the three groupings add up to the same total, and the owner's 50/55 then 58/65 example gives per-unit profits 5 and 7.

### Tests for User Story 1 (write first, confirm they fail)

- [x] T012 [P] [US1] `tests/integration/db-report-sales-rules.pglite.test.ts` (needs `report_sales`): sales of a period equal the sum of `grand_total` of issued invoices with `invoice_date` in the period and the sum of the line totals; a cancelled invoice, a draft invoice, a draft order and a cancelled order add nothing and are counted in `excluded`; a changed catalog selling price does not change a frozen invoice; a zero-quantity line adds no sales and no missing line; an invoice dated the first and the last day of the period is included and the day before and after are not; a typed line (no product) is counted in sales and is cost missing for both figures; the billed (delivered) quantity is what counts when it differs from the ordered quantity (sales, cost and profit use the billed quantity, never the ordered one); an issued invoice that is not in the account (`in_account = false`, issued before Module 007) still counts in sales.
- [x] T013 [P] [US1] `tests/integration/db-report-cost-rules.pglite.test.ts`: the owner's example (`seedPanadolExample`): 23 Nov profit 50.00 on 550.00 sales, 24 Nov profit 70.00 on 650.00; recording the 24 Nov purchase later or at a different cost never changes 23 Nov; two purchases on one market day (10 at 50.00 and 10 at 56.00) give the weighted cost 53.00; a purchase on another day, a cancelled purchase, a purchase with no cost, and a purchase in another unit are never used and leave the line missing for Realized; the market date is the order's `confirmed_at` in Pakistan time (a confirmation at 23:30 UTC belongs to the next Pakistan day); an order confirmed on day 1 and invoiced on day 3 uses day 1 purchases; the Estimate uses `purchase_price_snapshot` only and a snapshot of `0.00` is a real cost of zero while a missing snapshot is missing; neither figure borrows a cost from another medicine.
- [x] T014 [P] [US1] `tests/integration/db-report-honesty.pglite.test.ts`: a figure with one missing line is `incomplete` with the right `missing_lines` and `missing_sales`, its profit covers only costed lines (`covered_sales`), and a period where nothing is costed has `profit = null` (not `0.00`); a complete period is `complete`; the estimated and realized figures are different fields that can disagree; money is exact (a cost of 3 units at a weighted 53.3333… is kept unrounded per line and the reported cost is rounded once; each row equals `round(unrounded sum)` and the total equals `round(unrounded total)`, and sales rows add up exactly).
- [x] T015 [P] [US1] `tests/integration/db-report-series.pglite.test.ts`: day, week (Monday) and month series add up to the same totals; a week or month at the edge of the period has `partial = true` and the right label; only buckets with data exist; a period crossing a month and a year end; `invalid_period` for a start after the end, a period over 731 days, a start in the future, a null date and a bad group.
- [x] T016 [P] [US1] `tests/integration/db-report-cost-missing.pglite.test.ts` (needs `report_cost_missing`): one row per medicine and unit with the sales amount, billed quantity, line count, which figure is missing, up to 10 `realized_dates` in ascending order and the reason (`no_purchase_price_saved`, `no_purchase_on_market_day`, `typed_line`, `unit_differs`); a medicine with costs on every day is not listed; sorted by sales amount descending then name; the list needs no cost value itself.
- [x] T017 [P] [US1] `tests/integration/db-report-rls.pglite.test.ts` (extended by later stories): two tenants with different invoices and purchases; every report function returns only the caller's data; calling `report_sales_lines` and `report_sales` with the **other** tenant's business id returns nothing; `anon` is refused; a read-only transaction (`set transaction read only`) runs every function without error and nothing was written (row counts of all touched tables are unchanged).
- [x] T018 [P] [US1] `tests/integration/reports-api.test.ts` (TEST project, two real tenants; `hasTestEnv` skip like the other integration tests; first part): `getSalesReport` and `getCostMissing` as the signed-in user; the other tenant's data never appears; a crafted date range gives `validation_error`; a signed-out request is refused with 401 through the route handler.

### Implementation for User Story 1

- [x] T019 [US1] Migration part 2 in `supabase/migrations/0011_reports.sql`: `report_sales(p_from, p_to, p_group)` returning the `SalesReport` jsonb exactly as in the contract (period, totals, estimated and realized figures, excluded counts, series with `partial`), built only from `report_sales_lines`; and `report_cost_missing(p_from, p_to)`. Money as `::text` with two decimals. Grants as in T003. Run T012 to T017 on PGlite until green.
- [x] T020 [US1] Add `getSalesReport` and `getCostMissing` to `src/lib/reports/repository.ts` and the routes `src/app/api/reports/sales/route.ts` and `src/app/api/reports/cost-missing/route.ts` (`requireBusinessUser`, Zod first, `handle()`, `Cache-Control: no-store`, 401 when signed out). Depends on T019, T006, T009.
- [x] T021 [US1] Apply `0011_reports.sql` to the TEST project (**ask the owner first**), then run `tests/integration/reports-api.test.ts` (T018) until green.
- [x] T022 [US1] `src/lib/reports/client.ts` (a `useReport(path, params)` hook over `fetchJson` and `useApiResource`: loading, ready, error with `retry`; re-fetches when the period or group changes; never shows data from a failed request) and `src/components/reports/SalesReportScreen.tsx`: period chooser and group switch, a totals card (sales, invoices), an Estimated card and a Realized card each with `StatusBadge`, the explanation from the labels, `report-excluded` (cancelled and draft counts), the missing-cost sentence with a link to Cost missing when any, a profit of "Not available" for `null`, the series as `BarList` plus text rows (stacked cards on a phone), the sentence "Days without sales are not listed", the rounding note ("Rows are rounded one by one"), and the empty state ("No issued invoices in this period" with "Choose another period" and "Go to orders"). Page `src/app/(app)/reports/sales/page.tsx` (reads `from`, `to`, `group` from the address with the safe default of T005). Depends on T010, T020.
- [x] T023 [US1] `src/components/reports/CostMissingScreen.tsx` and `src/app/(app)/reports/cost-missing/page.tsx`: rows with the medicine details (strength, form, pack size, manufacturer), the unit, the sales amount, the reason in words and the fix links (plan D13): "Set purchase price" to `/products/{id}`, "Record a purchase for 23 Nov" to `/market-list?date=YYYY-MM-DD` for each affected date (up to 10), typed lines to `/pending`; states as in T010; the screen changes nothing. Depends on T020.
- [x] T024 [US1] Add the two entries ("Sales and profit", "Cost missing") to `REPORTS` in `src/components/reports/ReportsHub.tsx`, so the hub links only to screens that exist.
- [x] T025 [P] [US1] `tests/e2e/reports-flow.spec.ts` (TEST project; issues invoices dated today through the app's functions, adds purchases dated today): the owner opens Reports, then Sales and profit; sales equal the issued invoices; a cancelled invoice is excluded and named; a line with no cost makes the Realized card "Incomplete" with the count; the group switch keeps the same total; the Cost missing list shows the medicine and its link opens the right screen; changing the period updates the address and survives a reload.
- [x] T026 [P] [US1] `tests/e2e/reports-states.spec.ts` (first part): the loading state, the error state (the route is forced to fail) with Retry that recovers and never shows zero, the empty state of a business with no invoices (next action visible), and the offline message (the phone context set offline shows "Reports need the internet" and no numbers).
- [x] T027 [P] [US1] Early speed check, `tests/integration/reports-scale.test.ts` (TEST project, `hasTestEnv` skip; first part): seed 5,000 issued invoices with 10 lines each across 90 days with one bulk insert as the service role (this test only, never in `src/`), then time `report_sales` for the whole range, for one month and for one day, 5 runs each; assert each under the 2 second budget and print the measured times; plus a PGlite correctness-at-size check `tests/integration/db-report-scale.pglite.test.ts` with a looser 6 second ceiling that catches an accidental quadratic plan. If the TEST budget is missed, apply the named fallback (a covering index on `invoice_lines`) in the migration and measure again; do not cache or store totals. Record the real numbers in `specs/010-reports-profit/quickstart.md` section 5.

**Checkpoint**: US1 works end to end (MVP). The owner can trust the profit figures or see exactly why not.

---

## Phase 4: User Story 2 - See what was purchased (Priority: P2)

**Goal**: The purchase summary shows the money spent from actual quantity and actual cost, leaves out cancelled entries, and names entries without a cost.

**Independent Test**: Costed, uncosted and cancelled entries in a period; the money total counts only the costed, non-cancelled ones, the uncosted ones are listed as "no cost recorded" and make the total Incomplete, the cancelled count is shown, and the three groupings add up.

### Tests for User Story 2 (write first)

- [x] T028 [P] [US2] `tests/integration/db-report-purchases.pglite.test.ts` (needs `report_purchases`): cost = quantity × actual unit cost summed exactly; a voided entry is not counted and `cancelled_entries_left_out` counts it; an entry with no cost adds to `entries_without_cost` and `quantity_without_cost`, adds nothing to money and makes `status = incomplete`; day, week and month add up; period rules as in T015; a business with no entries returns an empty series; another tenant's entries never appear; nothing is derived from a market-list status.
- [x] T029 [P] [US2] Extend `tests/integration/db-report-rls.pglite.test.ts` and `tests/integration/reports-api.test.ts` with `report_purchases` (two tenants, crafted business id, read-only transaction).

### Implementation for User Story 2

- [x] T030 [US2] Migration part 3: `report_purchases(p_from, p_to, p_group)` as in the contract, from `purchase_entries` minus `purchase_voids`, bucketed by `purchase_date`. Run T028 and T029 on PGlite until green.
- [x] T031 [US2] `getPurchaseReport` in `src/lib/reports/repository.ts`, route `src/app/api/reports/purchases/route.ts`, screen `src/components/reports/PurchasesReportScreen.tsx` and page `src/app/(app)/reports/purchases/page.tsx`: total cost, entries, the "no cost recorded" count with its Incomplete badge, the cancelled count left out, the series, states (empty state links to "Open the market list"), the note "A tick on the market list is never a purchase. Only recorded quantities count." Add the entry to `REPORTS`. Re-apply the migration to the TEST project (the owner approved in T021) and run the API part of T029.
- [x] T032 [P] [US2] `tests/e2e/reports-purchases.spec.ts`: record purchases with and without a cost and cancel one through the app; the summary matches; the Incomplete badge and counts show; the empty state; a failed load shows the error with Retry.

**Checkpoint**: US1 and US2 work independently.

---

## Phase 5: User Story 3 - See which stores and medicines sell most (Priority: P3)

**Goal**: Sales by store and sales by medicine for a period, with each row's profit labelled, medicines grouped by identity and unit, typed lines in "Not registered", sorting and search.

**Independent Test**: Medicines that differ only by strength or pack size are separate rows, a typed line sits in "Not registered", the store rows, the medicine rows and the summary give the same sales, and search and sort work.

### Tests for User Story 3 (write first)

- [x] T033 [P] [US3] `tests/integration/db-report-by-store.pglite.test.ts` (needs `report_by_store`): rows with sales, invoices, share and both figures with labels; the sum of the sales of the rows equals the `report_sales` total (cost and profit rows equal `round(unrounded sum)` each); sort by sales, by profit (the **realized** profit, rows with a null realized profit last, ties by name) and by name; search by name narrows rows and `filtered_totals` covers only them while `totals` covers the whole period; paging (`limit` 50 max, `offset`, `total`); a store with only cancelled invoices is not listed; another tenant's stores never appear.
- [x] T034 [P] [US3] `tests/integration/db-report-by-medicine.pglite.test.ts` (needs `report_by_medicine`): Panadol 250 mg and 500 mg and two pack sizes and two manufacturers are separate rows; the same medicine sold in two units is two rows; rows group by product id and unit key, never by similar text; typed lines are in `typed_rows` by exact typed text compared ignoring capital letters and repeated spaces; medicine rows plus typed rows equal the `report_sales` total and the store rows total; an inactive or since-renamed medicine still shows its name as frozen on the invoice line; sort (profit means realized profit, unknown last), search and paging as in T033; per-row profit labels follow the rules of T013 and T014.
- [x] T035 [P] [US3] Extend `tests/integration/db-report-rls.pglite.test.ts` and `tests/integration/reports-api.test.ts` with both functions (two tenants, crafted business id, read-only).

### Implementation for User Story 3

- [x] T036 [US3] Migration part 4: `report_by_store(p_from, p_to, p_q, p_sort, p_limit, p_offset)` and `report_by_medicine(...)` as in the contract; the search uses the existing `pending_search_ok` and `pending_like_escape` helpers so a `%` or `_` typed by the owner is literal; `share` is computed in the database from exact values. Run T033 to T035 on PGlite until green.
- [x] T037 [US3] Repository functions `getStoreReport` and `getMedicineReport`, routes `src/app/api/reports/stores/route.ts` and `src/app/api/reports/medicines/route.ts`, screens `StoresReportScreen.tsx` and `MedicinesReportScreen.tsx` (rows as cards on a phone: name and medicine details, sales, billed quantity or invoices, profit figures with badges; sort chips; debounced search box; "Load more"; a "Not registered" section; the sentence "Totals below are for the rows shown" when a search is active; empty states with a next action), pages `src/app/(app)/reports/stores/page.tsx` and `.../medicines/page.tsx`. Add both entries to `REPORTS`. Re-apply the migration to TEST and run the API part of T035.
- [x] T038 [P] [US3] `tests/e2e/reports-stores-medicines.spec.ts`: two stores and medicines that differ by strength; separate rows; a typed line in "Not registered"; search and sort; the row totals equal the Sales and profit total; the touch targets of the new controls.

**Checkpoint**: US1 to US3 work independently.

---

## Phase 6: User Story 4 - See what each store still owes (Priority: P3)

**Goal**: Outstanding balances inside Reports with the same single definition as Home, stores that owe first, advances shown as advance, and a note about invoices that are not in the account.

**Independent Test**: With stores that owe, stores in advance and stores at zero, the report lists them correctly, its total equals the Home figure, and recording a payment changes only that store.

### Tests for User Story 4 (write first)

- [x] T039 [P] [US4] `tests/integration/db-report-not-in-account.pglite.test.ts` (needs `report_not_in_account`): counts and totals issued invoices with `in_account = false` (invoices issued before Module 007 are simulated by `update ... set in_account = false` with the guard disabled in the helper), ignores drafts, cancelled invoices and invoices in the account, returns zero for a new business, and never returns another tenant's invoices; extend `db-report-rls.pglite.test.ts` with it.
- [x] T040 [P] [US4] In `tests/integration/reports-api.test.ts` (second part): the balances shown by the Reports screen come from `listAccounts` and `getAccountsSummary`; for stores with debits, credits, a reversal and an advance each balance equals the sum of its entries and the total owed equals `getAccountsSummary().total_owed` (the Home figure); a payment for store A does not change store B's line.

### Implementation for User Story 4

- [x] T041 [US4] Migration part 5: `report_not_in_account()` (`invoices` and `total` as text). Repository `getNotInAccount`, route `src/app/api/reports/balances-note/route.ts`. Re-apply the migration to TEST.
- [x] T042 [US4] `src/components/reports/BalancesReportScreen.tsx` and `src/app/(app)/reports/balances/page.tsx`: reuses the existing account list and summary routes (`/api/accounts`, `/api/accounts/summary`) and the existing `BalanceBadge`, shows the total owed, the stores that owe first, advances as "Advance" (not subtracted from the total), a link to each store's account screen, the note "N invoices issued before store accounts are not in any balance" from T041, loading, error with Retry and the empty state ("Add an opening balance or issue an invoice"). This screen has no period chooser. Add the entry to `REPORTS`.
- [x] T043 [P] [US4] `tests/e2e/reports-balances.spec.ts`: the total equals the Home card, advances are labelled, a payment changes only its store, the empty state, and the not-in-account note appears only when such invoices exist.

**Checkpoint**: US1 to US4 work independently.

---

## Phase 7: User Story 5 - Export the report I am looking at (Priority: P4)

**Goal**: "Export CSV" on every report, Outstanding balances included (the owner asked for it on 2026-11-24), gives the same rows, period and filters as the screen, with the markers kept. The balances file has no period.

**Independent Test**: Export each report for a known period; rows and totals equal the screen, the markers are in the file, a medicine name that starts with `=` is text, a negative profit is a number.

### Tests for User Story 5 (write first)

- [x] T044 [P] [US5] Extend `tests/unit/reports-csv.test.ts` with the six builders (`salesCsv`, `purchasesCsv`, `storesCsv`, `medicinesCsv`, `costMissingCsv`, `balancesCsv`) fed with fixed report objects (for `balancesCsv`: one row per store with its signed balance as a number, a `Status` column Owes, Advance or Zero, a `TOTAL OWED` row equal to the Home figure, and the not-in-account note; an advance stays a negative number): header rows, one row per series bucket or list row, a `Figure status` column ("Complete", "Incomplete: 3 lines without cost", "Estimate"), the missing-line counts, a final `TOTAL` row that equals the screen total, money and counts through `csvNumber` (a negative profit stays `-12.50`), names and notes through `csvCell`, a `null` profit written as an empty cell with status "Not available", and a header that names the period.
- [x] T045 [P] [US5] (changed while implementing: the export route needs a browser session cookie, so it is tested in `tests/e2e/reports-export.spec.ts`, not in a Vitest integration file; the file checks below move there and into `tests/unit/reports-csv-files.test.ts`): the export of each report for a period equals the JSON of the same request row by row; a search filter is respected; more than 5,000 rows gives `list_too_large` (409, the same status as the market list export) with the message "Too many rows to export. Narrow the report with a search or a shorter period."; a bad period gives `validation_error`; a signed-out request gives 401; the file name is `report-<name>-<from>-<to>.csv` (`report-balances-<date>.csv` for balances); the balances export equals the account list row by row and its total equals `getAccountsSummary().total_owed`, and a payment for one store changes only that store's row.

### Implementation for User Story 5

- [x] T046 [US5] Add the six builders to `src/lib/reports/csv.ts` and the route `src/app/api/reports/export/route.ts` (`requireBusinessUser`, Zod, the same repository calls as the screens, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`; for lists it reads up to 5,000 rows in pages of 50 or one function call with a higher internal cap, and refuses larger with `list_too_large`; for `balances` it reads the existing `listAccounts` pages (at most 5,000 stores) and `getAccountsSummary` and needs no period). No PDF.
- [x] T047 [US5] An "Export CSV" button (`report-export`, at least 44 px) in `ReportShell` that is not offered while loading, failed or empty and links to `/api/reports/export` with the screen's exact period, group, search and sort; wire it into all six report screens (sales and profit, purchases, stores, medicines, cost missing, balances; the balances button has no period).
- [x] T048 [P] [US5] `tests/e2e/reports-export.spec.ts`: download a CSV from Sales and profit, from Sales by medicine and from Outstanding balances; the rows and totals equal the screen (the balances total equals the Home card); the Incomplete marker is in the file; the button is absent in the error and empty states; a medicine named `=SUM(1)` is exported as text.

**Checkpoint**: all five stories work.

---

## Phase 8: Polish and Cross-Cutting Concerns

**Purpose**: Entry points, offline wording, the internal-only guards, isolation on the real stack, the speed budget and the owner's steps.

- [x] T049 Entry points: a "Reports" card in `src/app/(app)/page.tsx` (in the `cards` list beside Products and Stores, icon `BarChart3` from lucide-react, text "Your sales and what stores owe." (the first wording, which said "profit", broke the existing rule that no order screen or Home names purchase, cost, margin or profit; found by the full browser suite)) and a "Reports" link in `src/app/(app)/settings/page.tsx`; the bottom navigation file `src/components/shell/BottomNav.tsx` is **not** changed (five items). Update any existing Home end-to-end test that counts the cards.
- [x] T050 Offline shell: add `["/reports", "Reports"]` to `BLOCKED_AREAS` in `src/lib/device/shell-route.ts`; extend `tests/unit/shell-route.test.ts` (`/reports` and `/reports/sales?from=...` give a blocked area named "Reports"). Confirm `tests/unit/offline-no-price.test.ts` still passes unchanged.
- [x] T051 [P] Internal-only guard `tests/unit/reports-no-leak.test.ts` (static): no file under `src/lib/invoices`, `src/components/invoices`, `src/lib/accounts`, `src/components/accounts`, `src/lib/market`, `src/components/market`, `src/lib/orders`, `src/components/orders`, `src/app/(app)/orders`, `src/lib/device`, `src/lib/backup`, `src/components/offline` or `public/sw.js` imports or names `reports` code (`@/lib/reports`, `@/components/reports`, `/api/reports`), except `src/lib/market/csv.ts` being imported **by** the reports (the other direction is allowed); no `service_role` or `SERVICE_ROLE` text anywhere under the new folders; the new folders never mention `localStorage`, `sessionStorage` or `indexedDB`.
- [x] T052 [P] Leak guards on the real responses, `tests/integration/reports-internal-only.pglite.test.ts`: with purchase prices, costs and profits in the data, the JSON of the invoice, invoice list, order, market list, accounts, statement, order sheet and backup export (`/api/backup/export` repository) contains none of the cost or profit keys and values the reports use (the existing no-cost tests stay unchanged and must still pass); the backup file field list and the offline device copy schema are byte-for-byte unchanged (compare with the lists in `tests/unit/backup.test.ts` and `tests/unit/device-schema.test.ts`); the invoice, Account Summary, Store Statement, order sheet and market-list **print pages** are covered by the existing print specs (`invoice-print`, `account-summary-print`, `account-statement`, `order-sheets`, `market-print`), which must stay unchanged and pass, and the page text of each is also searched for the word "Reports" and the report routes (none).
- [x] T053 [P] Two-business end-to-end isolation, `tests/e2e/reports-two-businesses.spec.ts`: two real tenants with different invoices, purchases and balances; each owner sees only their own figures on every Reports screen and in every export; a crafted address with the other tenant's store id or a forged business id shows nothing of it.
- [x] T054 [P] Touch targets and layout, `tests/e2e/reports-touch-targets.spec.ts` at 360 px (and one desktop run): every Reports screen (hub, sales, purchases, stores, medicines, cost-missing, balances) has no sideways scroll, every interactive control is at least 44 by 44 px (the existing touch-target helper), and the bottom navigation still has five items.
- [x] T055 [P] Finish `tests/e2e/reports-states.spec.ts` for every screen (loading, error with Retry, empty with a next action, offline sentence) and the Home card and Settings link (they open Reports; the Home card shows no number).
- [x] T056 Full speed budget on the real stack, finishing `tests/integration/reports-scale.test.ts`: times for `report_sales`, `report_by_store` (first page), `report_by_medicine` (first page), `report_purchases` (5,000 entries), `report_cost_missing` and one CSV export of 5,000 rows against the 5,000-invoice data set; each within 2 seconds on the TEST project; real numbers recorded in `quickstart.md` section 5. Depends on all functions.
- [x] T057 Run the whole check set and record the real results in `specs/010-reports-profit/quickstart.md` section 5: `npm run lint`, `npm run typecheck`, `npm test` (counts), `npm run build`, and `npm run test:e2e` (new `reports-*.spec.ts` first, then the whole suite; stop `npm run dev` first). Also check with `git diff --stat master -- package.json package-lock.json` that no package was added, and that `src/lib/device`, `src/lib/backup` and `public` have no change other than the one blocked-area line of T050. Say plainly anything not run or flaky. Never claim a result that was not run.
- [x] T058 Update `README.md` with one short "Reports" paragraph (what is in it, that it is internal and online only, that migration 0011 is needed) and tick the done boxes in this file.

### Owner steps (cannot be done by the assistant alone)

- [ ] T059 Owner (TEST part done on 2026-11-24, DEV part still open): say yes before `0011_reports.sql` is applied to the TEST project (T021); that one yes also covers re-applying the same growing file to TEST in T031, T037 and T041. Say yes again, separately, before it is applied to the DEV project after the checks pass.
- [ ] T060 Owner trial (quickstart section 4), recorded as reported, not seen: open Reports on the phone with real data; can the owner say "how much did I sell and what profit can I trust this month" within 30 seconds (SC-011)? Do the figures of one remembered day match? Is "Incomplete" understandable? Record the answers in `quickstart.md`.
- [ ] T061 Pull request: open it only when the owner says so (title and description in English; end the description with the attribution line the harness asks for); merge only when the owner says so. An ADR (`/sp.adr reports-cost-rule-and-read-only-functions`) and the optional constitution PATCH clarification for Principle II are the owner's decision.

---

## Dependencies and Execution Order

- Phase 1 first. Phase 2 blocks everything: T003 (migration skeleton) and T004 to T008 first, then T009, T010, T011.
- US1 (Phase 3) is the MVP and also proves the base function and the speed budget (T027). US2 to US5 need only Phase 2 and their own migration part; US2, US3 and US4 can be done in any order after US1; US5 needs the screens it exports (so after US1, and ideally after US2 to US3).
- The migration file is one file: stories that add functions to it must not run in parallel with each other (same file); tests and screens of different stories can.
- Within a story: tests first (confirm they fail), then the migration part, the repository and route, then the screen, then the end-to-end test.
- Polish (Phase 8) after the stories; T056 needs every function; T057 is last of the code tasks; T059 to T061 are the owner's.

### Parallel opportunities

- Phase 2: T004, T005, T006, T007, T008 together.
- US1 tests: T012 to T018 together (different files); T025, T026, T027 together after T022 and T023.
- After US1: US2, US3 and US4 tests can be written together; their migration parts one after another.
- Polish: T051, T052, T053, T054, T055 together.

## Implementation Strategy

1. **MVP**: Phases 1, 2 and US1. Stop and check with the owner: the profit figures, their labels and the Cost missing list are the heart of the module.
2. **Then**: US2 (purchases), US3 (stores and medicines), US4 (balances), US5 (export), each independently checked.
3. **Finish**: Phase 8, the full check set, and the owner's trial.
4. **Fallbacks named in the plan**: if the speed budget is missed, add a covering index on `invoice_lines` (T027); never cache or store totals. If a purchase unit differs from the sale unit, the line stays "cost missing" with the reason; no unit conversion is added.

## Task Count

61 tasks: Setup 2, Foundational 9, US1 16, US2 5, US3 6, US4 5, US5 5, Polish 10, Owner steps 3.
