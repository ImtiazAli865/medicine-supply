# ADR-0003: Order Write Model and Price Snapshots (database-function-only writes, replayable saves, snapshot at confirm)

> **Scope**: One decision cluster made in Module 003 (manual orders) that Modules 004 to 009 build on. The parts were chosen together and would change together.

- **Status:** Accepted (the owner asked for this ADR on 2026-11-09)
- **Date:** 2026-11-09
- **Feature:** 003-manual-orders
- **Related:** ADR-0002 (REST handlers over RLS, client-generated ids, versions). This ADR narrows it for state machines: plain RLS writes stay right for master data, not for orders.
- **Context:** An order is the first record in the app that is a business promise: it has a status, a number the supplier quotes to a store, prices that must not change later, and a history. Later modules read it (pending products, market list, invoices, khata). Requirements: nothing typed may be lost on refresh or a bad network; a retry or double tap must not create a second order or number; two tabs must not overwrite each other; prices agreed at confirm must never move when the catalog changes (constitution II); a signed-in user must not be able to rewrite a snapshot or status by calling Supabase directly (constitution V); a medicine not yet in the catalog must never block an order (constitution VI).

<!-- Significance checklist: 1) Impact: yes, every billing and ledger module depends on these rules. 2) Alternatives: yes, listed below. 3) Scope: yes, database, handlers, autosave client, all later order-related modules. -->

## Decision

1. **Signed-in users can only read the order tables. All writes go through three `SECURITY DEFINER` functions: `order_save`, `order_confirm`, `order_cancel`.**
   - `orders`, `order_lines` and `order_events` have a select-only RLS policy and select-only grants; `order_counters` has no grants. Each function takes the business from `current_business_id()` and filters every statement by it. Composite foreign keys `(business_id, id)` tie a store or medicine to the same business whatever the function does.
   - Reads use `SECURITY INVOKER` functions (`order_get`, `order_list`, `order_to_json`), so RLS still applies to them.
2. **One `order_save` creates a draft, updates a draft and edits a confirmed order, as a whole-order replace, made safe to retry.**
   - The client generates the order id and line ids and sends a fresh `request_id` per save. A request whose id equals the order's `last_request_id` is a replay and returns the stored order unchanged. `expected_version` gives optimistic concurrency (409 with the current order). `pg_advisory_xact_lock` on the order id serialises same-id requests.
   - Order numbers are gapless per business from `order_counters` (`greatest(last_number, max(order_number)) + 1`) in the same transaction.
   - Lines are never hard-deleted (`removed_at`); `order_events` is append-only (only `service_role` may delete).
3. **The price snapshot is taken at confirm and is immutable.**
   - Confirm copies purchase price, selling price, MRP and the medicine description into each catalog line; typed lines get a snapshot with null prices. A trigger (`order_lines_guard`) refuses any later change to a snapshot column. `line_total` is a generated column. A draft shows the live price, labelled as current; a discarded draft shows none.
   - One reserved exception exists for Module 004 (`app.line_snapshot_edit = 'on'`, set only by a future `SECURITY DEFINER` function with confirmation and an audit event), so filling a missing price later needs no schema change.
   - Purchase price and MRP are stored in the snapshot but are never returned to any order screen.
4. **The browser saves through a small autosave state machine** (`src/lib/orders/autosave.ts`): one request in flight, 800 ms debounce, retry only on network or 5xx errors with the same request id, a later edit waits for a retrying request, `flush()` before confirm, discard and navigation, and a conflict stops saving until the supplier reviews the current order. The screen never shows "Saved" unless the server confirmed it.

## Consequences

### Positive

- A user cannot skip a snapshot, fake a status or confirm without history, even by calling Supabase directly (tested: direct writes are refused on the real project and on PGlite).
- A lost response, a double tap, a refresh or ten simultaneous requests produce one order and one number (tested, including 10 simultaneous creates and confirms).
- A confirmed order keeps its prices and total after the catalog changes (tested). Later invoices can total from the snapshot without extra work.
- The same request ids and versions can be resent by the offline queue (Module 009) without a new contract.

### Negative

- Rules live in SQL (about 950 lines in `0003_orders.sql`), so every change is a migration and needs PGlite and Supabase tests; a missing business filter in a `SECURITY DEFINER` function would be a leak. Mitigation: composite foreign keys, RLS tests with two real users, crafted foreign ids.
- Each save sends the whole order (up to 200 lines). Fine for one supplier on mobile data, but the cost grows with order size.
- A retry is a replay only while its request id is the latest successful one; if another tab changed the order in between, the old retry gets a visible conflict. Nothing is lost, but the supplier must review it.
- Gapless numbers serialise order creation per business. Acceptable for a solo supplier.
- The reserved snapshot-edit flag is a deliberate hole that must stay unused until Module 004 and must be reviewed when it is added.

## Alternatives Considered

- **Plain table writes under RLS (as for products and stores).** Rejected: an order, its lines, its number and its history cannot be changed atomically from several client calls, and a user could change a snapshot or status directly.
- **`SECURITY INVOKER` functions with insert and update grants (as the Module 002 import).** Rejected for orders: the grants would still allow a direct call to change a snapshot or status.
- **One endpoint per line operation.** Rejected: needs an ordered queue with per-operation idempotency, and a lost response can leave a half-applied order.
- **Snapshot at line add.** Rejected: a draft can sit for hours; the price at confirm is the one the supplier agrees to, and the constitution fixes the snapshot at confirm.
- **Order total stored on the order, or computed in the browser.** Rejected: it can disagree with the lines; totals are computed from lines (money as text, integer paisa on the client).
- **A PostgreSQL sequence per business, or `max + 1`.** Rejected: sequences leave gaps and need dynamic DDL; `max + 1` races.

## References

- Spec: specs/003-manual-orders/spec.md; plan: specs/003-manual-orders/plan.md
- Research (D1 to D7): specs/003-manual-orders/research.md; data model: specs/003-manual-orders/data-model.md; API: specs/003-manual-orders/contracts/api.openapi.yaml
- Migration: supabase/migrations/0003_orders.sql; autosave: src/lib/orders/autosave.ts
- Earlier decision: history/adr/0002-rest-handlers-over-rls-with-client-generated-ids.md
