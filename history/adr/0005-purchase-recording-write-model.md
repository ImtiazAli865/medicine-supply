# ADR-0005: Purchase Recording Write Model (append-only entries and cancellations, entry id as request id, computed market list)

> **Scope**: One decision cluster made in Module 005 (market list and purchases). The parts were chosen together and would change together: how the daily market list is produced, how a real purchase is recorded and cancelled, and how that is kept retry-safe, immutable, audited and isolated. It follows the pattern of ADR-0003 and ADR-0004.

- **Status:** Accepted (the owner asked for this ADR on 2026-11-14)
- **Date:** 2026-11-14
- **Feature:** 005-market-list-purchases
- **Related:** ADR-0003 (order write model: function-only writes, select-only tables, versions), ADR-0004 (the same function-only, replay-safe pattern; point 10 "counts and lists share one definition" is reused here), ADR-0002 (REST handlers over RLS, client-generated ids).
- **Context:** The supplier confirms orders from many stores during the day and then buys the medicines at the wholesale market. Module 005 must (1) show one combined list of what to buy (all stores, same medicine and unit together, typed medicines in their own group), (2) let the supplier record what was actually bought, in parts, with an optional actual cost, and cancel a wrong entry, and (3) never lose, double-count or silently change any of it. The hard rules are: purchased quantity is real data and a checkbox is not proof; a retry or a double tap must never record a purchase twice; a recorded purchase must never be edited or deleted; the list must always agree with the orders and with the Home count; no cost, price or MRP may appear on the list, the print or the CSV; and one business must never see or change another's rows. A plain "stored list" or an "update the row" design cannot meet these together.

<!-- Significance checklist: 1) Impact: yes, Module 006 (delivered quantities, invoices) and Module 010 (reports, purchase cost) read purchase entries, and a stored or mutable design would be costly to reverse. 2) Alternatives: yes, listed below. 3) Scope: yes, database, handlers, the market list screens and print, and later modules. -->

## Decision

1. **The market list is computed on every read from one shared SQL definition, never stored.** `market_rows(date)` returns the rows (registered medicines and typed lines) with requested, purchased, remaining and status; `market_list` and `market_summary` both read it, so the Home count always equals the length of the "still to buy" list (ADR-0004 point 10). It uses orders whose status is `confirmed` or `fulfilled` and whose `confirmed_at` falls inside the chosen Pakistan day (`Asia/Karachi`), lines not removed. Draft and cancelled orders never count. Rows are grouped by `(product_id, norm_text(unit))`; typed lines by `(norm_text(name), norm_text(unit))`. Units are never converted into each other.
2. **Purchases live in two append-only tables.** `purchase_entries` (one row per real purchase: medicine, unit, purchase date, quantity, optional unit cost, supplier, reference, who, when) and `purchase_voids` (one row per cancellation with a required reason, unique per entry). A trigger refuses every update and delete on both tables (delete only for `service_role`). An entry is cancelled by adding a void row, never by changing the entry. A cancelled entry stops counting and stays in the history with its reason. Primary keys are `(business_id, id)` and `(business_id, entry_id)` so a row can only belong to one business.
3. **Writes only through two `SECURITY DEFINER` functions, no write grants.** `purchase_record` and `purchase_void` read the business from `current_business_id()` and filter every statement by it. Signed-in users have `select` only (Row Level Security on both tables); `anon` has nothing. The four reads (`market_rows`, `market_list`, `market_summary`, `purchase_entries_list`) are `SECURITY INVOKER`, so Row Level Security still applies to them.
4. **The client-created entry id is the request id.** The browser creates a UUID per save; `purchase_record` takes an advisory lock on `purchase:<id>`, looks the id up, and inserts only when it is new. The same id with the same content returns the stored entry (`replayed`); the same id with different content is refused (`request_reused`). A repeated cancel returns the first void and keeps the first reason. No separate replay table is needed because the entry's own key gives exactly-once.
5. **Purchased quantity is keyed by (medicine, unit, purchase date).** It is the sum of non-cancelled entries with the same product, the same unit (compared with `norm_text`) and a purchase date equal to the list date. A purchase date later than today (Pakistan time) or earlier than 2000-01-01 is refused. Remaining is never below zero; an over-purchase is `bought_extra`. A store filter changes what is shown and printed, not the bought and remaining figures, which stay for the whole day.
6. **Typed (unregistered) lines cannot be bought.** They are listed in a separate "Not yet registered" group with a link to register them (Module 004); nothing is recorded against a medicine that does not exist, and nothing is invented for it.
7. **The medicine's purchase price changes only on an explicit "Yes, update".** No function in this module writes a product price. After a purchase with a cost, the screen asks, and only that answer calls the existing product update (`PATCH /api/products/{id}` with the current `version`). Order line snapshots and selling prices are never touched.
8. **Cost exists only in the purchase entry shapes.** The list, the summary, the print data and the CSV never contain a cost, price or MRP (tested by key-name checks on the database output and text checks on the print page and the CSV).
9. **Reads are shaped for the planner and capped.** The reads compute the business filter once and use `MATERIALIZED` CTEs (the lesson of migration `0005`), with a partial index on confirmed orders and an index on `purchase_entries (business_id, purchase_date, product_id)`. A list has at most 2,000 rows; beyond that the response says it was truncated and print and CSV refuse to produce a partial list.

