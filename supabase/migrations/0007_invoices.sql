-- Module 006: invoices (draft, issue, cancel), invoice numbers, invoice history and order sheets.
--
-- Invoices are written ONLY through the functions below (invoice_create, invoice_set_quantities, invoice_refresh,
-- invoice_discard, invoice_issue, invoice_cancel); signed-in users get SELECT only on the invoice tables, so a direct
-- request cannot skip a number rule, a price check, the freeze or the history. Every function reads the business from
-- current_business_id() and filters every statement by it; composite foreign keys also tie every reference to the same
-- business. NO invoice table has a purchase price, MRP or cost column: nothing here can return one.
--
-- Three Module 003 objects change (and nothing else of Modules 003 to 005):
--   * orders_guard: confirmed -> fulfilled and fulfilled -> confirmed are allowed (issue and cancel of an invoice);
--   * order_events.event_type: two new kinds, 'invoiced' and 'invoice_cancelled';
--   * order_lines.delivered_quantity: the check becomes >= 0 (a line may be billed as 0).
--
-- Roll back (safe only while no invoice has been issued: an issued invoice makes the restored order guard and checks
-- refuse existing rows):
--   drop function if exists public.invoice_create(uuid, uuid), public.invoice_set_quantities(uuid, int, jsonb),
--     public.invoice_refresh(uuid, int), public.invoice_discard(uuid, int), public.invoice_issue(uuid, int),
--     public.invoice_cancel(uuid, text), public.invoice_build_lines(uuid, uuid, uuid),
--     public.invoice_recompute_total(uuid, uuid), public.invoice_get(uuid),
--     public.invoice_list(text, uuid, date, date, uuid, text, int, int), public.invoice_todo(text, int, int),
--     public.invoice_summary(), public.invoice_todo_rows(), public.invoice_orders_summary(uuid),
--     public.invoice_json(uuid, uuid, boolean), public.order_lines_fingerprint(uuid, uuid),
--     public.order_sheet(uuid[]), public.order_sheet_day(date, uuid[]);
--   drop table if exists public.invoice_events, public.invoice_lines, public.invoices, public.invoice_counters;
--   drop function if exists public.invoices_guard(), public.invoices_no_delete(), public.invoice_lines_guard(),
--     public.invoice_events_append_only();
--   (then restore orders_guard, the order_events check and the delivered_quantity check from 0003 and 0004)

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per business: the source of invoice numbers. Updated in the same transaction that issues the invoice, so
-- numbers are never duplicated and a failed issue rolls the counter back.
create table if not exists public.invoice_counters (
  business_id  uuid primary key references public.businesses (id) on delete restrict,
  last_number  integer not null default 0 check (last_number >= 0)
);

create table if not exists public.invoices (
  id                  uuid not null,
  business_id         uuid not null default public.current_business_id()
                        references public.businesses (id) on delete restrict,
  order_id            uuid not null,
  store_id            uuid not null,
  status              text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  invoice_number      integer check (invoice_number is null or invoice_number >= 1),
  invoice_date        date,
  issued_at           timestamptz,
  issued_by           uuid,
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancel_reason       text check (cancel_reason is null or char_length(btrim(cancel_reason)) between 1 and 500),
  grand_total         numeric(18, 2) not null default 0 check (grand_total >= 0),
  source_fingerprint  text not null,
  -- Copied at issue time, so a reprint always shows the same header.
  business_name       text,
  business_phone      text,
  business_address    text,
  store_name          text,
  store_contact       text,
  store_phone         text,
  store_address       text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,
  constraint invoices_pkey primary key (business_id, id),
  constraint invoices_order_fk foreign key (business_id, order_id) references public.orders (business_id, id),
  constraint invoices_store_fk foreign key (business_id, store_id) references public.stores (business_id, id),
  constraint invoices_number_uniq unique (business_id, invoice_number),
  constraint invoices_draft_shape check (
    status <> 'draft'
    or (invoice_number is null and invoice_date is null and issued_at is null and cancelled_at is null
        and cancel_reason is null and business_name is null and store_name is null)
  ),
  constraint invoices_issued_shape check (
    status = 'draft'
    or (invoice_number is not null and invoice_date is not null and issued_at is not null
        and business_name is not null and store_name is not null)
  ),
  constraint invoices_cancelled_shape check (
    (status = 'cancelled' and cancelled_at is not null and cancel_reason is not null)
    or (status <> 'cancelled' and cancelled_at is null and cancel_reason is null)
  )
);

