# Data Model: Store Accounts (Khata), Payments, Account Summary and Store Statement

**Feature**: 007-store-accounts-payments | **Migration**: `supabase/migrations/0008_store_accounts.sql` | **Date**: 2026-11-16

Conventions (same as Modules 001 to 006): every business table has `business_id` (default `current_business_id()`) and a composite key `(business_id, id)`; signed-in users have `select` only (Row Level Security, no write grants, nothing for `anon`); all writes are `SECURITY DEFINER` functions with `set search_path = public` that read the business from `current_business_id()` and filter every statement by it; reads are `SECURITY INVOKER`; money is `numeric`; a refusal is a `reason` in the function result, and a missing record and another business's record give the same answer.

Sign convention used by every function and screen: **a positive amount is what the store owes the supplier; a negative amount is an advance** (the store has paid in advance). Money is returned as text with two decimals.

## 1. Table `ledger_entries` (new, append-only)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | the client-created key (request id) |
| `business_id` | uuid not null | default `current_business_id()`, references `businesses` |
| `store_id` | uuid not null | composite foreign key to `stores (business_id, id)` |
| `seq` | bigint generated always as identity | unique; the order of recording (ties and previous balance) |
| `entry_type` | text not null | `opening_balance`, `invoice`, `payment`, `adjustment`, `reversal` |
| `entry_date` | date not null | check between 2000-01-01 and 9999-12-31 |
| `debit` | numeric(18,2) not null default 0 | the store owes more |
| `credit` | numeric(18,2) not null default 0 | the store owes less |
| `invoice_id` | uuid | the invoice of an `invoice` entry, of the reversal of one, and of a payment received at issue; the reversal of a payment received at issue copies the same invoice id (for display only) |
| `reverses_entry_id` | uuid | set only on a `reversal` |
| `payment_method` | text | `cash` now; check `in ('cash','bank_transfer','mobile_wallet')` so later methods need no migration of data; only `payment` entries carry it |
| `reference` | text | optional, at most 100 characters (payment reference) |
| `note` | text | opening balance note (optional, at most 200) or the required reason of an adjustment or a reversal (1 to 500) |
| `created_by` | uuid | default `auth.uid()` |
| `created_at` | timestamptz not null default `now()` | |

Keys and constraints:

- `primary key (business_id, id)`; `unique (business_id, store_id, id)` (target of the composite foreign keys); `unique (seq)`.
- `foreign key (business_id, store_id) references stores (business_id, id)`.
- `foreign key (business_id, store_id, invoice_id) references invoices (business_id, store_id, id)`: an entry can only point at an invoice of the same store.
- `foreign key (business_id, store_id, reverses_entry_id) references ledger_entries (business_id, store_id, id)`: a reversal can only point at an entry of the same store.
- `check (debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0)))`: exactly one side.
- Shape per type (one check each):
  - `invoice`: `debit > 0`, `invoice_id` not null, `reverses_entry_id` null, `payment_method` null.
  - `payment`: `credit > 0`, `payment_method` not null, `reverses_entry_id` null.
  - `opening_balance`: `reverses_entry_id` null, `invoice_id` null, `payment_method` null.
  - `adjustment`: `reverses_entry_id` null, `invoice_id` null, `note` not null (1 to 500 characters).
  - `reversal`: `reverses_entry_id` not null, `note` not null (1 to 500 characters), `payment_method` null.
- Partial unique indexes (exactly-once, research D5):
  - `ledger_invoice_entry_uidx on (business_id, invoice_id) where entry_type = 'invoice'`
  - `ledger_reversal_uidx on (business_id, reverses_entry_id) where entry_type = 'reversal'`
  - `ledger_invoice_payment_uidx on (business_id, invoice_id) where entry_type = 'payment' and invoice_id is not null`
- Indexes for reads: `ledger_store_date_idx on (business_id, store_id, entry_date, seq)`; `ledger_store_debit_idx on (business_id, store_id) where debit > 0`.

Triggers:

- `ledger_entries_append_only` (before update or delete): refuses every update and delete, except that `current_user = 'service_role'` may delete (test cleanup only, the app never uses it), exactly like the purchase and invoice history tables.
- `ledger_entries_check_insert` (before insert): defence in depth for a reversal: the original exists, is not itself a reversal, is on the same store, and the reversal has the opposite side with the same amount. An `invoice` entry must belong to an invoice whose status is `issued` and whose `in_account` is true; a `payment` with an `invoice_id` must belong to an issued invoice of that store.

