-- Module 003: manual orders, order lines, change history and order numbers.
--
-- Orders are written ONLY through the functions below (order_save, order_confirm, order_cancel); signed-in
-- users get SELECT only on the order tables, so a direct request cannot skip a price snapshot, a status
-- rule or the change history. Every function reads the business from current_business_id() and filters every
-- statement by it; composite foreign keys also tie every reference to the same business.
--
-- Roll back (nothing else depends on these objects):
--   drop function if exists public.order_cancel(uuid, uuid, int, text), public.order_confirm(uuid, uuid, int),
--     public.order_save(uuid, uuid, int, uuid, text, jsonb), public.order_list(uuid, text, date, date, text, int, int),
--     public.order_get(uuid), public.order_to_json(uuid, uuid, boolean);
--   drop table if exists public.order_events, public.order_lines, public.orders, public.order_counters;
--   alter table public.products drop constraint if exists products_business_id_id_uniq;
--   alter table public.stores drop constraint if exists stores_business_id_id_uniq;

begin;

-- ---------------------------------------------------------------------------
-- Targets for composite foreign keys (an order can only reference its own business's rows)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stores_business_id_id_uniq') then
    alter table public.stores add constraint stores_business_id_id_uniq unique (business_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_business_id_id_uniq') then
    alter table public.products add constraint products_business_id_id_uniq unique (business_id, id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per business: the source of order numbers. Updated in the same transaction that creates the
-- order, so numbers are never duplicated or skipped.
create table if not exists public.order_counters (
  business_id  uuid primary key references public.businesses (id) on delete restrict,
  last_number  integer not null default 0 check (last_number >= 0)
);

create table if not exists public.orders (
  id               uuid primary key,
  business_id      uuid not null default public.current_business_id()
                     references public.businesses (id) on delete restrict,
  store_id         uuid not null,
  order_number     integer not null check (order_number > 0),
  source           text not null default 'manual' check (source in ('manual', 'voice')),
  status           text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled', 'fulfilled')),
  notes            text check (notes is null or char_length(notes) <= 1000),
  confirmed_at     timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  last_request_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          integer not null default 1,
  constraint orders_store_fk foreign key (business_id, store_id) references public.stores (business_id, id),
  constraint orders_business_number_uniq unique (business_id, order_number),
  constraint orders_business_id_id_uniq unique (business_id, id),
  constraint orders_confirmed_has_time check (status <> 'confirmed' or confirmed_at is not null),
  constraint orders_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null),
  constraint orders_cancelled_confirmed_needs_reason
    check (status <> 'cancelled' or confirmed_at is null or char_length(btrim(coalesce(cancel_reason, ''))) > 0)
);

create index if not exists orders_business_created_idx on public.orders (business_id, created_at desc, id desc);
create index if not exists orders_business_store_created_idx on public.orders (business_id, store_id, created_at desc);
create index if not exists orders_business_status_created_idx on public.orders (business_id, status, created_at desc);

create table if not exists public.order_lines (
  id                       uuid primary key,
  business_id              uuid not null default public.current_business_id()
                             references public.businesses (id) on delete restrict,
  order_id                 uuid not null,
  position                 integer not null check (position >= 1),
  product_id               uuid,
  item_status              text not null check (item_status in ('registered', 'pending_registration')),
  name                     text not null check (char_length(btrim(name)) between 1 and 200),
  strength                 text check (strength is null or char_length(strength) <= 100),
  dosage_form              text check (dosage_form is null or char_length(dosage_form) <= 100),
  pack_size                text check (pack_size is null or char_length(pack_size) <= 100),
  manufacturer             text check (manufacturer is null or char_length(manufacturer) <= 200),
  quantity                 integer not null check (quantity between 1 and 100000),
  unit                     text not null check (char_length(btrim(unit)) between 1 and 50),
  delivered_quantity       integer check (delivered_quantity is null or delivered_quantity >= 1),
  purchase_price_snapshot  numeric(12, 2) check (purchase_price_snapshot is null or purchase_price_snapshot >= 0),
  selling_price_snapshot   numeric(12, 2) check (selling_price_snapshot is null or selling_price_snapshot >= 0),
  mrp_snapshot             numeric(12, 2) check (mrp_snapshot is null or mrp_snapshot >= 0),
  snapshot_taken_at        timestamptz,
  line_total               numeric(18, 2) generated always as ((quantity * selling_price_snapshot)::numeric(18, 2)) stored,
  removed_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint order_lines_order_fk foreign key (business_id, order_id) references public.orders (business_id, id),
  constraint order_lines_product_fk foreign key (business_id, product_id) references public.products (business_id, id),
  constraint order_lines_business_id_id_uniq unique (business_id, id),
  -- A typed (not registered) line has no medicine; a linked line always has one.
  constraint order_lines_status_matches_product check ((product_id is null) = (item_status = 'pending_registration')),
  -- A price can only exist together with the time it was recorded.
  constraint order_lines_price_needs_snapshot
    check (snapshot_taken_at is not null
           or (purchase_price_snapshot is null and selling_price_snapshot is null and mrp_snapshot is null))
);

create index if not exists order_lines_order_idx on public.order_lines (order_id, position) where removed_at is null;
create index if not exists order_lines_product_idx on public.order_lines (business_id, product_id) where product_id is not null;

-- Append-only change history.
create table if not exists public.order_events (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null default public.current_business_id()
                   references public.businesses (id) on delete restrict,
  order_id       uuid not null,
  event_type     text not null check (event_type in ('created', 'confirmed', 'edited', 'cancelled')),
  order_version  integer not null,
  actor          uuid default auth.uid(),
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint order_events_order_fk foreign key (business_id, order_id) references public.orders (business_id, id)
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists orders_row_meta on public.orders;
create trigger orders_row_meta
  before insert or update on public.orders
  for each row execute function public.set_row_meta();

-- Business rules that must hold whatever code touches the row.
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
      or (old.status = 'confirmed' and new.status = 'cancelled')
    ) then
      raise exception 'invalid status change from % to %', old.status, new.status using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard on public.orders;
create trigger orders_guard
  before update on public.orders
  for each row execute function public.orders_guard();

create or replace function public.order_lines_touch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
  else
    if new.id is distinct from old.id then
      raise exception 'id is immutable' using errcode = '22023';
    end if;
    if new.business_id is distinct from old.business_id then
      raise exception 'business_id is immutable' using errcode = '22023';
    end if;
    if new.order_id is distinct from old.order_id then
      raise exception 'order_id is immutable' using errcode = '22023';
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists order_lines_touch on public.order_lines;
create trigger order_lines_touch
  before insert or update on public.order_lines
  for each row execute function public.order_lines_touch();

-- Once a line has its snapshot, the recorded prices and the description of the medicine never change.
-- One controlled exception exists for a later module (the Pending Prices flow and linking): a function that
-- sets app.line_snapshot_edit = 'on' for its own transaction. Nothing in this module sets it, and signed-in
-- users cannot write to this table at all.
create or replace function public.order_lines_guard()
returns trigger
language plpgsql
as $$
begin
  if old.snapshot_taken_at is not null
     and coalesce(current_setting('app.line_snapshot_edit', true), '') <> 'on'
     and (
       new.snapshot_taken_at is distinct from old.snapshot_taken_at
       or new.purchase_price_snapshot is distinct from old.purchase_price_snapshot
       or new.selling_price_snapshot is distinct from old.selling_price_snapshot
       or new.mrp_snapshot is distinct from old.mrp_snapshot
       or new.name is distinct from old.name
       or new.strength is distinct from old.strength
       or new.dosage_form is distinct from old.dosage_form
       or new.pack_size is distinct from old.pack_size
       or new.manufacturer is distinct from old.manufacturer
     ) then
    raise exception 'snapshot_immutable: the recorded prices and description of an order line cannot change'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists order_lines_guard on public.order_lines;
create trigger order_lines_guard
  before update on public.order_lines
  for each row execute function public.order_lines_guard();

-- The change history can never be edited. Only the service role (tests and operations, never the app)
-- may delete rows, for example to remove a test business.
create or replace function public.order_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception 'order_events_append_only: the order history cannot be changed or deleted'
    using errcode = '22023';
end;
$$;

drop trigger if exists order_events_append_only on public.order_events;
create trigger order_events_append_only
  before update or delete on public.order_events
  for each row execute function public.order_events_append_only();

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges: read-only for signed-in users
-- ---------------------------------------------------------------------------

alter table public.order_counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.order_events enable row level security;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists order_lines_select on public.order_lines;
create policy order_lines_select on public.order_lines
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists order_events_select on public.order_events;
create policy order_events_select on public.order_events
  for select to authenticated
  using (business_id = (select public.current_business_id()));

revoke all on public.order_counters, public.orders, public.order_lines, public.order_events from anon, authenticated;
grant select on public.orders, public.order_lines, public.order_events to authenticated;

-- ---------------------------------------------------------------------------
-- Reading: one order as JSON, and the history list. SECURITY INVOKER, so Row Level Security applies.
-- Purchase price and MRP are never selected here.
-- ---------------------------------------------------------------------------

create or replace function public.order_to_json(p_biz uuid, p_order uuid, p_with_events boolean)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_row public.orders;
  v_store jsonb;
  v_lines jsonb;
  v_totals jsonb;
  v_events jsonb := '[]'::jsonb;
begin
  select * into v_row from public.orders where id = p_order and business_id = p_biz;
  if not found then
    return null;
  end if;

  select jsonb_build_object('id', s.id, 'name', s.name, 'is_active', s.is_active)
    into v_store
    from public.stores s
   where s.id = v_row.store_id and s.business_id = p_biz;

  with l as (
    select ol.id, ol.position, ol.created_at, ol.product_id, ol.item_status, ol.name, ol.strength, ol.dosage_form,
           ol.pack_size, ol.manufacturer, ol.quantity, ol.unit, ol.delivered_quantity, ol.snapshot_taken_at,
           p.is_active as product_active,
           case
             when ol.snapshot_taken_at is not null then ol.selling_price_snapshot
             when v_row.status = 'draft' then p.selling_price
             else null
           end as eff_price
      from public.order_lines ol
      left join public.products p on p.id = ol.product_id and p.business_id = ol.business_id
     where ol.order_id = p_order and ol.business_id = p_biz and ol.removed_at is null
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'position', l.position,
        'product_id', l.product_id,
        'item_status', l.item_status,
        'name', l.name,
        'strength', l.strength,
        'dosage_form', l.dosage_form,
        'pack_size', l.pack_size,
        'manufacturer', l.manufacturer,
        'quantity', l.quantity,
        'unit', l.unit,
        'delivered_quantity', l.delivered_quantity,
        'price_basis', case when l.eff_price is null then 'none'
                            when l.snapshot_taken_at is not null then 'snapshot'
                            else 'current' end,
        'selling_price', l.eff_price::text,
        'line_total', (l.quantity * l.eff_price)::numeric(18, 2)::text,
        'product_is_active', l.product_active
      ) order by l.position, l.created_at, l.id), '[]'::jsonb) from l),
    (select jsonb_build_object(
        'priced_total', coalesce(sum((l.quantity * l.eff_price)::numeric(18, 2)), 0)::numeric(18, 2)::text,
        'priced_lines', count(*) filter (where l.eff_price is not null),
        'unpriced_lines', count(*) filter (where l.eff_price is null),
        'line_count', count(*)
      ) from l)
    into v_lines, v_totals;

  if p_with_events then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', e.id,
             'event_type', e.event_type,
             'order_version', e.order_version,
             'created_at', e.created_at,
             'detail', e.detail
           ) order by e.order_version desc, e.created_at desc), '[]'::jsonb)
      into v_events
      from public.order_events e
     where e.order_id = p_order and e.business_id = p_biz;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'order_number', v_row.order_number,
    'status', v_row.status,
    'source', v_row.source,
    'notes', v_row.notes,
    'version', v_row.version,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at,
    'confirmed_at', v_row.confirmed_at,
    'cancelled_at', v_row.cancelled_at,
    'cancel_reason', v_row.cancel_reason,
    'store', v_store,
    'lines', v_lines,
    'totals', v_totals,
    'events', v_events
  );
