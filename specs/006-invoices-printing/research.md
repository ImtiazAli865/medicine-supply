# Research: Invoices and Printing

**Feature**: 006-invoices-printing | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

All decisions below were checked against the merged code of Modules 001 to 005 (`supabase/migrations/0001` to `0006`, `src/lib/orders`, `src/lib/market`, `src/lib/settings`). The spec has no open clarifications (the four assumptions were confirmed by the owner on 2026-11-14); this file records the technical choices and what was rejected.

## Facts found in the existing code (they shape the decisions)

1. `orders.status` already allows `fulfilled`, but the guard trigger `orders_guard` allows only `draft -> confirmed|cancelled` and `confirmed -> cancelled`. Migration `0007` must add `confirmed -> fulfilled` and `fulfilled -> confirmed` (research D9, D10).
2. `order_events.event_type` is a checked list (`created, confirmed, edited, cancelled, linked, price_filled`). Two kinds are added: `invoiced` and `invoice_cancelled` (migration `0004` shows the safe way to replace that check).
3. `order_lines.delivered_quantity` exists, is set equal to the ordered quantity at confirm, and has a check `>= 1`. A line that is not delivered needs 0, so the check becomes `>= 0` (D6).
4. `order_lines.line_total` is a generated column on the ORDERED quantity. Invoices use their own line total (delivered quantity times the snapshot price), so the order column is never used for billing (D4).
5. Settings (Module 002, `business_settings`) already hold `phone`, `address` and `thermal_paper_mm` (default 80, allowed 40 to 120) and the `account_summary_default` switch for Module 007. Nothing is added to Settings. `businesses.name` is the business name.
6. Order numbers come from `order_counters` (one row per business, updated in the same transaction as the order). The same pattern gives invoice numbers (D8).
7. The functions of Modules 003 to 005 all use a `reason` result for refusals, an advisory lock per record, `security definer` writes, `security invoker` reads, and `set search_path = public`. Module 006 follows the same pattern (ADR-0003, ADR-0004, ADR-0005).
8. The market list (migration `0006`) already counts orders with status `confirmed` or `fulfilled`, so marking an order fulfilled does not change it (verified by a test, D11).
9. `src/app/globals.css` has one global `@media print` block with an A4 `@page`; the application shell hides itself with `print:hidden`. The thermal layout needs a different `@page` width, injected only on the thermal print page (D17).
10. `OrderHistoryLog` has a `default` branch for unknown event kinds ("Order updated"); the two new kinds get their own wording.

## D1. Four new tables, written only by functions

- **Decision**: `invoices`, `invoice_lines`, `invoice_events` and `invoice_counters`. All writes go through `security definer` functions; signed-in users get `select` only (Row Level Security on every table, `anon` nothing). This is the ADR-0003 / ADR-0005 pattern.
- **Rationale**: a direct request must not be able to skip the number rule, the price check, the freeze or the history. Composite keys `(business_id, id)` tie every row to one business.
- **Rejected**: letting the browser write the tables under Row Level Security (it could not enforce the number sequence, the freeze or the atomic order update).

## D2. One live invoice per order

- **Decision**: a partial unique index on `invoices (business_id, order_id) where status in ('draft', 'issued')`. A cancelled invoice is not live, so a replacement can be created.
- **Rationale**: the database itself refuses a second live invoice, whatever code path runs, which is the "no duplicate invoices on retry" rule at its root.
- **Rejected**: checking in application code only (a race between two taps would pass).

## D3. Creating a draft is retry-safe with the client id

- **Decision**: `invoice_create(p_id, p_order_id)`. The client creates the invoice id (a UUID) and sends it; an advisory lock on `invoice:<id>` and on `order:<order id>` (the same key the order functions use) serialises the work. Results: a new draft (`created: true`); the same id again (`replayed: true`, the stored draft); a different id for an order that already has a live invoice (`created: false, existing: <invoice>`, never a second one); the same id used for another order (`request_reused`).
- **Rationale**: exactly-once from the invoice's own key, the same idea as ADR-0005 point 4. Returning the existing live invoice makes a double tap from two devices harmless and lets the order screen simply open it.

## D4. Invoice lines carry only what the customer may see

