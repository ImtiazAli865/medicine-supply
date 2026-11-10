# Research: Pending Products (Quick Register, Linking, Pending Prices)

**Branch**: `004-pending-products` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

No `NEEDS CLARIFICATION` items were open in the spec. This document records the design decisions the plan depends on, the alternatives rejected, and what must be verified when the migration is first applied. Conventions from Modules 001 to 003 are reused wherever they fit: client-generated ids, optimistic `version`, `norm_text`, REST route handlers over the user's own Supabase session, `ApiError` shapes, offset cursors, and the write model of ADR-0003 (read-only tables for signed-in users, `SECURITY DEFINER` functions as the only write path).

What the plan builds on (checked in the Module 003 code on 2026-11-10):

- `order_lines` keeps a typed line as `product_id null` and `item_status = 'pending_registration'`; a check constraint ties the two together. A confirmed typed line already has `snapshot_taken_at` set and null prices.
- Trigger `order_lines_guard` refuses changes to the recorded prices and the description columns (`name`, `strength`, `dosage_form`, `pack_size`, `manufacturer`) once `snapshot_taken_at` is set, unless the transaction sets `app.line_snapshot_edit = 'on'`. Nothing sets it yet.
- `order_save` refuses "A line cannot change its medicine", so the browser can never relink a line through autosave; Module 004 is the only path that links.
- `order_events.event_type` allows only `created`, `confirmed`, `edited`, `cancelled`.
- Every change to an order row bumps `orders.version`; an open editor that saves an older version gets `version_conflict` with the current order.
- Products have a unique identity index (`business_id`, normalised name, strength, dosage form, pack size, manufacturer; inactive products included) and a unique SKU index. `find_products_by_name` returns same-name medicines.

## D1. Register, link and price fill are `SECURITY DEFINER` functions; no new write grants

- **Decision**: three write functions, all reading the business from `current_business_id()` and filtering every statement by it: `pending_line_register`, `pending_line_link`, `pending_price_apply`. Reads are `SECURITY INVOKER` functions so RLS still applies: `pending_summary`, `pending_typed_groups`, `pending_candidates`, `pending_prices_list`, `pending_price_preview`. The order tables stay select-only for signed-in users.
- **Rationale**: Linking and price fill change `order_lines` rows whose guard trigger protects recorded prices; the only controlled exception is a function that sets `app.line_snapshot_edit` for its own transaction (ADR-0003). A client that could update `order_lines` directly could skip the confirmation. Register must create a medicine and link a line atomically, which a handler making two calls cannot guarantee (constitution V and the Module 003 lesson).
- **Alternatives considered**: (a) A handler that first creates the product through the existing `POST /api/products` and then links: rejected, because a failure between the two leaves a created medicine with an unlinked line (FR-005, SC-002) and a retry cannot be proven atomic. (b) Granting `UPDATE` on `order_lines` columns to signed-in users: rejected, it would let a direct API call change a price snapshot.
- **Risk and mitigation**: `SECURITY DEFINER` bypasses RLS, so a missing business filter would leak or cross-write. Mitigation: every query filters by the caller's business, composite foreign keys already tie lines, products and orders to one business, and tests (PGlite and two real Supabase users) attempt cross-business reads, writes and crafted ids for every new function. The flag `app.line_snapshot_edit` is set with `set_config(..., true)` (transaction-local) only inside these functions and is reset to `off` before they return.

## D2. One idempotency record per request, in a new table `pending_requests`

- **Decision**: `pending_requests (business_id, request_id, kind, result jsonb, created_at)` with primary key `(business_id, request_id)`, written by the three write functions in the same transaction as the change. A repeated request with the same `request_id` returns the stored result with `replayed: true` and changes nothing. No grants to signed-in users; no hard delete by the app.
- **Rationale**: Module 003 recognises a replay by `orders.last_request_id`, which works for one order. A price fill touches many orders and a register touches a product and an order, so a per-order marker cannot cover them. One small table gives the same exact guarantee for all three: a retry of a request that already succeeded returns that success (SC-003), including simultaneous repeats (the advisory lock below serialises them, then the second one finds the record).
- **Simultaneous identical requests**: the lookup is done twice, once before and once after the advisory locks are taken. Without the second lookup, the second of two simultaneous identical requests would pass the first lookup (nothing stored yet), wait for the lock, and then be refused (for example `line_not_pending`) instead of receiving the first request's stored result, which would break "a retry shows the same result" (SC-003). Found by the analysis of 2026-11-10.
- **Interaction with `order_save`**: the new functions do not write `orders.last_request_id`. An `order_save` retry that was already applied still replays correctly; an `order_save` that is stale after a link gets `version_conflict` and the current order, which is the intended "changed elsewhere" behaviour (FR-031).
- **Alternatives considered**: reuse `orders.last_request_id` (rejected: cannot cover multi-order fills); an idempotency key derived from the product id only (rejected: a price fill has no id of its own); storing the key in each event (rejected: scanning events to find a replay is slow and the event table must stay append-only history).