end;
$$;

create or replace function public.order_get(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select public.order_to_json(public.current_business_id(), p_id, true)
$$;

-- One page of the history, newest first. Returns at most p_limit + 1 rows so the caller can tell whether
-- another page exists. Dates are inclusive local days in Pakistan time.
create or replace function public.order_list(
  p_store uuid,
  p_status text,
  p_from date,
  p_to date,
  p_q text,
  p_limit int,
  p_offset int
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_from timestamptz;
  v_to timestamptz;
  v_q text := btrim(coalesce(p_q, ''));
  v_digits text;
  v_tokens text[];
  v_result jsonb;
begin
  if v_biz is null then
    return '[]'::jsonb;
  end if;

  v_from := case when p_from is null then null else (p_from::timestamp at time zone 'Asia/Karachi') end;
  v_to := case when p_to is null then null else ((p_to + 1)::timestamp at time zone 'Asia/Karachi') end;

  -- "12", "#12" and "ORD-0012" all mean order number 12 (matched as a part of the number).
  v_digits := regexp_replace(v_q, '^(ord[-[:space:]]*|#)', '', 'i');
  if v_digits ~ '^[0-9]+$' then
    v_digits := coalesce(nullif(ltrim(v_digits, '0'), ''), '0');
  else
    v_digits := null;
  end if;
  v_tokens := case when v_q = '' then '{}'::text[] else regexp_split_to_array(lower(v_q), '[[:space:]]+') end;

  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id desc), '[]'::jsonb)
    into v_result
    from (
      select o.id, o.created_at,
             jsonb_build_object(
               'id', o.id,
               'order_number', o.order_number,
               'status', o.status,
               'source', o.source,
               'created_at', o.created_at,
               'updated_at', o.updated_at,
               'confirmed_at', o.confirmed_at,
               'version', o.version,
               'store', jsonb_build_object('id', s.id, 'name', s.name),
               'line_count', agg.line_count,
               'priced_total', agg.priced_total::text,
               'unpriced_lines', agg.unpriced_lines
             ) as j
        from (
          select o2.id
            from public.orders o2
            join public.stores s2 on s2.id = o2.store_id and s2.business_id = o2.business_id
           where o2.business_id = v_biz
             and (p_store is null or o2.store_id = p_store)
             and (p_status is null or o2.status = p_status)
             and (v_from is null or o2.created_at >= v_from)
             and (v_to is null or o2.created_at < v_to)
             and (
               v_q = ''
               or (v_digits is not null and o2.order_number::text like '%' || v_digits || '%')
               or not exists (select 1 from unnest(v_tokens) t where position(t in s2.search_text) = 0)
             )
           order by o2.created_at desc, o2.id desc
           limit greatest(coalesce(p_limit, 50), 1) + 1
          offset greatest(coalesce(p_offset, 0), 0)
        ) pg
        join public.orders o on o.id = pg.id
        join public.stores s on s.id = o.store_id and s.business_id = o.business_id
        cross join lateral (
          select count(*)::int as line_count,
                 coalesce(sum((t.quantity * t.price)::numeric(18, 2)) filter (where t.price is not null), 0)::numeric(18, 2) as priced_total,
                 (count(*) filter (where t.price is null))::int as unpriced_lines
            from (
              select ol.quantity,
                     case
                       when ol.snapshot_taken_at is not null then ol.selling_price_snapshot
                       when o.status = 'draft' then p.selling_price
                       else null
                     end as price
                from public.order_lines ol
                left join public.products p on p.id = ol.product_id and p.business_id = ol.business_id
               where ol.order_id = o.id and ol.business_id = o.business_id and ol.removed_at is null
            ) t
        ) agg
    ) x;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writing. SECURITY DEFINER: these functions are the only way to change orders.
