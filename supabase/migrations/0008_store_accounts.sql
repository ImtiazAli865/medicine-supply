-- Module 007: store accounts (khata), payments, the Account Summary snapshot and the Store Statement.
--
-- The khata is ONE append-only table, ledger_entries (opening_balance, invoice, payment, adjustment, reversal). A balance
-- is never stored: it is the sum of debits minus credits, and the paid status of an invoice is worked out by
-- ledger_allocation (credits settle debits oldest first, opening balances first). Entries are written ONLY through the
-- functions below (signed-in users get SELECT only), and the only INSERT into the table is the internal
-- ledger_insert_entry, which no user can call. Every function reads the business from current_business_id() and
-- filters every statement by it. Composite foreign keys tie an entry to the same store as its invoice and as the entry
-- it reverses, so a payment can never reach another store. NO ledger table or column has a purchase price, MRP or cost.
--
-- Five Module 006 objects change (and nothing else of Modules 001 to 006):
--   * table invoices: in_account, summary_previous, summary_payment, summary_due, a unique key (business, store, id) and
--     the check invoices_account_shape. invoices_guard is NOT changed: the update that issues the invoice sets the new
--     columns, and from then on the existing guard freezes every column of an issued invoice;
--   * invoice_json: in_account, payment_status, amount_paid, amount_outstanding, account_summary;
--   * invoice_issue: the optional payment, the invoice entry and the snapshot (a new third argument replaces the old
--     two-argument function);
--   * invoice_cancel: the reversal entry for an invoice that is in the account;
--   * invoice_list: a payment status filter (a last argument with a default) and two keys per row.
--
-- Lock order in every function that takes more than one lock: invoice, order, the store's ledger, the invoice counter.
--
-- Roll back (safe only while no ledger entry exists and no invoice has in_account = true):
--   drop function if exists public.ledger_opening_add(uuid, uuid, numeric, text, date, text),
--     public.ledger_payment_add(uuid, uuid, numeric, date, text, text),
--     public.ledger_adjustment_add(uuid, uuid, numeric, text, text, date),
--     public.ledger_entry_reverse(uuid, uuid, text, uuid), public.ledger_stores(text, boolean, int, int),
--     public.ledger_summary(), public.ledger_account(uuid, int, int), public.ledger_payment_preview(uuid, numeric),
--     public.ledger_statement(uuid, date, date), public.ledger_balances(uuid), public.ledger_allocation(uuid, uuid[], numeric),
--     public.ledger_entry_json(uuid, uuid), public.ledger_entry_obj(public.ledger_entries, integer, uuid, numeric),
--     public.ledger_amount_ok(numeric),
--     public.ledger_insert_entry(uuid, uuid, uuid, text, date, numeric, numeric, uuid, uuid, text, text, text);
--   drop table if exists public.ledger_entries;
--   drop function if exists public.ledger_entries_append_only(), public.ledger_entries_check_insert();
--   alter table public.invoices drop constraint invoices_account_shape, drop constraint invoices_biz_store_id_uniq,
--     drop column in_account, drop column summary_previous, drop column summary_payment, drop column summary_due;
--   (then restore invoice_json, invoice_issue(uuid, int), invoice_cancel and invoice_list from 0007)

begin;

-- ---------------------------------------------------------------------------
-- Changes to the invoices table (Module 006 object)
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists in_account boolean not null default false,
  add column if not exists summary_previous numeric(18, 2),
  add column if not exists summary_payment numeric(18, 2),
  add column if not exists summary_due numeric(18, 2);

alter table public.invoices drop constraint if exists invoices_summary_payment_positive;
alter table public.invoices add constraint invoices_summary_payment_positive
  check (summary_payment is null or summary_payment > 0);

alter table public.invoices drop constraint if exists invoices_biz_store_id_uniq;
alter table public.invoices add constraint invoices_biz_store_id_uniq unique (business_id, store_id, id);

alter table public.invoices drop constraint if exists invoices_account_shape;
alter table public.invoices add constraint invoices_account_shape check (
  (not in_account and summary_previous is null and summary_payment is null and summary_due is null)
  or (in_account and status <> 'draft' and summary_previous is not null and summary_due is not null)
);

-- ---------------------------------------------------------------------------
-- The ledger table
-- ---------------------------------------------------------------------------

create table if not exists public.ledger_entries (
  id                 uuid not null,
  business_id        uuid not null default public.current_business_id()
                       references public.businesses (id) on delete restrict,
  store_id           uuid not null,
  -- The order of recording (ties, and the meaning of "the balance before this entry").
  seq                bigint generated always as identity,
  entry_type         text not null check (entry_type in ('opening_balance', 'invoice', 'payment', 'adjustment', 'reversal')),
  entry_date         date not null check (entry_date >= date '2000-01-01'),
  debit              numeric(18, 2) not null default 0 check (debit >= 0),
  credit             numeric(18, 2) not null default 0 check (credit >= 0),
  invoice_id         uuid,
  reverses_entry_id  uuid,
  payment_method     text check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'mobile_wallet')),
  reference          text check (reference is null or char_length(reference) <= 100),
  note               text check (note is null or char_length(note) <= 500),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  constraint ledger_entries_pkey primary key (business_id, id),
  constraint ledger_entries_store_id_uniq unique (business_id, store_id, id),
  constraint ledger_entries_seq_uniq unique (seq),
  constraint ledger_entries_store_fk foreign key (business_id, store_id) references public.stores (business_id, id),
  -- An entry can only point at an invoice of the same store, and a reversal only at an entry of the same store.
  constraint ledger_entries_invoice_fk foreign key (business_id, store_id, invoice_id)
    references public.invoices (business_id, store_id, id),
  constraint ledger_entries_reverses_fk foreign key (business_id, store_id, reverses_entry_id)
    references public.ledger_entries (business_id, store_id, id),
  constraint ledger_entries_one_side check ((debit > 0) <> (credit > 0)),
  constraint ledger_entries_invoice_shape check (
    entry_type <> 'invoice'
    or (debit > 0 and invoice_id is not null and reverses_entry_id is null and payment_method is null)
  ),
  constraint ledger_entries_payment_shape check (
    entry_type <> 'payment' or (credit > 0 and payment_method is not null and reverses_entry_id is null)
  ),
  constraint ledger_entries_opening_shape check (
    entry_type <> 'opening_balance' or (reverses_entry_id is null and invoice_id is null and payment_method is null)
  ),
  constraint ledger_entries_adjustment_shape check (
    entry_type <> 'adjustment'
    or (reverses_entry_id is null and invoice_id is null and payment_method is null
        and note is not null and char_length(btrim(note)) between 1 and 500)
  ),
  constraint ledger_entries_reversal_shape check (
    entry_type <> 'reversal'
    or (reverses_entry_id is not null and payment_method is null
        and note is not null and char_length(btrim(note)) between 1 and 500)
  ),
  constraint ledger_entries_reference_shape check (entry_type = 'payment' or reference is null)
);

create index if not exists ledger_store_date_idx on public.ledger_entries (business_id, store_id, entry_date, seq);
create index if not exists ledger_store_debit_idx on public.ledger_entries (business_id, store_id) where debit > 0;

-- Exactly-once, enforced by the database for any code path.
create unique index if not exists ledger_invoice_entry_uidx
  on public.ledger_entries (business_id, invoice_id) where entry_type = 'invoice';
create unique index if not exists ledger_reversal_uidx
  on public.ledger_entries (business_id, reverses_entry_id) where entry_type = 'reversal';
create unique index if not exists ledger_invoice_payment_uidx
  on public.ledger_entries (business_id, invoice_id) where entry_type = 'payment' and invoice_id is not null;

-- ---------------------------------------------------------------------------
-- Guards: the ledger is append-only
-- ---------------------------------------------------------------------------