## D3. Locking and the order version: same advisory lock key as `order_save`

- **Decision**: each function takes `pg_advisory_xact_lock(hashtext('order:' || order_id))` for every order it touches (sorted by id for a multi-order fill, to avoid deadlocks) and for the product `pg_advisory_xact_lock(hashtext('product:' || product_id))` first. It then applies the same checks as `order_save`: order exists in the business, status is `draft` or `confirmed` (otherwise `order_not_editable`), and `expected_version` equals the order's version (otherwise `version_conflict` with the current order). A successful change updates the order row once, which bumps `version` through the existing trigger.
- **Rationale**: Using the same lock key means a register or link and an `order_save` of the same order cannot interleave. Bumping the version makes any open editor tab see "changed elsewhere" (FR-031, US1 scenario 12) instead of overwriting a line that was just linked. For a fill, the expected version is not sent per order (the reviewed line list plays that role, D6): each touched order's version is bumped, which also warns open editors.
- **Alternative considered**: no version bump for a link (rejected: an open editor would then autosave a typed line over a linked one; `order_save` would raise `invalid_lines` instead of a clear conflict).

## D4. A new column `order_lines.typed_name` keeps what the supplier typed

- **Decision**: additive column `typed_name text` (null for lines that were never typed). When a line is linked, the function sets `typed_name` to the line's current `name` (the typed text), then writes the medicine's description into `name`, `strength`, `dosage_form`, `pack_size`, `manufacturer`. A small trigger makes `typed_name` write-once: once not null it can never change or become null, even under the snapshot-edit flag.
- **Rationale**: FR-006/FR-007 require the line to show the registered medicine and still show "As typed: ...". Keeping it only in the history event would make every screen read events to find it, and a history entry is not a line field. A column is exact, small and testable. It is additive (no rewrite of Module 003 data) and `order_to_json` returns it, so the screens need no join.
- **Why the description is copied into the line**: a confirmed line shows its own snapshot columns (`order_to_json` reads `ol.name`, `ol.strength`...), not the live medicine, so invoices later total from what the order recorded. Linking therefore snapshots the description at the moment of the supplier's confirmation. For a draft line the description is also copied (as `order_save` already does when a catalog line is inserted) and `order_confirm` refreshes it at confirmation.
- **Alternatives considered**: overwrite `name` and keep the typed text only in the event (rejected, see above); a separate `order_line_links` table (rejected: one link per line, never undone, so a column is enough and cheaper to read).

## D5. New order history entry types: `linked` and `price_filled`

- **Decision**: extend the check on `order_events.event_type` to `('created','confirmed','edited','cancelled','linked','price_filled')` (drop the generated constraint by looking it up in the catalog, then add a named one). `linked` carries, per line: line id, typed text, product id and name, how it was linked (`registered`, `existing`, or `proposal`), and the price recorded with it (or `null`). `price_filled` carries, per line: line id, quantity, previous price (`null`), new price, product id. Purchase price and MRP are never in event details.
- **Rationale**: The spec requires who, when, before and after for every link and fill (FR-010, FR-021, SC-010). The history table is append-only (trigger), so new kinds are new rows, never edits. Existing rows are untouched.
- **Display**: `OrderHistoryLog` gets two new line formats ("Linked ... to ...", "Price PKR 125.50 recorded for 3 x ..."). Unknown future types keep a generic line so the log never breaks.

## D6. Pending Prices: price set once, reviewed list, all-or-nothing fill

