# Data Model: Reports and Profit (Module 010)

**No new table and no new column.** Reports are computed on every read from existing records. Nothing here is stored, so nothing here can go stale or be edited. The only schema change is migration `0011_reports.sql`: read-only functions, one partial index and grants.

## Records read (all existing, all behind Row Level Security)

| Table | Columns used | Module |
|-------|--------------|--------|
| `invoices` | `id`, `business_id`, `order_id`, `store_id`, `status`, `invoice_date`, `created_at`, `grand_total`, `in_account` | 006, 007 |
| `invoice_lines` | `invoice_id`, `order_line_id`, `product_id`, `name`, `strength`, `dosage_form`, `pack_size`, `manufacturer`, `unit`, `delivered_quantity`, `selling_price`, `line_total` | 006 |
| `order_lines` | `id`, `purchase_price_snapshot` | 003 |
| `orders` | `id`, `confirmed_at` (market date, Pakistan time) | 003 |
| `products` | `id`, `name`, `strength`, `dosage_form`, `pack_size`, `manufacturer` (identity text for rows) | 001 |
| `stores` | `id`, `name` | 001 |
| `purchase_entries`, `purchase_voids` | `product_id`, `unit`, `purchase_date`, `quantity`, `unit_cost`, void rows | 005 |
| `ledger_entries` (through `ledger_stores`, `ledger_summary`) | balances | 007 |

## Database objects added by 0011

| Object | Kind | Purpose |
|--------|------|---------|
| `invoices_report_idx` on `invoices (business_id, invoice_date) where status in ('issued','cancelled')` | index | Period reads of issued and cancelled invoices |
| `report_sales_lines(p_biz, p_from, p_to)` | function (table) | The one base set of billed lines with both cost figures (D2, D3) |
| `report_sales(p_from, p_to, p_group)` | function (jsonb) | Sales summary and both profit figures, with the series |
| `report_purchases(p_from, p_to, p_group)` | function (jsonb) | Purchase summary and series |
| `report_by_store(p_from, p_to, p_q, p_sort, p_limit, p_offset)` | function (jsonb) | Sales by store |
| `report_by_medicine(p_from, p_to, p_q, p_sort, p_limit, p_offset)` | function (jsonb) | Sales by medicine plus the "Not registered" group |
| `report_cost_missing(p_from, p_to)` | function (jsonb) | Medicines whose sales have no cost for a figure |
| `report_not_in_account()` | function (jsonb) | Count and total of issued invoices with `in_account = false`, for the balances note |

There are seven report functions plus five helpers: `report_check_period(p_from, p_to, p_group)`, which every function calls first to refuse a bad period or group, the two pure text helpers `report_money` (two decimals, rounded once) and `report_figure` (one profit figure as JSON), and `report_bucket_start` and `report_bucket_end` (the day, Monday week or month that holds a day). `p_limit` is at most 5,001 (the screens ask for 20; the CSV asks for 5,001 so it can tell when there are more than 5,000 rows). `p_sort` is `sales` (default), `profit` (the **realized** profit, rows whose realized profit is null come last) or `name`. All are `SECURITY INVOKER`, `STABLE`, `set search_path = public`, filter by `current_business_id()`, `revoke all from public, anon`, `grant execute to authenticated`. A refusal is `raise exception 'invalid_period'` (SQLSTATE 22023) for a bad period, group or sort, and `no_business` (P0001) with no business, translated by the route to the existing error shapes.

## Derived concepts (never stored)

### Sales line (output of `report_sales_lines`)