-- Entries are never edited or deleted. Only the service role may delete (removing a test business); the app never uses it.
create or replace function public.ledger_entries_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception 'ledger_immutable: ledger entries are never edited or deleted' using errcode = '22023';
end;
$$;

drop trigger if exists ledger_entries_append_only on public.ledger_entries;
create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_append_only();

-- Defence in depth for the rules the functions also check.
create or replace function public.ledger_entries_check_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_orig public.ledger_entries;
  v_inv public.invoices;
begin
  if new.entry_type = 'reversal' then
    select * into v_orig from public.ledger_entries e
     where e.business_id = new.business_id and e.id = new.reverses_entry_id;
    if not found then
      raise exception 'ledger_invalid: the entry to reverse does not exist' using errcode = '22023';
    end if;
    if v_orig.entry_type = 'reversal' then
      raise exception 'ledger_invalid: a reversal cannot be reversed' using errcode = '22023';
    end if;
    if v_orig.store_id <> new.store_id then
      raise exception 'ledger_invalid: a reversal must belong to the store of the entry it reverses' using errcode = '22023';
    end if;
    if not ((v_orig.debit > 0 and new.credit = v_orig.debit) or (v_orig.credit > 0 and new.debit = v_orig.credit)) then
      raise exception 'ledger_invalid: a reversal takes the opposite side with the same amount' using errcode = '22023';
    end if;
  elsif new.entry_type = 'invoice' then
    select * into v_inv from public.invoices i where i.business_id = new.business_id and i.id = new.invoice_id;
    if not found or v_inv.store_id <> new.store_id or v_inv.status = 'draft' or not v_inv.in_account then
      raise exception 'ledger_invalid: only an issued invoice that is in the account has an invoice entry'
        using errcode = '22023';
    end if;
  elsif new.entry_type = 'payment' and new.invoice_id is not null then
    select * into v_inv from public.invoices i where i.business_id = new.business_id and i.id = new.invoice_id;
    if not found or v_inv.store_id <> new.store_id or v_inv.status <> 'issued' or not v_inv.in_account then
      raise exception 'ledger_invalid: a payment received with an invoice needs an issued invoice of the same store'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ledger_entries_check_insert on public.ledger_entries;
create trigger ledger_entries_check_insert
  before insert on public.ledger_entries
  for each row execute function public.ledger_entries_check_insert();

-- ---------------------------------------------------------------------------
-- Row Level Security and grants (select only)
-- ---------------------------------------------------------------------------

alter table public.ledger_entries enable row level security;

drop policy if exists ledger_entries_select on public.ledger_entries;
create policy ledger_entries_select on public.ledger_entries
  for select to authenticated
  using (business_id = public.current_business_id());

revoke all on public.ledger_entries from anon, authenticated;
grant select on public.ledger_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Small shared helpers
-- ---------------------------------------------------------------------------

-- An amount above 0 with at most two decimals and at most 9,999,999,999.99 (the same limit as every money input).
create or replace function public.ledger_amount_ok(p_amount numeric)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_amount is not null and p_amount > 0 and p_amount = round(p_amount, 2) and p_amount <= 9999999999.99
$$;