RLS: `enable row level security`; policy `ledger_entries_select` for `authenticated` using `business_id = current_business_id()`; `revoke all ... from anon, authenticated; grant select ... to authenticated`.

## 2. Changes to table `invoices` (Module 006 object)

| Change | Detail |
|--------|--------|
| `in_account boolean not null default false` | existing rows become `false` ("Not in the account") |
| `summary_previous numeric(18,2)` | the store balance immediately before the invoice entry (negative = advance) |
| `summary_payment numeric(18,2)` | the payment received at issue; null when there was none; `check (summary_payment is null or summary_payment > 0)` |
| `summary_due numeric(18,2)` | previous + grand total - payment (negative = advance) |
| `constraint invoices_biz_store_id_uniq unique (business_id, store_id, id)` | target of the ledger's composite foreign key |
| check `invoices_account_shape` | `(not in_account and summary_previous is null and summary_payment is null and summary_due is null) or (in_account and status <> 'draft' and summary_previous is not null and summary_due is not null)` (so a draft is never in the account and has no figures) |

`invoices_guard` is **not changed**: a draft changes freely, so the update that issues the invoice may set the new columns; from then on the guard compares the whole row except status, the three cancellation columns, `updated_at` and `version`, so the four new columns are frozen (a test proves each one). "Balance as on" is the existing `invoice_date`; "This invoice" is the existing `grand_total`.

## 3. Reads (SECURITY INVOKER)

Internal helpers (executable by signed-in users, but invoker functions, so Row Level Security applies; the same arrangement as `invoice_json`):

- `ledger_balances(p_biz uuid)` returns `(store_id uuid, balance numeric, entry_count int, last_entry_date date)` for every store with at least one entry. Balance = `sum(debit) - sum(credit)`.
- `ledger_allocation(p_biz uuid, p_stores uuid[] default null, p_extra numeric default 0)` returns `(store_id, entry_id, kind text, invoice_id uuid, entry_date date, amount numeric, allocated numeric, outstanding numeric, status text, position bigint)` for every debit item that is still counted (`position` is its place in the settling order). `p_stores` limits the stores (an empty array computes nothing, which the invoices list uses); `p_extra` adds a hypothetical payment to the credit pool and is used only by the payment preview. Definition:

```sql
-- items: debit entries (opening_balance, invoice, adjustment) with no reversal pointing at them
-- pool : sum of credit of payment, opening_balance and adjustment entries with no reversal pointing at them (per store)
-- order: (case entry_type when 'opening_balance' then 0 else 1 end, entry_date, seq)
-- allocated = least(amount, greatest(0, pool - coalesce(sum(amount) over (partition by store_id order by <order>
--             rows between unbounded preceding and 1 preceding), 0)))
-- status    = case when allocated >= amount then 'paid' when allocated = 0 then 'unpaid' else 'partially_paid' end
```

  Reversal entries are excluded from both sides, so a reversed entry and its reversal cancel out. The sum of `allocated` equals `least(pool, sum(amount))`, and `pool - sum(allocated)` is the advance (a test checks both on random sequences).
- `ledger_entry_json(p_biz uuid, p_id uuid)` returns one entry (see section 6).

Public reads:

| Function | Returns |
|----------|---------|
| `ledger_stores(p_q text, p_only_owing boolean, p_limit int, p_offset int)` | `{items: [{store_id, name, is_active, balance, owes, advance, entry_count, last_entry_date}], total}` for every store (a left join from `stores`, so stores without entries and archived stores are listed with balance 0.00 or their balance); search by store name; at most 50 per page |
| `ledger_summary()` | `{total_owed, stores_owing, total_advance, stores_with_advance}`; `total_owed` is the sum of the positive balances |
| `ledger_account(p_store uuid, p_limit int, p_offset int)` | `{found, store: {id, name, contact_person, phone, address, is_active}, balance, owes, advance, open_items: [...up to 50, oldest first], entries: [...], total_entries}`; entries newest first, each with `running_balance` computed over the whole account in `(entry_date, seq)` order |
| `ledger_payment_preview(p_store uuid, p_amount numeric)` | `{found, valid, reason?, balance_before, balance_after, advance_after, settles: [{kind, label, date, outstanding_before, applied, outstanding_after}]}`; nothing is written |
| `ledger_statement(p_store uuid, p_from date, p_to date)` | `{found, business, store, from, to, opening_balance, entries: [...], total_debit, total_credit, closing_balance, truncated}`; at most 2,000 lines; `opening_balance` is the sum of entries dated before `p_from` |

