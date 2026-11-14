# Data Model: Market List and Purchases

**Feature**: 005-market-list-purchases | **Migration**: `supabase/migrations/0006_market_list_purchases.sql` (applied after `0005`)

Nothing in `orders`, `order_lines`, `order_events`, `products`, `stores` or `pending_requests` changes shape. The migration adds two tables, two guard triggers, three indexes, two write functions, four read functions and their grants. Every table and function filters by the business read from the session (`public.current_business_id()`), like Modules 003 and 004.

## 1. Tables

### 1.1 `purchase_entries` (append-only)

One real purchase at the market.

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid, not null | Created by the client; it is also the request id (research D4). The primary key is `(business_id, id)`, so another business can never collide with or probe this id |
| `business_id` | uuid, not null, default `current_business_id()` | References `businesses`; part of every foreign key |
| `product_id` | uuid, not null | Composite foreign key `(business_id, product_id)` to `products (business_id, id)` |
| `unit` | text, not null | `char_length(btrim(unit))` between 1 and 50; stored cleaned (trimmed, repeated spaces collapsed) |
| `purchase_date` | date, not null | Pakistan calendar day; not after today (Pakistan), not before 2000-01-01 (checked in the function) |
| `quantity` | integer, not null | Check `between 1 and 100000` |
| `unit_cost` | numeric(12,2), null | Check `>= 0`; the actual cost per unit; null means "not recorded" (never 0 by default) |
| `supplier_name` | text, null | Check `char_length <= 200` |
| `reference` | text, null | Check `char_length <= 100` |
| `created_by` | uuid, default `auth.uid()` | Who recorded it |
| `created_at` | timestamptz, not null, default `now()` | When |

- Primary key `(business_id, id)`, which other tables reference with a composite key.
- Trigger `purchase_entries_append_only`: `UPDATE` and `DELETE` raise `purchase_entries_append_only`; only `service_role` may delete (tests and operations, never the app), like `pending_requests`.
- Index `purchase_entries_day_idx` on `(business_id, purchase_date, product_id)`.
- RLS on; policy `purchase_entries_select` for `authenticated` with `business_id = current_business_id()`; `revoke all ... from anon, authenticated` then `grant select ... to authenticated`. No insert, update or delete grant.

### 1.2 `purchase_voids` (append-only)

One cancellation of an entry. An entry is "cancelled" exactly when it has a void row.

| Column | Type | Rules |
|--------|------|-------|
| `entry_id` | uuid, not null | Composite foreign key `(business_id, entry_id)` to `purchase_entries (business_id, id)`; the primary key is `(business_id, entry_id)`, so there is one void per entry |
| `business_id` | uuid, not null, default `current_business_id()` | References `businesses` |
| `reason` | text, not null | `char_length(btrim(reason)) between 1 and 500` |
| `voided_by` | uuid, default `auth.uid()` | Who cancelled it |
| `voided_at` | timestamptz, not null, default `now()` | When |

- Trigger `purchase_voids_append_only` (same rule as above).
- RLS and grants as for `purchase_entries` (select only).

### 1.3 Indexes added to existing tables