| Field | Meaning |
|-------|---------|
| `invoice_id`, `invoice_date`, `store_id` | The issued invoice the line belongs to |
| `product_id` or null, `name`, `strength`, `dosage_form`, `pack_size`, `manufacturer`, `unit`, `unit_key` | Identity as frozen on the invoice line; `unit_key = norm_text(unit)` |
| `billed_qty` | `delivered_quantity` (always above 0 here; zero lines are left out) |
| `line_total` | `delivered_quantity × selling_price`, two decimals (the invoice line's own value) |
| `market_date` | `(orders.confirmed_at at time zone 'Asia/Karachi')::date` of the invoice's order |
| `est_unit_cost` | `order_lines.purchase_price_snapshot` or null |
| `real_unit_cost` | Weighted average of the non-cancelled purchase entries with a cost for the same product, `unit_key` and `market_date`, or null; unrounded |
| `est_cost`, `real_cost` | `billed_qty × unit cost`, unrounded, or null |
| `est_missing`, `real_missing` | True when the matching cost is null |

### Profit figure (inside `report_sales`)

For each of `estimated` and `realized`:

| Field | Meaning |
|-------|---------|
| `cost` | Sum of line costs over lines that have a cost (rounded once) |
| `covered_sales` | Sum of `line_total` of those lines |
| `profit` | `covered_sales − cost` (rounded once); computed only over covered lines |
| `missing_lines`, `missing_sales` | Count and `line_total` sum of lines with no cost for this figure |
| `status` | `complete` when `missing_lines = 0`, otherwise `incomplete`; the estimate is always labelled Estimate on screen, the realized one "Realized" |

When `covered_sales = 0` the profit is `null` (not zero): "not available".

### Series bucket

`bucket_start`, `bucket_end` (dates), `partial`, `sales`, `invoices`, and the same estimated and realized fields per bucket. Only buckets with data exist. The row text ("Mon 23 Nov", "Week of 3 Nov (from 5 Nov)") is written by the screen from these dates (`bucketLabel` in `src/lib/reports/period.ts`), not by the database.

### Totals and exclusions

`totals`: `sales`, `invoices`, `lines`, `quantity`. `excluded`: `cancelled_invoices`, `draft_invoices`. `period`: `from`, `to`, `group`, `generated_at`.

### Purchase summary (inside `report_purchases`)

`totals`: `cost` (sum of `quantity × unit_cost` over entries with a cost), `entries`, `entries_with_cost`, `entries_without_cost`, `quantity_without_cost`, `cancelled_entries_left_out`. `status` is `incomplete` when `entries_without_cost > 0`. Series by `purchase_date` bucket with the same fields.

### Store row and medicine row

- Store row: `store_id`, `name`, `sales`, `invoices`, `estimated` and `realized` figures (as above), `share` (text, percent of the period's sales, one decimal, computed on the server from exact values).
- Medicine row: `key` (`product_id:unit_key` or `typed:<text>:<unit_key>`), `product_id` or null, `name`, `typed_name` (for the group), identity fields, `unit`, `billed_quantity`, `sales`, `estimated`, `realized`.
- Both lists carry `totals` for the **whole period** and for the **filtered rows** (`filtered_totals`), `total` (row count) and `truncated`. The "Not registered" group is its own section (`typed_rows`).

### Cost-missing row

`product_id` or null, `name` and identity fields, `unit`, `sales_amount`, `billed_quantity`, `lines`, `estimate_missing` (bool), `realized_missing` (bool), `realized_dates` (up to 10 market dates, ascending, that have no purchase cost), `reason` (`no_purchase_price_saved`, `no_purchase_on_market_day`, `typed_line`, or `unit_differs` when the medicine has a costed purchase that day only in another unit).

### Balance row (existing)

As returned by `ledger_stores` (`store_id`, `name`, `balance`, `owes`, `advance`, `entry_count`, `last_entry_date`) and `ledger_summary`. The report adds only the `report_not_in_account()` note.

## Rules that the tests pin

1. Sales of a period = sum of `grand_total` of issued invoices with `invoice_date` in the period = sum of the line totals of `report_sales_lines`.
2. A cancelled invoice, a draft invoice, a draft or cancelled order and a zero-quantity line never add to sales, cost, profit or "missing".
3. Day, week and month series, the store rows and the medicine rows (with "Not registered") each add up to the same `sales`.
4. `real_unit_cost` uses only entries of the market date, in the same unit, not cancelled, with a cost; changing or adding a purchase on another day changes nothing for that line.
5. A line never counts in `realized` without an actual cost and never counts in `estimated` without a snapshot; neither cost is ever invented from another medicine or another day.
6. The 50/55 then 58/65 example gives line profits of 5 and 7 per unit, and the earlier day's profit does not change when the later purchase is recorded.
7. Every function returns nothing for another business, also when called with another business id.
8. No function writes anything (a read-only transaction test), and none is granted to `anon`.