- **Decision**: `invoice_lines` copy the medicine name, strength, dosage form, pack size, manufacturer, unit, the ordered quantity, the delivered (billed) quantity and the selling price snapshot, plus a link to the order line and the product. There is **no column for purchase price, MRP or cost** on any invoice table. The line total is a generated column `delivered_quantity * selling_price` (null when the price is null).
- **Rationale**: "never show cost on an invoice" becomes true by structure, not only by care: a function cannot return a column that does not exist. A test lists the columns of the invoice tables and scans every returned JSON for forbidden key names.
- **Rejected**: copying the whole order line and hiding cost in the screen (one forgotten field would leak).

## D5. Detecting that the order changed after the draft was made

- **Decision**: the draft stores `source_fingerprint`, an `md5` over the ordered list of the order's active line facts (line id, position, product id, name, strength, dosage form, pack size, manufacturer, unit, quantity, selling price snapshot). One SQL function `order_lines_fingerprint` computes it. `invoice_get` returns `stale: true` when the stored value differs from the current one; `invoice_issue` refuses with `order_changed`. `invoice_refresh` rebuilds the lines and stores the new value.
- **Rationale**: Module 004 can fill a price on an order line without changing the order's own version, so comparing the order version would miss it. The fingerprint covers every fact that is copied onto the invoice.
- **Rejected**: comparing `orders.version` only (misses a price fill or a link); locking the order while a draft exists (blocks normal order edits, which the spec allows).

## D6. Delivered quantity: entered on the draft, written back at issue

- **Decision**: a draft line starts with `delivered_quantity` equal to the order line's `delivered_quantity` (which equals the ordered quantity after confirm). `invoice_set_quantities(p_id, p_expected_version, p_lines)` changes the delivered quantity of draft lines (0 to 100,000, a version check, a history entry). At issue, in the same transaction, the final delivered quantities are written to the order lines, so the order truthfully shows what was delivered; the order event records old and new. The `order_lines` check changes from `>= 1` to `>= 0`. When the invoice is cancelled the order lines go back to delivered = ordered (the default of Principle II), and the cancelled invoice keeps the real figures.
- **Rationale**: the owner chose "delivered quantity is set on the draft, no separate delivery screen" and the constitution says order lines carry a delivered quantity that invoices use and that ordered and delivered stay distinct. Writing back at issue satisfies both without changing the order while the draft is still a draft.
- **Consequence**: after a cancellation a replacement draft starts again from the ordered quantities; if 8 of 10 were delivered the supplier enters 8 again (the cancelled invoice still shows 8). Recorded as a known limitation.
- **Rejected**: writing the draft edits to the order lines immediately (a discarded draft would leave the order changed); keeping the delivered quantity only on the invoice (the order would claim "delivered 10" after 8 were delivered).

## D7. Verified selling price

- **Decision**: a line is billable only when it is linked to a medicine and its order line has a selling price snapshot (a snapshot of 0 counts as a price). A typed line or a missing price is `needs_price`, is shown with a link to Pending Prices, and blocks issuing only if its delivered quantity is above 0. A line with delivered quantity 0 is never billed, so it does not block.
- **Rationale**: the master prompt forbids issuing while any line lacks a verified price; a line that is not billed has nothing to verify. Nothing is ever priced by guessing.

## D8. Invoice numbers

- **Decision**: `invoice_counters (business_id primary key, last_number)`, updated inside `invoice_issue` with `insert ... on conflict do update set last_number = last_number + 1 returning`. The number is stored as an integer with `unique (business_id, invoice_number)` and shown as `INV-` plus six digits (more digits when it grows). It is assigned only at issue, so a discarded draft leaves no gap. Because the counter row is locked until the transaction ends, two simultaneous issues get two different, increasing numbers; a failed issue rolls the counter back.
- **Lock order** (to avoid deadlocks): invoice advisory lock, then order advisory lock (the key the order functions use), then the counter row.
- **Rationale**: it is the existing order-number pattern; a database sequence would leave gaps after a rollback and is not per business.

## D9. Issue is one atomic function