- `orders_market_idx` on `orders (business_id, confirmed_at) where status in ('confirmed', 'fulfilled')` (the day's orders by range, research D2/D7).
- No new index on `order_lines` (`order_lines_order_idx` and `order_lines_product_idx` exist).

## 2. Computed values (never stored)

For a list date `D` (Pakistan day) and a row key (registered: `product_id` + normalized unit; typed: normalized typed text + normalized unit):

- `total_requested` = sum of `order_lines.quantity` of lines (not removed) of orders with `status in ('confirmed','fulfilled')` and `confirmed_at` inside `D`, for that key (all stores).
- `shown_requested` = the same, limited to the stores selected in the call (equal to `total_requested` when no store is selected).
- `purchased` = sum of `purchase_entries.quantity` for the same product, same unit (compared with `public.norm_text`, so case and repeated spaces are ignored), `purchase_date = D`, that have no row in `purchase_voids`. Always 0 for typed rows.
- `remaining` = `greatest(total_requested - purchased, 0)`; `extra` = `greatest(purchased - total_requested, 0)`.
- `status`: `not_bought` (purchased 0), `partly_bought` (0 < purchased < total_requested), `fully_bought` (purchased = total_requested), `bought_extra` (purchased > total_requested).
- Sum rule (SC-001): the sum of `total_requested` over all rows (registered and typed, no store filter) equals the sum of the quantities of the day's confirmed order lines.

## 3. Functions

All functions use `set search_path = public`. Business isolation: write functions are SECURITY DEFINER and filter every statement by `v_biz := current_business_id()`; read functions are SECURITY INVOKER (RLS also applies).

### 3.1 Write functions (SECURITY DEFINER)

**`purchase_record(p_id uuid, p_product uuid, p_unit text, p_date date, p_quantity int, p_unit_cost text, p_supplier text, p_reference text) returns jsonb`**

1. No business in the session: raise `no_business`.
2. Missing or malformed arguments: `{done:false, reason:'invalid_purchase', fields:{...}}` with a message per field (quantity whole number 1 to 100,000; unit 1 to 50 characters; cost `^[0-9]{1,10}(\.[0-9]{1,2})?$` when given; supplier up to 200; reference up to 100; date real, not in the future in Pakistan time, not before 2000-01-01).
3. Advisory lock `hashtext('purchase:' || p_id)`; look up `purchase_entries` by `(business, p_id)`.
4. Found: same product, unit (normalized), date, quantity, cost, supplier and reference means `{done:true, replayed:true, entry:{...}}`; different content means `{done:false, reason:'request_reused'}`.
5. Product must exist in this business (`product_not_found` otherwise; an inactive product is accepted because it may be on confirmed orders).
6. Insert one row; return `{done:true, replayed:false, entry:{...}}`. The entry JSON includes the cost, because the purchase screens may show it (never the list or print).

**`purchase_void(p_entry uuid, p_reason text) returns jsonb`**

1. Business check as above; reason required (trimmed, 1 to 500) else `{done:false, reason:'invalid_void', fields:{reason:'...'}}`.
2. Advisory lock `hashtext('purchase:' || p_entry)`; the entry must exist in this business (`not_found` otherwise, the same answer for another business's id).
3. If a void row exists: `{done:true, replayed:true, entry:{...}}` (the stored reason stays; a second call never changes it). Otherwise insert the void row and return `{done:true, replayed:false, entry:{...}}`.

Neither function reads or writes `orders`, `order_lines`, `order_events`, `products` or `pending_requests` (FR-015). They write only to the two new tables.

### 3.2 Read functions (SECURITY INVOKER, stable)

**`market_rows(p_date date) returns table(...)`** (internal): the shared definition above. Uses `AS MATERIALIZED` CTEs for the day's lines and the purchase sums (research D7). It selects only names, descriptive fields, quantities, units, store ids and names. **It never selects a purchase price, a selling price, an MRP or a unit cost.**

**`market_list(p_date date, p_q text, p_status text, p_stores uuid[]) returns jsonb`**

- `p_status` is `all`, `to_buy` (remaining > 0) or `bought` (purchased > 0).
- Returns `{date, generated_at, stores:[{id,name}], rows:[...], typed_rows:[...], totals:{requested, purchased, remaining, rows, typed_rows}, truncated}`.
- A registered row: `{key, product_id, name, strength, dosage_form, pack_size, manufacturer, unit, total_requested, shown_requested, purchased, remaining, extra, status, can_record: true, stores:[{store_id, store_name, quantity}]}`.
- A typed row: `{key, typed_name, unit, total_requested, shown_requested, purchased: 0, remaining: total_requested, extra: 0, status: 'not_bought', can_record: false, stores:[...]}`.
- Rows are ordered by name (typed rows after registered rows, by typed text). `p_stores` limits which rows appear (a row appears when at least one selected store ordered it) and which stores are listed.
- Cap of 2,000 rows; `truncated: true` when exceeded.

**`market_summary(p_date date) returns jsonb`**: `{date, rows_total, rows_to_buy, typed_rows, typed_to_buy}` from `market_rows`; `rows_to_buy` counts rows with `remaining > 0`, typed rows included.

**`purchase_entries_list(p_product uuid, p_unit text, p_date date) returns jsonb`**: the entries of a medicine and unit for a date, newest first, including cancelled ones: `{entries:[{id, quantity, unit_cost, supplier_name, reference, created_at, recorded_by_me, cancelled, void:{reason, voided_at, by_me}|null}], purchased, requested}`. Cost appears here because this is a purchase recording screen.

### 3.3 Grants

- `revoke all on function ... from public, anon` for all six public functions and for `market_rows`; `grant execute ... to authenticated` for all.
- `purchase_record` and `purchase_void` are the only write path.

## 4. Existing tables used (read only)

| Table | Used for |
|-------|----------|
| `orders` | status, `confirmed_at`, `store_id`, `order_number` |
| `order_lines` | `product_id`, `quantity`, `unit`, descriptive fields, typed `name` for typed lines, `removed_at` |
| `stores` | store names |
| `products` | name, strength, dosage form, pack size, manufacturer, unit, `is_active` (no price column is selected) |
| `businesses` | business name for the print header (`businesses.name`; phone and address in `business_settings` are not used here) |

## 5. State and history

- A purchase entry has no states; it is either active or has a void row.
- The history of a medicine's purchases is the list of its entries and voids (who, when, quantity, cost, reason). There is no order history entry for a purchase, because a purchase never changes an order (FR-015).
- Updating a medicine's purchase price after confirmation uses the existing product update (Module 001); it is not part of these tables.

## 6. Validation summary (also enforced in the browser forms for convenience, never only there)

| Field | Rule | Message example |
|-------|------|-----------------|
| quantity | whole number 1 to 100,000 | "Enter a whole number from 1 to 100,000." |
| unit cost | empty, or PKR with at most two decimals, 0 or more | "Enter an amount like 125 or 125.50, or leave it empty." |
| supplier / market | up to 200 characters | "Use at most 200 characters." |
| reference | up to 100 characters | "Use at most 100 characters." |
| purchase date | a real day, not in the future, not before 2000-01-01 | "Choose today or an earlier day." |
| cancel reason | 1 to 500 characters | "Write why this entry is cancelled." |
