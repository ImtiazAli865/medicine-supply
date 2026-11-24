# Research: Reports and Profit (Module 010)

Date: 2026-11-24. Every decision below was checked against the real migrations (0001 to 0008) and the code on master (ae00244).

## What the existing data already gives us

| Need | Where it already lives | Notes |
|------|------------------------|-------|
| Sales lines | `invoice_lines` (frozen at issue): `delivered_quantity`, `selling_price`, generated `line_total`, `product_id`, `unit`, `order_line_id` | Parent `invoices` has `status` (draft, issued, cancelled), `invoice_date` (Pakistan date set at issue), `store_id`, `grand_total`. |
| Estimated cost | `order_lines.purchase_price_snapshot` (taken at confirm, empty stays empty), reached by `invoice_lines.order_line_id` | A typed line has no product and no snapshot. |
| Market date of an order | `orders.confirmed_at`, read as a Pakistan date: `(confirmed_at at time zone 'Asia/Karachi')::date` | The market list (migration 0006) uses exactly this day range. |
| Actual costs | `purchase_entries` (`product_id`, `unit`, `purchase_date`, `quantity`, optional `unit_cost`), cancelled ones in `purchase_voids` | Append-only; `norm_text(unit)` is how the market list matches units. |
| Balances | `ledger_balances`, `ledger_stores`, `ledger_summary` (migration 0008), already behind `/api/accounts` and `/api/accounts/summary` | Home and the Store accounts list already use them. |
| Money helpers | `src/lib/money.ts` (integer paisa, negative allowed in `paisaToMoney`, `formatPKR`) | The server returns money as decimal strings. |
| CSV helper | `src/lib/market/csv.ts` (`csvCell` prefixes formula characters) | Reused, with one fix for negative numbers (D9). |

## Decisions

### D1. One new migration, `0011_reports.sql`: read-only functions and one index; no table

- **Decision**: Add read-only database functions (`SECURITY INVOKER`, `STABLE`, `set search_path = public`, explicit `business_id = current_business_id()` filters) and one partial index. No table, no stored total, no write path. Number 0011 is free in this repository (0009 and 0010 of the dropped voice work exist only on the TEST and DEV projects and on the kept voice branch; they touch voice tables and do not clash).
- **Why not "no migration"**: the spec asks for exact totals over thousands of invoices without downloading rows. PostgREST returns at most 1,000 rows per request, so aggregating in the browser or in a route would need many requests and would break FR-024 (exact totals, about 2 seconds for 5,000 invoices). Module 008 avoided a migration because its lists were small; this module cannot.
- **Alternatives rejected**: (a) summing in TypeScript after paging rows (slow, partial-total risk); (b) a materialized or summary table (a stored derived number that can go stale, and a write path from the invoice and purchase modules, against "never alter an issued invoice" and the ledger-is-computed rule); (c) views (cannot take the period and grouping as parameters without a function anyway).
- **Applying it**: to the TEST project first, to DEV only with the owner's approval (as with 0008). Rollback note in the migration header: drop the functions and the index (no data is created).

### D2. One shared base function so figures cannot disagree

- **Decision**: `report_sales_lines(p_biz, p_from, p_to)` returns one row per billed line of every issued invoice whose `invoice_date` is in the period: invoice id and date, store, product id (or null), name and identity fields, unit, billed quantity, selling price, line total, the order's market date, the estimated unit cost (the order line snapshot), the realized unit cost (weighted average, see D3) and two flags `est_missing`, `real_missing`. Every report function (`report_sales`, `report_by_store`, `report_by_medicine`, `report_cost_missing`) reads this one function, so the summary, the store rows and the medicine rows add up by construction.
- Lines with billed quantity 0 are left out (they sell and cost nothing and must not count as "missing").
- **Alternative rejected**: each report with its own SQL (the totals of different screens could drift apart, which SC-001 forbids).

### D3. Cost rules, in the database