- **Decision**: `invoice_issue(p_id, p_expected_version)` in one transaction: locks, checks the rules (status draft, order still `confirmed`, not stale, at least one billed line, every billed line has a verified price, version matches), recomputes the line totals and the grand total from the lines, takes the next number, copies the business name, phone and address and the store name, contact, phone and address as they are now, sets the invoice date (Pakistan day), the issue time and the issuing user, writes the delivered quantities back to the order lines, moves the order to `fulfilled`, and writes the invoice event and the order event `invoiced`. A repeat on an issued invoice returns it with `replayed: true`. A refusal changes nothing and uses no number.
- **Reasons**: `not_found`, `version_conflict`, `invoice_not_draft`, `order_not_confirmed`, `order_changed`, `nothing_to_bill`, `not_ready` (with the list of blocked lines).

## D10. Cancel is a controlled status change, not an edit

- **Decision**: `invoice_cancel(p_id, p_reason)`: only an issued invoice; the reason is required (1 to 500 characters); status becomes `cancelled` with `cancelled_at`, `cancelled_by` and `cancel_reason`; the order goes back to `confirmed`; the order lines' delivered quantities return to the ordered quantities; the invoice event `cancelled` and the order event `invoice_cancelled` are written. A repeat returns the first cancellation (`replayed`), keeping the first reason. The invoice number and lines are untouched.
- **Status storage**: the constitution says the status is stored only as draft, issued or cancelled, so the status is a column, protected by the guard trigger of D12 (this differs from ADR-0005, where a cancellation is a separate row, because there the entries have no status).
- **Rejected**: deleting or editing an issued invoice; a separate cancellation table (a second source of truth for the status).

## D11. The order becomes fulfilled; the market list must not change

- **Decision**: `orders_guard` gets two new allowed changes, `confirmed -> fulfilled` and `fulfilled -> confirmed`, and nothing else. Only the two invoice functions make them (signed-in users cannot write orders). The order functions of Module 003 already refuse a fulfilled order (`order_not_editable`) and cannot cancel it, so an order with an issued invoice cannot be edited or cancelled until the invoice is cancelled. The market list already counts `confirmed` and `fulfilled`; a PGlite test compares requested, purchased and remaining before and after issuing and after cancelling.

## D12. Immutability is enforced in the database

- **Decision**: three guards. `invoices_guard` (before update): when the old status is not `draft`, every column must stay the same, except that an `issued` invoice may change to `cancelled` while setting only the cancellation columns, `updated_at` and `version`; a `cancelled` invoice cannot change at all; the invoice number can never change once set; the draft-to-issued step must set the number and the snapshot together. `invoices_no_delete` (before delete): refuses unless the status is `draft`. `invoice_lines_guard` (before insert, update, delete): refuses unless the parent invoice is a draft. `invoice_events_append_only`: refuses update and delete (only `service_role` may delete, like the other history tables).
- **Rationale**: "never alter an issued invoice" must hold for any code path, including a future module. Tests try every forbidden change on PGlite and through the real API.

## D13. History

- **Decision**: `invoice_events` (created, edited, refreshed, issued, cancelled, discarded) with who, when and a `detail` JSON, append-only. It has no foreign key to `invoices`, because a discarded draft is deleted (a draft is not a financial record, only an issued invoice is) while its history entry stays. The order history gets the two new kinds.

## D14. Reads and one shared "to invoice" definition

- **Decision**: reads are `security invoker` functions: `invoice_get`, `invoice_list` (filters status, store, date range, order, text search on number and store name; paging with a limit and an offset, like `order_list`), `invoice_todo` (the orders still to invoice) and `invoice_summary` (the count). `invoice_summary` counts the rows of the same internal function `invoice_todo_rows()` that `invoice_todo` returns, so Home and the list cannot disagree (the rule of ADR-0004 point 10 and ADR-0005 point 1). "To invoice" means: orders with status `confirmed` that have at least one active line; an order that already has a draft stays on the list and shows its draft.
- **Performance**: the business filter is computed once and `MATERIALIZED` CTEs are used for aggregates (the migration `0005` lesson); a partial index `invoices_order_live_idx` (D2), `invoices_list_idx (business_id, created_at desc, id desc)` and `invoices_store_idx (business_id, store_id, created_at desc)`; a scale test measures 1,000 invoices (SC-009) and a 60-line invoice.

## D15. No cost on any output