-- The only INSERT into ledger_entries. Callers hold the store's ledger lock. Not executable by users.
create or replace function public.ledger_insert_entry(
  p_biz uuid, p_store uuid, p_id uuid, p_type text, p_date date, p_debit numeric, p_credit numeric,
  p_invoice uuid, p_reverses uuid, p_method text, p_reference text, p_note text
)
returns public.ledger_entries
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.ledger_entries;
begin
  insert into public.ledger_entries
    (id, business_id, store_id, entry_type, entry_date, debit, credit, invoice_id, reverses_entry_id,
     payment_method, reference, note, created_by)
  values
    (p_id, p_biz, p_store, p_type, p_date, coalesce(p_debit, 0), coalesce(p_credit, 0), p_invoice, p_reverses,
     p_method, p_reference, p_note, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal reads (SECURITY INVOKER: Row Level Security applies even when called directly)
-- ---------------------------------------------------------------------------

-- One row per store that has entries: the balance (positive = the store owes, negative = an advance).
create or replace function public.ledger_balances(p_biz uuid)
returns table (store_id uuid, balance numeric, entry_count integer, last_entry_date date)
language sql
stable
security invoker
set search_path = public
as $$
  select e.store_id,
         (sum(e.debit) - sum(e.credit))::numeric(18, 2),
         count(*)::integer,
         max(e.entry_date)
    from public.ledger_entries e
   where e.business_id = p_biz
   group by e.store_id
$$;

-- The allocation: credits (payments, advance opening balances, reducing adjustments, none of them reversed) settle the
-- open debit items (opening balances, invoices, increasing adjustments, none of them reversed) oldest first, opening
-- balances first, then by (entry date, order of recording). Reversed entries and their reversals are left out of both
-- sides. p_extra adds a hypothetical payment to the credit pool (the payment preview); it is 0 everywhere else.
create or replace function public.ledger_allocation(p_biz uuid, p_stores uuid[] default null, p_extra numeric default 0)
returns table (
  store_id    uuid,
  entry_id    uuid,
  kind        text,
  invoice_id  uuid,
  entry_date  date,
  amount      numeric,
  allocated   numeric,
  outstanding numeric,
  status      text,
  ord         bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with live as materialized (
    select e.*
      from public.ledger_entries e
     where e.business_id = p_biz
       and (p_stores is null or e.store_id = any (p_stores))
       and e.entry_type <> 'reversal'
       and not exists (
         select 1 from public.ledger_entries r
          where r.business_id = e.business_id and r.reverses_entry_id = e.id and r.entry_type = 'reversal')
  ),
  pool as materialized (
    select l.store_id, coalesce(sum(l.credit), 0) as credits
      from live l
     where l.credit > 0
     group by l.store_id
  ),
  items as materialized (
    select l.store_id,
           l.id as entry_id,
           l.entry_type as kind,
           l.invoice_id,
           l.entry_date,
           l.debit as amount,
           sum(l.debit) over (
             partition by l.store_id
             order by (case l.entry_type when 'opening_balance' then 0 else 1 end), l.entry_date, l.seq
             rows between unbounded preceding and 1 preceding) as before_amount,
           row_number() over (
             partition by l.store_id
             order by (case l.entry_type when 'opening_balance' then 0 else 1 end), l.entry_date, l.seq) as ord
      from live l
     where l.debit > 0
  ),
  calc as (
    select i.*,
           least(i.amount,
                 greatest(0, coalesce(p.credits, 0) + coalesce(p_extra, 0) - coalesce(i.before_amount, 0)))::numeric(18, 2) as allocated
      from items i
      left join pool p on p.store_id = i.store_id
  )
  select c.store_id, c.entry_id, c.kind, c.invoice_id, c.entry_date, c.amount::numeric(18, 2), c.allocated,
         (c.amount - c.allocated)::numeric(18, 2) as outstanding,
         case when c.allocated >= c.amount then 'paid'
              when c.allocated = 0 then 'unpaid'
              else 'partially_paid' end as status,
         c.ord
    from calc c
$$;

-- One entry as JSON, from the row plus what a join knows (invoice number, the reversing entry, the running balance).
create or replace function public.ledger_entry_obj(
  e public.ledger_entries, p_invoice_number integer, p_reversed_by uuid, p_running numeric
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'entry_type', e.entry_type,
    'entry_date', e.entry_date,
    'debit', e.debit::text,
    'credit', e.credit::text,
    'side', case when e.debit > 0 then 'debit' else 'credit' end,
    'amount', greatest(e.debit, e.credit)::text,
    'note', e.note,
    'reference', e.reference,
    'payment_method', e.payment_method,
    'invoice_id', e.invoice_id,
    'invoice_label', case when p_invoice_number is null then null
                          else 'INV-' || lpad(p_invoice_number::text, 6, '0') end,
    'reverses_entry_id', e.reverses_entry_id,
    'reversed', p_reversed_by is not null,
    'reversed_by_entry_id', p_reversed_by,
    'created_at', e.created_at,
    'mine', e.created_by is not distinct from auth.uid()
  ) || case when p_running is null then '{}'::jsonb
            else jsonb_build_object('running_balance', p_running::numeric(18, 2)::text) end
$$;

-- One entry as JSON (null when it does not exist or belongs to another business).
create or replace function public.ledger_entry_json(p_biz uuid, p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select public.ledger_entry_obj(
           e,
           i.invoice_number,
           (select r.id from public.ledger_entries r
             where r.business_id = e.business_id and r.reverses_entry_id = e.id and r.entry_type = 'reversal'),
           null)
    from public.ledger_entries e
    left join public.invoices i on i.business_id = e.business_id and i.id = e.invoice_id
   where e.business_id = p_biz and e.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Writes (SECURITY DEFINER): opening balance, payment, adjustment, reversal
-- ---------------------------------------------------------------------------

create or replace function public.ledger_opening_add(
  p_id uuid, p_store_id uuid, p_amount numeric, p_direction text, p_as_on date, p_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing public.ledger_entries;
  v_row public.ledger_entries;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_store_id is null
     or not exists (select 1 from public.stores s where s.business_id = v_biz and s.id = p_store_id) then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if not public.ledger_amount_ok(p_amount) then
    return jsonb_build_object('done', false, 'reason', 'invalid_amount');
  end if;
  if p_direction is null or p_direction not in ('owes', 'advance') then
    return jsonb_build_object('done', false, 'reason', 'invalid_direction');
  end if;
  if p_as_on is null or p_as_on > v_today or p_as_on < date '2000-01-01' then
    return jsonb_build_object('done', false, 'reason', 'invalid_date');
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    return jsonb_build_object('done', false, 'reason', 'note_too_long');
  end if;

  perform pg_advisory_xact_lock(hashtext('ledger:' || v_biz::text || ':' || p_store_id::text));

  select * into v_existing from public.ledger_entries e where e.business_id = v_biz and e.id = p_id;
  if found then
    if v_existing.store_id = p_store_id and v_existing.entry_type = 'opening_balance'
       and greatest(v_existing.debit, v_existing.credit) = p_amount
       and (v_existing.debit > 0) = (p_direction = 'owes')
       and v_existing.entry_date = p_as_on then
      return jsonb_build_object('done', true, 'replayed', true, 'entry', public.ledger_entry_json(v_biz, p_id));
    end if;
    return jsonb_build_object('done', false, 'reason', 'request_reused');
  end if;

  v_row := public.ledger_insert_entry(
    v_biz, p_store_id, p_id, 'opening_balance', p_as_on,
    case when p_direction = 'owes' then p_amount else 0 end,
    case when p_direction = 'advance' then p_amount else 0 end,
    null, null, null, null, v_note);

  return jsonb_build_object('done', true, 'replayed', false, 'entry', public.ledger_entry_json(v_biz, p_id));
end;
$$;

create or replace function public.ledger_payment_add(
  p_id uuid, p_store_id uuid, p_amount numeric, p_date date, p_method text default 'cash', p_reference text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_method text := coalesce(nullif(btrim(coalesce(p_method, '')), ''), 'cash');
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_existing public.ledger_entries;
  v_row public.ledger_entries;
  v_balance numeric(18, 2);
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_store_id is null
     or not exists (select 1 from public.stores s where s.business_id = v_biz and s.id = p_store_id) then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if not public.ledger_amount_ok(p_amount) then
    return jsonb_build_object('done', false, 'reason', 'invalid_amount');
  end if;
  if v_method <> 'cash' then
    return jsonb_build_object('done', false, 'reason', 'invalid_method');
  end if;
  if p_date is null or p_date > v_today or p_date < date '2000-01-01' then
    return jsonb_build_object('done', false, 'reason', 'invalid_date');
  end if;
  if v_reference is not null and char_length(v_reference) > 100 then
    return jsonb_build_object('done', false, 'reason', 'reference_too_long');
  end if;

  perform pg_advisory_xact_lock(hashtext('ledger:' || v_biz::text || ':' || p_store_id::text));

  select * into v_existing from public.ledger_entries e where e.business_id = v_biz and e.id = p_id;
  if found then
    if v_existing.store_id = p_store_id and v_existing.entry_type = 'payment' and v_existing.credit = p_amount
       and v_existing.entry_date = p_date and v_existing.invoice_id is null then
      select (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18, 2) into v_balance
        from public.ledger_entries e where e.business_id = v_biz and e.store_id = p_store_id;
      return jsonb_build_object('done', true, 'replayed', true, 'entry', public.ledger_entry_json(v_biz, p_id),
                                'account', jsonb_build_object('balance', v_balance::text, 'advance', v_balance < 0));
    end if;
    return jsonb_build_object('done', false, 'reason', 'request_reused');
  end if;

  v_row := public.ledger_insert_entry(v_biz, p_store_id, p_id, 'payment', p_date, 0, p_amount, null, null, v_method,
                                      v_reference, null);

  select (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18, 2) into v_balance
    from public.ledger_entries e where e.business_id = v_biz and e.store_id = p_store_id;
  return jsonb_build_object('done', true, 'replayed', false, 'entry', public.ledger_entry_json(v_biz, p_id),
                            'account', jsonb_build_object('balance', v_balance::text, 'advance', v_balance < 0));
end;
$$;

create or replace function public.ledger_adjustment_add(
  p_id uuid, p_store_id uuid, p_amount numeric, p_direction text, p_reason text, p_date date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Karachi')::date);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_existing public.ledger_entries;
  v_row public.ledger_entries;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_store_id is null
     or not exists (select 1 from public.stores s where s.business_id = v_biz and s.id = p_store_id) then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if not public.ledger_amount_ok(p_amount) then
    return jsonb_build_object('done', false, 'reason', 'invalid_amount');
  end if;
  if p_direction is null or p_direction not in ('reduce', 'increase') then
    return jsonb_build_object('done', false, 'reason', 'invalid_direction');
  end if;
  if v_date > v_today or v_date < date '2000-01-01' then
    return jsonb_build_object('done', false, 'reason', 'invalid_date');
  end if;
  if v_reason is null then
    return jsonb_build_object('done', false, 'reason', 'reason_required');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('done', false, 'reason', 'reason_too_long');
  end if;

  perform pg_advisory_xact_lock(hashtext('ledger:' || v_biz::text || ':' || p_store_id::text));

  select * into v_existing from public.ledger_entries e where e.business_id = v_biz and e.id = p_id;
  if found then
    if v_existing.store_id = p_store_id and v_existing.entry_type = 'adjustment'
       and greatest(v_existing.debit, v_existing.credit) = p_amount
       and (v_existing.debit > 0) = (p_direction = 'increase')
       and v_existing.entry_date = v_date and v_existing.note = v_reason then
      return jsonb_build_object('done', true, 'replayed', true, 'entry', public.ledger_entry_json(v_biz, p_id));
    end if;
    return jsonb_build_object('done', false, 'reason', 'request_reused');
  end if;

  v_row := public.ledger_insert_entry(
    v_biz, p_store_id, p_id, 'adjustment', v_date,
    case when p_direction = 'increase' then p_amount else 0 end,
    case when p_direction = 'reduce' then p_amount else 0 end,
    null, null, null, null, v_reason);

  return jsonb_build_object('done', true, 'replayed', false, 'entry', public.ledger_entry_json(v_biz, p_id));
end;
$$;

-- Reverses a payment, an opening balance or an adjustment with a required reason. An invoice entry is reversed only by
-- cancelling its invoice; a reversal cannot be reversed; an entry is reversed at most once.
create or replace function public.ledger_entry_reverse(p_id uuid, p_entry_id uuid, p_reason text, p_store_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_orig public.ledger_entries;
  v_existing public.ledger_entries;
  v_row public.ledger_entries;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_entry_id is null then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  select * into v_orig from public.ledger_entries e where e.business_id = v_biz and e.id = p_entry_id;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  -- When the caller names the store (the route does), it must be the store of the entry; otherwise it looks missing.
  if p_store_id is not null and p_store_id is distinct from v_orig.store_id then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if v_reason is null then
    return jsonb_build_object('done', false, 'reason', 'reason_required');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('done', false, 'reason', 'reason_too_long');
  end if;

  perform pg_advisory_xact_lock(hashtext('ledger:' || v_biz::text || ':' || v_orig.store_id::text));

  select * into v_existing from public.ledger_entries e where e.business_id = v_biz and e.id = p_id;
  if found then
    if v_existing.entry_type = 'reversal' and v_existing.reverses_entry_id = p_entry_id then
      return jsonb_build_object('done', true, 'replayed', true, 'entry', public.ledger_entry_json(v_biz, p_id),
                                'reversed', public.ledger_entry_json(v_biz, p_entry_id));
    end if;
    return jsonb_build_object('done', false, 'reason', 'request_reused');
  end if;

  if v_orig.entry_type = 'reversal' then
    return jsonb_build_object('done', false, 'reason', 'entry_is_reversal');
  end if;
  if v_orig.entry_type = 'invoice' then
    return jsonb_build_object('done', false, 'reason', 'invoice_entry');
  end if;
  if exists (select 1 from public.ledger_entries r
              where r.business_id = v_biz and r.reverses_entry_id = p_entry_id and r.entry_type = 'reversal') then
    return jsonb_build_object('done', false, 'reason', 'already_reversed');
  end if;

  v_row := public.ledger_insert_entry(
    v_biz, v_orig.store_id, p_id, 'reversal', (now() at time zone 'Asia/Karachi')::date,
    v_orig.credit, v_orig.debit, v_orig.invoice_id, p_entry_id, null, null, v_reason);

  return jsonb_build_object('done', true, 'replayed', false, 'entry', public.ledger_entry_json(v_biz, p_id),
                            'reversed', public.ledger_entry_json(v_biz, p_entry_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public reads (SECURITY INVOKER)
-- ---------------------------------------------------------------------------

-- Every store with its balance (a left join from stores, so stores without entries and archived stores are listed).
create or replace function public.ledger_stores(p_q text, p_only_owing boolean, p_limit int, p_offset int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with biz as materialized (select public.current_business_id() as id),
  bal as materialized (select b.* from public.ledger_balances((select id from biz)) b),
  rws as materialized (
    select s.id as store_id, s.name, s.is_active,
           coalesce(b.balance, 0)::numeric(18, 2) as balance,
           coalesce(b.entry_count, 0) as entry_count,
           b.last_entry_date
      from public.stores s
      join biz on s.business_id = biz.id
      left join bal b on b.store_id = s.id
     where (btrim(coalesce(p_q, '')) = '' or public.pending_search_ok(s.name, null, p_q))
       and (not coalesce(p_only_owing, false) or coalesce(b.balance, 0) > 0)
  ),
  page as (
    select r.*
      from rws r
     order by r.balance desc, lower(r.name), r.store_id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'store_id', p.store_id,
                'name', p.name,
                'is_active', p.is_active,
                'balance', p.balance::text,
                'owes', p.balance > 0,
                'advance', p.balance < 0,
                'entry_count', p.entry_count,
                'last_entry_date', p.last_entry_date
              ) order by p.balance desc, lower(p.name), p.store_id) from page p), '[]'::jsonb),
    'total', (select count(*) from rws)
  )
$$;

-- Home totals: the sum of the positive balances (advances are not subtracted and are reported separately).
create or replace function public.ledger_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with b as materialized (select * from public.ledger_balances(public.current_business_id()))
  select jsonb_build_object(
    'total_owed', coalesce(sum(b.balance) filter (where b.balance > 0), 0)::numeric(18, 2)::text,
    'stores_owing', count(*) filter (where b.balance > 0),
    'total_advance', coalesce(abs(sum(b.balance) filter (where b.balance < 0)), 0)::numeric(18, 2)::text,
    'stores_with_advance', count(*) filter (where b.balance < 0)
  )
  from b
$$;

-- One store account: the balance, the open items (oldest first) and a page of entries, newest first, with the running
-- balance computed over the whole account in (entry date, order of recording) order.
create or replace function public.ledger_account(p_store uuid, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_store jsonb;
  v_balance numeric(18, 2);
  v_open jsonb;
  v_entries jsonb;
  v_total integer;
begin
  select jsonb_build_object('id', s.id, 'name', s.name, 'contact_person', s.contact_person, 'phone', s.phone,
                            'address', s.address, 'is_active', s.is_active)
    into v_store
    from public.stores s
   where s.business_id = v_biz and s.id = p_store;
  if v_store is null then
    return jsonb_build_object('found', false);
  end if;

  select (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18, 2), count(*)::integer
    into v_balance, v_total
    from public.ledger_entries e
   where e.business_id = v_biz and e.store_id = p_store;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', a.kind,
           'entry_id', a.entry_id,
           'invoice_id', a.invoice_id,
           'label', case a.kind
                      when 'invoice' then coalesce('INV-' || lpad(i.invoice_number::text, 6, '0'), 'Invoice')
                      when 'opening_balance' then 'Opening balance'
                      else 'Adjustment' end,
           'date', a.entry_date,
           'amount', a.amount::text,
           'allocated', a.allocated::text,
           'outstanding', a.outstanding::text,
           'status', a.status
         ) order by a.ord), '[]'::jsonb)
    into v_open
    from (select * from public.ledger_allocation(v_biz, array[p_store], 0) x
           where x.outstanding > 0 order by x.ord limit 50) a
    left join public.invoices i on i.business_id = v_biz and i.id = a.invoice_id;

  with ordered as materialized (
    select e as entry,
           sum(e.debit - e.credit) over (order by e.entry_date, e.seq
                                         rows between unbounded preceding and current row) as running
      from public.ledger_entries e
     where e.business_id = v_biz and e.store_id = p_store
  ),
  page as (
    select o.entry, o.running
      from ordered o
     order by (o.entry).entry_date desc, (o.entry).seq desc
     limit least(greatest(coalesce(p_limit, 30), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select coalesce(jsonb_agg(public.ledger_entry_obj(
           p.entry,
           i.invoice_number,
           (select r.id from public.ledger_entries r
             where r.business_id = v_biz and r.reverses_entry_id = (p.entry).id and r.entry_type = 'reversal'),
           p.running) order by (p.entry).entry_date desc, (p.entry).seq desc), '[]'::jsonb)
    into v_entries
    from page p
    left join public.invoices i on i.business_id = v_biz and i.id = (p.entry).invoice_id;

  return jsonb_build_object(
    'found', true,
    'store', v_store,
    'balance', v_balance::text,
    'owes', v_balance > 0,
    'advance', v_balance < 0,
    'open_items', v_open,
    'entries', v_entries,
    'total_entries', v_total
  );
end;
$$;

-- What a payment would do, without writing anything: the balance after and the items it settles, oldest first.
create or replace function public.ledger_payment_preview(p_store uuid, p_amount numeric)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_balance numeric(18, 2);
  v_settles jsonb;
begin
  if not exists (select 1 from public.stores s where s.business_id = v_biz and s.id = p_store) then
    return jsonb_build_object('found', false);
  end if;
  select (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18, 2) into v_balance
    from public.ledger_entries e where e.business_id = v_biz and e.store_id = p_store;

  if not public.ledger_amount_ok(p_amount) then
    return jsonb_build_object('found', true, 'valid', false, 'reason', 'invalid_amount',
                              'balance_before', v_balance::text, 'balance_after', v_balance::text,
                              'advance_after', greatest(-v_balance, 0)::text, 'settles', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', a2.kind,
           'label', case a2.kind
                      when 'invoice' then coalesce('INV-' || lpad(i.invoice_number::text, 6, '0'), 'Invoice')
                      when 'opening_balance' then 'Opening balance'
                      else 'Adjustment' end,
           'date', a2.entry_date,
           'outstanding_before', a1.outstanding::text,
           'applied', (a2.allocated - a1.allocated)::numeric(18, 2)::text,
           'outstanding_after', a2.outstanding::text
         ) order by a2.ord), '[]'::jsonb)
    into v_settles
    from public.ledger_allocation(v_biz, array[p_store], 0) a1
    join public.ledger_allocation(v_biz, array[p_store], p_amount) a2 on a2.entry_id = a1.entry_id
    left join public.invoices i on i.business_id = v_biz and i.id = a2.invoice_id
   where a2.allocated > a1.allocated;

  return jsonb_build_object(
    'found', true,
    'valid', true,
    'balance_before', v_balance::text,
    'balance_after', (v_balance - p_amount)::numeric(18, 2)::text,
    'advance_after', greatest(p_amount - v_balance, 0)::numeric(18, 2)::text,
    'settles', v_settles
  );
end;
$$;

-- The Store Statement data: the balance at the start of the range, the entries of the range in (date, order of
-- recording) order with a running balance, the totals and the closing balance. At most 2,000 lines are returned.
create or replace function public.ledger_statement(p_store uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_store jsonb;
  v_business jsonb;
  v_opening numeric(18, 2);
  v_debit numeric(18, 2);
  v_credit numeric(18, 2);
  v_count integer;
  v_entries jsonb;
begin
  select jsonb_build_object('id', s.id, 'name', s.name, 'contact_person', s.contact_person, 'phone', s.phone,
                            'address', s.address)
    into v_store
    from public.stores s
   where s.business_id = v_biz and s.id = p_store;
  if v_store is null then
    return jsonb_build_object('found', false);
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    return jsonb_build_object('found', true, 'valid', false, 'reason', 'invalid_range');
  end if;

  select jsonb_build_object('name', b.name, 'phone', st.phone, 'address', st.address)
    into v_business
    from public.businesses b
    left join public.business_settings st on st.business_id = b.id
   where b.id = v_biz;

  select (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18, 2)
    into v_opening
    from public.ledger_entries e
   where e.business_id = v_biz and e.store_id = p_store and e.entry_date < p_from;

  select coalesce(sum(e.debit), 0)::numeric(18, 2), coalesce(sum(e.credit), 0)::numeric(18, 2), count(*)::integer
    into v_debit, v_credit, v_count
    from public.ledger_entries e
   where e.business_id = v_biz and e.store_id = p_store and e.entry_date between p_from and p_to;

  with ordered as materialized (
    select e as entry,
           v_opening + sum(e.debit - e.credit) over (order by e.entry_date, e.seq
                                                     rows between unbounded preceding and current row) as running
      from public.ledger_entries e
     where e.business_id = v_biz and e.store_id = p_store and e.entry_date between p_from and p_to
  ),
  page as (
    select o.entry, o.running from ordered o order by (o.entry).entry_date, (o.entry).seq limit 2000
  )
  select coalesce(jsonb_agg(public.ledger_entry_obj(
           p.entry,
           i.invoice_number,
           (select r.id from public.ledger_entries r
             where r.business_id = v_biz and r.reverses_entry_id = (p.entry).id and r.entry_type = 'reversal'),
           p.running) order by (p.entry).entry_date, (p.entry).seq), '[]'::jsonb)
    into v_entries
    from page p
    left join public.invoices i on i.business_id = v_biz and i.id = (p.entry).invoice_id;

  return jsonb_build_object(
    'found', true,
    'valid', true,
    'business', v_business,
    'store', v_store,
    'from', p_from,
    'to', p_to,
    'opening_balance', v_opening::text,
    'entries', v_entries,
    'total_debit', v_debit::text,
    'total_credit', v_credit::text,
    'closing_balance', (v_opening + v_debit - v_credit)::numeric(18, 2)::text,
    'truncated', v_count > 2000
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- invoice_json: the account fields (Module 006 object, replaced)
-- ---------------------------------------------------------------------------

create or replace function public.invoice_json(p_biz uuid, p_id uuid, p_with_events boolean)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_inv public.invoices;
  v_order public.orders;
  v_lines jsonb;
  v_blockers jsonb;
  v_business jsonb;
  v_store jsonb;
  v_events jsonb := null;
  v_result jsonb;
  v_stale boolean;
  v_nothing boolean;
  v_ready boolean;
  v_pay_status text := null;
  v_paid text := null;
  v_outstanding text := null;
  v_summary jsonb := null;
  v_alloc record;
begin
  select * into v_inv from public.invoices i where i.business_id = p_biz and i.id = p_id;
  if not found then
    return null;
  end if;
  select * into v_order from public.orders o where o.business_id = p_biz and o.id = v_inv.order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id,
           'position', l.position,
           'name', l.name,
           'strength', l.strength,
           'dosage_form', l.dosage_form,
           'pack_size', l.pack_size,
           'manufacturer', l.manufacturer,
           'unit', l.unit,
           'ordered_quantity', l.ordered_quantity,
           'delivered_quantity', l.delivered_quantity,
           'selling_price', l.selling_price::text,
           'line_total', l.line_total::text,
           'billed', l.delivered_quantity > 0,
           'needs_price', l.delivered_quantity > 0 and (l.product_id is null or l.selling_price is null),
           'typed', l.product_id is null,
           'more_than_ordered', l.delivered_quantity > l.ordered_quantity
         ) order by l.position), '[]'::jsonb)
    into v_lines
    from public.invoice_lines l
   where l.business_id = p_biz and l.invoice_id = p_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', l.id,
           'name', l.name,
           'reason', case when l.product_id is null then 'typed' else 'needs_price' end
         ) order by l.position), '[]'::jsonb)
    into v_blockers
    from public.invoice_lines l
   where l.business_id = p_biz and l.invoice_id = p_id
     and l.delivered_quantity > 0 and (l.product_id is null or l.selling_price is null);

  select not exists (
           select 1 from public.invoice_lines l
            where l.business_id = p_biz and l.invoice_id = p_id and l.delivered_quantity > 0)
    into v_nothing;

  v_stale := v_inv.status = 'draft'
             and v_inv.source_fingerprint is distinct from public.order_lines_fingerprint(p_biz, v_inv.order_id);

  v_ready := v_inv.status = 'draft'
             and v_order.status = 'confirmed'
             and not v_stale
             and jsonb_array_length(v_blockers) = 0
             and not v_nothing;

  if v_inv.status = 'draft' then
    -- A draft shows the live business and store details; they are frozen at issue time.
    select jsonb_build_object('name', b.name, 'phone', s.phone, 'address', s.address)
      into v_business
      from public.businesses b
      left join public.business_settings s on s.business_id = b.id
     where b.id = p_biz;
    select jsonb_build_object('id', st.id, 'name', st.name, 'contact_person', st.contact_person,
                              'phone', st.phone, 'address', st.address)
      into v_store
      from public.stores st
     where st.business_id = p_biz and st.id = v_inv.store_id;
  else
    v_business := jsonb_build_object('name', v_inv.business_name, 'phone', v_inv.business_phone,
                                     'address', v_inv.business_address);
    v_store := jsonb_build_object('id', v_inv.store_id, 'name', v_inv.store_name, 'contact_person', v_inv.store_contact,
                                  'phone', v_inv.store_phone, 'address', v_inv.store_address);
  end if;

  -- The derived paid status, only for an issued invoice that is in the account. An invoice with a grand total of 0.00
  -- has no ledger entry (an entry needs an amount above 0) and owes nothing, so it counts as paid.
  if v_inv.in_account and v_inv.status = 'issued' then
    select a.status, a.allocated, a.outstanding into v_alloc
      from public.ledger_allocation(p_biz, array[v_inv.store_id], 0) a
     where a.invoice_id = p_id and a.kind = 'invoice';
    if found then
      v_pay_status := v_alloc.status;
      v_paid := v_alloc.allocated::numeric(18, 2)::text;
      v_outstanding := v_alloc.outstanding::numeric(18, 2)::text;
    else
      v_pay_status := 'paid';
      v_paid := '0.00';
      v_outstanding := '0.00';
    end if;
  end if;

  if v_inv.in_account then
    v_summary := jsonb_build_object(
      'balance_date', v_inv.invoice_date,
      'previous_balance', v_inv.summary_previous::text,
      'previous_is_advance', v_inv.summary_previous < 0,
      'this_invoice', v_inv.grand_total::text,
      'payment_received', v_inv.summary_payment::text,
      'balance_due', v_inv.summary_due::text,
      'due_is_advance', v_inv.summary_due < 0);
  end if;

  if p_with_events then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.id,
             'event_type', e.event_type,
             'created_at', e.created_at,
             'mine', e.actor is not distinct from auth.uid(),
             'detail', e.detail
           ) order by e.created_at desc, e.id desc), '[]'::jsonb)
      into v_events
      from public.invoice_events e
     where e.business_id = p_biz and e.invoice_id = p_id;
  end if;

  v_result := jsonb_build_object(
    'id', v_inv.id,
    'order_id', v_inv.order_id,
    'order_number', v_order.order_number,
    'order_status', v_order.status,
    'status', v_inv.status,
    'invoice_number', v_inv.invoice_number,
    'number_label', case when v_inv.invoice_number is null then null
                         else 'INV-' || lpad(v_inv.invoice_number::text, 6, '0') end,
    'invoice_date', v_inv.invoice_date,
    'issued_at', v_inv.issued_at,
    'issued_by_me', v_inv.issued_by is not distinct from auth.uid(),
    'cancelled_at', v_inv.cancelled_at,
    'cancel_reason', v_inv.cancel_reason,
    'version', v_inv.version,
    'stale', v_stale,
    'ready_to_issue', v_ready,
    'nothing_to_bill', v_nothing,
    'blockers', v_blockers,
    'grand_total', v_inv.grand_total::text,
    'business', v_business,
    'store', v_store,
    'lines', v_lines
  );
  v_result := v_result || jsonb_build_object(
    'in_account', v_inv.in_account,
    'payment_status', v_pay_status,
    'amount_paid', v_paid,
    'amount_outstanding', v_outstanding,
    'account_summary', v_summary
  );
  if p_with_events then
    v_result := v_result || jsonb_build_object('events', v_events);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- invoice_list: the payment status filter and two keys per row (Module 006 object, replaced)