-- At most one live (draft or issued) invoice per order, whatever code path runs.
create unique index if not exists invoices_order_live_idx
  on public.invoices (business_id, order_id) where status in ('draft', 'issued');
create index if not exists invoices_list_idx on public.invoices (business_id, created_at desc, id desc);
create index if not exists invoices_store_idx on public.invoices (business_id, store_id, created_at desc);

create table if not exists public.invoice_lines (
  id                  uuid not null default gen_random_uuid(),
  business_id         uuid not null default public.current_business_id()
                        references public.businesses (id) on delete restrict,
  invoice_id          uuid not null,
  position            integer not null check (position >= 1),
  order_line_id       uuid,
  product_id          uuid,
  name                text not null check (char_length(btrim(name)) between 1 and 200),
  strength            text check (strength is null or char_length(strength) <= 100),
  dosage_form         text check (dosage_form is null or char_length(dosage_form) <= 100),
  pack_size           text check (pack_size is null or char_length(pack_size) <= 100),
  manufacturer        text check (manufacturer is null or char_length(manufacturer) <= 200),
  unit                text not null check (char_length(btrim(unit)) between 1 and 50),
  ordered_quantity    integer not null check (ordered_quantity between 1 and 100000),
  delivered_quantity  integer not null check (delivered_quantity between 0 and 100000),
  selling_price       numeric(12, 2) check (selling_price is null or selling_price >= 0),
  line_total          numeric(18, 2) generated always as (
                        case when selling_price is null then null
                             else (delivered_quantity * selling_price)::numeric(18, 2) end
                      ) stored,
  created_at          timestamptz not null default now(),
  constraint invoice_lines_pkey primary key (business_id, id),
  constraint invoice_lines_invoice_fk foreign key (business_id, invoice_id) references public.invoices (business_id, id),
  constraint invoice_lines_order_line_fk foreign key (business_id, order_line_id) references public.order_lines (business_id, id),
  constraint invoice_lines_product_fk foreign key (business_id, product_id) references public.products (business_id, id),
  constraint invoice_lines_position_uniq unique (business_id, invoice_id, position)
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (business_id, invoice_id, position);

-- Append-only history. No foreign key to invoices: a discarded draft is deleted and its history entry stays.
create table if not exists public.invoice_events (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null default public.current_business_id()
                     references public.businesses (id) on delete restrict,
  invoice_id       uuid not null,
  order_id         uuid not null,
  event_type       text not null check (event_type in ('created', 'edited', 'refreshed', 'issued', 'cancelled', 'discarded')),
  invoice_version  integer not null,
  actor            uuid default auth.uid(),
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists invoice_events_invoice_idx on public.invoice_events (business_id, invoice_id, created_at desc);
create index if not exists invoice_events_order_idx on public.invoice_events (business_id, order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Guards: an issued invoice never changes, history is append-only
-- ---------------------------------------------------------------------------

drop trigger if exists invoices_row_meta on public.invoices;
create trigger invoices_row_meta
  before insert or update on public.invoices
  for each row execute function public.set_row_meta();

create or replace function public.invoices_guard()
returns trigger
language plpgsql
as $$
declare
  v_ignore text[] := array['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'updated_at', 'version'];
begin
  if new.id is distinct from old.id
     or new.business_id is distinct from old.business_id
     or new.order_id is distinct from old.order_id
     or new.store_id is distinct from old.store_id
     or new.created_at is distinct from old.created_at then
    raise exception 'invoice_immutable: the order, store and identity of an invoice never change'
      using errcode = '22023';
  end if;

  if old.status = 'draft' then
    if new.status = 'cancelled' then
      raise exception 'invalid invoice status change from draft to cancelled' using errcode = '22023';
    end if;
    return new;
  end if;

  if old.status = 'issued' then
    -- The only change an issued invoice accepts: it becomes cancelled, with the cancellation fields set.
    if new.status <> 'cancelled' then
      raise exception 'invoice_immutable: an issued invoice can only be cancelled' using errcode = '22023';
    end if;
    if (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
      raise exception 'invoice_immutable: an issued invoice cannot be changed' using errcode = '22023';
    end if;
    return new;
  end if;

  raise exception 'invoice_immutable: a cancelled invoice cannot be changed' using errcode = '22023';
end;
$$;

drop trigger if exists invoices_guard on public.invoices;
create trigger invoices_guard
  before update on public.invoices
  for each row execute function public.invoices_guard();

-- Only a draft can be deleted (a discarded draft). Only the service role (tests and operations, never the app)
-- may delete anything else, for example to remove a test business.
create or replace function public.invoices_no_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' or current_user = 'service_role' then
    return old;
  end if;
  raise exception 'invoice_immutable: an issued or cancelled invoice cannot be deleted' using errcode = '22023';
end;
$$;

drop trigger if exists invoices_no_delete on public.invoices;
create trigger invoices_no_delete
  before delete on public.invoices
  for each row execute function public.invoices_no_delete();

-- Lines can be added, changed or removed only while the invoice is a draft.
create or replace function public.invoice_lines_guard()
returns trigger
language plpgsql
as $$
declare
  v_biz uuid;
  v_invoice uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    if current_user = 'service_role' then
      return old;
    end if;
    v_biz := old.business_id;
    v_invoice := old.invoice_id;
  else
    v_biz := new.business_id;
    v_invoice := new.invoice_id;
  end if;

  select i.status into v_status from public.invoices i where i.business_id = v_biz and i.id = v_invoice;
  if v_status is distinct from 'draft' then
    raise exception 'invoice_immutable: the lines of an issued or cancelled invoice cannot change' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.business_id is distinct from old.business_id
       or new.invoice_id is distinct from old.invoice_id
       or new.order_line_id is distinct from old.order_line_id then
      raise exception 'invoice_immutable: the identity of an invoice line never changes' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_lines_guard on public.invoice_lines;
create trigger invoice_lines_guard
  before insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_guard();

create or replace function public.invoice_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception 'invoice_events_append_only: the invoice history cannot be changed or deleted'
    using errcode = '22023';
end;
$$;

drop trigger if exists invoice_events_append_only on public.invoice_events;
create trigger invoice_events_append_only
  before update or delete on public.invoice_events
  for each row execute function public.invoice_events_append_only();

-- ---------------------------------------------------------------------------
-- Changes to Module 003 objects
-- ---------------------------------------------------------------------------

-- The same guard as 0003, with two more allowed status changes: issuing an invoice fulfils the order, cancelling the
-- invoice returns it to confirmed. Nothing else changes.
create or replace function public.orders_guard()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is distinct from old.order_number then
    raise exception 'order_number is immutable' using errcode = '22023';
  end if;
  if new.source is distinct from old.source then
    raise exception 'source is immutable' using errcode = '22023';
  end if;

  -- The store can change only while the order is a draft without any active line, so a line can never
  -- end up under a different store than the one it was entered for.
  if new.store_id is distinct from old.store_id then
    if old.status <> 'draft' or new.status <> 'draft' then
      raise exception 'store_id is immutable once an order is confirmed or cancelled' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_lines l
      where l.order_id = old.id and l.business_id = old.business_id and l.removed_at is null
    ) then
      raise exception 'store_id is immutable once an order has lines' using errcode = '22023';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('confirmed', 'cancelled'))
      or (old.status = 'confirmed' and new.status in ('cancelled', 'fulfilled'))
      or (old.status = 'fulfilled' and new.status = 'confirmed')
    ) then
      raise exception 'invalid status change from % to %', old.status, new.status using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.order_events'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%event_type%'
  loop
    execute format('alter table public.order_events drop constraint %I', v_name);
  end loop;
  alter table public.order_events
    add constraint order_events_event_type_check
    check (event_type in ('created', 'confirmed', 'edited', 'cancelled', 'linked', 'price_filled', 'invoiced', 'invoice_cancelled'));

  for v_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.order_lines'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%delivered_quantity%'
  loop
    execute format('alter table public.order_lines drop constraint %I', v_name);
  end loop;
  alter table public.order_lines
    add constraint order_lines_delivered_quantity_check
    check (delivered_quantity is null or delivered_quantity >= 0);
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges: read-only for signed-in users
-- ---------------------------------------------------------------------------

alter table public.invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_events enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists invoice_events_select on public.invoice_events;
create policy invoice_events_select on public.invoice_events
  for select to authenticated
  using (business_id = (select public.current_business_id()));

-- invoice_counters has no policy and no grant: only the issue function touches it.
revoke all on public.invoice_counters, public.invoices, public.invoice_lines, public.invoice_events from anon, authenticated;
grant select on public.invoices, public.invoice_lines, public.invoice_events to authenticated;

-- ---------------------------------------------------------------------------
-- Reading: SECURITY INVOKER, so Row Level Security applies (also when a helper is called directly).
-- Purchase price, MRP and cost are never selected here: no invoice table has such a column.
-- ---------------------------------------------------------------------------

-- A fingerprint of every order line fact that is copied onto an invoice. A draft stores it when its lines are built;
-- a different value later means the order changed and the draft is stale.
create or replace function public.order_lines_fingerprint(p_biz uuid, p_order uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select md5(coalesce(string_agg(
           concat_ws('|', ol.id::text, ol.position::text, coalesce(ol.product_id::text, ''), ol.name,
                     coalesce(ol.strength, ''), coalesce(ol.dosage_form, ''), coalesce(ol.pack_size, ''),
                     coalesce(ol.manufacturer, ''), ol.unit, ol.quantity::text,
                     coalesce(ol.selling_price_snapshot::text, '~')),
           E'\n' order by ol.position, ol.id), ''))
    from public.order_lines ol
   where ol.order_id = p_order and ol.business_id = p_biz and ol.removed_at is null
$$;

-- One invoice as JSON (null when it does not exist or belongs to another business).
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
  if p_with_events then
    v_result := v_result || jsonb_build_object('events', v_events);
  end if;
  return v_result;
end;
$$;

create or replace function public.invoice_get(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with j as (select public.invoice_json(public.current_business_id(), p_id, true) as v)
  select case when j.v is null then jsonb_build_object('found', false)
              else j.v || jsonb_build_object('found', true) end
    from j
$$;

-- The single definition of "to invoice": confirmed orders that have at least one active line. An order that
-- already has a draft stays on the list and shows the draft. The Home count and the list both read this.
create or replace function public.invoice_todo_rows()
returns table (
  order_id           uuid,
  order_number       integer,
  store_id           uuid,
  store_name         text,
  confirmed_at       timestamptz,
  line_count         integer,
  lines_without_price integer,
  draft_invoice_id   uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with biz as materialized (select public.current_business_id() as id),
  confirmed as materialized (
    select o.id, o.order_number, o.store_id, o.confirmed_at, o.business_id
      from public.orders o, biz
     where o.business_id = biz.id and o.status = 'confirmed'
  ),
  lines as materialized (
    select ol.order_id,
           count(*)::int as line_count,
           (count(*) filter (where ol.product_id is null or ol.selling_price_snapshot is null))::int as lines_without_price
      from public.order_lines ol, biz
     where ol.business_id = biz.id and ol.removed_at is null
       and ol.order_id in (select c.id from confirmed c)
     group by ol.order_id
  )
  select c.id, c.order_number, c.store_id, s.name, c.confirmed_at, l.line_count, l.lines_without_price, d.id
    from confirmed c
    join lines l on l.order_id = c.id
    join public.stores s on s.business_id = c.business_id and s.id = c.store_id
    left join public.invoices d on d.business_id = c.business_id and d.order_id = c.id and d.status = 'draft'
$$;

create or replace function public.invoice_todo(p_q text, p_limit int, p_offset int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as materialized (
    select r.*
      from public.invoice_todo_rows() r
     where btrim(coalesce(p_q, '')) = ''
        or public.pending_search_ok(r.store_name, r.order_number::text, p_q)
  ),
  page as (
    select f.*
      from filtered f
     order by f.confirmed_at desc, f.order_id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'order_id', p.order_id,
                'order_number', p.order_number,
                'store_id', p.store_id,
                'store_name', p.store_name,
                'confirmed_at', p.confirmed_at,
                'line_count', p.line_count,
                'lines_without_price', p.lines_without_price,
                'draft_invoice_id', p.draft_invoice_id
              ) order by p.confirmed_at desc, p.order_id desc) from page p), '[]'::jsonb),
    'total', (select count(*) from filtered)
  )
$$;

create or replace function public.invoice_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with biz as materialized (select public.current_business_id() as id)
  select jsonb_build_object(
    'to_invoice', (select count(*) from public.invoice_todo_rows()),
    'drafts', (select count(*) from public.invoices i, biz where i.business_id = biz.id and i.status = 'draft'),
    'issued_today', (select count(*) from public.invoices i, biz
                      where i.business_id = biz.id and i.status = 'issued'
                        and i.invoice_date = (now() at time zone 'Asia/Karachi')::date)
  )
$$;

create or replace function public.invoice_list(
  p_status text, p_store uuid, p_from date, p_to date, p_order uuid, p_q text, p_limit int, p_offset int
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
  v_result jsonb;
begin
  with inv_rows as materialized (
    select i.id, i.status, i.invoice_number, i.invoice_date, i.order_id, o.order_number, i.store_id,
           coalesce(i.store_name, s.name) as store_name, i.grand_total, i.created_at
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
  page as (
    select r.*
      from inv_rows r
     order by r.created_at desc, r.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
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
                'created_at', p.created_at
              ) order by p.created_at desc, p.id desc) from page p), '[]'::jsonb),
    'total', (select count(*) from inv_rows)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.invoice_orders_summary(p_order uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'status', i.status,
           'number_label', case when i.invoice_number is null then null
                                else 'INV-' || lpad(i.invoice_number::text, 6, '0') end,
           'invoice_date', i.invoice_date,
           'grand_total', i.grand_total::text,
           'created_at', i.created_at
         ) order by i.created_at desc, i.id desc), '[]'::jsonb)
    from public.invoices i
   where i.business_id = public.current_business_id() and i.order_id = p_order