- **Estimate** (FR-010): line cost = billed quantity × `order_lines.purchase_price_snapshot`; missing when there is no order line or no snapshot (typed lines, lines whose medicine had no purchase price at confirm).
- **Realized** (FR-012, the owner's rule of 2026-11-24): per (product, `norm_text(unit)`, market date) take the non-cancelled purchase entries of that day that have an `unit_cost`; the unit cost is `sum(quantity × unit_cost) / sum(quantity)`. Line cost = billed quantity × that value. No entry that day, or entries without a cost: missing. No other day is used, no unit conversion is attempted (a medicine bought by the box and sold by the strip is "cost missing", and the fix hint says so).
- The per-day average is computed once per (product, unit, day) in a grouped CTE restricted to the dates the lines need, then joined by key (no per-line subquery).
- **Constitution wording**: Principle II says profit uses "the weighted average of actual recorded purchase costs". The owner's rule is that weighted average, taken over the order's market day. It is a narrowing, not a conflict; recorded as a risk with a suggested one-line PATCH clarification the owner may approve later (the constitution is not edited in this module).

### D4. Exact money and rounding (FR-013)

- All arithmetic stays `numeric` inside the database; a per-line realized cost is kept unrounded (`billed_quantity * sum(q*c) / sum(q)`, multiply first). Each reported figure is rounded once with `round(x, 2)` (half away from zero, PostgreSQL's numeric rounding) after summing the unrounded values. Sales are sums of two-decimal values and are exact. Because cost and profit rows are rounded one by one, a row set can differ from its total by a paisa or two for cost and profit; sales rows always add up exactly. The screens say "Rows are rounded one by one" in one short note, and the tests check each row equals `round(unrounded sum)` and the total equals `round(unrounded total)`.
- The browser never adds or subtracts money; it only formats strings (`formatPKR`). Profit comes from the server.

### D5. Periods, groups and exclusions

- Sales date = `invoices.invoice_date` (already a Pakistan date). Purchases use `purchase_date`.
- Presets today, this week (Monday start), this month, last month are computed in Pakistan time on the server-rendered page from one helper; a custom range is two dates. Default: this month. A period longer than 731 days, an end before the start, or a start in the future is refused with a validation message.
- Groups: day = the date; week = `date_trunc('week', date)` (PostgreSQL weeks start on Monday); month = `date_trunc('month', date)`. Only buckets that have data are returned (the screen says "Days without sales are not listed"). A bucket that starts before or ends after the period carries `partial: true` and the screen writes "from 3 Nov" or "to 30 Nov" beside it so a week at the edge is not mistaken for a full week. Every grouping adds up to the same total because each line lands in exactly one bucket.
- Exclusions (FR-005): the response carries `excluded.cancelled_invoices` (cancelled invoices whose `invoice_date` is in the period) and `excluded.draft_invoices` (drafts created in the period, by Pakistan creation day) so the screen can say what was left out.

### D6. The reports and where each one comes from

| Report | Function | Notes |
|--------|----------|-------|
| Sales and profit (Sales summary + Estimated + Realized) | `report_sales(from, to, group)` | One screen, because profit is a column of the same lines. FR-001's "Sales summary" and "Profit" are two views of this screen (totals cards first, then the time series). |
| Purchase summary | `report_purchases(from, to, group)` | From `purchase_entries` minus `purchase_voids`; entries without `unit_cost` counted and listed as "no cost recorded". |
| Sales by store | `report_by_store(from, to, q, sort, limit, offset)` | Includes each store's estimated and realized profit with their labels. |
| Sales by medicine | `report_by_medicine(from, to, q, sort, limit, offset)` | Grouped by product id and `norm_text(unit)`; typed lines in one "Not registered" group by `norm_text(name)` + unit. |
| Cost missing | `report_cost_missing(from, to)` | Per medicine and unit: sales amount concerned, which figure is affected, the market dates missing a purchase cost. |
| Outstanding balances | existing `ledger_stores`, `ledger_summary` | No new SQL: the same functions Home and Store accounts use, so the total can never disagree with Home (FR-016). |

### D7. Index and speed

- New partial index `invoices_report_idx on invoices (business_id, invoice_date) where status in ('issued', 'cancelled')`. Existing indexes cover the rest: `invoice_lines_invoice_idx`, the primary keys for `order_lines` and `orders`, `purchase_entries_day_idx (business_id, purchase_date, product_id)`.
- **Budget**: 5,000 issued invoices with 10 lines each (50,000 lines) answer within 2 s on a real PostgreSQL (the TEST project) for the summary; the PGlite test engine is slower, so its test checks correctness at that size and a looser 6 s ceiling that only catches an accidental quadratic plan. If the budget is missed, the fallback is to add `(business_id, invoice_id)` covering columns to the line read, not to cache or store totals.
- The by-medicine and by-store lists page at 50 rows (`limit` max 50) with a `total` row count; CSV reads up to 5,000 rows and refuses larger exports with `list_too_large`, as the market list does.

### D8. API routes (all `GET`, as the user, `Cache-Control: no-store`)

`/api/reports/sales`, `/api/reports/purchases`, `/api/reports/stores`, `/api/reports/medicines`, `/api/reports/cost-missing`, `/api/reports/balances-note` (the "not in the account" count shown with Outstanding balances), and `/api/reports/export?report=<name>&...` for CSV (report names: sales, purchases, stores, medicines, cost-missing, balances; the balances file is built from the existing account list pages, its total from `ledger_summary`). Sorting by `profit` means the realized profit, unknown last. Balances use the existing `/api/accounts` and `/api/accounts/summary`. Inputs are validated with Zod (dates `YYYY-MM-DD`, group, sort, limits); errors use the existing `handle` and `ApiError` shapes. Routes call the database functions with the signed-in user's session; there is no service-role key anywhere in this module.

### D9. CSV

- Built on the server from the same function call as the screen. Free text goes through `csvCell` (formula characters get an apostrophe). **Numbers** (money and quantities) go through a new `csvNumber` that writes `-12.50` as is, because `csvCell` would turn a negative number into text with an apostrophe. A test pins this.
- Columns keep the markers: a `Figure status` column ("Complete", "Incomplete: 3 lines without cost", "Estimate") and a final `TOTAL` row. The file name contains the report and period. No PDF.

### D10. Screens, entry point and offline

- Pages under `src/app/(app)/reports/`: hub, `sales`, `purchases`, `stores`, `medicines`, `cost-missing`, `balances`. They are client screens that read through `fetchJson` (loading, error with Retry, empty with a next action), with the period and group in the address so Back and refresh work.
- Entry: a "Reports" card on Home (beside Products and Stores) and a link in Settings. The bottom navigation stays at five items.
- Offline: `/reports` is added to the offline shell's blocked areas ("Reports") so the shell says it needs the internet. `fetchJson` has no local answer for `/api/reports/*`, so a network failure shows the honest "Reports need the internet" message and never stored numbers. Nothing is added to IndexedDB, the service worker cache list or the backup file.
- Charts: simple bars drawn with CSS widths (no library), `aria-hidden`, and every value is also text.

### D11. Keeping reports internal (FR-018, FR-019)

- The new code lives in `src/lib/reports/**`, `src/components/reports/**`, `src/app/(app)/reports/**` and `src/app/api/reports/**`. A static test fails if any file of the invoice print, accounts, market list print or export, order screens, `src/lib/device/**`, `src/lib/backup/**` or `public/sw.js` imports or names them. The existing no-cost tests for invoices, accounts, market list and the backup stay unchanged and must keep passing; a new test pins the backup and the offline copy field lists.
- Cost and profit keys appear only in `/api/reports/*` responses. The Home card and the Settings link carry no number.

### D12. Isolation

- Every function filters by `current_business_id()` and also passes `p_biz` into the base function; Row Level Security on the underlying tables still applies because the functions are `SECURITY INVOKER`. Tests run two tenants with different data through every function, and call a function with the other tenant's business id as a crafted argument (it returns nothing). Execute is granted to `authenticated` only (revoked from `public` and `anon`).

### D13. Fix links in the cost-missing list

- Estimate missing: link to the product's internal screen (`/products/{id}`) where the purchase price can be saved. Realized missing: link to the market list of each affected date (`/market-list?date=YYYY-MM-DD`), where a purchase with an actual cost can be recorded. Typed lines link to the Pending items screen to register the medicine first. The report never changes anything.

## Risks to watch

1. **A purchase recorded a day late** leaves the earlier day "cost missing" until the owner records it on the right date; the cost-missing list names the dates. This is the price of the owner's per-day rule (no borrowed costs).
2. **Rounding of rows versus totals** (D4): honest note on screen; tests pin the rule.
3. **Speed on the real database** (D7): measured on the TEST project before the pull request; the fallback is named.
4. **Units**: purchases and sales in different units of the same medicine never match (D3); shown as cost missing with a reason, never converted.

## Items that need the owner's approval later

- Applying `0011_reports.sql` to the DEV project (and TEST for tests).
- Optional PATCH clarification of constitution Principle II wording for the market-day average (not required to build).
- An ADR for the cost rule and the read-only report functions (suggested, not created).