Changed reads (Module 006 objects):

- `invoice_json` adds: `in_account` (boolean), `payment_status` (`unpaid`, `partially_paid`, `paid` or null for a draft, a cancelled invoice or an invoice not in the account), `amount_paid`, `amount_outstanding` (null when not applicable), and `account_summary` (null when `in_account` is false): `{balance_date, previous_balance, previous_is_advance, this_invoice, payment_received, balance_due, due_is_advance}` with the signed figures as text and the two flags. A cancelled invoice that was in the account keeps its figures in the data; the print page shows the block only for an issued invoice, never for a draft or a cancelled one (spec FR-025).
- `invoice_list(p_status, p_store, p_from, p_to, p_order, p_q, p_limit, p_offset)` becomes `invoice_list(p_status, p_store, p_from, p_to, p_order, p_q, p_limit, p_offset, p_payment_status default null)` (the new argument is last with a default, so existing positional callers and the existing test helper keep working; the old eight-argument function is dropped so the call is not ambiguous); each row gains `in_account` and `payment_status`; `p_payment_status` filters to `unpaid`, `partially_paid` or `paid`.

No read returns a purchase price, MRP, cost, margin or profit: no ledger or invoice table has such a column.

**Invoice with a grand total of 0.00**: a selling price of zero is a verified price, so an invoice can total 0.00. An entry needs an amount above 0, so such an invoice writes **no invoice entry**; it is still `in_account` with its Account Summary saved, it counts as `paid` (nothing is owed), and cancelling it adds no reversal. A payment received with it is still recorded.

## 4. Writes (SECURITY DEFINER)

All writes validate in the database: amounts above 0, at most two decimals, at most 9,999,999,999.99; dates from 2000-01-01 to today in `Asia/Karachi`; reasons 1 to 500 characters. All take the store's ledger lock (`pg_advisory_xact_lock(hashtext('ledger:' || business || ':' || store))`) before reading or writing.