-- ---------------------------------------------------------------------------

drop function if exists public.invoice_list(text, uuid, date, date, uuid, text, int, int);

create or replace function public.invoice_list(
  p_status text, p_store uuid, p_from date, p_to date, p_order uuid, p_q text, p_limit int, p_offset int,
  p_payment_status text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_q text := btrim(coalesce(p_q, ''));
  v_num int := case when btrim(coalesce(p_q, '')) ~* '^(inv-?)?[0-9]{1,9}$'
                    then regexp_replace(btrim(p_q), '^inv-?', '', 'i')::int end;
  v_status text := coalesce(nullif(btrim(p_status), ''), 'all');
  v_pay text := coalesce(nullif(btrim(p_payment_status), ''), 'all');
  v_filter boolean := coalesce(nullif(btrim(p_payment_status), ''), 'all') in ('unpaid', 'partially_paid', 'paid');
  v_result jsonb;
begin
  with inv_rows as materialized (
    select i.id, i.status, i.invoice_number, i.invoice_date, i.order_id, o.order_number, i.store_id,
           coalesce(i.store_name, s.name) as store_name, i.grand_total, i.created_at, i.in_account
      from public.invoices i
      join public.orders o on o.business_id = i.business_id and o.id = i.order_id
      join public.stores s on s.business_id = i.business_id and s.id = i.store_id
     where i.business_id = v_biz
       and (v_status = 'all' or i.status = v_status)
       and (p_store is null or i.store_id = p_store)
       and (p_order is null or i.order_id = p_order)
       and (p_from is null or coalesce(i.invoice_date, (i.created_at at time zone 'Asia/Karachi')::date) >= p_from)
       and (p_to is null or coalesce(i.invoice_date, (i.created_at at time zone 'Asia/Karachi')::date) <= p_to)
       and (v_q = ''
            or (v_num is not null and i.invoice_number = v_num)
            or public.pending_search_ok(coalesce(i.store_name, s.name), null, v_q))
  ),
  -- With a payment status filter the allocation is needed for every store of the matching invoices; without one it
  -- is computed below only for the stores on the returned page (an empty store list computes nothing).
  alloc_filter as materialized (
    select a.invoice_id, a.status
      from public.ledger_allocation(
             v_biz,
             case when v_filter
                  then coalesce((select array_agg(distinct r.store_id) from inv_rows r
                                  where r.in_account and r.status = 'issued'), array[]::uuid[])
                  else array[]::uuid[] end,
             0) a
     where a.kind = 'invoice'
  ),
  rows2 as materialized (
    select r.*
      from inv_rows r
      left join alloc_filter af on af.invoice_id = r.id
     where not v_filter
        or (r.in_account and r.status = 'issued' and coalesce(af.status, 'paid') = v_pay)
  ),
  page as (
    select r.*
      from rows2 r
     order by r.created_at desc, r.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  alloc_page as materialized (
    select a.invoice_id, a.status
      from public.ledger_allocation(
             v_biz,
             case when v_filter then array[]::uuid[]
                  else coalesce((select array_agg(distinct p.store_id) from page p
                                  where p.in_account and p.status = 'issued'), array[]::uuid[]) end,
             0) a
     where a.kind = 'invoice'
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', p.id,
                'status', p.status,
                'number_label', case when p.invoice_number is null then null
                                     else 'INV-' || lpad(p.invoice_number::text, 6, '0') end,
                'invoice_date', p.invoice_date,
                'order_id', p.order_id,
                'order_number', p.order_number,
                'store_id', p.store_id,
                'store_name', p.store_name,
                'grand_total', p.grand_total::text,
                'in_account', p.in_account,
                'payment_status', case when p.in_account and p.status = 'issued'
                                       then coalesce(af.status, ap.status, 'paid') end,
                'created_at', p.created_at
              ) order by p.created_at desc, p.id desc)
                 from page p
                 left join alloc_filter af on af.invoice_id = p.id
                 left join alloc_page ap on ap.invoice_id = p.id), '[]'::jsonb),
    'total', (select count(*) from rows2)
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- invoice_issue: the optional payment, the invoice entry and the Account Summary snapshot (replaced)
-- ---------------------------------------------------------------------------

