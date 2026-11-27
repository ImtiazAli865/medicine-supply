# Data model: Store-specific selling prices (Module 012)

Migration `supabase/migrations/0012_store_rates.sql` (additive; no existing row changes).

## New table `store_rates`

| Column | Type | Rule |
|--------|------|------|
| business_id | uuid | default `current_business_id()`, FK businesses |
| store_id | uuid | FK `(business_id, store_id)` to stores |
| product_id | uuid | FK `(business_id, product_id)` to products |
| rate | numeric(12,2) | above 0 |
| catalog_price_at_set | numeric(12,2) | null when the product had no price |
| version | integer | starts at 1, moves on every change |
| removed_at | timestamptz | a removed rate stays as a row; setting it again revives it |
| updated_at | timestamptz | |

Primary key `(business_id, store_id, product_id)`. RLS: select own business only; no insert, update or delete grant. Written only by `security definer` functions.

## New table `store_rate_events` (append-only)

`id`, `business_id`, `store_id`, `product_id`, `event_type` (`set`, `changed`, `removed`), `old_rate`, `new_rate`, `catalog_price`, `order_id` (null when changed on the store page), `actor`, `created_at`. A trigger refuses update and delete except delete by the service role (test clean-up), as for `order_events`. RLS as above.

## Changes to `order_lines`

| Column | Type | Rule |
|--------|------|------|
| chosen_price | numeric(12,2) | null or above 0; the price typed for this order |
| price_source | text | null, `typed`, `store_rate`, `catalog`; set together with the snapshot |

Existing rows keep both null (shown as before). `order_lines_guard` is replaced so neither column can change once `snapshot_taken_at` is set (except through the Pending flows' existing switch, which also sets `price_source`).

## Effective price (draft line)

1. `chosen_price`
2. rate of (order's store, line's product) when not removed, the product is active and the line unit equals the product unit
3. product `selling_price`
4. none

A line with a snapshot shows the snapshot, whatever the rules above say.

## State of a rate

none -> set (version 1) -> changed (version + 1) -> removed -> set again (version + 1)

## Functions

New: `order_line_effective_price`, `store_rates_list(store)`, `store_rates_all(limit, cursor)` (for the phone copy), `store_rate_set(store, product, rate, expected_version)`, `store_rate_remove(store, product, expected_version)`.

Replaced: `order_to_json`, `order_list`, `order_save`, `order_confirm` (new `p_expected_prices` default null), `pending_link_line`, `pending_price_preview`, `pending_price_apply` (new expected price per line), `order_lines_guard`. The old signatures of `order_confirm` and `pending_price_apply` are dropped first (no overloads) and grants are repeated.

Unchanged: invoices, ledger, market list, order sheets, reports.

## Device (schema version 3)

`storeRates`: key `storeId:productId`; `storeId`, `productId`, `rate`, `version`, `catalogPriceAtSet`. Draft line input gains optional `price`, `remember`, `rateVersion`. No purchase price, MRP or cost.

## Rollback

Drop `store_rate_events`, `store_rates`, the two `order_lines` columns and restore the replaced functions (with their old signatures and grants) and the line guard from 0003, 0004 and 0005. Confirmed orders and invoices keep their snapshots either way.