## Consequences

### Positive

- No code path can rewrite a recorded purchase: quantity, cost and date are immutable, and a correction is a visible cancellation with a reason plus a new entry (tested on PGlite and on the Supabase test project).
- A lost response, a double tap, a refresh or ten simultaneous identical saves give one entry; ten simultaneous cancels give one cancellation; ten different ids give ten entries (tested against the real test project).
- The list cannot drift from the orders because nothing about it is stored; confirming, cancelling, editing, registering or linking changes the next read (tested).
- Business isolation is enforced in the functions and by Row Level Security, tested with crafted ids for two real users; a refusal looks exactly like a missing id.
- Measured at 200 confirmed orders, 1,000 lines, 150 medicines, 20 stores and 300 entries on the test project (5 runs each, including the network round trip): list at most 422 ms (goal 3,000 ms), purchase save at most 791 ms (goal 2,000 ms). No performance migration was needed.

### Negative

- Rules in SQL again (migration `0006`), so every change is a migration with PGlite and Supabase tests. A missing business filter in a `SECURITY DEFINER` function would be a leak. Mitigation: composite keys, a filter on every statement, two-user tests with crafted ids.
- Purchased quantity is not allocated to stores; a purchase belongs to the whole list, which matches the supplier's real way of buying but means delivered quantities per store must come from Module 006.
- A computed list is recalculated on every read; if a supplier ever has far more than a few hundred rows a day the cap and the indexes are the only protection (accepted for a solo supplier, and the scale test is part of the module's checks).
- An entry can be cancelled but not edited, so a wrong quantity takes two steps (cancel, record again). This is deliberate and keeps the history honest.
- The price-update question depends on the product's `version`; if the medicine changed elsewhere the screen asks again instead of overwriting.

## Alternatives Considered

- **A stored market-list table kept in sync with orders.** Rejected: it would need updating on every confirm, cancel, edit, link and register, and a missed update shows a wrong quantity to buy.
- **A materialized view for the list.** Rejected: stale between refreshes, and refresh logic is more risk than benefit for one supplier.
- **A mutable purchase row (a quantity column that is updated, or a `voided_at` column).** Rejected: the recorded fact could be rewritten, the trigger rules would be more complicated, and the audit trail would depend on a second log.
- **A shared replay table for purchases (reusing `pending_requests`).** Rejected: its kinds belong to Module 004, and the entry's own primary key already gives exactly-once for creation.
- **Relying on the screen to prevent double saves.** Rejected: the constitution and the project rules forbid depending on client-side checks for financial data.
- **Updating the medicine's purchase price inside `purchase_record`.** Rejected: it would change a price without a separate confirmation.
- **Cursor paging of the list.** Rejected: print and CSV need the whole list, and paging would make "the sum equals the order lines" harder to check; the cap protects the server instead.
- **Server-side PDF generation for print.** Rejected: a new dependency and PDF files are out of scope; a print page with print-media CSS is used, and thermal 80 mm printing is decided with invoices in Module 006.

## References

- Feature Spec: specs/005-market-list-purchases/spec.md
- Implementation Plan: specs/005-market-list-purchases/plan.md (the ADR suggestion is at its end); research D1 to D14: specs/005-market-list-purchases/research.md; data model: specs/005-market-list-purchases/data-model.md; API: specs/005-market-list-purchases/contracts/api.openapi.yaml
- Verification record: specs/005-market-list-purchases/quickstart.md sections 6 to 9
- Migration: supabase/migrations/0006_market_list_purchases.sql (applied to the test project and to the dev project on 2026-11-13)
- Related ADRs: history/adr/0003-order-write-model-and-price-snapshots.md, history/adr/0004-pending-link-and-price-fill-write-model.md, history/adr/0002-rest-handlers-over-rls-with-client-generated-ids.md