drop function if exists public.invoice_issue(uuid, int);

create or replace function public.invoice_issue(p_id uuid, p_expected_version int, p_payment numeric default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_inv public.invoices;
  v_order public.orders;
  v_now timestamptz := now();
  v_blockers jsonb;
  v_total numeric(18, 2);
  v_number integer;
  v_bname text;
  v_bphone text;
  v_baddr text;
  v_sname text;
  v_scontact text;
  v_sphone text;
  v_saddr text;
  v_changes jsonb;
  v_billed integer;
  v_lines integer;
  v_invoice_version integer;
  v_order_version integer;
  v_label text;
  v_date date := (now() at time zone 'Asia/Karachi')::date;
  v_payment numeric(18, 2);
  v_prev numeric(18, 2);
  v_due numeric(18, 2);
  v_entry public.ledger_entries;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice:' || v_biz::text || ':' || p_id::text));

  select * into v_inv from public.invoices i where i.business_id = v_biz and i.id = p_id for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  -- Already issued (a retry, a double tap or a second device): show it, change nothing, use no number, and record no
  -- second payment whatever amount the repeat carries.
  if v_inv.status = 'issued' then
    return jsonb_build_object('done', true, 'replayed', true, 'invoice', public.invoice_json(v_biz, p_id, true));
  end if;
  if v_inv.status <> 'draft' then
    return jsonb_build_object('done', false, 'reason', 'invoice_not_draft',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;

  perform pg_advisory_xact_lock(hashtext('order:' || v_inv.order_id::text));
  select * into v_order from public.orders o where o.business_id = v_biz and o.id = v_inv.order_id for update;

  if p_expected_version is null or v_inv.version <> p_expected_version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;
  if v_order.status <> 'confirmed' then
    return jsonb_build_object('done', false, 'reason', 'order_not_confirmed');
  end if;
  if v_inv.source_fingerprint is distinct from public.order_lines_fingerprint(v_biz, v_inv.order_id) then
    return jsonb_build_object('done', false, 'reason', 'order_changed');
  end if;

  select count(*) filter (where l.delivered_quantity > 0), count(*)
    into v_billed, v_lines
    from public.invoice_lines l
   where l.business_id = v_biz and l.invoice_id = p_id;
  if v_billed = 0 then
    return jsonb_build_object('done', false, 'reason', 'nothing_to_bill');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', l.id, 'name', l.name,
           'reason', case when l.product_id is null then 'typed' else 'needs_price' end) order by l.position), '[]'::jsonb)
    into v_blockers
    from public.invoice_lines l
   where l.business_id = v_biz and l.invoice_id = p_id
     and l.delivered_quantity > 0 and (l.product_id is null or l.selling_price is null);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('done', false, 'reason', 'not_ready', 'blockers', v_blockers);
  end if;

  -- The payment received now is validated BEFORE any number is taken, so a refusal uses no number.
  if p_payment is not null then
    if not public.ledger_amount_ok(p_payment) then
      return jsonb_build_object('done', false, 'reason', 'invalid_amount',
                                'fields', jsonb_build_object('payment_received',
                                  'Enter an amount above 0 with at most two decimals.'));
    end if;
    v_payment := p_payment;
  end if;

  -- The total is recomputed from the lines, never trusted from the draft.
  select coalesce(sum(l.line_total), 0)::numeric(18, 2) into v_total
    from public.invoice_lines l
   where l.business_id = v_biz and l.invoice_id = p_id and l.delivered_quantity > 0;

  -- The store's ledger, after the invoice and the order (the lock order of the module). Under this lock the balance
  -- read below is exact: every entry recorded before this one is visible and none can slip in before it.
  perform pg_advisory_xact_lock(hashtext('ledger:' || v_biz::text || ':' || v_inv.store_id::text));
  select (coalesce(sum(e.debit), 0) - coalesce(sum(e.credit), 0))::numeric(18, 2) into v_prev
    from public.ledger_entries e
   where e.business_id = v_biz and e.store_id = v_inv.store_id;
  v_due := (v_prev + v_total - coalesce(v_payment, 0))::numeric(18, 2);

  -- The next number. The counter row stays locked until this transaction ends, so two simultaneous issues get
  -- two different numbers, and a failure below rolls the number back.
  insert into public.invoice_counters as c (business_id, last_number) values (v_biz, 1)
  on conflict (business_id) do update set last_number = c.last_number + 1
  returning c.last_number into v_number;
  v_label := 'INV-' || lpad(v_number::text, 6, '0');

  select b.name into v_bname from public.businesses b where b.id = v_biz;
  select s.phone, s.address into v_bphone, v_baddr from public.business_settings s where s.business_id = v_biz;
  select st.name, st.contact_person, st.phone, st.address into v_sname, v_scontact, v_sphone, v_saddr
    from public.stores st where st.business_id = v_biz and st.id = v_inv.store_id;

  update public.invoices i
     set status = 'issued',
         invoice_number = v_number,
         invoice_date = v_date,
         issued_at = v_now,
         issued_by = auth.uid(),
         grand_total = v_total,
         business_name = v_bname,
         business_phone = v_bphone,
         business_address = v_baddr,
         store_name = v_sname,
         store_contact = v_scontact,
         store_phone = v_sphone,
         store_address = v_saddr,
         in_account = true,
         summary_previous = v_prev,
         summary_payment = v_payment,
         summary_due = v_due
   where i.business_id = v_biz and i.id = p_id;

  -- The invoice entry (an invoice with a grand total of 0.00 has no entry: an entry needs an amount above 0) and the
  -- payment received now, in the same transaction.
  if v_total > 0 then
    v_entry := public.ledger_insert_entry(v_biz, v_inv.store_id, gen_random_uuid(), 'invoice', v_date, v_total, 0,
                                          p_id, null, null, null, null);
  end if;
  if v_payment is not null then
    v_entry := public.ledger_insert_entry(v_biz, v_inv.store_id, gen_random_uuid(), 'payment', v_date, 0, v_payment,
                                          p_id, null, 'cash', null, null);
  end if;

  -- The order tells the truth about what was delivered: the delivered quantities are written to its lines.
  select coalesce(jsonb_agg(jsonb_build_object('line_id', ol.id, 'name', ol.name,
                                               'old', ol.delivered_quantity, 'new', il.delivered_quantity)
                            order by il.position), '[]'::jsonb)
    into v_changes
    from public.invoice_lines il
    join public.order_lines ol on ol.business_id = il.business_id and ol.id = il.order_line_id
   where il.business_id = v_biz and il.invoice_id = p_id
     and ol.delivered_quantity is distinct from il.delivered_quantity;

  update public.order_lines ol
     set delivered_quantity = il.delivered_quantity
    from public.invoice_lines il
   where il.business_id = v_biz and il.invoice_id = p_id and il.order_line_id = ol.id
     and ol.business_id = v_biz and ol.delivered_quantity is distinct from il.delivered_quantity;

  update public.orders o set status = 'fulfilled' where o.business_id = v_biz and o.id = v_inv.order_id;

  select i.version into v_invoice_version from public.invoices i where i.business_id = v_biz and i.id = p_id;
  select o.version into v_order_version from public.orders o where o.business_id = v_biz and o.id = v_inv.order_id;

  insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version, actor, detail)
  values (v_biz, p_id, v_inv.order_id, 'issued', v_invoice_version, auth.uid(),
          jsonb_build_object('issued', jsonb_build_object(
            'invoice_number', v_number, 'number_label', v_label, 'grand_total', v_total::text,
            'line_count', v_lines, 'billed_lines', v_billed,
            'previous_balance', v_prev::text, 'payment_received', v_payment::text, 'balance_due', v_due::text)));

  insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
  values (v_biz, v_inv.order_id, 'invoiced', v_order_version, auth.uid(),
          jsonb_build_object('invoiced', jsonb_build_object(
            'invoice_id', p_id, 'invoice_number', v_number, 'number_label', v_label,
            'grand_total', v_total::text, 'delivered_changes', v_changes)));

  return jsonb_build_object('done', true, 'replayed', false, 'invoice', public.invoice_json(v_biz, p_id, true));
