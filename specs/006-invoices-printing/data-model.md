# Data Model: Invoices and Printing

**Feature**: 006-invoices-printing | **Migration**: `supabase/migrations/0007_invoices.sql` (applied after `0006`)

The migration adds four tables, four guard triggers, indexes, six write functions, ten read functions (three of them internal helpers) and their grants, and makes three small changes to Module 003 objects (an order status guard, an order event kind check and the delivered quantity check). Every table and function filters by the business read from the session (`public.current_business_id()`), like Modules 003 to 005. **No invoice table has any purchase price, MRP or cost column** (research D4).

## 1. Tables

### 1.1 `invoices`

One bill for one confirmed order of one store.

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid, not null | Created by the client; it is also the request id (research D3). Primary key `(business_id, id)` |
| `business_id` | uuid, not null, default `current_business_id()` | References `businesses`; part of every foreign key |
| `order_id` | uuid, not null | Composite foreign key `(business_id, order_id)` to `orders (business_id, id)` |
| `store_id` | uuid, not null | Composite foreign key `(business_id, store_id)` to `stores (business_id, id)`; always equal to the order's store |
| `status` | text, not null, default `draft` | Check in `('draft','issued','cancelled')` (constitution Principle II) |
| `invoice_number` | integer, null | Null for a draft; set at issue; `>= 1`; `unique (business_id, invoice_number)` |
| `invoice_date` | date, null | The Pakistan calendar day of issue; null for a draft |
| `issued_at`, `issued_by` | timestamptz / uuid, null | Set at issue (`issued_by` default from `auth.uid()`) |
| `cancelled_at`, `cancelled_by`, `cancel_reason` | timestamptz / uuid / text, null | Set at cancellation; the reason has `char_length(btrim(...)) between 1 and 500` |
| `grand_total` | numeric(18,2), not null, default 0 | Check `>= 0`; the sum of the line totals, kept by the functions; recomputed from the lines at issue |
| `source_fingerprint` | text, not null | The order-lines fingerprint taken when the lines were last built (research D5) |
| `business_name`, `business_phone`, `business_address` | text, null | Copied at issue (from `businesses` and `business_settings`) |
| `store_name`, `store_contact`, `store_phone`, `store_address` | text, null | Copied at issue from `stores` |
| `created_by`, `created_at`, `updated_at` | uuid / timestamptz | Who and when |
| `version` | integer, not null, default 1 | Bumped by every change; used for the stale-screen check |

Table constraints:

- `invoices_draft_shape`: when `status = 'draft'`, `invoice_number`, `invoice_date`, `issued_at`, the cancellation columns and the snapshot columns are all null.
- `invoices_issued_shape`: when `status in ('issued','cancelled')`, `invoice_number`, `invoice_date`, `issued_at`, `business_name` and `store_name` are not null.
- `invoices_cancelled_shape`: `status = 'cancelled'` needs `cancelled_at` and a reason; any other status needs both null.
- Partial unique index `invoices_order_live_idx` on `(business_id, order_id) where status in ('draft','issued')`: **at most one live invoice per order** (research D2).
- `invoices_list_idx` on `(business_id, created_at desc, id desc)`; `invoices_store_idx` on `(business_id, store_id, created_at desc)`.
- Trigger `invoices_guard` (before update) and `invoices_no_delete` (before delete): see section 3.
- RLS on; policy `invoices_select` for `authenticated` with `business_id = current_business_id()`; `revoke all ... from anon, authenticated` then `grant select ... to authenticated`.

### 1.2 `invoice_lines`