- **Decision**:
  - A line is **waiting for a price** when its order is `confirmed`, `removed_at` is null, `snapshot_taken_at` is not null, `selling_price_snapshot` is null and `product_id` is not null. A typed line (`product_id` null) is "to register", never priced.
  - `pending_price_preview(product, price)` (invoker, read-only) returns the exact waiting lines of that medicine (store, order number, quantity, resulting total) and the count of the medicine's lines that already carry a price (not touched).
  - `pending_price_apply(product, price, request_id, line_ids, fill_lines)`: the browser sends the line ids it reviewed. The function recomputes the waiting set under the locks; if it differs from `line_ids` it returns `list_changed` with the current list and changes nothing (FR-020). Otherwise it (1) sets the product's `selling_price` only when it is null (an existing price is never overwritten; a different price entered for a priced medicine returns `price_differs`, FR-017), (2) when `fill_lines` is true, sets `selling_price_snapshot` on exactly those lines under the snapshot-edit flag, (3) bumps each touched order and writes one `price_filled` event per order, (4) stores the result in `pending_requests`.
  - "Save price only" is the same call with `fill_lines = false` and an empty list.
  - **Batch limit**: a preview and a fill cover at most the first 1,000 waiting lines of the medicine (ordered by order number, line position, line id); the preview also returns `total_waiting`, and the screen says how many remain so the supplier repeats the step. A cap keeps one request and one transaction bounded and keeps the reviewed list readable; for a solo supplier more than 1,000 waiting lines for one medicine is very unlikely, so no background job is built.
  - **A medicine that already has a price** and still has waiting lines (declined at link, or "Save price only" used): the screen shows its price read-only and offers "Fill the waiting lines at PKR X"; the call is the same with `p_price` equal to the current price. Entering a different price is `price_differs`.
  - The price must be greater than zero, at most `9999999999.99`, with at most two decimals; zero is refused because a zero price would count as priced and could later be invoiced for nothing (spec FR-017).
- **Rationale**: Constitution II: the snapshot is filled only through this flow, only after the user confirms, with an audit record, and a line that already has a snapshot never changes. The reviewed-list comparison is the technical form of "the app never fills a line that was not on the reviewed list". The condition `selling_price_snapshot is null` appears in the `update` itself as well, so a bug in the comparison still cannot overwrite a recorded price.
- **Purchase price and MRP snapshots** are not filled (assumption in the spec): they stay as recorded (null for a typed-then-linked line). Profit reports (Module 010) label such lines as incomplete.
- **Alternatives considered**: fill every waiting line of the medicine without a reviewed list (rejected: FR-018 requires the exact review); lock the price to the product and apply it lazily at invoice time (rejected: violates "snapshot only after confirmation, recorded in the audit history").

## D7. Duplicate and similar-name checks reuse the Module 001 rules, inside the function

- **Decision**: `pending_line_register` repeats the Module 001 checks in SQL, in the same order as `createProduct`: SKU conflict first (`sku_conflict` with the conflicting medicine), then exact identity using `norm_text` on name, strength, dosage form, pack size and manufacturer, including inactive medicines (`duplicate_product` with matches), then same normalised name with a different identity (`similar_products` with matches, accepted only when `confirm_similar` is true). The unique indexes `products_identity_uniq` and `products_sku_uniq` remain the last guard; a race that hits them returns the same reasons.
- **Rationale**: One transaction needs the check and the insert together; the TypeScript pre-check of Module 001 runs outside any transaction. The responses use the same codes (`duplicate_product`, `similar_products`, `sku_conflict`) so the existing `SimilarProductsDialog` and error handling are reused (FR-004).
- **An exact duplicate that is inactive** returns `duplicate_product` with the inactive match; the screen says it exists but is inactive and offers the existing Reactivate action from the Products screen (edge case in the spec).

## D8. Proposals use a deliberately narrow match rule

- **Decision**: `pending_candidates(product)` (invoker, read-only) looks at typed lines in orders that are `draft` or `confirmed`, with `removed_at` null. A line is **proposed** only when `norm_text(typed text)` equals one of: the medicine's normalised name; name + strength; name + strength + dosage form (joined with single spaces; empty parts skipped). A line is listed as **looks different, not proposed** when its first normalised word equals the medicine's first word but it is not proposed (this covers "Noran 40mg" against "Noran 20mg"). All other lines are not shown. Within the proposed group, if the same normalised typed text could also equal another active medicine's label (ambiguous), the line moves to "not proposed".
- **Rationale**: Principle IV and the negative prompt: nothing may be proposed that shows a different strength, form or pack size, and nothing is linked without confirmation. An exact label match is the only evidence the app can trust without inventing details. A narrow rule produces some missed proposals, which cost only a manual link (Story 2); a loose rule can mislead the supplier. Typed text is never parsed into strength or form (FR-033).
- **Alternatives considered**: trigram similarity (rejected: it would propose "Noran 40mg" for "Noran 20mg"); token containment (rejected for the same reason). The rule can be loosened later without changing data, because it only affects what is listed.
- **Cost**: one query over typed lines (partial index below); the result is capped at 200 candidates per group with a "show more" cursor.

