# Data Model: Manual Orders and Store-wise Order History

**Branch**: `003-manual-orders` | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

One new migration, `supabase/migrations/0003_orders.sql`, wrapped in `begin; ... commit;`. It only adds objects (plus two unique constraints on existing tables); it changes no existing column and moves no data. Conventions kept from Modules 001 and 002: `business_id` on every table with a default of `current_business_id()`, Row Level Security from the start, `set_row_meta` for `version` and `updated_at`, money as `NUMERIC(12,2)`, no hard deletes.

## Changes to existing tables

| Table | Change | Why |
|-------|--------|-----|
| `stores` | `unique (business_id, id)` | Target of the composite foreign key from `orders`, so an order can only reference a store of its own business. |
| `products` | `unique (business_id, id)` | Same, for `order_lines.product_id`. |

## New tables

### `order_counters`

One row per business; the source of order numbers.

| Column | Type | Notes |
|--------|------|-------|
| `business_id` | uuid PK | references `businesses` (restrict) |
| `last_number` | integer not null default 0 | `check (last_number >= 0)` |

RLS enabled, **no policy and no grant**: only the `SECURITY DEFINER` functions touch it.

### `orders`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | generated on the device, **not** defaulted by the database |
| `business_id` | uuid not null | default `current_business_id()`, references `businesses` |
| `store_id` | uuid not null | composite FK `(business_id, store_id)` -> `stores (business_id, id)` |
| `order_number` | integer not null | `check (order_number > 0)`; `unique (business_id, order_number)` |
| `source` | text not null default `'manual'` | `check (source in ('manual','voice'))`; only `manual` is created here |
| `status` | text not null default `'draft'` | `check (status in ('draft','confirmed','cancelled','fulfilled'))`; functions never set `fulfilled` |
| `notes` | text | `check (notes is null or char_length(notes) <= 1000)` |
| `confirmed_at` | timestamptz | set at confirm |
| `cancelled_at` | timestamptz | set at cancel |
| `cancel_reason` | text | `check (cancel_reason is null or char_length(cancel_reason) <= 500)` |
| `last_request_id` | uuid | the `request_id` of the last successful change (idempotent replay) |
| `created_at` | timestamptz not null default now() | the "order date" (first save) |
| `updated_at` | timestamptz not null | maintained by `set_row_meta`; the "last saved" time |
| `version` | integer not null default 1 | `set_row_meta` bumps it on every update |

Constraints:

- `unique (business_id, id)` (target of the line and event foreign keys).
- `check (status <> 'confirmed' or confirmed_at is not null)`.
- `check (status <> 'cancelled' or cancelled_at is not null)`.
- `check (status <> 'cancelled' or confirmed_at is null or char_length(btrim(coalesce(cancel_reason, ''))) > 0)`: cancelling a confirmed order needs a reason (FR-031).
- Trigger `orders_row_meta` (existing `set_row_meta`): `id`, `business_id`, `created_at` immutable.
- Trigger `orders_guard` (before update): `order_number` and `source` are immutable; `store_id` may change only while the order is a draft AND has no active line (so a line can never sit under a store it was not entered for; this is the database side of FR-011); status may only move `draft -> confirmed`, `draft -> cancelled`, `confirmed -> cancelled` (any other change raises). This repeats in the database what the functions already enforce.

Indexes:

- `orders_business_created_idx (business_id, created_at desc, id desc)` (history list and day filters).
- `orders_business_store_created_idx (business_id, store_id, created_at desc)` (per-store history).
- `orders_business_status_created_idx (business_id, status, created_at desc)` (drafts, status filter).

State transitions:

```text
          order_save (first call)            order_confirm
 (none) ------------------------> draft ------------------------> confirmed
                                    |                                 |
                                    | order_cancel                    | order_cancel (reason required)
                                    v                                 v
                                 cancelled <----------------------- (confirmed)
 confirmed -- order_save --> confirmed   (edit in place; one `edited` event per save)
 cancelled and fulfilled: no further change here (a later module's migration extends orders_guard to allow confirmed -> fulfilled)
```