One medicine on an invoice. Rows exist only for a draft or as the frozen lines of an issued or cancelled invoice.

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid, not null, default `gen_random_uuid()` | Primary key `(business_id, id)` |
| `business_id` | uuid, not null, default `current_business_id()` | References `businesses` |
| `invoice_id` | uuid, not null | Composite foreign key `(business_id, invoice_id)` to `invoices (business_id, id)` |
| `position` | integer, not null | `>= 1`; `unique (invoice_id, position)`; follows the order's line order |
| `order_line_id` | uuid, null | Composite foreign key `(business_id, order_line_id)` to `order_lines (business_id, id)` |
| `product_id` | uuid, null | Composite foreign key `(business_id, product_id)` to `products (business_id, id)`; null for a typed line |
| `name` | text, not null | Description exactly as on the order line (typed text for a typed line) |
| `strength`, `dosage_form`, `pack_size`, `manufacturer` | text, null | As on the order line |
| `unit` | text, not null | As on the order line |
| `ordered_quantity` | integer, not null | `between 1 and 100000`; copied, never changed |
| `delivered_quantity` | integer, not null | `between 0 and 100000`; the billed quantity; changeable only while the invoice is a draft |
| `selling_price` | numeric(12,2), null | `>= 0`; the order line's selling price snapshot; null means "no verified price" |
| `line_total` | numeric(18,2), generated | `delivered_quantity * selling_price`, null when `selling_price` is null |
| `created_at` | timestamptz, not null | |

- Trigger `invoice_lines_guard` (before insert, update, delete): see section 3.
- A line with `delivered_quantity = 0` is kept (frozen with the rest) but is never shown on the issued invoice screen or print and is not billed.
- Index `invoice_lines_invoice_idx` on `(invoice_id, position)`.
- RLS on; select-only policy and grant as above.

### 1.3 `invoice_counters`

One row per business, the source of invoice numbers (research D8).

| Column | Type | Rules |
|--------|------|-------|
| `business_id` | uuid, primary key | References `businesses` |
| `last_number` | integer, not null, default 0 | `>= 0`; updated only inside `invoice_issue`, in the same transaction as the issue |

RLS on with **no policy and no grant** for `authenticated` (like `order_counters`); only the function reads or writes it.

### 1.4 `invoice_events` (append-only history)

| Column | Type | Rules |
|--------|------|-------|
| `id` | uuid, primary key, default `gen_random_uuid()` | |
| `business_id` | uuid, not null, default `current_business_id()` | References `businesses` |
| `invoice_id` | uuid, not null | **No foreign key** (a discarded draft is deleted, its history stays; research D13) |
| `order_id` | uuid, not null | For the order's invoice history |
| `event_type` | text, not null | Check in `('created','edited','refreshed','issued','cancelled','discarded')` |
| `invoice_version` | integer, not null | |
| `actor` | uuid, default `auth.uid()` | |
| `detail` | jsonb, not null, default `{}` | What changed (quantities old and new, number, reason, totals) |
| `created_at` | timestamptz, not null, default `now()` | |

- Trigger `invoice_events_append_only`: update and delete raise an error; only `service_role` may delete (tests and operations).
- Index `invoice_events_invoice_idx` on `(business_id, invoice_id, created_at desc)` and `invoice_events_order_idx` on `(business_id, order_id, created_at desc)`.
- RLS on; select-only policy and grant.

## 2. Changes to Module 003 objects (all inside the same migration)

| Object | Change | Why |
|--------|--------|-----|
| `orders_guard` (trigger function) | Allow `confirmed -> fulfilled` and `fulfilled -> confirmed`, nothing else new | Issue and cancel move the order (D11) |
| `order_events_event_type_check` | Add `invoiced` and `invoice_cancelled` (replace the check the way migration 0004 did) | The order history records the invoice (D9, D10) |
| `order_lines.delivered_quantity` check | `>= 0` instead of `>= 1` | A line may be billed as 0 (D6) |
| `order_to_json` / `order_get` | Not changed | The events already come out as they are stored; the UI gets the new wording (`OrderHistoryLog`) |

No order, order line or product function is replaced. `order_save`, `order_confirm` and `order_cancel` already refuse a fulfilled order.

## 3. Guards (the immutability rules, research D12)