end;
$$;

-- ---------------------------------------------------------------------------
-- invoice_cancel: the reversal entry for an invoice that is in the account (replaced)
-- ---------------------------------------------------------------------------

create or replace function public.invoice_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_inv public.invoices;
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_changes jsonb;
  v_invoice_version integer;
  v_order_version integer;
  v_label text;
  v_entry_id uuid;
  v_entry public.ledger_entries;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice:' || v_biz::text || ':' || p_id::text));

  select * into v_inv from public.invoices i where i.business_id = v_biz and i.id = p_id for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  -- Already cancelled (a retry or a second device): the first cancellation and its reason stay, and no second
  -- reversal is added.
  if v_inv.status = 'cancelled' then
    return jsonb_build_object('done', true, 'replayed', true, 'invoice', public.invoice_json(v_biz, p_id, true));
  end if;
  if v_inv.status <> 'issued' then
    return jsonb_build_object('done', false, 'reason', 'invoice_not_issued');
  end if;
  if v_reason is null then
    return jsonb_build_object('done', false, 'reason', 'reason_required');
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('done', false, 'reason', 'reason_too_long');
  end if;

  perform pg_advisory_xact_lock(hashtext('order:' || v_inv.order_id::text));
  select * into v_order from public.orders o where o.business_id = v_biz and o.id = v_inv.order_id for update;

  v_label := 'INV-' || lpad(v_inv.invoice_number::text, 6, '0');

  update public.invoices i
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancel_reason = v_reason
   where i.business_id = v_biz and i.id = p_id;

  -- An invoice that is in the account gets one reversal of its invoice entry, in the same transaction. A payment
  -- received with the invoice is not touched. An invoice issued before the store accounts, or with a grand total of
  -- 0.00, has no invoice entry and adds nothing.
  if v_inv.in_account then
    perform pg_advisory_xact_lock(hashtext('ledger:' || v_biz::text || ':' || v_inv.store_id::text));
    select e.id into v_entry_id
      from public.ledger_entries e
     where e.business_id = v_biz and e.invoice_id = p_id and e.entry_type = 'invoice';
    if v_entry_id is not null then
      v_entry := public.ledger_insert_entry(v_biz, v_inv.store_id, gen_random_uuid(), 'reversal',
                                            (now() at time zone 'Asia/Karachi')::date, 0, v_inv.grand_total,
                                            p_id, v_entry_id, null, null, v_reason);
    end if;
  end if;

  -- The delivered quantities go back to the ordered quantities (the default); the cancelled invoice keeps the
  -- figures that were billed.
  select coalesce(jsonb_agg(jsonb_build_object('line_id', ol.id, 'name', ol.name,
                                               'old', ol.delivered_quantity, 'new', ol.quantity)
                            order by ol.position), '[]'::jsonb)
    into v_changes
    from public.order_lines ol
   where ol.business_id = v_biz and ol.order_id = v_inv.order_id and ol.removed_at is null
     and ol.delivered_quantity is distinct from ol.quantity;

  update public.order_lines ol
     set delivered_quantity = ol.quantity
   where ol.business_id = v_biz and ol.order_id = v_inv.order_id and ol.removed_at is null
     and ol.delivered_quantity is distinct from ol.quantity;

  if v_order.status = 'fulfilled' then
    update public.orders o set status = 'confirmed' where o.business_id = v_biz and o.id = v_inv.order_id;
  end if;

  select i.version into v_invoice_version from public.invoices i where i.business_id = v_biz and i.id = p_id;
  select o.version into v_order_version from public.orders o where o.business_id = v_biz and o.id = v_inv.order_id;

  insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version, actor, detail)
  values (v_biz, p_id, v_inv.order_id, 'cancelled', v_invoice_version, auth.uid(),
          jsonb_build_object('cancelled', jsonb_build_object('number_label', v_label, 'reason', v_reason)));

  insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
  values (v_biz, v_inv.order_id, 'invoice_cancelled', v_order_version, auth.uid(),
          jsonb_build_object('invoice_cancelled', jsonb_build_object(
            'invoice_id', p_id, 'invoice_number', v_inv.invoice_number, 'number_label', v_label,
            'reason', v_reason, 'delivered_reset', v_changes)));

  return jsonb_build_object('done', true, 'replayed', false, 'invoice', public.invoice_json(v_biz, p_id, true));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.ledger_amount_ok(numeric) from public, anon;