### `order_lines`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | generated on the device |
| `business_id` | uuid not null | default `current_business_id()` |
| `order_id` | uuid not null | composite FK `(business_id, order_id)` -> `orders (business_id, id)` |
| `position` | integer not null | `check (position >= 1)`; order of the active lines as sent by the client |
| `product_id` | uuid | null for a typed line; composite FK `(business_id, product_id)` -> `products (business_id, id)` |
| `item_status` | text not null | `check (item_status in ('registered','pending_registration'))` |
| `name` | text not null | `check (char_length(btrim(name)) between 1 and 200)`; for a typed line the exact typed text (spaces cleaned), never overwritten by a later link |
| `strength`, `dosage_form`, `pack_size`, `manufacturer` | text | same length limits as `products`; null for typed lines |
| `quantity` | integer not null | `check (quantity between 1 and 100000)` (ordered quantity) |
| `unit` | text not null | `check (char_length(btrim(unit)) between 1 and 50)` |
| `delivered_quantity` | integer | `check (delivered_quantity is null or delivered_quantity >= 1)`; set equal to `quantity` at confirm and kept equal on edits of a confirmed order; not editable by users in this module |
| `purchase_price_snapshot` | numeric(12,2) | `check (>= 0)`; null until confirm, and null for typed lines |
| `selling_price_snapshot` | numeric(12,2) | same |
| `mrp_snapshot` | numeric(12,2) | same |
| `snapshot_taken_at` | timestamptz | null while the order is a draft; set for every active line at confirm (typed lines too, with null prices) |
| `line_total` | numeric(18,2) generated always as `(quantity * selling_price_snapshot)::numeric(18,2)` stored | null when there is no selling price snapshot |
| `removed_at` | timestamptz | set when the supplier removes the line; reads ignore removed lines |
| `created_at`, `updated_at` | timestamptz not null default now() | maintained by a small touch trigger |

Constraints:

- `unique (business_id, id)`.
- `check ((product_id is null) = (item_status = 'pending_registration'))`: a typed line and a linked line can never be confused (this is the only change Module 004 makes to a typed line: set `product_id` and `item_status`, both allowed by this check).
- `check (snapshot_taken_at is not null or (purchase_price_snapshot is null and selling_price_snapshot is null and mrp_snapshot is null))`: no price without a snapshot time.
- Trigger `order_lines_guard` (before update): when `old.snapshot_taken_at is not null`, any change to `snapshot_taken_at`, the three snapshot prices, `name`, `strength`, `dosage_form`, `pack_size`, `manufacturer` raises `snapshot_immutable`, **unless** `current_setting('app.line_snapshot_edit', true) = 'on'`. Module 003 never sets that flag; it exists so that Module 004's Pending Prices and linking functions (which will set it with `set_config(..., true)` inside their own audited `SECURITY DEFINER` functions) need no schema change. Quantity, unit, `delivered_quantity`, `position` and `removed_at` may change.
- `order_id`, `business_id`, `created_at` immutable (same guard).

Indexes: `order_lines_order_idx (order_id, position) where removed_at is null`; `order_lines_product_idx (business_id, product_id) where product_id is not null` (later: product usage, linking).

No unique constraint on `(order_id, product_id)`: a second line of the same medicine is allowed only when the supplier explicitly chooses it; that is a screen rule (FR-007), not an integrity rule.

### `order_events`

Append-only change history.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK default `gen_random_uuid()` | |
| `business_id` | uuid not null | default `current_business_id()` |
| `order_id` | uuid not null | composite FK `(business_id, order_id)` -> `orders (business_id, id)` |
| `event_type` | text not null | `check (event_type in ('created','confirmed','edited','cancelled'))` |
| `order_version` | integer not null | the order version after the change |
| `actor` | uuid | `auth.uid()` of the caller |
| `detail` | jsonb not null default `'{}'` | see below |
| `created_at` | timestamptz not null default now() | |

`before update or delete` trigger raises `order_events_append_only`; the only exception is a DELETE by the `service_role` (used by tests to remove a test business and by operations, never by the app, which does not use that key; signed-in users have no write privileges on the table at all). Index `order_events_order_idx (order_id, created_at desc)`.

`detail` shapes (never contain purchase price or MRP):

```json
{ "created":   { "store_id": "...", "order_number": 12 } }
{ "confirmed": { "line_count": 4, "priced_lines": 3, "unpriced_lines": 1, "priced_total": "5200.00" } }
{ "cancelled": { "from_status": "confirmed", "reason": "Pharmacy cancelled by phone" } }
{ "edited": { "changes": [
    { "type": "quantity", "line_id": "...", "name": "Panadol 500mg", "from": 10, "to": 20 },
    { "type": "unit",     "line_id": "...", "name": "Panadol 500mg", "from": "Box", "to": "Strip" },
    { "type": "added",    "line_id": "...", "name": "Brufen 400mg", "quantity": 5, "unit": "Box", "selling_price": "310.00" },
    { "type": "removed",  "line_id": "...", "name": "Augmentin 625mg", "quantity": 2, "unit": "Box", "selling_price": "1450.00" },
    { "type": "notes",    "from": "", "to": "Deliver before noon" } ] } }
```