- **`invoices_guard` (before update)**
  - `id`, `business_id`, `order_id`, `store_id` and `created_at` never change.
  - Old status `draft`: any column may change except the ones above; `draft -> issued` must set `invoice_number`, `invoice_date`, `issued_at` and the snapshot columns together (the table shape checks enforce it); `draft -> cancelled` is refused.
  - Old status `issued`: only `issued -> cancelled` is allowed, and only `status`, `cancelled_at`, `cancelled_by`, `cancel_reason`, `updated_at` and `version` may differ; every other column (number, date, totals, snapshot) must be identical.
  - Old status `cancelled`: no change at all.
- **`invoices_no_delete`**: refuses a delete unless the old status is `draft`.
- **`invoice_lines_guard`**: for insert, update and delete, the parent invoice must exist and have status `draft`; otherwise it raises `invoice_immutable`.
- **`invoice_events_append_only`**: see 1.4.

## 4. Computed values (never typed)

- `line_total` is generated; `grand_total` is the sum of `line_total` of the lines with `delivered_quantity > 0`, computed in SQL.
- `billed` (per line) = `delivered_quantity > 0`.
- `needs_price` (per line) = `billed` and (`product_id is null` or `selling_price is null`). A typed line has `product_id` null.
- `blockers` of an invoice = the lines with `needs_price`; `nothing_to_bill` = no line is billed.
- `ready_to_issue` = status `draft`, order status `confirmed`, not stale, no blockers, not `nothing_to_bill`.
- `stale` = status `draft` and `source_fingerprint` is different from `order_lines_fingerprint(business, order)` now.
- `number_label` = `INV-` plus the number left-padded with zeros to six digits.
- `more_than_ordered` (per line) = `delivered_quantity > ordered_quantity`.

## 5. Functions

Every function is created in `public`, with `set search_path = public`, `revoke all ... from public, anon` and `grant execute ... to authenticated`. Writes are `security definer`; reads are `security invoker` (Row Level Security applies). The internal helpers are `security invoker` too (like `order_to_json` of Module 003), so calling one directly with another business's id returns nothing; a test does exactly that.

### 5.1 Writes (security definer)

| Function | Does | Refusal reasons (result `done: false, reason`) |
|----------|------|-----------------------------------------------|
| `invoice_create(p_id uuid, p_order_id uuid)` | Creates the draft from the confirmed order's active lines (copying only permitted facts, the delivered quantity from the order line), takes the fingerprint, writes the event `created`. Returns `created`, `replayed` or `existing` with the invoice | `not_found` (order of another business or missing), `order_not_confirmed`, `order_empty`, `request_reused` |
| `invoice_set_quantities(p_id uuid, p_expected_version int, p_lines jsonb)` | Draft only. `p_lines` is a list of `{line_id, delivered_quantity}`; validates 0 to 100,000; recomputes `grand_total`; event `edited` with old and new | `not_found`, `invoice_not_draft`, `version_conflict`, `invalid_quantity` (with the line) |
| `invoice_refresh(p_id uuid, p_expected_version int)` | Draft only, order must be confirmed. Rebuilds the lines from the order, resets delivered to the order lines' delivered quantities, new fingerprint, event `refreshed` | `not_found`, `invoice_not_draft`, `version_conflict`, `order_not_confirmed` |
| `invoice_discard(p_id uuid, p_expected_version int)` | Draft only. Deletes the lines and the draft, keeps the event `discarded` | `not_found`, `invoice_not_draft`, `version_conflict` |
| `invoice_issue(p_id uuid, p_expected_version int)` | Research D9: the checks, the number, the snapshot, the write-back to the order lines, the order becomes `fulfilled`, the events. A repeat returns the issued invoice with `replayed` | `not_found`, `version_conflict`, `invoice_not_draft`, `order_not_confirmed`, `order_changed`, `nothing_to_bill`, `not_ready` (with `blockers`) |
| `invoice_cancel(p_id uuid, p_reason text)` | Research D10: issued only, reason required, the order back to `confirmed`, the delivered quantities back to the ordered ones, events. A repeat returns the first cancellation | `not_found`, `invoice_not_issued`, `reason_required`, `reason_too_long` |

