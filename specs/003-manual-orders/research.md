# Research: Manual Orders and Store-wise Order History

**Branch**: `003-manual-orders` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

No `NEEDS CLARIFICATION` items were open in the spec; this document records the design decisions the plan depends on, the alternatives rejected, and what must be verified when the migration is first applied. Existing conventions from Modules 001 and 002 are reused wherever they fit (client-generated ids, optimistic `version`, `norm_text`, REST route handlers over the user's own Supabase session, `ApiError` shapes, offset cursors).

## D1. Orders are written only through database functions; the tables are read-only for signed-in users

- **Decision**: `orders`, `order_lines` and `order_events` get Row Level Security with a **select** policy only, and `authenticated` is granted **select only**. All writes go through `SECURITY DEFINER` functions (`order_save`, `order_confirm`, `order_cancel`) that read the business from `current_business_id()` and filter every statement by it. Composite foreign keys `(business_id, store_id)` and `(business_id, product_id)` additionally make it impossible for an order to reference another business's store or medicine, whatever the function does.
- **Rationale**: Status transitions, price snapshots, order numbers and the change history are integrity rules. If users could `UPDATE orders` or `order_lines` directly through the API they could skip a snapshot, rewrite one, or confirm with no history. Module 002 used one such function for settings (`save_business_settings`); here the same idea is the only write path. Constitution V: financial and security-sensitive validation is enforced server-side, in the database, never by client code.
- **Alternatives considered**:
  - Plain table writes with RLS (as for products and stores): rejected, because a multi-table atomic change (order + lines + number + history) cannot be done safely from several client calls, and a user could bypass the rules.
  - `SECURITY INVOKER` functions with insert/update grants (as Module 002's import): rejected for orders, because the grants themselves would still let a direct call change a snapshot or status.
- **Risk and mitigation**: `SECURITY DEFINER` bypasses RLS, so a missing filter would leak or cross-write between businesses. Mitigation: every query in these functions filters by the caller's business, composite foreign keys enforce same-business references, and RLS tests (PGlite and the Supabase test project) attempt cross-business reads, writes, and crafted payloads (foreign store id, foreign product id, foreign line id).

## D2. One `order_save` function creates a draft, updates a draft, and edits a confirmed order; idempotency by request id plus version

- **Decision**: `order_save(p_id, p_request_id, p_expected_version, p_store_id, p_notes, p_lines)`:
  - order does not exist and `p_expected_version` is null: create a draft (assigns the order number, writes a `created` event);
  - order exists and `p_request_id` equals the order's `last_request_id`: **replay**, return the stored order and change nothing (this covers a lost response);
  - order exists, status draft: check `expected_version`, apply the new notes and lines;
  - order exists, status confirmed: check `expected_version`, apply as an edit, write an `edited` event;
  - cancelled or fulfilled: refuse (`order_not_editable`).
  Every successful change updates the order row once, which bumps `version` (existing `set_row_meta` trigger). The function returns `{saved, replayed, order}` or `{saved:false, reason, current?}`; reasons: `version_conflict`, `order_not_editable`, `store_locked`, `store_inactive`, `invalid_lines`, `unusable_id`, `not_found`.
- **Rationale**: Order ids come from the device (`newId()`), so a retried create is the same request. Comparing a stored `last_request_id` is exact: a retry of a request that already succeeded returns that success, while a different request on a stale version returns a real conflict (FR-019, FR-020). A per-order advisory lock (`pg_advisory_xact_lock(hashtext('order:' || id))`) serialises two simultaneous requests for the same id, so two simultaneous creates produce one order and the second becomes a replay (SC-005).
- **Whole-order replace**: the client sends the complete list of lines. Lines are matched by their client-generated id: known ids are updated, new ids inserted, ids missing from the list are marked removed (D4). This keeps each save one atomic, idempotent unit and makes "no partial order" (FR-021) a property of one transaction.
- **Alternatives considered**: one endpoint per line operation (add/update/remove): rejected, because the autosave then needs a queue of ordered operations with per-operation idempotency, and a lost response in the middle can leave a half-applied order; the whole-order replace is simpler to prove correct. A separate `last_request_id` per operation table: rejected as heavier than one column.
- **Accepted limit**: the whole order is sent on each save (up to 200 lines, a few KB). Acceptable on mobile data and far simpler than deltas.
- **Accepted limit (replay)**: a retry is recognised as a replay only while its `request_id` is the order's most recent successful one. If a different successful change (for example from a second tab) landed in between, the old retry gets a `version_conflict` with the current order instead of a replay; nothing is lost, the supplier reviews the current version.

## D3. Order numbers come from a per-business counter updated in the same transaction

- **Decision**: table `order_counters (business_id primary key, last_number)`. Creating an order runs `insert ... on conflict (business_id) do update set last_number = order_counters.last_number + 1 returning last_number` inside `order_save`, and the number is stored as an integer `orders.order_number` with `unique (business_id, order_number)`. The screen shows it as `ORD-0001` (formatted in TypeScript; numbers above 9999 simply grow longer).
- **Rationale**: The counter row is locked by the first transaction until it commits or rolls back, so concurrent creates are serialised and get different numbers; a rolled-back creation also rolls back the counter, so there are no gaps and no reuse in normal operation (FR-043, SC-005). Cancelled orders keep their number.
- **Alternatives considered**: a PostgreSQL `SEQUENCE` per business (needs dynamic DDL, and sequences are not rolled back, so gaps appear); `max(order_number) + 1` (races); client-chosen numbers (violates "controlled server-side mechanism").
- **Format**: human readable, `ORD-` plus at least 4 digits. This is display only; the stored value is the integer, so the format can change without a migration. (Invoice numbers in Module 006 will use their own counter.)

## D4. Lines are never hard-deleted: removal sets `removed_at`

- **Decision**: removing a line from a draft or from a confirmed order sets `removed_at`; every read ignores removed lines. The `edited` event for a confirmed order also records the removed line (name, quantity, unit, selling price snapshot).
- **Rationale**: FR-032 says no hard deletes by user action, and the constitution requires important changes to be traceable. Soft removal for drafts too keeps one rule for both. A removed line's id is never reused by the client, so a later replay cannot resurrect it.
- **Alternative considered**: hard-delete draft lines (they have no snapshot and no meaning yet): rejected as a special case that contradicts FR-032 and makes the replay rule harder to reason about.

## D5. The price snapshot is taken at confirm and is immutable; a draft shows the live price

- **Decision**: at `order_confirm`, every active catalog line copies the medicine's `purchase_price`, `selling_price`, `mrp` and its description (name, strength, dosage form, pack size, manufacturer) into the line, with `snapshot_taken_at = now()` and `delivered_quantity = quantity`. A typed line gets `snapshot_taken_at` and null prices. A line added while editing a confirmed order gets its snapshot when that edit is saved. A `BEFORE UPDATE` trigger on `order_lines` raises an error if any snapshot column or the description of a line with `snapshot_taken_at` changes. The line total is a stored generated column, `quantity * selling_price_snapshot` (null when there is no snapshot price), so it is exact and cannot drift.
- **Rationale**: Constitution II fixes the snapshot at confirm (the request text said "added/confirmed"; the constitution wins and the spec records it). Until confirm, the line has no snapshot, so a draft's screen shows the live current price, labelled as such. Putting the immutability rule in a trigger means even a future bug in a function cannot rewrite a snapshot.
- **Module 004 compatibility** (the spec says the data model must not need to change): a typed line has `product_id` null and `item_status = 'pending_registration'`; linking sets `product_id` and `item_status = 'registered'` and leaves the typed `name` alone; the "Pending Prices" flow must be able to fill a `null` selling price snapshot after the supplier confirms. The trigger therefore allows exactly one exception, active only when the transaction sets `app.line_snapshot_edit = 'on'` through `set_config(..., true)`. Nothing in Module 003 sets it, signed-in users cannot call `set_config` through the API, and direct writes to the table are not granted (D1). Module 004 adds its own `SECURITY DEFINER` function that sets the flag, with a confirmation and an audit event; no table or column change is needed.
- **Alternatives considered**: snapshot at line add (the request's other reading): rejected, because a draft can sit for hours and the price at confirm is the one the supplier agrees to; storing prices on drafts would also need refreshing rules. Storing `line_total` computed by the application: rejected, because a stored number the application computes can disagree with the data.
- **Cancelled drafts**: a draft cancelled before it was ever confirmed has no snapshot; it shows no price and no total (`price_basis = none`), never the live catalog price (FR-035).
- **Accepted behaviour**: if the catalog price changes between the supplier looking at the confirm screen and the confirm call, the snapshot is the price at the confirm call. The confirm response shows the recorded prices and totals, so the supplier sees what was recorded.

## D6. Totals are computed in SQL, never stored on the order

- **Decision**: an order's total is `sum(line_total)` over active lines, with `unpriced_count` = active lines whose effective selling price is null. For confirmed and cancelled orders the effective price is the line's snapshot; for drafts it is the medicine's current selling price (typed lines have none). The functions return money as text (cast `::text`) so PostgREST never turns it into a float.
- **Rationale**: FR-034 to FR-036: exact PKR, labelled "priced lines only" whenever any line is unpriced, never counting an unpriced line as zero silently. An order-level stored total would have to be kept in step with every line edit.
- **Display**: the TypeScript side formats strings with the existing `formatPKR`; it never does arithmetic on floats. The line total in a draft screen is computed with the existing integer-paisa helpers (`parseMoneyToPaisa`, `paisaToMoney`) multiplied by the integer quantity, which is exact.

## D7. Autosave is a small client state machine with one request in flight

- **Decision**: the editor keeps local order state (store, notes, lines) and the last server `version`. Edits are debounced (about 800 ms) and sent as one `PUT /api/orders/{id}`; only one request is in flight; changes made meanwhile are coalesced into the next request; the next request uses the version returned by the previous one. A failed request is retried with the **same** `request_id` and payload (three attempts with a short back-off), then the state becomes "Not saved" with a Retry button; the typed data stays on screen. `beforeunload` warns while there is unsaved data. A `version_conflict` response stops autosaving and shows "This order was changed elsewhere" with the current version to review. The states shown are exactly: Saving, Saved at HH:MM, Not saved, Changed elsewhere.
- **Flush rule**: Confirm, Discard and leaving the order wait for `flush()`, which resolves only when every local edit has been confirmed by the server. If the flush fails, the confirmation is not sent and the unsaved state stays visible, so an edit made a moment before Confirm can never be dropped by confirming an older saved version.
- **Retry rules**: only network failures and HTTP 5xx are retried automatically (same `request_id`, three attempts with back-off). 400, 401, 404 and 409 responses stop the machine with the server's message and are never retried in a loop. An edit made while a request is being retried, or whose response was lost, waits until that request is resolved and is then sent with the returned version and a new `request_id`; otherwise the user's own earlier change would be reported as "Changed elsewhere".
- **Rationale**: FR-016 to FR-022. Keeping the logic in one pure module (`src/lib/orders/autosave.ts`) makes it testable with fake timers and a fake transport (lost response, 500, conflict, duplicate delivery) without a browser.
- **Honesty**: nothing is stored on the device; refresh before the first successful save loses only the last debounce window, which the warning and the "Not saved" state make visible. No "saved on this device" wording anywhere (Constitution VII: that belongs to Module 009).
- **Alternatives considered**: saving only on a button: rejected (the product rule is automatic draft saving); saving each keystroke or each field: rejected (too many requests on mobile data); IndexedDB drafts now: rejected as Module 009's scope.

## D8. Confirmed orders are edited with an explicit "Save changes"

- **Decision**: opening a confirmed order for editing loads it into the same editor in "edit mode": no autosave, an explicit **Save changes** (one `order_save` call, which writes one `edited` event with the list of changes) and **Discard changes**. Line removal asks for confirmation.
- **Rationale**: each save of a confirmed order is a recorded business change (FR-033). Autosaving every keystroke would flood the history and could record half-typed quantities. Drafts have no history of edits, so they autosave.

## D9. The store of a draft is locked once it has a line, enforced in the database

- **Decision**: `order_save` refuses a different `store_id` (`store_locked`) when the stored order has any active line; confirmed and cancelled orders never change store. The editor shows the store as read-only once a line exists, with "Start a new order for another store". An empty draft can change store freely.
- **Rationale**: FR-010, FR-011, SC-003: the exact failure the product rules forbid is lines moving between stores. A UI-only rule is not enough for a rule of this kind, so the function refuses it even for a crafted request. Because lines belong to the order and the order belongs to one store, no operation ever copies or moves a line between orders.

## D10. History list is one SQL function with day bounds in Pakistan time and offset cursors

- **Decision**: `order_list(p_store, p_status, p_from, p_to, p_q, p_limit, p_offset)` (SECURITY INVOKER, so RLS applies) returns order summaries newest first (`created_at desc, id desc`) with the store name, line count, priced total and unpriced count in one query. Date filters are inclusive local days in `Asia/Karachi`, converted to a `[from, to + 1 day)` range on `created_at`, so the `(business_id, created_at desc)` index is used. `p_q` matches an order number (digits, with or without `ORD-` or `#`) or tokens of the store name. Paging uses the existing offset cursor helpers (`decodeCursor`, `slicePage`).
- **Rationale**: FR-038 to FR-042, SC-010. One query per page avoids an N+1 on lines. The existing offset cursor is adequate for one owner's history; newest-first insertion can shift pages slightly while someone pages, which is harmless for a read-only list.
- **To verify at first apply**: that PGlite and the Supabase projects both know the `Asia/Karachi` zone (Pakistan has no daylight saving now, so a fixed `+05:00` is the fallback). Recorded in the quickstart.
- **"Order date"** is `created_at` (the first save), as assumed in the spec.

## D11. Search and inline store creation reuse Module 001's endpoints

- **Decision**: the medicine search uses `GET /api/products?q=&status=active` through the existing `useSearchList` hook (debounced 250 ms, tokens must all match `search_text`, which already contains name, brand, generic name, strength, manufacturer and SKU). The store selector uses `GET /api/stores?status=active` and creates a store with the existing `POST /api/stores` (client id, only a name, the same "similar store" confirmation). Dosage form is not in `search_text` today.
- **Gap and decision**: FR-004 requires matching dosage form, and `search_text` does not contain it. Changing a generated column means dropping and re-adding it (and its trigram index) on a table that already holds data. **Chosen**: leave `search_text` alone and make each search token match either `search_text` or `dosage_form` (one `or` filter per token in the products list query). Each pattern is double-quoted and escaped before it goes into the PostgREST `or(...)` expression, because commas, brackets and quotes in user text would otherwise change the filter. If the 5,000-medicine timing test (SC-009) shows this is too slow, a follow-up migration rebuilds `search_text` to include `dosage_form`. This is a task with a measured outcome, not a silent assumption.
- **Rationale**: no new endpoints, no duplicated matching rules, and the 250 ms debounce plus trigram index already pass for Module 001's catalog search.

## D12. The new-order flow puts the client id in the URL; nothing is created until the first change

- **Decision**: `/orders/new` shows the store selector. Choosing a store generates `newId()` and replaces the URL with `/orders/<id>?store=<storeId>`. The page loads the order with `GET /api/orders/<id>`; a 404 plus a valid `store` parameter means "new, not yet saved": an empty editor for that store. The first change (a line or notes) triggers the first `PUT`, which creates the draft. Refreshing before the first change loses nothing (nothing existed); refreshing after it reloads the saved draft. The route never remounts the editor after the first save, so edits typed during the first save are not lost.
- **Rationale**: avoids a route change after the first save (which would remount and drop in-flight typing), and avoids creating empty orders just from opening the screen (spec Assumptions).

## D13. Navigation gets five items

- **Decision**: Home, **Orders**, Products, Stores, Settings. Five items fit at 360 px (72 px each, 56 px high). "New order" is a primary button on Home and on the Orders list, and Home shows "Continue order" cards (up to three newest drafts) when drafts exist. The store detail page links to `/orders?store=<id>`.
- **Alternative considered**: a floating "+" in the bar: rejected (adds a control that is not a destination and would break the touch-target test layout).

## D14. Order change history is an append-only table written by the functions

- **Decision**: `order_events` (created, confirmed, edited, cancelled) with the order version, the acting user (`auth.uid()`), a time, and a JSON detail (before and after values; removed lines with their selling snapshot). Update and delete are blocked by a trigger as well as by missing grants. The order screen shows the history newest first.
- **Rationale**: FR-033, SC-014, and Constitution V (important changes are audited). The detail never contains purchase price or MRP (FR-037).

## D15. No offline in this module, and what is prepared for Module 009

- **Decision**: with no connection the screen says "Not saved"; nothing is claimed about the device. What Module 009 can reuse unchanged: client-generated order and line ids, a request id per save, optimistic versions, and a save function that is idempotent and returns conflicts instead of overwriting.
- **Constitution VII note**: VII says order taking and drafts must eventually work offline; the roadmap schedules that in Module 009. The plan satisfies VII's honesty rules now (no false "saved" or "synced") and is recorded in the plan's Complexity Tracking.

## D16. Testing strategy

- **Unit (Vitest)**: autosave state machine (debounce, coalescing, retry with the same request id, lost response, conflict, beforeunload flag); order validation schemas (quantity range, unit, notes, 200 lines, duplicate line ids, typed vs catalog line); order number formatting; PKT day-range builder; line total and order total helpers; list-query parsing.
- **PGlite (real PostgreSQL, no credentials)**: schema and constraints; `order_save` create, replay, update, version conflict, store lock, inactive store, foreign store/product/line ids; `order_confirm` snapshot, unpriced and typed lines, empty refusal, replay, later catalog price change; confirmed edit with history; cancel rules; immutability trigger; append-only events; soft removal; gapless numbers; direct writes denied to `authenticated`; two-business RLS.
- **Supabase test project (integration)**: the real API with two users: idempotency, 10 simultaneous creates (10 different numbers), 10 simultaneous confirms (one confirmation), version conflicts across two sessions, RLS isolation, history filters, medicine search timing on 5,000 medicines (SC-009), first page of 1,000 orders (SC-010).
- **Playwright (production build)**: a 10-line order timed on a phone viewport (SC-001), refresh and navigation recovery, typed lines, store lock, confirm, edit confirmed, cancel, history filters, price change after confirm, "Not saved" with the network cut, "changed elsewhere" with two pages, 360 px and 44 px targets.
- **Not tested here**: the real phone experience beyond what the owner verifies (as in Module 002).

## Items to verify when the migration is first applied

1. `Asia/Karachi` is available in PGlite and on both Supabase projects (D10).
2. A generated column `quantity * selling_price_snapshot` accepts a `numeric(18,2)` cast on both engines (D5).
3. `pg_advisory_xact_lock` and `insert ... on conflict ... do update ... returning` behave as described under PGlite (single connection) and on Supabase (real concurrency, tested by the integration tests).
4. The products search with an extra `dosage_form` match meets SC-009 on 5,000 medicines (D11).