## Row Level Security and privileges

| Table | Policies | Grants to `authenticated` |
|-------|----------|---------------------------|
| `orders` | `select` where `business_id = current_business_id()` | `select` only |
| `order_lines` | same | `select` only |
| `order_events` | same | `select` only |
| `order_counters` | none (RLS on) | none |

Nothing is granted to `anon`. `rls_audit()` (existing) must report RLS on and a `business_id` column for all four new tables.

## Functions

All use `set search_path = public`, read the business from `current_business_id()`, filter every statement by it, and revoke execute from `public` and `anon`.

### `order_save(p_id uuid, p_request_id uuid, p_expected_version int, p_store_id uuid, p_notes text, p_lines jsonb) returns jsonb` (SECURITY DEFINER)

`p_lines`: array of `{ "id": uuid, "product_id": uuid|null, "name": text|null, "quantity": int, "unit": text }`, in screen order (at most 200). For a catalog line the server ignores `name` and copies the description from the medicine; for a typed line `name` is required.

Steps (one transaction):

1. `no_business` error when the caller has no business. Take `pg_advisory_xact_lock(hashtext('order:' || p_id))`.
2. Load the order `where id = p_id and business_id = v_biz for update`.
3. **Not found**:
   - if `p_expected_version is not null` return `{saved:false, reason:'not_found'}`;
   - the store must exist in the business and be active (`store_inactive` otherwise);
   - take the next number from `order_counters`; insert the order as `draft` with `last_request_id = p_request_id`; insert the lines; write a `created` event.
   - a primary-key clash with another business's id returns `{saved:false, reason:'unusable_id'}`.
4. **Found**:
   - `last_request_id = p_request_id`: return `{saved:true, replayed:true, order}` unchanged;
   - status `cancelled` or `fulfilled`: `{saved:false, reason:'order_not_editable', current}`;
   - `version <> p_expected_version` (or expected is null): `{saved:false, reason:'version_conflict', current}`;
   - `p_store_id` different from the stored store: allowed only for a `draft` with no active line, and the new store must be active; otherwise `{saved:false, reason:'store_locked', current}`;
   - validate lines (below); apply them: update known active lines (quantity, unit, name of typed lines, position), insert new lines, set `removed_at` on active lines missing from the list;
   - for a **draft**: new catalog lines get their description copied from the medicine now (no price);
   - for a **confirmed** order: new catalog lines get description and price snapshot now, with `snapshot_taken_at = now()` and `delivered_quantity = quantity`; kept lines get `delivered_quantity = quantity`; one `edited` event with the `changes` list is written (only when something changed);
   - update the order row once (`notes`, `last_request_id`, store for an empty draft) so `version` increases by one; an unchanged save still updates the row so the version and "last saved" move, but writes no event for drafts.
5. Return `{saved:true, replayed:false, order}`.

Line validation (`{saved:false, reason:'invalid_lines', detail:{...}}`): more than 200 lines; duplicate line ids; a line id that already belongs to another order or business; `product_id` not in the business; a **new** line for an inactive medicine; a typed line without a name; quantity outside 1..100000; empty unit. The function also trims and collapses repeated spaces in a typed line's name and trims the unit itself, because it can be called directly through the database API without the route handler's checks.

Implementation notes (recorded while writing migration 0003): the result of `order_save` also carries `created` (true only for the very first save, so the route can answer 201); extra failure reasons are `store_not_found` (the store id is unknown in this business) and `unusable_id` (the order id already belongs to another business); a line cannot change its medicine (remove it and add a new line), and the name of a typed line on a confirmed order cannot change (its description is frozen by the snapshot guard); `order_cancel` also returns `reason_too_long` for a reason over 500 characters. The route handlers map `store_not_found`, `store_inactive`, `invalid_lines`, `reason_required`, `reason_too_long` and `unusable_id` to 400 `validation_error` with field messages.

### `order_confirm(p_id uuid, p_request_id uuid, p_expected_version int) returns jsonb` (SECURITY DEFINER)