-- ---------------------------------------------------------------------------

-- Creates a draft, updates a draft, or saves edits to a confirmed order. The whole list of lines is sent
-- on every save: known active lines are updated, new ids inserted, missing ids marked removed.
-- Returns { saved, replayed, created, order } or { saved: false, reason, current?, detail? }.
create or replace function public.order_save(
  p_id uuid,
  p_request_id uuid,
  p_expected_version int,
  p_store_id uuid,
  p_notes text,
  p_lines jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_order public.orders;
  v_exists boolean;
  v_store public.stores;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_src jsonb;
  v_problem text;
  v_number int;
  v_changes jsonb := '[]'::jsonb;
  v_snapshot boolean;
  v_version int;
  v_max int;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  if p_id is null or p_request_id is null or p_store_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('saved', false, 'reason', 'invalid_lines', 'detail',
      jsonb_build_object('message', 'The order id, request id, store and a list of lines are required.'));
  end if;
  if jsonb_array_length(p_lines) > 200 then
    return jsonb_build_object('saved', false, 'reason', 'invalid_lines', 'detail',
      jsonb_build_object('message', 'An order can have at most 200 lines.'));
  end if;

  -- Two requests for the same order id run one after the other (a simultaneous double send becomes a replay).
  perform pg_advisory_xact_lock(hashtext('order:' || p_id::text));

  select * into v_order from public.orders where id = p_id and business_id = v_biz for update;
  v_exists := found;

  -- Replay: this exact request was already applied.
  if v_exists and v_order.last_request_id = p_request_id then
    return jsonb_build_object('saved', true, 'replayed', true, 'created', false,
      'order', public.order_to_json(v_biz, p_id, true));
  end if;

  if not v_exists and p_expected_version is not null then
    return jsonb_build_object('saved', false, 'reason', 'not_found');
  end if;

  if v_exists then
    if v_order.status in ('cancelled', 'fulfilled') then
      return jsonb_build_object('saved', false, 'reason', 'order_not_editable',
        'current', public.order_to_json(v_biz, p_id, true));
    end if;
    if p_expected_version is null or v_order.version <> p_expected_version then
      return jsonb_build_object('saved', false, 'reason', 'version_conflict',
        'current', public.order_to_json(v_biz, p_id, true));
    end if;
  elsif exists (select 1 from public.orders where id = p_id) then
    -- The id belongs to another business: report it like any unusable id, revealing nothing.
    return jsonb_build_object('saved', false, 'reason', 'unusable_id');
  end if;

  -- Store: a new order needs an active store; an existing order may change store only while it is a
  -- draft without active lines.
  if not v_exists or p_store_id <> v_order.store_id then
    select * into v_store from public.stores where id = p_store_id and business_id = v_biz;
    if not found then
      return jsonb_build_object('saved', false, 'reason', 'store_not_found');
    end if;
    if not v_store.is_active then
      return jsonb_build_object('saved', false, 'reason', 'store_inactive');
    end if;
    if v_exists and (
      v_order.status <> 'draft'
      or exists (select 1 from public.order_lines l
                  where l.order_id = p_id and l.business_id = v_biz and l.removed_at is null)
    ) then
      return jsonb_build_object('saved', false, 'reason', 'store_locked',
        'current', public.order_to_json(v_biz, p_id, true));
    end if;
  end if;

  -- Normalise the lines once: cleaned typed name and unit, whole-number quantity, screen order.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', case when e.elem->>'id' ~ v_uuid_re then (e.elem->>'id')::uuid end,
           'product_id', case when e.elem->>'product_id' ~ v_uuid_re then (e.elem->>'product_id')::uuid end,
           'bad_product', (e.elem->>'product_id') is not null and not (e.elem->>'product_id' ~ v_uuid_re),
           'name', nullif(btrim(regexp_replace(coalesce(e.elem->>'name', ''), '[[:space:]]+', ' ', 'g')), ''),
           'quantity', case when e.elem->>'quantity' ~ '^[0-9]{1,7}$' then (e.elem->>'quantity')::int end,
           'unit', nullif(btrim(coalesce(e.elem->>'unit', '')), ''),
           'ord', e.ord
         ) order by e.ord), '[]'::jsonb)
    into v_src
    from jsonb_array_elements(p_lines) with ordinality as e(elem, ord);

  with x as (
    select * from jsonb_to_recordset(v_src)
      as t(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
  )
  select case
    when exists (select 1 from x where id is null)
      then 'Every line needs an id.'
    when (select count(*) from x) <> (select count(distinct id) from x)
      then 'Each line needs its own id.'
    when exists (select 1 from x where quantity is null or quantity < 1 or quantity > 100000)
      then 'Quantity must be a whole number from 1 to 100,000.'
    when exists (select 1 from x where unit is null or char_length(unit) > 50)
      then 'Enter a unit of at most 50 characters for every line.'
    when exists (select 1 from x where product_id is null and not bad_product and (name is null or char_length(name) > 200))
      then 'Enter the medicine name (at most 200 characters) for a typed line.'
    when exists (select 1 from x where bad_product)
      then 'A medicine on this order was not found.'
    when exists (select 1 from x where product_id is not null
                   and not exists (select 1 from public.products p where p.id = x.product_id and p.business_id = v_biz))
      then 'A medicine on this order was not found.'
    when exists (select 1 from x join public.products p on p.id = x.product_id and p.business_id = v_biz
                  where not p.is_active
                    and not exists (select 1 from public.order_lines ol
                                     where ol.id = x.id and ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null))
      then 'A new line uses a medicine that is inactive.'
    when exists (select 1 from x join public.order_lines ol on ol.id = x.id
                  where ol.order_id <> p_id or ol.business_id <> v_biz or ol.removed_at is not null)
      then 'A line id cannot be used.'
    when exists (select 1 from x join public.order_lines ol
                    on ol.id = x.id and ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
                  where ol.product_id is distinct from x.product_id)
      then 'A line cannot change its medicine. Remove it and add a new line.'
    when exists (select 1 from x join public.order_lines ol
                    on ol.id = x.id and ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
                  where ol.snapshot_taken_at is not null and ol.product_id is null and ol.name is distinct from x.name)
      then 'The name of a line on a confirmed order cannot be changed.'
    else null
  end into v_problem;

  if v_problem is not null then
    return jsonb_build_object('saved', false, 'reason', 'invalid_lines', 'detail', jsonb_build_object('message', v_problem));
  end if;

  -- ---------------------------------------------------------------- create
  if not v_exists then
    -- The counter is the source of numbers; it is also never allowed to fall behind the highest number
    -- that exists, so rows written another way (an import, a restore) can never cause a duplicate.
    select coalesce(max(o.order_number), 0) into v_max from public.orders o where o.business_id = v_biz;
    insert into public.order_counters (business_id, last_number)
    values (v_biz, v_max + 1)
    on conflict (business_id) do update
      set last_number = greatest(public.order_counters.last_number, v_max) + 1
    returning last_number into v_number;

    insert into public.orders (id, business_id, store_id, order_number, source, status, notes, last_request_id)
    values (p_id, v_biz, p_store_id, v_number, 'manual', 'draft', v_notes, p_request_id);

    insert into public.order_lines (id, business_id, order_id, position, product_id, item_status, name,
                                    strength, dosage_form, pack_size, manufacturer, quantity, unit)
    select x.id, v_biz, p_id, x.ord, x.product_id,
           case when x.product_id is null then 'pending_registration' else 'registered' end,
           case when x.product_id is null then x.name else p.name end,
           p.strength, p.dosage_form, p.pack_size, p.manufacturer, x.quantity, x.unit
      from jsonb_to_recordset(v_src)
             as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
      left join public.products p on p.id = x.product_id and p.business_id = v_biz;

    insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
    values (v_biz, p_id, 'created', 1, auth.uid(),
            jsonb_build_object('created', jsonb_build_object('store_id', p_store_id, 'order_number', v_number)));

    return jsonb_build_object('saved', true, 'replayed', false, 'created', true,
      'order', public.order_to_json(v_biz, p_id, true));
  end if;

  -- ---------------------------------------------------------------- update (draft) or edit (confirmed)
  v_snapshot := v_order.status = 'confirmed';

  if v_snapshot then
    -- What this save changes, recorded before anything is modified. Purchase price and MRP are never recorded here.
    select coalesce(jsonb_agg(t.c order by t.k, t.pos), '[]'::jsonb)
      into v_changes
      from (
        select 1 as k, ol.position as pos,
               jsonb_build_object('type', 'quantity', 'line_id', ol.id, 'name', ol.name,
                                  'from', ol.quantity, 'to', x.quantity) as c
          from public.order_lines ol
          join jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
            on x.id = ol.id
         where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null and ol.quantity <> x.quantity
        union all
        select 2, ol.position,
               jsonb_build_object('type', 'unit', 'line_id', ol.id, 'name', ol.name, 'from', ol.unit, 'to', x.unit)
          from public.order_lines ol
          join jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
            on x.id = ol.id
         where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null and ol.unit <> x.unit
        union all
        select 3, x.ord,
               jsonb_build_object('type', 'added', 'line_id', x.id, 'name', coalesce(p.name, x.name),
                                  'quantity', x.quantity, 'unit', x.unit, 'selling_price', p.selling_price::text)
          from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
          left join public.products p on p.id = x.product_id and p.business_id = v_biz
         where not exists (select 1 from public.order_lines ol
                            where ol.id = x.id and ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null)
        union all
        select 4, ol.position,
               jsonb_build_object('type', 'removed', 'line_id', ol.id, 'name', ol.name, 'quantity', ol.quantity,
                                  'unit', ol.unit, 'selling_price', ol.selling_price_snapshot::text)
          from public.order_lines ol
         where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
           and not exists (select 1 from jsonb_to_recordset(v_src) as x(id uuid) where x.id = ol.id)
      ) t;
    if v_order.notes is distinct from v_notes then
      v_changes := v_changes || jsonb_build_array(
        jsonb_build_object('type', 'notes', 'from', coalesce(v_order.notes, ''), 'to', coalesce(v_notes, '')));
    end if;
  end if;

  -- The order row first (a store change is allowed only while there are no active lines, so it must
  -- come before the new lines are written). One update, so the version moves by exactly one.
  update public.orders
     set notes = v_notes, store_id = p_store_id, last_request_id = p_request_id
   where id = p_id and business_id = v_biz;

  -- Known active lines: quantity, unit, position (and the typed name while it has no snapshot).
  update public.order_lines ol
     set quantity = x.quantity,
         unit = x.unit,
         position = x.ord,
         name = case when ol.product_id is null and ol.snapshot_taken_at is null then x.name else ol.name end,
         delivered_quantity = case when v_snapshot then x.quantity else ol.delivered_quantity end
    from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
   where ol.id = x.id and ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null;

  -- Lines no longer in the list: marked removed, never deleted.
  update public.order_lines ol
     set removed_at = now()
   where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
     and not exists (select 1 from jsonb_to_recordset(v_src) as x(id uuid) where x.id = ol.id);

  -- New lines. On a confirmed order they take their price snapshot now.
  insert into public.order_lines (id, business_id, order_id, position, product_id, item_status, name,
                                  strength, dosage_form, pack_size, manufacturer, quantity, unit,
                                  delivered_quantity, purchase_price_snapshot, selling_price_snapshot, mrp_snapshot,
                                  snapshot_taken_at)
  select x.id, v_biz, p_id, x.ord, x.product_id,
         case when x.product_id is null then 'pending_registration' else 'registered' end,
         case when x.product_id is null then x.name else p.name end,
         p.strength, p.dosage_form, p.pack_size, p.manufacturer, x.quantity, x.unit,
         case when v_snapshot then x.quantity end,
         case when v_snapshot then p.purchase_price end,
         case when v_snapshot then p.selling_price end,
         case when v_snapshot then p.mrp end,
         case when v_snapshot then now() end
    from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int)
    left join public.products p on p.id = x.product_id and p.business_id = v_biz
   where not exists (select 1 from public.order_lines ol where ol.id = x.id);

  if v_snapshot and jsonb_array_length(v_changes) > 0 then
    select version into v_version from public.orders where id = p_id and business_id = v_biz;
    insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
    values (v_biz, p_id, 'edited', v_version, auth.uid(), jsonb_build_object('edited', jsonb_build_object('changes', v_changes)));
  end if;

  return jsonb_build_object('saved', true, 'replayed', false, 'created', false,
    'order', public.order_to_json(v_biz, p_id, true));
