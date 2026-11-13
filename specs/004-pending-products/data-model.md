# Data Model: Pending Products

**Branch**: `004-pending-products` | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

One additive migration, `supabase/migrations/0004_pending_products.sql`, applied after `0003_orders.sql`. Nothing in Modules 001 to 003 is removed or renamed. The file is safe to run more than once: columns, tables and indexes use `if not exists`, triggers use `drop trigger if exists` before `create trigger`, functions use `create or replace`, and the event-type check is replaced by catalog lookup. This matters because the file is re-applied to the test project every time it changes during implementation. Money is `NUMERIC(12,2)` and is returned to the application as text. Purchase price and MRP are never selected by any function in this module (FR-023).

## 1. Changes to existing tables

### `order_lines`: one new column and one new trigger

| Column | Type | Rules |
|---|---|---|
| `typed_name` | `text` | `check (typed_name is null or char_length(btrim(typed_name)) between 1 and 200)`. Null for lines that were never typed. Set once, when a typed line is linked, to the line's `name` at that moment (the exact typed text). |

- Trigger `order_lines_typed_name_once` (before update): if `old.typed_name is not null` and `new.typed_name is distinct from old.typed_name`, raise `typed_name_immutable` (errcode `22023`). This holds even when `app.line_snapshot_edit = 'on'`.
- Existing check `order_lines_status_matches_product` is unchanged: linking sets `product_id` and `item_status = 'registered'` together.
- Existing trigger `order_lines_guard` is unchanged. The new functions set `app.line_snapshot_edit = 'on'` (transaction-local) only around the statements that write the description columns and `selling_price_snapshot` of a line that already has `snapshot_taken_at`, and set it back to `off` straight after.

### `order_events`: two new event types

`check (event_type in ('created','confirmed','edited','cancelled','linked','price_filled'))`. The old constraint is found by catalog lookup (`pg_constraint` on `order_events` with `contype = 'c'` and a definition containing `event_type`) and dropped; the new one is named `order_events_event_type_check`. Existing rows are valid under the new check. The append-only trigger is unchanged.

Event `detail` shapes (no purchase price or MRP, ever):

```json
// linked  (one event per order per call; "lines" has one entry per linked line)
{ "linked": [ {
    "line_id": "uuid", "typed_name": "Noran 20mg cap",
    "product_id": "uuid", "product_name": "Noran 20mg cap",
    "how": "registered | existing | proposal",
    "price_recorded": "125.50"   // or null: no price on the line
} ] }

// price_filled  (one event per touched order)
{ "price_filled": [ {
    "line_id": "uuid", "product_id": "uuid",
    "quantity": 3, "previous_price": null, "new_price": "125.50"
} ] }
```

`order_version` on the event is the order's version after the change.

### `order_to_json` (replaced with `create or replace`)

Identical to 0003 except each line object gains `'typed_name', l.typed_name`. `order_get`, `order_list` and every caller are unchanged.

## 2. New table

### `pending_requests` (idempotency records)

| Column | Type | Rules |
|---|---|---|
| `business_id` | `uuid not null default current_business_id()` | references `businesses (id) on delete restrict` |
| `request_id` | `uuid not null` | client-generated |
| `kind` | `text not null` | `check (kind in ('register','link','price_apply'))` |
| `result` | `jsonb not null` | the response that was returned, without the `replayed` flag |
| `created_at` | `timestamptz not null default now()` | |

- `primary key (business_id, request_id)`.
- Row Level Security enabled; no policy and no grant for `anon` or `authenticated` (not even select): only the three write functions read and write it. A trigger refuses `update` always and `delete` unless `current_user = 'service_role'` (tests and operations), like `order_events`.

## 3. Indexes

```sql
create index order_lines_pending_typed_idx
  on order_lines (business_id, order_id) where product_id is null and removed_at is null;
create index order_lines_waiting_price_idx
  on order_lines (business_id, product_id, order_id)
  where product_id is not null and removed_at is null
    and snapshot_taken_at is not null and selling_price_snapshot is null;
create index products_unpriced_idx
  on products (business_id, lower(name)) where is_active and selling_price is null;
```

## 4. Definitions used by every function