revoke all on function public.ledger_balances(uuid) from public, anon;
revoke all on function public.ledger_allocation(uuid, uuid[], numeric) from public, anon;
revoke all on function public.ledger_entry_obj(public.ledger_entries, integer, uuid, numeric) from public, anon;
revoke all on function public.ledger_entry_json(uuid, uuid) from public, anon;
revoke all on function public.ledger_opening_add(uuid, uuid, numeric, text, date, text) from public, anon;
revoke all on function public.ledger_payment_add(uuid, uuid, numeric, date, text, text) from public, anon;
revoke all on function public.ledger_adjustment_add(uuid, uuid, numeric, text, text, date) from public, anon;
revoke all on function public.ledger_entry_reverse(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.ledger_stores(text, boolean, int, int) from public, anon;
revoke all on function public.ledger_summary() from public, anon;
revoke all on function public.ledger_account(uuid, int, int) from public, anon;
revoke all on function public.ledger_payment_preview(uuid, numeric) from public, anon;
revoke all on function public.ledger_statement(uuid, date, date) from public, anon;
revoke all on function public.invoice_json(uuid, uuid, boolean) from public, anon;
revoke all on function public.invoice_list(text, uuid, date, date, uuid, text, int, int, text) from public, anon;
revoke all on function public.invoice_issue(uuid, int, numeric) from public, anon;
revoke all on function public.invoice_cancel(uuid, text) from public, anon;

-- The only insert into the ledger: no user can call it.
revoke all on function public.ledger_insert_entry(uuid, uuid, uuid, text, date, numeric, numeric, uuid, uuid, text, text, text)
  from public, anon, authenticated;

grant execute on function public.ledger_amount_ok(numeric) to authenticated;
grant execute on function public.ledger_balances(uuid) to authenticated;
grant execute on function public.ledger_allocation(uuid, uuid[], numeric) to authenticated;
grant execute on function public.ledger_entry_obj(public.ledger_entries, integer, uuid, numeric) to authenticated;
grant execute on function public.ledger_entry_json(uuid, uuid) to authenticated;
grant execute on function public.ledger_opening_add(uuid, uuid, numeric, text, date, text) to authenticated;
grant execute on function public.ledger_payment_add(uuid, uuid, numeric, date, text, text) to authenticated;
grant execute on function public.ledger_adjustment_add(uuid, uuid, numeric, text, text, date) to authenticated;
grant execute on function public.ledger_entry_reverse(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.ledger_stores(text, boolean, int, int) to authenticated;
grant execute on function public.ledger_summary() to authenticated;
grant execute on function public.ledger_account(uuid, int, int) to authenticated;
grant execute on function public.ledger_payment_preview(uuid, numeric) to authenticated;
grant execute on function public.ledger_statement(uuid, date, date) to authenticated;
grant execute on function public.invoice_json(uuid, uuid, boolean) to authenticated;
grant execute on function public.invoice_list(text, uuid, date, date, uuid, text, int, int, text) to authenticated;
grant execute on function public.invoice_issue(uuid, int, numeric) to authenticated;
grant execute on function public.invoice_cancel(uuid, text) to authenticated;

commit;