end;
$$;

-- Confirms a draft: records the price snapshot of every active line, all together or not at all.
create or replace function public.order_confirm(p_id uuid, p_request_id uuid, p_expected_version int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_order public.orders;
  v_now timestamptz := now();
  v_version int;
  v_totals jsonb;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_request_id is null then
    return jsonb_build_object('confirmed', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('order:' || p_id::text));

  select * into v_order from public.orders where id = p_id and business_id = v_biz for update;
  if not found then
    return jsonb_build_object('confirmed', false, 'reason', 'not_found');
  end if;

  -- Already confirmed (a retry, a double tap or a second tab): show the original, change nothing.
  if v_order.status = 'confirmed' then
    return jsonb_build_object('confirmed', true, 'replayed', true, 'order', public.order_to_json(v_biz, p_id, true));
  end if;
  if v_order.status <> 'draft' then
    return jsonb_build_object('confirmed', false, 'reason', 'order_not_editable',
      'current', public.order_to_json(v_biz, p_id, true));
  end if;
  if p_expected_version is null or v_order.version <> p_expected_version then
    return jsonb_build_object('confirmed', false, 'reason', 'version_conflict',
      'current', public.order_to_json(v_biz, p_id, true));
  end if;
  if not exists (select 1 from public.order_lines l
                  where l.order_id = p_id and l.business_id = v_biz and l.removed_at is null) then
    return jsonb_build_object('confirmed', false, 'reason', 'order_empty');
  end if;

  -- Catalog lines: description and prices exactly as they are now (empty stays empty).
  update public.order_lines ol
     set name = p.name,
         strength = p.strength,
         dosage_form = p.dosage_form,
         pack_size = p.pack_size,
         manufacturer = p.manufacturer,
         purchase_price_snapshot = p.purchase_price,
         selling_price_snapshot = p.selling_price,
         mrp_snapshot = p.mrp,
         snapshot_taken_at = v_now,
         delivered_quantity = ol.quantity
    from public.products p
   where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
     and ol.product_id is not null and p.id = ol.product_id and p.business_id = v_biz;

  -- Typed lines: no medicine and no price; they are marked as recorded.
  update public.order_lines ol
     set snapshot_taken_at = v_now,
         delivered_quantity = ol.quantity
   where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null and ol.product_id is null;

  update public.orders
     set status = 'confirmed', confirmed_at = v_now, last_request_id = p_request_id
   where id = p_id and business_id = v_biz;

  select version into v_version from public.orders where id = p_id and business_id = v_biz;
  v_totals := public.order_to_json(v_biz, p_id, false) -> 'totals';

  insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
  values (v_biz, p_id, 'confirmed', v_version, auth.uid(),
          jsonb_build_object('confirmed', jsonb_build_object(
            'line_count', v_totals -> 'line_count',
            'priced_lines', v_totals -> 'priced_lines',
            'unpriced_lines', v_totals -> 'unpriced_lines',
            'priced_total', v_totals -> 'priced_total')));

  return jsonb_build_object('confirmed', true, 'replayed', false, 'order', public.order_to_json(v_biz, p_id, true));
end;
$$;

-- Cancels (discards) an order. A confirmed order needs a reason. Lines and snapshots are kept.
create or replace function public.order_cancel(p_id uuid, p_request_id uuid, p_expected_version int, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_version int;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_id is null or p_request_id is null then
    return jsonb_build_object('cancelled', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('order:' || p_id::text));

  select * into v_order from public.orders where id = p_id and business_id = v_biz for update;
  if not found then
    return jsonb_build_object('cancelled', false, 'reason', 'not_found');
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('cancelled', true, 'replayed', true, 'order', public.order_to_json(v_biz, p_id, true));
  end if;
  if v_order.status <> 'draft' and v_order.status <> 'confirmed' then
    return jsonb_build_object('cancelled', false, 'reason', 'order_not_editable',
      'current', public.order_to_json(v_biz, p_id, true));
  end if;
  if p_expected_version is null or v_order.version <> p_expected_version then
    return jsonb_build_object('cancelled', false, 'reason', 'version_conflict',
      'current', public.order_to_json(v_biz, p_id, true));
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    return jsonb_build_object('cancelled', false, 'reason', 'reason_too_long');
  end if;
  if v_order.status = 'confirmed' and v_reason is null then
    return jsonb_build_object('cancelled', false, 'reason', 'reason_required');
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, last_request_id = p_request_id
   where id = p_id and business_id = v_biz;

  select version into v_version from public.orders where id = p_id and business_id = v_biz;
  insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
  values (v_biz, p_id, 'cancelled', v_version, auth.uid(),
          jsonb_build_object('cancelled', jsonb_build_object('from_status', v_order.status, 'reason', v_reason)));

  return jsonb_build_object('cancelled', true, 'replayed', false, 'order', public.order_to_json(v_biz, p_id, true));
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.order_to_json(uuid, uuid, boolean) from public, anon;
revoke all on function public.order_get(uuid) from public, anon;
revoke all on function public.order_list(uuid, text, date, date, text, int, int) from public, anon;
revoke all on function public.order_save(uuid, uuid, int, uuid, text, jsonb) from public, anon;
revoke all on function public.order_confirm(uuid, uuid, int) from public, anon;
revoke all on function public.order_cancel(uuid, uuid, int, text) from public, anon;

grant execute on function public.order_to_json(uuid, uuid, boolean) to authenticated;
grant execute on function public.order_get(uuid) to authenticated;
grant execute on function public.order_list(uuid, text, date, date, text, int, int) to authenticated;
grant execute on function public.order_save(uuid, uuid, int, uuid, text, jsonb) to authenticated;
grant execute on function public.order_confirm(uuid, uuid, int) to authenticated;
grant execute on function public.order_cancel(uuid, uuid, int, text) to authenticated;

commit;