$$;

-- ---------------------------------------------------------------------------
-- Order sheets (options A and B): quantities and units only, never a price. Each order of each store is its own
-- section, so items of different stores can never mix.
-- ---------------------------------------------------------------------------

create or replace function public.order_sheet(p_order_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with biz as materialized (select public.current_business_id() as id),
  orders_picked as materialized (
    select o.id, o.order_number, o.store_id, o.business_id,
           (coalesce(o.confirmed_at, o.created_at) at time zone 'Asia/Karachi')::date as order_date,
           o.confirmed_at
      from public.orders o, biz
     where o.business_id = biz.id
       and o.id = any (coalesce(p_order_ids, '{}'::uuid[]))
       and o.status in ('confirmed', 'fulfilled')
     order by o.confirmed_at, o.order_number
     limit 200
  )
  select jsonb_build_object(
    'business', (select jsonb_build_object('name', b.name, 'phone', s.phone, 'address', s.address)
                   from public.businesses b
                   left join public.business_settings s on s.business_id = b.id
                  where b.id = (select id from biz)),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', op.id,
               'order_number', op.order_number,
               'order_date', op.order_date,
               'store', jsonb_build_object('id', st.id, 'name', st.name, 'contact_person', st.contact_person,
                                           'phone', st.phone, 'address', st.address),
               'lines', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'position', ol.position,
                          'name', ol.name,
                          'strength', ol.strength,
                          'dosage_form', ol.dosage_form,
                          'pack_size', ol.pack_size,
                          'manufacturer', ol.manufacturer,
                          'quantity', ol.quantity,
                          'unit', ol.unit,
                          'unregistered', ol.product_id is null
                        ) order by ol.position, ol.id)
                   from public.order_lines ol
                  where ol.business_id = op.business_id and ol.order_id = op.id and ol.removed_at is null
               ), '[]'::jsonb)
             ) order by op.confirmed_at, op.order_number)
        from orders_picked op
        join public.stores st on st.business_id = op.business_id and st.id = op.store_id
    ), '[]'::jsonb)
  )
