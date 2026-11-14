# Research: Market List and Purchases

**Feature**: 005-market-list-purchases | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

All decisions below were checked against the merged code of Modules 001 to 004 (`supabase/migrations/0001` to `0005`, `src/lib/orders`, `src/lib/pending`). There were no open clarifications in the spec; this file records the technical choices and what was rejected.

## D1. The market list is a computed read, not stored data

- **Decision**: A SECURITY INVOKER read function `market_list(...)` computes the list from `orders`, `order_lines`, `stores`, `products` and `purchase_entries` every time. Nothing about the list (totals, purchased, remaining, status) is stored.
- **Rationale**: The spec requires the list to follow the orders (FR-005) and the constitution forbids storing a balance-like number as an editable value. A computed read cannot drift from the orders.
- **Rejected**: A stored "market list" table (would need syncing on every order change, confirm, cancel, edit, link and register); a materialized view (stale, and refresh logic for a solo business is more risk than benefit).

## D2. Which orders and which date

- **Decision**: Orders with `status in ('confirmed', 'fulfilled')` whose `confirmed_at` falls inside the chosen Pakistan day, converted with `Asia/Karachi` exactly like the Module 003 history filter. Lines with `removed_at is null`. Draft and cancelled orders never count. The date is turned into a UTC range (`>= day start`, `< next day start`) so that an index on `confirmed_at` can be used.
- **Rationale**: The owner confirmed on 2026-11-13 that the list of a date holds the orders confirmed on that date. `fulfilled` is not reachable in Modules 001 to 005, but once invoices (Module 006) exist a fulfilled order must not make already bought quantities vanish from the list; the spec says "confirmed, not cancelled".
- **Rejected**: Filtering by `created_at` (an old draft confirmed today would be missing from today's list, which breaks "no requested quantity is left out"); a date column on orders (a migration of existing rows for no gain).

## D3. Grouping key: medicine and unit; typed lines by normalized text and unit

- **Decision**: Registered rows are grouped by `(product_id, public.norm_text(unit))`. Typed rows are grouped by `(public.norm_text(name), public.norm_text(unit))` using the existing `norm_text` helper from `0001` (the same rule as the Module 004 "To register" groups). The unit shown is the first unit text as typed.
- **Rationale**: Order lines keep the unit the supplier typed (Module 004 left it unchanged when linking), so one medicine can appear in "strip" and "box". Adding those would be a wrong total. The spec was refined on 2026-11-13 (FR-002, edge case) to state this. Grouping by product id alone is what the master prompt requires for the medicine identity; the unit is an extra, safer split.
- **Rejected**: Converting between units (needs pack arithmetic the app must never invent); grouping typed lines by their label (strength and form are not parsed from typed text, Module 004 D4).

## D4. Purchase entries: two append-only tables, the entry id is the request id

- **Decision**: `purchase_entries` (one row per real purchase; never updated or deleted) and `purchase_voids` (one row per cancellation, unique on `entry_id`; never updated or deleted). A cancelled entry is an entry that has a void row. Both tables are written only by SECURITY DEFINER functions; signed-in users get SELECT only through RLS (the ADR-0003 pattern).
- **Idempotency**: The client creates the entry id (a UUID) and sends it as the request id. `purchase_record` takes an advisory lock on `purchase:<id>`, looks the id up, and inserts only when it is new; a repeat with the same id and the same content returns the stored entry with `replayed: true`; the same id with different content is refused (`request_reused`). A cancellation is idempotent by the unique `entry_id` in `purchase_voids`: a second cancel returns the existing void with `replayed: true`.
- **Rationale**: The spec needs exactly one entry per save (FR-012), no edits or deletes (FR-011) and a visible history with who, when and why (FR-022). Keeping the entry itself immutable means no code path can rewrite a recorded quantity or cost; the void is a separate fact.
- **Rejected**: A `voided_at` column on the entry with an UPDATE (the entry row would be mutable; the trigger rules get more complicated); reusing the `pending_requests` table (its kinds are fixed to Module 004; the entry's own primary key already gives exactly-once for creation); client-side only duplicate prevention (the spec forbids relying on the screen).

## D5. Purchased quantity belongs to (product, unit, purchase date)

- **Decision**: Purchased quantity on a row is the sum of non-cancelled entries with the same `product_id`, unit (compared with `public.norm_text`, so case and repeated spaces are ignored) and `purchase_date` as the list date. The purchase date defaults to the list date; the function refuses a date later than today (Pakistan time) and a date earlier than 2000-01-01.
- **Rationale**: Matches the spec assumption "a purchase entry belongs to the list date it was recorded for". A purchase for tomorrow's list cannot be recorded today (it would count for no real list yet).
- **Consequence**: A store filter changes what is shown and printed, not the bought figures (spec assumption). Each row therefore returns two numbers: `total_requested` (whole day) and `shown_requested` (the selected stores). Purchased and remaining use `total_requested`.
- **Rejected**: Allocating a purchase to stores (out of scope; delivered quantities belong to Module 006).

## D6. Status, remaining and the home count come from one definition

- **Decision**: One internal SQL function `market_rows(p_date)` returns the rows (registered and typed) with requested, purchased, remaining and status. `market_list` and `market_summary` both read it, so the Home count always equals the number of rows the "still to buy" filter shows (the same rule as ADR-0004 point 10).
- **Status** (per row): `not_bought` (purchased = 0), `partly_bought` (0 < purchased < requested), `fully_bought` (purchased = requested), `bought_extra` (purchased > requested; `extra = purchased - requested`). `remaining = greatest(requested - purchased, 0)`. Typed rows are always `not_bought` with `can_record = false`.
- **Home count**: `rows_to_buy` = rows with `remaining > 0` (typed rows included), plus `rows_total`.

## D7. Planner safety learned in Module 004 (migration 0005)

- **Decision**: The read functions are SECURITY INVOKER (RLS applies) but compute the business filter once and use `AS MATERIALIZED` CTEs for the day's lines and for the purchase sums, then join. The scale test (200 orders, 1,000 lines, the 3-second goal of SC-010) is a planned task and its numbers are recorded; it is not assumed.
- **Rationale**: In Module 004 the planner estimated one row for `current_business_id()` conditions and re-ran aggregates once per medicine (seconds, then a timeout). The same trap is possible here, so the shape of the query is chosen to avoid it and then measured.
- **Index**: a partial index on `orders (business_id, confirmed_at) where status in ('confirmed', 'fulfilled')`; the lines already have `order_lines_order_idx` and `order_lines_product_idx`; `purchase_entries (business_id, purchase_date, product_id)`.

## D8. No paging; a safety cap

- **Decision**: The list returns every row of the day in one response (a day has at most a few hundred medicines for one supplier) with a cap of 2,000 rows and a `truncated` flag the screen shows as an error-style notice ("Too many rows to show. Narrow the list with a store or a search."). Print and CSV use the same function with the same cap and refuse to print a truncated list.
- **Rationale**: The print and CSV need the whole list, and paging would make "sum of all quantities equals the sum of the order lines" untestable on screen. The cap protects the server.
- **Rejected**: Cursor paging (extra state for a list that is small by nature).

## D9. Printing: a dedicated print page with print-media CSS; export as CSV

- **Decision**: A page `/market-list/print?date=...&stores=...` renders the same JSON as a plain compact table (business name and date in a header, the stores included, rows with total and store breakdown, the "Not yet registered" group with "unregistered" marks, blank write-in columns or the recorded figures) and calls the browser print dialog from a button. `@media print` hides the navigation and the toolbar. CSV comes from a route handler with one line per medicine and store.
- **Verification**: Playwright emulates the print media and also generates a PDF of the print page, then checks that the text has the header and rows and contains no cost (a real printer is not used; this is stated in the quickstart). The "no cost" rule is also enforced one level lower: `market_list` never selects a cost, a price or an MRP column, and a database test checks the returned JSON keys.
- **CSV safety**: Any text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with an apostrophe so a spreadsheet does not run it as a formula (FR-017). Values with commas, quotes or line breaks are quoted.
- **Rejected**: Server-side PDF generation (a new dependency and the spec excludes PDF files); making Options A and B (Module 006).

## D10. Updating the medicine's purchase price after a purchase

- **Decision**: No new database function. After a purchase with a cost, the screen asks "Update the current purchase price of this medicine to PKR X?"; only the answer "Yes, update" calls the existing Module 001 product update (`PATCH /api/products/[id]` with `purchase_price` only). "No" and closing the dialog change nothing.
- **Rationale**: The product update path already validates money, isolates by business and records `updated_at`. A second write path for the same column would be duplicated risk. Order line snapshots are untouched by design (a product update never writes order lines).
- **Rejected**: Updating the price inside `purchase_record` (it would change a price without a separate confirmation, which the spec forbids).

## D11. Visibility without a sixth navigation item

- **Decision**: A Home card (`MarketSummaryCard`) and a link in the Orders screen header. The bottom navigation keeps five items (Module 004 D11).
- **Rationale**: Spec FR-019 and the 360 px touch-target rule.

## D12. Refresh model

- **Decision**: The list loads when opened and when the date, search or filters change, has a visible "Refresh" button, and reloads when the page becomes visible again after being hidden. After recording or cancelling a purchase the list is reloaded from the server; no optimistic totals are shown as final.
- **Rationale**: Spec assumption: live updating is not required; stale totals must never be shown as final without a way to refresh. Offline queueing is Module 009 and is not claimed.

## D13. Searching

- **Decision**: Search matches the medicine name, strength, dosage form and manufacturer (registered rows) and the typed text (typed rows), case-insensitively, with `%`, `_` and `\` escaped, reusing the escape and search helper pattern of Module 004 (`pending_like_escape`, `pending_search_ok`).
- **Rationale**: No new matching rule is invented; search never merges rows, it only hides rows.

## D14. Things deliberately not built

- Undo of a cancellation (a new entry is added instead).
- Allocation of a purchase to stores or to delivered quantities (Module 006).
- Live push of changes between two open screens.
- PDF files, order print options A and B, thermal (80 mm) layouts (they come with invoices in Module 006), reports from costs.

## Risks to revisit

1. **Unit split.** A supplier who types "strip" for one store and "box" for another sees two rows on purpose. If this feels noisy, a later module can offer unit conversion per medicine; it must never be guessed.
2. **Confirmed-date rule.** An order confirmed after midnight Pakistan time lands on the next day's list. This follows the owner's choice.
3. **Large days.** The 2,000-row cap is a safety limit, not a design target; the scale test records the real time at 1,000 lines.