- **Typed (pending) line**: `product_id is null and item_status = 'pending_registration' and removed_at is null`, on an order whose status is `draft` or `confirmed`.
- **Waiting-for-price line**: `product_id is not null and removed_at is null and snapshot_taken_at is not null and selling_price_snapshot is null`, on an order whose status is `confirmed`. (A draft line follows the medicine's current price; cancelled and fulfilled orders are never touched.)
- **Normalised text**: `public.norm_text(...)` from migration 0001 (lowercase, trimmed, collapsed whitespace).

## 5. Write functions (all `SECURITY DEFINER`, `set search_path = public`, `to authenticated` only)

Common behaviour, in this order: read `v_biz := current_business_id()` (null returns `{done:false, reason:'no_business'}`); look up `pending_requests` for `(v_biz, p_request_id)` and, if found, return its stored `result` with `replayed: true`; take the advisory locks (product first, then orders sorted by id, key `hashtext('order:'||id)` and `hashtext('product:'||id)`); **look up `pending_requests` again now that the locks are held** and, if the request was stored meanwhile by a simultaneous identical request, return that stored result with `replayed: true` (so every copy of a simultaneous request gets the same result, never a refusal such as `line_not_pending`); validate; change; write events; store the result; return. A refusal never writes `pending_requests` and never leaves the snapshot-edit flag on.

Every success returns `{ "done": true, "replayed": false|true, ... }`; every refusal returns `{ "done": false, "reason": "...", ... }`. Reasons are mapped to HTTP statuses and `ApiError` codes in the handlers.

### `pending_line_register(p_order uuid, p_line uuid, p_request_id uuid, p_expected_version int, p_product jsonb, p_confirm_similar boolean, p_apply_price boolean) returns jsonb`

`p_product` keys: `id` (client-generated uuid), `name`, `unit` (required), `brand`, `generic_name`, `strength`, `dosage_form`, `manufacturer`, `pack_size`, `sku`, `purchase_price`, `selling_price`, `mrp` (optional, strings or null).

Steps:

1. Order must exist in the business (`not_found`); status `draft` or `confirmed` (else `order_not_editable`, with the current order); `p_expected_version` equals the order's version (else `version_conflict`, with the current order).
2. The line must exist on that order, not removed (`line_not_found`) and be a typed line (else `line_not_pending`, with the current order, which covers a second tab that already linked it).
3. Validate `p_product` with the Module 001 limits: name 1 to 200, unit 1 to 50, brand 200, generic name 200, strength 100, dosage form 100, manufacturer 200, pack size 100, SKU 100, money non-negative with at most two decimals and at most `9999999999.99`. On failure return `invalid_product` with `fields` (field to message). Empty strings become null; nothing is defaulted or parsed out of the name.
4. `p_product.id` must be unused: if a product with that id exists in any business, return `unusable_id` (reveals nothing).
5. SKU conflict (`sku_conflict`, with the conflicting medicine), then exact identity (`duplicate_product`, with `matches`, inactive included), then same normalised name with another identity (`similar_products`, with `matches`, skipped when `p_confirm_similar`).
6. Insert the product (`is_active = true`).
7. Link the line (D4): `typed_name := name`, then `product_id`, `item_status = 'registered'`, `name/strength/dosage_form/pack_size/manufacturer` from the new product. If the order is `confirmed` the flag is on for this statement. If `p_apply_price` is true, the order is `confirmed`, the line has `snapshot_taken_at` and no selling price snapshot, and the product has a `selling_price`, the same statement also sets `selling_price_snapshot` to it; otherwise the price stays null and `price_applied` is false.
8. `update orders set updated_at = now()` (version bump).
9. Insert one `linked` event (`how = 'registered'`).
10. Store the result in `pending_requests` (`kind = 'register'`) and return `{done:true, replayed:false, product:{id,name,unit,strength,dosage_form,pack_size,manufacturer,selling_price}, price_applied:boolean, order:<order_to_json>}`.

Race handling: if step 6 hits `products_identity_uniq` or `products_sku_uniq` (another session created it between check and insert, possible only for a different request id because same-id requests are serialised by the lock), the function returns the same `duplicate_product` or `sku_conflict` reason; the whole transaction rolls back, so no line is half linked.

### `pending_line_link(p_order uuid, p_line uuid, p_request_id uuid, p_expected_version int, p_product_id uuid, p_apply_price boolean, p_how text default 'existing') returns jsonb`

Same steps 1, 2 and 7 to 10 as register, with: the product must exist in the business and be active (`product_not_found`, `product_inactive`); no product is created; `p_how` is `existing` or `proposal` (any other value is `existing`); the result is `{done:true, replayed, price_applied, order}`. The caller (the screen) shows the side-by-side confirmation; the function does not decide whether strengths match, because the supplier chooses explicitly (spec Story 2, scenario 4). It never links more than the one line.

### `pending_price_apply(p_product uuid, p_price text, p_request_id uuid, p_line_ids uuid[], p_fill_lines boolean) returns jsonb`

1. Parse `p_price` as `numeric(12,2)` from text without rounding (more than two decimals returns `invalid_price`); it must be `> 0` and `<= 9999999999.99` (else `invalid_price`).
2. The product must exist in the business and be active (`product_not_found`, `product_inactive`). If `selling_price` is not null and differs from `p_price`, return `price_differs` with the current price (an existing catalog price is never overwritten here).
3. Compute the waiting set for the product (section 4), ordered by order number, line position and line id, and limited to the first 1,000 lines (`batch limit`); lock those lines' orders in id order, recompute the same limited set under the locks. If `p_fill_lines` is true and the set of ids is not equal to `p_line_ids`, return `list_changed` with the current waiting lines and change nothing. If `p_fill_lines` is false, `p_line_ids` must be empty (`invalid_request` otherwise).
4. If the product's `selling_price` is null, set it to `p_price`.
5. If `p_fill_lines`: set `selling_price_snapshot = p_price` on exactly those lines with the flag on, adding `and selling_price_snapshot is null and snapshot_taken_at is not null` to the `update` itself; the count of updated rows must equal the set size, else raise and roll everything back.
6. Bump each touched order, insert one `price_filled` event per order, store the result (`kind = 'price_apply'`).
7. Return `{done:true, replayed, product:{id,name,selling_price}, filled:[{order_id, order_number, line_id, quantity, line_total}], filled_count, orders_touched}`.

## 6. Read functions (all `SECURITY INVOKER`, `stable`, so Row Level Security applies)

| Function | Returns |
|---|---|
| `pending_summary()` | `{typed_lines, typed_groups, price_items, price_items_with_waiting_lines, lines_waiting}` as integers. `typed_groups` equals the number of groups `pending_typed_groups` returns (without a search or limit). `price_items` equals the number of items `pending_prices_list` returns with no search and `p_only_waiting = false` (active medicines without a selling price, plus priced medicines that still have waiting lines); `price_items_with_waiting_lines` is how many of those items have at least one waiting line, so it is always a subset of `price_items`; `lines_waiting` is the number of waiting lines. Both lists and the summary share one set of definitions (section 4) so the Home counts always equal the list lengths |
| `pending_typed_groups(p_q text, p_limit int, p_offset int)` | `{items:[{typed_text, line_count, lines:[{line_id, order_id, order_number, order_status, store_id, store_name, quantity, unit}]}], next_offset}`; grouped by `norm_text(name)`; the group shows the first typed spelling |
| `pending_prices_list(p_q text, p_only_waiting boolean, p_limit int, p_offset int)` | `{items:[{product_id, name, strength, dosage_form, pack_size, manufacturer, unit, selling_price, lines_waiting, orders_waiting}], next_offset}`: active medicines with no selling price, plus priced medicines that still have waiting lines; ordered by `lines_waiting desc, lower(name)`; a priced medicine with waiting lines is returned with its `selling_price` so the screen shows it read-only and offers "Fill the waiting lines at PKR X" (same preview and apply with `p_price` equal to that price) |
| `pending_price_preview(p_product uuid, p_price text)` | `{product:{id,name,selling_price}, price:text, lines:[{line_id, order_id, order_number, store_name, quantity, line_total}], untouched_priced_lines:int, total_waiting:int, batch_limit:1000}`; `lines` are the waiting lines that would be filled (at most the first 1,000 by order number, line position and line id); `total_waiting` is how many wait in all, so the screen can say how many remain after this batch; `line_total = quantity * price` computed in SQL |
| `pending_candidates(p_product uuid)` | `{proposed:[{line_id, order_id, order_number, order_status, store_name, typed_text, quantity, unit}], not_proposed:[same fields]}` using the match rule of research D8; at most 200 per group |

All search text goes through the same escaping helper as `listProducts` (`escapeLike`); the functions take it as a plain parameter and use `ilike` on `norm_text`, never string concatenation into SQL.

## 7. Row Level Security and privileges

- `pending_requests`: RLS on, no policy, `revoke all` from `anon` and `authenticated`.
- `order_lines`, `order_events`, `orders`, `products`: policies and grants unchanged (select-only for the order tables).
- Write functions: `revoke all on function ... from public, anon`; `grant execute ... to authenticated`. Read functions the same.
- The snapshot-edit flag is set with `set_config('app.line_snapshot_edit', 'on', true)` and reset with `set_config('app.line_snapshot_edit', 'off', true)`; a PGlite test proves the flag is not left on after success, refusal or error.

## 8. TypeScript types and validation (application side)

- `OrderLine` gains `typed_name: string | null`; `OrderEventType` gains `'linked' | 'price_filled'`.
- `src/lib/validation/pending.ts`: Zod schemas for the register body (`request_id`, `expected_version`, `product` reusing `ProductCreateSchema` fields minus `confirm_similar`, `confirm_similar`, `apply_price`), the link body, the price apply body (`request_id`, `price` string, `line_ids` uuid array up to 1,000, `fill_lines`) and the list queries.
- `ApiError` codes added: `line_not_pending`, `line_not_found`, `list_changed`, `price_differs`, `invalid_price`; existing codes reused: `duplicate_product`, `similar_products`, `sku_conflict`, `version_conflict`, `order_not_editable`, `validation_error`, `not_found`.

## 9. Rollback

The migration is additive. Rolling back (a development or test environment only) means dropping, in this order: the eight new functions (three write, five read), `pending_requests`, the three indexes, the `typed_name` column and its trigger, restoring the old `order_events` check, and restoring the 0003 `order_to_json`. This is only safe while no `linked` or `price_filled` event exists and no line has a `typed_name`; otherwise the history would lose rows, so production rollback is a new forward migration instead.

## 10. What later modules need (no schema change)

- The market list (Module 005) groups lines by `product_id` and puts lines with `product_id is null` under "Not yet registered"; linked lines move into the normal grouping automatically.
- Invoice issue (Module 006) refuses lines where `selling_price_snapshot is null`; this module makes lines ready by filling it, with a recorded history.
- A future "undo link" would add an event type and a function; no column of this module blocks it (`typed_name` is write-once, so an undo would restore `name` from it).