## D9. Reading models: three small invoker functions and one Home count

- **Decision**: `pending_summary()` returns `{typed_lines, typed_groups, price_items, price_items_with_waiting_lines, lines_waiting}`, where `price_items` is exactly the length of the unfiltered Need a price list and `price_items_with_waiting_lines` is a subset of it (found by the analysis of 2026-11-10: the earlier pair of counts overlapped only partly, so the Home wording "N need a price (M have orders waiting)" would have been wrong and SC-007 untestable); `pending_typed_groups(q, limit, offset)` returns typed lines grouped by normalised typed text with each line's store, order number, order id, quantity, unit and status; `pending_prices_list(q, only_waiting, limit, offset)` returns active medicines without a selling price (with counts of waiting lines and orders) plus medicines that have a price but still have waiting lines, ordered by waiting lines descending then name. All money is returned as text; purchase price and MRP are never selected.
- **Rationale**: One query per screen, computed on open so a count is never stale (FR-026). The list and the Home count use the same definition (SC-007).
- **Note on volume**: the dev catalog has 156 medicines and many have no selling price, so the Home card shows two honest numbers ("to register" and "need a price") rather than hiding the unpriced catalog.

## D10. Indexes

- **Decision**: partial indexes in the migration:
  - `order_lines_pending_typed_idx on order_lines (business_id, order_id) where product_id is null and removed_at is null`
  - `order_lines_waiting_price_idx on order_lines (business_id, product_id, order_id) where product_id is not null and removed_at is null and snapshot_taken_at is not null and selling_price_snapshot is null`
  - `products_unpriced_idx on products (business_id, lower(name)) where is_active and selling_price is null`
- **Rationale**: SC-011 asks for the lists to open within 2 seconds with 1,000 pending lines and 500 unpriced medicines; the partial indexes cover exactly the "pending" rows and stay small. The 1,000/500 case is measured on the Supabase test project and recorded in quickstart.

## D11. Screens: reuse, and no sixth navigation item

- **Decision**: new route `/pending` (tabs "To register" and "Need a price") and `/pending/prices/[productId]` (set price, review, confirm). Dialogs for Register and Link open from a line on the order screen (read-only confirmed view and the editor); Home gets a "Needs attention" card. The bottom navigation keeps five items. Register reuses the Module 001 validation (`ProductCreateSchema` limits and money parsing), the existing `SimilarProductsDialog`, and the medicine search of the order screen for Link.
- **Rationale**: the spec assumption (five 44 px targets fit at 360 px); fewer new components and one search behaviour.
- **Editor interaction**: Register and Link need the saved order and its current version. In the draft editor the screen first awaits the autosave `flush()`; if it cannot be saved, the dialog refuses with "Save the order first". In the confirmed editor with unsaved edits the actions are disabled with the reason. On success the screen calls `adoptServerOrder(order)` so nothing typed is lost and the row shows the linked state.

## D12. What this module does not change

- `order_save`, `order_confirm`, `order_cancel` and the autosave machine are not modified; their tests stay as they are and are rerun. `order_to_json` is replaced (create or replace) only to add `typed_name` to each line; every other key is unchanged.
- No new npm packages. Offline, voice, invoices, undo of a link or fill, and the market list stay out of scope.

## Items to verify when `0004_pending_products.sql` is first applied

1. The old `order_events` check constraint name is found and replaced; existing events are unchanged and the new types insert.
2. `typed_name` is null for all existing lines; the write-once trigger refuses a second change and a change to null, also under `app.line_snapshot_edit = 'on'`.
3. A direct `update` or `insert` on `order_lines`, `order_events` or `pending_requests` by a signed-in user is refused; the three write functions are not executable by `anon`.
4. The snapshot-edit flag is off again after each function returns and after a failed call (a rolled-back transaction leaves no flag).
5. Register, link and fill: replay returns the stored result; 10 simultaneous identical requests give one product, one link per line, one fill per line; a stale expected version returns `version_conflict` with the current order.
6. Lines that already carry a price are identical before and after every fill (price, total, history).
7. The three reads return no purchase price or MRP; cross-business ids return nothing or a refusal.
8. With 1,000 waiting lines and 500 unpriced medicines the lists open within 2 seconds on the Supabase test project.