- **Decision**: besides D4, the three order-sheet and invoice read functions select only the permitted columns by name (never `select *` from `order_lines`). Tests: (a) the column list of the four invoice tables has no cost, price-of-purchase or MRP column; (b) every returned JSON is scanned for the keys `purchase_price`, `mrp`, `cost`, `margin`, `profit` and their snapshot forms; (c) the rendered print pages are scanned for the same words.

## D16. Order sheets (options A and B) come from a price-free function

- **Decision**: `order_sheet(p_order_ids uuid[])` and `order_sheet_day(p_date, p_stores)` return the business header, store header, order number and date and each active line's name, strength, form, pack size, manufacturer, quantity, unit and an `unregistered` flag, and nothing else. Option B reuses the Pakistan-day rule of the market list (confirmed day). Each store is its own section in the result, so items cannot mix.
- **Rationale**: `order_to_json` carries snapshot prices (including cost), so it is never used for a printout.
- **Rejected**: reusing `order_get` and hiding fields in the page.

## D17. Printing

- **Decision**: server pages `/invoices/[id]/print?layout=a4|thermal`, `/orders/[id]/print` (option A) and `/orders/print?date=&stores=` (option B). The pages render from the read functions, have no application chrome (`print:hidden` on the shell, already in place) and a toolbar with a print button that is hidden when printing. The thermal page injects `@page { size: <thermal_paper_mm>mm auto; margin: 3mm }` from the Settings value (default 80), uses one narrow column and large type; the A4 page uses the existing A4 `@page`. A draft is marked "DRAFT, not an invoice", a cancelled invoice "CANCELLED". The browser's own print dialog and "save as PDF" are the only outputs.
- **Verification**: Playwright emulates the print media, generates a PDF of each layout and checks the text (header, number, lines, grand total, no forbidden words) and that nothing overflows sideways; a 60-line invoice must keep every line and the grand total. A real thermal printer is not claimed (stated in the quickstart).
- **Rejected**: server-side PDF generation (a new dependency, out of scope); a client-side PDF library.

## D18. Screens and visibility without a sixth navigation item

- **Decision**: a Home card ("To invoice"), a link in the Orders screen header and on the order screen ("Create invoice" or "View invoice"). The bottom navigation keeps its five items (the rule of Modules 004 and 005). The Invoices screen (`/invoices`) has two tabs, "Invoices" (the list with filters) and "To invoice" (the orders, the list the Home count refers to). The invoice screen (`/invoices/[id]`) shows a draft editor (delivered quantity per line, blocked lines with the Pending Prices link, stale notice with "Refresh from order", Issue and Discard) or the frozen invoice (Print, Cancel, history).

## D19. Money and rounding

- **Decision**: all money is `numeric` (selling price `numeric(12,2)`, line total and grand total `numeric(18,2)`), summed in SQL, never in JavaScript; the screen only formats with the existing `formatPKR`. The grand total of an issued invoice is stored at issue after being recomputed from the lines; a test checks `grand_total = sum(line_total)` for every invoice.

## D20. Things deliberately not built

- Account Summary, payments, balances, paid and partially paid (Module 007); discounts and taxes; server-side PDF; e-mail or messaging of invoices; QR codes; a separate delivery screen; undo of a cancellation (a new draft is made); numbering formats chosen by the supplier; offline issuing (issuing needs a connection by constitution VII).

## Risks to revisit

1. **Replacement draft starts from the ordered quantity** (D6): the supplier re-enters the delivered figures after a cancellation. If this is annoying, a later change can pre-fill from the cancelled invoice.
2. **Stale detection is strict** (D5): any change to an order line copied onto the invoice makes the draft stale, even a harmless one; the supplier refreshes and re-checks the quantities.
3. **Print layouts are checked in print emulation, not on paper** (D17).
4. **A typed line with delivered 0 on an invoiced order** (found by `/sp.analyze`): it does not block issuing and the order becomes fulfilled, but Module 004 refuses linking and registering on a fulfilled order and Module 005's market list still shows the line under "Not yet registered". Accepted as a known limitation (the supplier cancels the invoice, registers the medicine, then invoices again); recorded in the spec edge cases and checked by a test. If it proves annoying, a later change can let the pending functions accept a fulfilled order for typed lines that are not billed.