A successful write returns `{ done: true, ... , invoice: <invoice json> }`.

### 5.2 Reads (security invoker)

| Function | Returns |
|----------|---------|
| `invoice_get(p_id uuid)` | The invoice json of section 6 with `stale`, `blockers`, `ready_to_issue`, and the events; `found: false` for a missing or foreign id |
| `invoice_list(p_status text, p_store uuid, p_from date, p_to date, p_order uuid, p_q text, p_limit int, p_offset int)` | A page of invoice summaries (id, number or null, status, store, order number, dates, grand total) newest first, plus the total count; the search matches the invoice number and the store name, with the special characters escaped (the `pending_like_escape` helper); the date range filters by `invoice_date` for issued and cancelled invoices and by the Pakistan creation day for drafts |
| `invoice_todo(p_q text, p_limit int, p_offset int)` | The orders still to invoice (section 4 of research D14) with the store, order number, confirmed time, line count, the number of lines without a verified price and the draft's id if one exists |
| `invoice_summary()` | `{ to_invoice, drafts, issued_today }`; `to_invoice` counts the rows of the same internal function that `invoice_todo` reads |
| `invoice_todo_rows()` (internal) | The single definition of "to invoice" |
| `order_lines_fingerprint(p_biz uuid, p_order uuid)` (internal, immutable per call) | The md5 text of D5 |
| `invoice_json(p_biz uuid, p_id uuid, p_with_events boolean)` (internal) | The invoice json of section 6, used by `invoice_get` and by every write function for its result; selects only permitted columns |
| `order_sheet(p_order_ids uuid[])` | For option A and B: per order the store header, order number and date, and the active lines (name, strength, dosage form, pack size, manufacturer, quantity, unit, `unregistered`) |
| `order_sheet_day(p_date date, p_stores uuid[])` | The same shape for the confirmed (or fulfilled) orders of a Pakistan day, one section per order and store |
| `invoice_orders_summary(p_order uuid)` | The order's invoices (id, number or null, status, date, grand total) for the "View invoice" link and the invoice history of an order |

`invoice_list` is capped at a page of 50 rows (the paging of `order_list`); no read function selects a cost, price of purchase or MRP column of any table.

## 6. Invoice json (what `invoice_get` returns)

```text
{
  found: true,
  id, order_id, order_number, order_status, status, invoice_number, number_label, invoice_date,
  issued_at, issued_by_me, cancelled_at, cancel_reason, version,
  stale, ready_to_issue, nothing_to_bill, blockers: [{ line_id, name, reason }],
  grand_total,
  business: { name, phone, address },            // snapshot when issued, live for a draft
  store:    { id, name, contact_person, phone, address },
  lines: [{ id, position, name, strength, dosage_form, pack_size, manufacturer, unit,
            ordered_quantity, delivered_quantity, selling_price, line_total,
            billed, needs_price, typed, more_than_ordered }],
  events: [{ id, event_type, created_at, mine, detail }]
}
```

A test scans this json and every other function result for the keys `purchase_price`, `mrp`, `cost`, `margin`, `profit` and their snapshot forms: there must be none (research D15).

## 7. State changes

```text
Invoice:  (none) --create--> draft --issue--> issued --cancel--> cancelled
                              |  ^
                      edit / refresh      draft --discard--> (deleted, history kept)

Order:    confirmed --issue--> fulfilled --cancel invoice--> confirmed
          (an order with a draft invoice stays confirmed)
```

## 8. Rollback (for the migration header)

```text
drop function if exists ... (the six writes, the reads, order_lines_fingerprint);
drop table if exists public.invoice_events, public.invoice_lines, public.invoices, public.invoice_counters;
-- restore orders_guard, the order_events check and the delivered_quantity check to their 0003/0004 forms.
```

The rollback is safe only while no invoice has been issued (an issued invoice makes the restored `orders_guard` and checks refuse existing rows); the migration header says so.