1. Advisory lock on the order id; load `for update`; not found -> `{confirmed:false, reason:'not_found'}`.
2. Already `confirmed` -> `{confirmed:true, replayed:true, order}` (covers a retry, a double tap, and a second tab; the original snapshot is returned, no second snapshot is taken).
3. `cancelled` or `fulfilled` -> `order_not_editable`.
4. `version <> p_expected_version` -> `version_conflict` with `current`.
5. No active line -> `{confirmed:false, reason:'order_empty'}`.
6. For every active line: catalog line -> copy `name, strength, dosage_form, pack_size, manufacturer` and `purchase_price, selling_price, mrp` from the medicine (null stays null), `snapshot_taken_at = now()`; typed line -> `snapshot_taken_at = now()` with null prices; `delivered_quantity = quantity`.
7. Set `status = 'confirmed'`, `confirmed_at = now()`, `last_request_id`; write the `confirmed` event; return `{confirmed:true, replayed:false, order}`.

### `order_cancel(p_id uuid, p_request_id uuid, p_expected_version int, p_reason text) returns jsonb` (SECURITY DEFINER)

Already `cancelled` -> replay (`cancelled:true, replayed:true`). `fulfilled` -> `order_not_editable`. Version mismatch -> `version_conflict`. A **confirmed** order needs a non-blank reason of at most 500 characters (`reason_required`); a draft's reason is optional. Sets `status`, `cancelled_at`, `cancel_reason`, `last_request_id`; writes the `cancelled` event. Lines and snapshots are untouched.

### `order_get(p_id uuid) returns jsonb` (SECURITY INVOKER, stable)

Returns `null` when the order is not visible. Otherwise:

```json
{
  "id": "...", "order_number": 12, "status": "confirmed", "source": "manual", "notes": "...",
  "version": 4, "created_at": "...", "updated_at": "...", "confirmed_at": "...", "cancelled_at": null, "cancel_reason": null,
  "store": { "id": "...", "name": "Al-Shifa Pharmacy", "is_active": true },
  "lines": [ {
      "id": "...", "position": 1, "product_id": "...|null", "item_status": "registered|pending_registration",
      "name": "...", "strength": "...|null", "dosage_form": "...|null", "pack_size": "...|null", "manufacturer": "...|null",
      "quantity": 10, "unit": "Box", "delivered_quantity": 10,
      "price_basis": "current|snapshot|none",
      "selling_price": "310.00|null", "line_total": "3100.00|null",
      "product_is_active": true } ],
  "totals": { "priced_total": "3100.00", "priced_lines": 1, "unpriced_lines": 1, "line_count": 2 },
  "events": [ { "id": "...", "event_type": "edited", "order_version": 4, "created_at": "...", "detail": { } } ]
}
```

`price_basis` is `snapshot` for lines with `snapshot_taken_at` (confirmed orders, and cancelled orders that had been confirmed), `current` ONLY while the order's status is `draft` and the line's medicine has a selling price (the live price), and `none` for typed lines, for medicines without a selling price, and for every line of a cancelled order that never had a snapshot (a discarded draft). A cancelled order therefore never shows live catalog prices (FR-035). `purchase_price_snapshot` and `mrp_snapshot` are **never** returned.

### `order_list(p_store uuid, p_status text, p_from date, p_to date, p_q text, p_limit int, p_offset int) returns jsonb` (SECURITY INVOKER, stable)

Returns an array of at most `p_limit + 1` summaries ordered `created_at desc, id desc`:
`{ id, order_number, status, source, created_at, updated_at, confirmed_at, version, store: {id, name}, line_count, priced_total, unpriced_lines }`.
Filters (all optional, combined with AND): `p_store`; `p_status` in draft/confirmed/cancelled; `p_from`/`p_to` inclusive local days in `Asia/Karachi` (converted to a half-open `created_at` range); `p_q` matched as an order number (the digits of `ORD-0012`, `#12` or `12`) or as tokens of the store name. Totals use the line's snapshot when it has one (confirmed orders and cancelled orders that had been confirmed), the current selling price only while the order is a draft, and no price at all for a cancelled order that never had a snapshot (a discarded draft: total empty, all lines counted as unpriced).

## Derived values

- **Priced total** = sum of `line_total` of active lines that have an effective selling price; **unpriced lines** = active lines without one. Money is returned as text.
- **Order number display** = `ORD-` + number padded to 4 digits (TypeScript only).
- **Draft line price** = the medicine's current selling price (never stored on a draft line), and only while the order status is `draft`.

## What Module 004 and later modules need (no schema change)

- Typed line -> registered: set `product_id` and `item_status` (check-compatible), keep `name`.
- Fill a missing selling price: a Module 004 function sets `app.line_snapshot_edit = 'on'` for the transaction, writes the snapshot, and records its own audit event.
- Invoicing (Module 006) totals from `selling_price_snapshot` and `delivered_quantity`; it will add its own lock on an invoiced order by changing the status or adding a column in its own migration.
- Voice (Module 008) creates orders with `source = 'voice'` through the same functions.