$$;

create or replace function public.order_sheet_day(p_date date, p_stores uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select public.order_sheet(coalesce((
    select array_agg(x.id)
      from (
        select o.id
          from public.orders o
         where o.business_id = public.current_business_id()
           and o.status in ('confirmed', 'fulfilled')
           and o.confirmed_at >= (p_date::timestamp at time zone 'Asia/Karachi')
           and o.confirmed_at < ((p_date + 1)::timestamp at time zone 'Asia/Karachi')
           and (p_stores is null or o.store_id = any (p_stores))
         order by o.confirmed_at, o.order_number
         limit 200
      ) x
  ), '{}'::uuid[]))
$$;

-- ---------------------------------------------------------------------------
-- Writing: SECURITY DEFINER. Every function reads the business from the session and filters every statement by it.
-- ---------------------------------------------------------------------------

-- Internal: copies the order's active lines onto a draft (only the facts an invoice may hold). Not callable by users.
create or replace function public.invoice_build_lines(p_biz uuid, p_invoice uuid, p_order uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.invoice_lines (
    business_id, invoice_id, position, order_line_id, product_id, name, strength, dosage_form, pack_size,
    manufacturer, unit, ordered_quantity, delivered_quantity, selling_price
  )
  select p_biz, p_invoice, (row_number() over (order by ol.position, ol.id))::int, ol.id, ol.product_id, ol.name,
         ol.strength, ol.dosage_form, ol.pack_size, ol.manufacturer, ol.unit, ol.quantity,
         coalesce(ol.delivered_quantity, ol.quantity), ol.selling_price_snapshot
    from public.order_lines ol
   where ol.order_id = p_order and ol.business_id = p_biz and ol.removed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Internal: the grand total of a draft = the sum of its billed, priced line totals. Always writes, so every edit
-- bumps the version. Not callable by users.
create or replace function public.invoice_recompute_total(p_biz uuid, p_invoice uuid)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  update public.invoices i
     set grand_total = coalesce((
           select sum(l.line_total)
             from public.invoice_lines l
            where l.business_id = p_biz and l.invoice_id = p_invoice
              and l.delivered_quantity > 0 and l.line_total is not null), 0)
   where i.business_id = p_biz and i.id = p_invoice
  returning i.grand_total into v_total;
  return v_total;
end;
$$;

-- Creates the draft of a confirmed order. The client creates the invoice id; it is also the request id.
create or replace function public.invoice_create(p_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_order public.orders;
  v_existing public.invoices;
  v_live public.invoices;
  v_count integer;
  v_version integer;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_order_id is null then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice:' || v_biz::text || ':' || p_id::text));
  perform pg_advisory_xact_lock(hashtext('order:' || p_order_id::text));

  -- The same invoice id again: a retry returns the stored draft; another order is refused.
  select * into v_existing from public.invoices i where i.business_id = v_biz and i.id = p_id;
  if found then
    if v_existing.order_id <> p_order_id then
      return jsonb_build_object('done', false, 'reason', 'request_reused');
    end if;
    return jsonb_build_object('done', true, 'created', false, 'replayed', true,
                              'invoice', public.invoice_json(v_biz, p_id, true));
  end if;

  select * into v_order from public.orders o where o.id = p_order_id and o.business_id = v_biz;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if v_order.status <> 'confirmed' then
    return jsonb_build_object('done', false, 'reason', 'order_not_confirmed');
  end if;
  if not exists (select 1 from public.order_lines l
                  where l.order_id = p_order_id and l.business_id = v_biz and l.removed_at is null) then
    return jsonb_build_object('done', false, 'reason', 'order_empty');
  end if;

  -- The order already has a live invoice (made from another screen or device): show it, never make a second one.
  select * into v_live from public.invoices i
   where i.business_id = v_biz and i.order_id = p_order_id and i.status in ('draft', 'issued');
  if found then
    return jsonb_build_object('done', true, 'created', false, 'existing', true,
                              'invoice', public.invoice_json(v_biz, v_live.id, true));
  end if;

  insert into public.invoices (id, business_id, order_id, store_id, status, source_fingerprint)
  values (p_id, v_biz, p_order_id, v_order.store_id, 'draft', public.order_lines_fingerprint(v_biz, p_order_id));

  v_count := public.invoice_build_lines(v_biz, p_id, p_order_id);
  perform public.invoice_recompute_total(v_biz, p_id);

  select i.version into v_version from public.invoices i where i.business_id = v_biz and i.id = p_id;
  insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version, actor, detail)
  values (v_biz, p_id, p_order_id, 'created', v_version, auth.uid(),
          jsonb_build_object('created', jsonb_build_object('line_count', v_count)));

  return jsonb_build_object('done', true, 'created', true, 'replayed', false,
                            'invoice', public.invoice_json(v_biz, p_id, true));
end;
$$;

-- Changes the delivered (billed) quantity of draft lines. The ordered quantity is never touched.
create or replace function public.invoice_set_quantities(p_id uuid, p_expected_version int, p_lines jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_inv public.invoices;
  v_el jsonb;
  v_line uuid;
  v_text text;
  v_seen uuid[] := '{}';
  v_ok boolean;
  v_changes jsonb;
  v_version integer;
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
  if v_inv.status <> 'draft' then
    return jsonb_build_object('done', false, 'reason', 'invoice_not_draft',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;
  if p_expected_version is null or v_inv.version <> p_expected_version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    return jsonb_build_object('done', false, 'reason', 'invalid_quantity',
                              'fields', jsonb_build_object('lines', 'Send between 1 and 200 lines.'));
  end if;

  for v_el in select e.value from jsonb_array_elements(p_lines) e loop
    begin
      v_line := (v_el ->> 'line_id')::uuid;
    exception when others then
      return jsonb_build_object('done', false, 'reason', 'invalid_quantity',
                                'fields', jsonb_build_object('line_id', 'A line id is not valid.'));
    end;
    v_text := v_el ->> 'delivered_quantity';
    v_ok := jsonb_typeof(v_el -> 'delivered_quantity') = 'number' and v_text ~ '^[0-9]{1,6}$';
    if coalesce(v_ok, false) then
      v_ok := v_text::int <= 100000;
    end if;
    if v_line is null or v_line = any (v_seen) or not coalesce(v_ok, false) then
      return jsonb_build_object('done', false, 'reason', 'invalid_quantity', 'line_id', v_line,
                                'fields', jsonb_build_object('delivered_quantity',
                                  'Delivered quantity must be a whole number from 0 to 100,000.'));
    end if;
    v_seen := v_seen || v_line;
    if not exists (select 1 from public.invoice_lines l
                    where l.business_id = v_biz and l.invoice_id = p_id and l.id = v_line) then
      return jsonb_build_object('done', false, 'reason', 'line_not_found', 'line_id', v_line);
    end if;
  end loop;

  with req as (
    select (e ->> 'line_id')::uuid as line_id, (e ->> 'delivered_quantity')::int as q
      from jsonb_array_elements(p_lines) e
  )
  select coalesce(jsonb_agg(jsonb_build_object('line_id', l.id, 'name', l.name,
                                               'old', l.delivered_quantity, 'new', r.q) order by l.position), '[]'::jsonb)
    into v_changes
    from public.invoice_lines l
    join req r on r.line_id = l.id
   where l.business_id = v_biz and l.invoice_id = p_id and l.delivered_quantity <> r.q;

  if jsonb_array_length(v_changes) > 0 then
    update public.invoice_lines l
       set delivered_quantity = r.q
      from (select (e ->> 'line_id')::uuid as line_id, (e ->> 'delivered_quantity')::int as q
              from jsonb_array_elements(p_lines) e) r
     where l.business_id = v_biz and l.invoice_id = p_id and l.id = r.line_id and l.delivered_quantity <> r.q;

    perform public.invoice_recompute_total(v_biz, p_id);

    select i.version into v_version from public.invoices i where i.business_id = v_biz and i.id = p_id;
    insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version, actor, detail)
    values (v_biz, p_id, v_inv.order_id, 'edited', v_version, auth.uid(),
            jsonb_build_object('edited', jsonb_build_object('changes', v_changes)));
  end if;

  return jsonb_build_object('done', true, 'invoice', public.invoice_json(v_biz, p_id, true));
end;
$$;

-- Rebuilds a stale draft from its order; delivered quantities return to the order lines' values.
create or replace function public.invoice_refresh(p_id uuid, p_expected_version int)
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
  v_count integer;
  v_version integer;
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
  if v_inv.status <> 'draft' then
    return jsonb_build_object('done', false, 'reason', 'invoice_not_draft',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;

  perform pg_advisory_xact_lock(hashtext('order:' || v_inv.order_id::text));
  select * into v_order from public.orders o where o.business_id = v_biz and o.id = v_inv.order_id;

  if p_expected_version is null or v_inv.version <> p_expected_version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;
  if v_order.status <> 'confirmed' then
    return jsonb_build_object('done', false, 'reason', 'order_not_confirmed');
  end if;

  if not exists (select 1 from public.order_lines l
                  where l.order_id = v_inv.order_id and l.business_id = v_biz and l.removed_at is null) then
    -- The order has no active line any more; nothing can be billed. The draft is left as it was.
    return jsonb_build_object('done', false, 'reason', 'order_empty');
  end if;

  delete from public.invoice_lines l where l.business_id = v_biz and l.invoice_id = p_id;
  v_count := public.invoice_build_lines(v_biz, p_id, v_inv.order_id);

  update public.invoices i
     set source_fingerprint = public.order_lines_fingerprint(v_biz, v_inv.order_id)
   where i.business_id = v_biz and i.id = p_id;
  perform public.invoice_recompute_total(v_biz, p_id);

  select i.version into v_version from public.invoices i where i.business_id = v_biz and i.id = p_id;
  insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version, actor, detail)
  values (v_biz, p_id, v_inv.order_id, 'refreshed', v_version, auth.uid(),
          jsonb_build_object('refreshed', jsonb_build_object('line_count', v_count)));

  return jsonb_build_object('done', true, 'invoice', public.invoice_json(v_biz, p_id, true));
end;
$$;

-- Discards a draft (no invoice number was ever used). The history entry stays.
create or replace function public.invoice_discard(p_id uuid, p_expected_version int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_inv public.invoices;
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
  if v_inv.status <> 'draft' then
    return jsonb_build_object('done', false, 'reason', 'invoice_not_draft',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;
  if p_expected_version is null or v_inv.version <> p_expected_version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
                              'current', public.invoice_json(v_biz, p_id, true));
  end if;

  delete from public.invoice_lines l where l.business_id = v_biz and l.invoice_id = p_id;
  delete from public.invoices i where i.business_id = v_biz and i.id = p_id;

  insert into public.invoice_events (business_id, invoice_id, order_id, event_type, invoice_version, actor, detail)
  values (v_biz, p_id, v_inv.order_id, 'discarded', v_inv.version, auth.uid(), '{}'::jsonb);

  return jsonb_build_object('done', true, 'order_id', v_inv.order_id);
end;
$$;

-- Issues a draft: the next invoice number, a frozen invoice and a fulfilled order, all together or not at all.
create or replace function public.invoice_issue(p_id uuid, p_expected_version int)
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

  -- Already issued (a retry, a double tap or a second device): show it, change nothing, use no number.
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

  -- The total is recomputed from the lines, never trusted from the draft.
  select coalesce(sum(l.line_total), 0)::numeric(18, 2) into v_total
    from public.invoice_lines l
   where l.business_id = v_biz and l.invoice_id = p_id and l.delivered_quantity > 0;

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
         invoice_date = (v_now at time zone 'Asia/Karachi')::date,
         issued_at = v_now,
         issued_by = auth.uid(),
         grand_total = v_total,
         business_name = v_bname,
         business_phone = v_bphone,
         business_address = v_baddr,
         store_name = v_sname,
         store_contact = v_scontact,
         store_phone = v_sphone,
         store_address = v_saddr
   where i.business_id = v_biz and i.id = p_id;

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
            'line_count', v_lines, 'billed_lines', v_billed)));

  insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
  values (v_biz, v_inv.order_id, 'invoiced', v_order_version, auth.uid(),
          jsonb_build_object('invoiced', jsonb_build_object(
            'invoice_id', p_id, 'invoice_number', v_number, 'number_label', v_label,
            'grand_total', v_total::text, 'delivered_changes', v_changes)));

  return jsonb_build_object('done', true, 'replayed', false, 'invoice', public.invoice_json(v_biz, p_id, true));
end;
$$;

-- Cancels an issued invoice with a required reason. The invoice and its number stay; the order returns to confirmed.
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

  -- Already cancelled (a retry or a second device): the first cancellation and its reason stay.
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

revoke all on function public.order_lines_fingerprint(uuid, uuid) from public, anon;
revoke all on function public.invoice_json(uuid, uuid, boolean) from public, anon;
revoke all on function public.invoice_get(uuid) from public, anon;
revoke all on function public.invoice_todo_rows() from public, anon;
revoke all on function public.invoice_todo(text, int, int) from public, anon;
revoke all on function public.invoice_summary() from public, anon;
revoke all on function public.invoice_list(text, uuid, date, date, uuid, text, int, int) from public, anon;
revoke all on function public.invoice_orders_summary(uuid) from public, anon;
revoke all on function public.order_sheet(uuid[]) from public, anon;
revoke all on function public.order_sheet_day(date, uuid[]) from public, anon;
revoke all on function public.invoice_create(uuid, uuid) from public, anon;
revoke all on function public.invoice_set_quantities(uuid, int, jsonb) from public, anon;
revoke all on function public.invoice_refresh(uuid, int) from public, anon;
revoke all on function public.invoice_discard(uuid, int) from public, anon;
revoke all on function public.invoice_issue(uuid, int) from public, anon;
revoke all on function public.invoice_cancel(uuid, text) from public, anon;
-- The two internal write helpers are called only by the functions above, never by a user.
revoke all on function public.invoice_build_lines(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.invoice_recompute_total(uuid, uuid) from public, anon, authenticated;

grant execute on function public.order_lines_fingerprint(uuid, uuid) to authenticated;
grant execute on function public.invoice_json(uuid, uuid, boolean) to authenticated;
grant execute on function public.invoice_get(uuid) to authenticated;
grant execute on function public.invoice_todo_rows() to authenticated;
grant execute on function public.invoice_todo(text, int, int) to authenticated;
grant execute on function public.invoice_summary() to authenticated;
grant execute on function public.invoice_list(text, uuid, date, date, uuid, text, int, int) to authenticated;
grant execute on function public.invoice_orders_summary(uuid) to authenticated;
grant execute on function public.order_sheet(uuid[]) to authenticated;
grant execute on function public.order_sheet_day(date, uuid[]) to authenticated;
grant execute on function public.invoice_create(uuid, uuid) to authenticated;
grant execute on function public.invoice_set_quantities(uuid, int, jsonb) to authenticated;
grant execute on function public.invoice_refresh(uuid, int) to authenticated;
grant execute on function public.invoice_discard(uuid, int) to authenticated;
grant execute on function public.invoice_issue(uuid, int) to authenticated;
grant execute on function public.invoice_cancel(uuid, text) to authenticated;

commit;