| Function | Arguments | Result |
|----------|-----------|--------|
| `ledger_opening_add` | `p_id uuid, p_store_id uuid, p_amount numeric, p_direction text ('owes' or 'advance'), p_as_on date, p_note text` | `{done, replayed, entry}` |
| `ledger_payment_add` | `p_id uuid, p_store_id uuid, p_amount numeric, p_date date, p_method text default 'cash', p_reference text default null` | `{done, replayed, entry, account: {balance, advance}}` |
| `ledger_adjustment_add` | `p_id uuid, p_store_id uuid, p_amount numeric, p_direction text ('reduce' or 'increase'), p_reason text, p_date date default null` (null = today) | `{done, replayed, entry}` |
| `ledger_entry_reverse` | `p_id uuid (the new reversal's key), p_entry_id uuid, p_reason text, p_store_id uuid default null` (when given, it must be the entry's own store, otherwise the entry looks missing; the route always gives it) | `{done, replayed, entry, reversed: entry}` |
| `invoice_issue` (changed) | `p_id uuid, p_expected_version int, p_payment numeric default null` | `{done, replayed, invoice}` as before |
| `invoice_cancel` (changed) | `p_id uuid, p_reason text` (unchanged) | `{done, replayed, invoice}` as before |
| `ledger_insert_entry` (internal) | `(p_biz, p_store, p_id, p_type, p_date, p_debit, p_credit, p_invoice, p_reverses, p_method, p_reference, p_note)` | the new row; **not executable** by `anon` or `authenticated`; the only `insert` into `ledger_entries` |

Refusal reasons (`done: false`):

| Reason | When |
|--------|------|
| `not_found` | the store, entry or invoice does not exist for this business |
| `invalid_amount` | zero, negative, more than two decimals, or above 9,999,999,999.99 (also for the payment received now; nothing changes and no invoice number is used) |
| `invalid_direction` | an unknown direction value |
| `note_too_long` / `reference_too_long` | an opening balance note above 200 characters, a payment reference above 100 characters |
| `invalid_method` | a payment method other than `cash` (the table check already allows `bank_transfer` and `mobile_wallet` so later methods need no data migration, but the function accepts only `cash` until they are built) |
| `invalid_date` | in the future (Pakistan time) or before 2000-01-01 |
| `reason_required` / `reason_too_long` | a reason that is empty or longer than 500 characters |
| `request_reused` | the same id with different content (store, type, amount, direction or date) |
| `entry_is_reversal` | trying to reverse a reversal |
| `already_reversed` | the entry already has a reversal |
| `invoice_entry` | trying to reverse an invoice entry by hand (cancel the invoice instead) |

Behaviour of the changed invoice functions (order of work, research D6 to D8):

- `invoice_issue`: existing checks, then payment validation, then the ledger lock, the previous balance, the counter number, one update of the invoice (status, number, date, copied details and the four snapshot columns), the invoice entry, the optional payment entry, the invoice event (the payment and the account figures in `detail`) and the Module 006 order work. A replay of an issued invoice returns first and never records a payment.
- `invoice_cancel`: existing checks, then, only when `in_account` is true, the ledger lock and one reversal entry (credit = the grand total, reason = the cancellation reason, dated today); a payment received with the invoice is left untouched; then the Module 006 order work.

## 5. Grants

- `revoke all` on the new table from `anon, authenticated`; `grant select` on `ledger_entries` to `authenticated`.
- `revoke all ... from public, anon` and `grant execute ... to authenticated` on: `ledger_opening_add`, `ledger_payment_add`, `ledger_adjustment_add`, `ledger_entry_reverse`, `ledger_stores`, `ledger_summary`, `ledger_account`, `ledger_payment_preview`, `ledger_statement`, `ledger_balances`, `ledger_allocation`, `ledger_entry_json`, and the re-created `invoice_issue(uuid, int, numeric)` and `invoice_list(...)`.
- `revoke all ... from public, anon, authenticated` on `ledger_insert_entry`.

## 6. JSON shapes

Entry (`ledger_entry_json`): `{id, entry_type, entry_date, debit, credit, side ('debit' or 'credit'), amount, note, reference, payment_method, invoice_id, invoice_label, reverses_entry_id, reversed (bool), reversed_by_entry_id, running_balance (account and statement only), created_at, mine}`. `invoice_label` is `INV-000001` form.

Open item (`ledger_account.open_items`): `{kind ('opening_balance', 'invoice', 'adjustment'), entry_id, invoice_id, label, date, amount, allocated, outstanding, status}`.

## 7. Existing objects used, not changed

`current_business_id()`, `set_row_meta()`, `norm_text`, the tables `businesses`, `stores`, `business_settings` (read for the header and `account_summary_default`), `orders` and `order_lines` (touched only by the Module 006 parts of issue and cancel, unchanged), `invoice_counters`, `invoice_lines`, `invoice_events`.

## 8. Roll back

Safe only while no ledger entry exists and no invoice has `in_account = true`:

```sql
-- drop function if exists public.ledger_opening_add(uuid, uuid, numeric, text, date, text),
--   public.ledger_payment_add(uuid, uuid, numeric, date, text, text),
--   public.ledger_adjustment_add(uuid, uuid, numeric, text, text, date),
--   public.ledger_entry_reverse(uuid, uuid, text, uuid), public.ledger_stores(text, boolean, int, int),
--   public.ledger_summary(), public.ledger_account(uuid, int, int), public.ledger_payment_preview(uuid, numeric),
--   public.ledger_statement(uuid, date, date), public.ledger_balances(uuid), public.ledger_allocation(uuid, uuid),
--   public.ledger_entry_json(uuid, uuid), public.ledger_insert_entry(uuid, uuid, uuid, text, date, numeric, numeric, uuid, uuid, text, text, text);
-- drop table if exists public.ledger_entries;
-- drop function if exists public.ledger_entries_append_only(), public.ledger_entries_check_insert();
-- alter table public.invoices drop constraint invoices_account_shape, drop constraint invoices_biz_store_id_uniq, drop column in_account,
--   drop column summary_previous, drop column summary_payment, drop column summary_due;
-- (then restore invoice_json, invoice_issue(uuid, int), invoice_cancel and invoice_list from 0007)
```
