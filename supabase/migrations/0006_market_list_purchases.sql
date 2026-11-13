-- Module 005: market list and purchases.
--
-- The consolidated market list is COMPUTED on every read from the confirmed orders of a Pakistan day and the
-- recorded purchases; nothing about it (totals, purchased, remaining, status) is stored. Purchases are recorded
-- only through two write functions (purchase_record, purchase_void). Signed-in users have SELECT only on the two
-- new tables, and both tables are append-only (a trigger refuses UPDATE and DELETE, DELETE is allowed only for
-- service_role, which tests and operations use and the app never does). A wrong entry is cancelled by adding a
-- row to purchase_voids with a reason; the entry itself is never changed.
--
-- The client-created entry id is the request id of a purchase, so a repeated save returns the stored entry.
-- Every function reads the business from current_business_id() and filters every statement by it. The list
-- functions never select a purchase price, a selling price, an MRP or a unit cost; only the purchase entry
-- functions return the unit cost (the purchase recording screens).
--
-- Rollback (manual, only before real data exists): drop the functions market_list, market_summary, market_rows,
-- purchase_entries_list, purchase_entry_to_json, purchase_record, purchase_void, the trigger function
-- purchase_append_only, then the tables purchase_voids and purchase_entries, then the index orders_market_idx.
--
-- Safe to run more than once (if not exists, drop trigger if exists, create or replace).

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.purchase_entries (
  id             uuid not null,
  business_id    uuid not null default public.current_business_id()
                   references public.businesses (id) on delete restrict,
  product_id     uuid not null,
  unit           text not null check (char_length(btrim(unit)) between 1 and 50),
  purchase_date  date not null check (purchase_date >= date '2000-01-01'),
  quantity       integer not null check (quantity between 1 and 100000),
  unit_cost      numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  supplier_name  text check (supplier_name is null or char_length(supplier_name) <= 200),
  reference      text check (reference is null or char_length(reference) <= 100),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  primary key (business_id, id),
  constraint purchase_entries_product_fk foreign key (business_id, product_id)
    references public.products (business_id, id)
);

create table if not exists public.purchase_voids (
  entry_id     uuid not null,
  business_id  uuid not null default public.current_business_id()
                 references public.businesses (id) on delete restrict,
  reason       text not null check (char_length(btrim(reason)) between 1 and 500),
  voided_by    uuid default auth.uid(),
  voided_at    timestamptz not null default now(),
  primary key (business_id, entry_id),
  constraint purchase_voids_entry_fk foreign key (business_id, entry_id)
    references public.purchase_entries (business_id, id)
);

create index if not exists purchase_entries_day_idx
  on public.purchase_entries (business_id, purchase_date, product_id);

-- The day's orders are found by a range on confirmed_at.
create index if not exists orders_market_idx
  on public.orders (business_id, confirmed_at)
  where status in ('confirmed', 'fulfilled');

-- ---------------------------------------------------------------------------
-- Append-only guard for both tables
-- ---------------------------------------------------------------------------

create or replace function public.purchase_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception '%_append_only: purchase records cannot be changed or deleted', tg_table_name
    using errcode = '22023';
end;
$$;

drop trigger if exists purchase_entries_append_only on public.purchase_entries;
create trigger purchase_entries_append_only
  before update or delete on public.purchase_entries
  for each row execute function public.purchase_append_only();

drop trigger if exists purchase_voids_append_only on public.purchase_voids;
create trigger purchase_voids_append_only
  before update or delete on public.purchase_voids
  for each row execute function public.purchase_append_only();

-- ---------------------------------------------------------------------------
-- Row Level Security: select only; there is no insert, update or delete grant
-- ---------------------------------------------------------------------------

alter table public.purchase_entries enable row level security;
alter table public.purchase_voids enable row level security;

drop policy if exists purchase_entries_select on public.purchase_entries;
create policy purchase_entries_select on public.purchase_entries
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists purchase_voids_select on public.purchase_voids;
create policy purchase_voids_select on public.purchase_voids
  for select to authenticated
  using (business_id = (select public.current_business_id()));

revoke all on public.purchase_entries, public.purchase_voids from anon, authenticated;
grant select on public.purchase_entries, public.purchase_voids to authenticated;

-- ---------------------------------------------------------------------------
-- One entry as JSON (shared by the write and read functions). SECURITY INVOKER with an explicit business filter.
-- This is a purchase recording screen shape: it carries the unit cost, so it is never used by the list.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_entry_to_json(p_biz uuid, p_entry uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'product_id', e.product_id,
    'unit', e.unit,
    'purchase_date', e.purchase_date,
    'quantity', e.quantity,
    'unit_cost', e.unit_cost::text,
    'supplier_name', e.supplier_name,
    'reference', e.reference,
    'created_at', e.created_at,
    'recorded_by_me', e.created_by is not distinct from auth.uid(),
    'cancelled', v.entry_id is not null,
    'void', case
              when v.entry_id is null then null
              else jsonb_build_object(
                'reason', v.reason,
                'voided_at', v.voided_at,
                'by_me', v.voided_by is not distinct from auth.uid())
            end
  )
  from public.purchase_entries e
  left join public.purchase_voids v on v.entry_id = e.id and v.business_id = e.business_id
  where e.business_id = p_biz and e.id = p_entry
$$;

-- ---------------------------------------------------------------------------
-- The shared definition of the market list rows (internal). One row per registered medicine and unit, and one
-- per typed text and unit. SECURITY INVOKER; the business is read once, and the two aggregates are MATERIALIZED
-- so the planner runs each once (the lesson of migration 0005).
-- It selects only names, descriptive fields, quantities, units and stores. It never selects a price or a cost.
-- ---------------------------------------------------------------------------

create or replace function public.market_rows(p_date date)
returns table (
  row_key text,
  product_id uuid,
  name text,
  typed_name text,
  strength text,
  dosage_form text,
  pack_size text,
  manufacturer text,
  unit text,
  total_requested integer,
  purchased integer,
  remaining integer,
  extra integer,
  status text,
  stores jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.current_business_id();
  v_from timestamptz;
  v_to timestamptz;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  v_from := p_date::timestamp at time zone 'Asia/Karachi';
  v_to := (p_date + 1)::timestamp at time zone 'Asia/Karachi';

  return query
  with day_lines as materialized (
    select ol.product_id as d_product,
           ol.name as d_name,
           ol.unit as d_unit,
           public.norm_text(ol.unit) as d_unit_key,
           ol.quantity as d_qty,
           o.store_id as d_store,
           ol.created_at as d_at,
           ol.id as d_line
      from public.order_lines ol
      join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
     where ol.business_id = v_biz and o.business_id = v_biz
       and ol.removed_at is null
       and o.status in ('confirmed', 'fulfilled')
       and o.confirmed_at >= v_from and o.confirmed_at < v_to
  ),
  per_store as materialized (
    select d.d_product as s_product,
           case when d.d_product is null then public.norm_text(d.d_name) end as s_typed_key,
           d.d_unit_key as s_unit_key,
           d.d_store as s_store,
           sum(d.d_qty)::int as s_qty,
           (array_agg(d.d_name order by d.d_at, d.d_line))[1] as s_first_name,
           (array_agg(d.d_unit order by d.d_at, d.d_line))[1] as s_first_unit,
           min(d.d_at) as s_first_at
      from day_lines d
     group by 1, 2, 3, 4
  ),
  grouped as (
    select ps.s_product as g_product,
           ps.s_typed_key as g_typed_key,
           ps.s_unit_key as g_unit_key,
           sum(ps.s_qty)::int as g_total,
           (array_agg(ps.s_first_name order by ps.s_first_at, ps.s_store))[1] as g_first_name,
           (array_agg(ps.s_first_unit order by ps.s_first_at, ps.s_store))[1] as g_first_unit,
           jsonb_agg(
             jsonb_build_object('store_id', ps.s_store, 'store_name', st.name, 'quantity', ps.s_qty)
             order by lower(st.name), ps.s_store
           ) as g_stores
      from per_store ps
      join public.stores st on st.id = ps.s_store and st.business_id = v_biz
     group by 1, 2, 3
  ),
  bought as materialized (
    select pe.product_id as b_product,
           public.norm_text(pe.unit) as b_unit_key,
           sum(pe.quantity)::int as b_qty
      from public.purchase_entries pe
     where pe.business_id = v_biz and pe.purchase_date = p_date
       and not exists (
         select 1 from public.purchase_voids pv
          where pv.business_id = pe.business_id and pv.entry_id = pe.id
       )
     group by 1, 2
  ),
  joined as (
    select g.g_product, g.g_typed_key, g.g_unit_key, g.g_total, g.g_first_name, g.g_first_unit, g.g_stores,
           p.name as p_name, p.strength as p_strength, p.dosage_form as p_form, p.pack_size as p_pack,
           p.manufacturer as p_maker,
           coalesce(b.b_qty, 0) as j_bought
      from grouped g
      left join public.products p on p.id = g.g_product and p.business_id = v_biz
      left join bought b on b.b_product = g.g_product and b.b_unit_key = g.g_unit_key
  )
  select
    case when j.g_product is not null
         then j.g_product::text || ':' || j.g_unit_key
         else 'typed:' || j.g_typed_key || ':' || j.g_unit_key end,
    j.g_product,
    j.p_name,
    case when j.g_product is null then j.g_first_name end,
    j.p_strength,
    j.p_form,
    j.p_pack,
    j.p_maker,
    j.g_first_unit,
    j.g_total,
    j.j_bought,
    greatest(j.g_total - j.j_bought, 0),
    greatest(j.j_bought - j.g_total, 0),
    case
      when j.j_bought = 0 then 'not_bought'
      when j.j_bought < j.g_total then 'partly_bought'
      when j.j_bought = j.g_total then 'fully_bought'
      else 'bought_extra'
    end,
    j.g_stores
  from joined j;
end;
$$;

-- ---------------------------------------------------------------------------
-- market_list: the screen, the print page and the CSV all read this.
-- ---------------------------------------------------------------------------

create or replace function public.market_list(p_date date, p_q text, p_status text, p_stores uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_status text := coalesce(nullif(btrim(p_status), ''), 'all');
  v_all_stores boolean := p_stores is null or cardinality(p_stores) = 0;
  v_cap constant int := 2000;
  v_result jsonb;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;
  if v_status not in ('all', 'to_buy', 'bought') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  with rows_all as materialized (
    select * from public.market_rows(p_date)
  ),
  shown as (
    select r.*,
           case
             when v_all_stores then r.stores
             else coalesce((
               select jsonb_agg(e.value order by e.ord)
                 from jsonb_array_elements(r.stores) with ordinality as e(value, ord)
                where (e.value ->> 'store_id')::uuid = any (p_stores)
             ), '[]'::jsonb)
           end as shown_stores
      from rows_all r
  ),
  filtered as (
    select s.*,
           (select coalesce(sum((e.value ->> 'quantity')::int), 0)::int
              from jsonb_array_elements(s.shown_stores) as e(value)) as shown_requested
      from shown s
     where jsonb_array_length(s.shown_stores) > 0
       and public.pending_search_ok(
             concat_ws(' ', s.name, s.strength, s.dosage_form, s.manufacturer, s.typed_name), null, p_q)
       and (v_status = 'all'
            or (v_status = 'to_buy' and s.remaining > 0)
            or (v_status = 'bought' and s.purchased > 0))
  ),
  ordered as (
    select f.*,
           row_number() over (
             order by (f.product_id is null),
                      lower(coalesce(f.name, f.typed_name)),
                      lower(coalesce(f.strength, '')),
                      lower(f.unit),
                      f.row_key
           ) as rn
      from filtered f
  )
  select jsonb_build_object(
    'date', p_date,
    'generated_at', now(),
    'business_name', (select b.name from public.businesses b where b.id = v_biz),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by lower(x.name), x.id)
        from (
          select distinct (e.value ->> 'store_id')::uuid as id, e.value ->> 'store_name' as name
            from rows_all ra, jsonb_array_elements(ra.stores) as e(value)
        ) x
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', o.row_key, 'product_id', o.product_id, 'name', o.name, 'typed_name', o.typed_name,
          'strength', o.strength, 'dosage_form', o.dosage_form, 'pack_size', o.pack_size,
          'manufacturer', o.manufacturer, 'unit', o.unit,
          'total_requested', o.total_requested, 'shown_requested', o.shown_requested,
          'purchased', o.purchased, 'remaining', o.remaining, 'extra', o.extra, 'status', o.status,
          'can_record', true, 'stores', o.shown_stores
        ) order by o.rn)
        from ordered o where o.rn <= v_cap and o.product_id is not null
    ), '[]'::jsonb),
    'typed_rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', o.row_key, 'product_id', null, 'name', null, 'typed_name', o.typed_name,
          'strength', null, 'dosage_form', null, 'pack_size', null, 'manufacturer', null, 'unit', o.unit,
          'total_requested', o.total_requested, 'shown_requested', o.shown_requested,
          'purchased', 0, 'remaining', o.total_requested, 'extra', 0, 'status', 'not_bought',
          'can_record', false, 'stores', o.shown_stores
        ) order by o.rn)
        from ordered o where o.rn <= v_cap and o.product_id is null
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'requested', (select coalesce(sum(f.total_requested), 0) from filtered f),
      'purchased', (select coalesce(sum(f.purchased), 0) from filtered f),
      'remaining', (select coalesce(sum(f.remaining), 0) from filtered f),
      'rows', (select count(*) from filtered f where f.product_id is not null),
      'typed_rows', (select count(*) from filtered f where f.product_id is null)
    ),
    'truncated', exists (select 1 from ordered o where o.rn > v_cap)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- market_summary: the Home card. It reads the same rows as market_list, so rows_to_buy always equals the length
-- of the "to_buy" list (without a search or a store filter).
-- ---------------------------------------------------------------------------

create or replace function public.market_summary(p_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_total int;
  v_to_buy int;
  v_typed int;
  v_typed_to_buy int;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select count(*)::int,
         (count(*) filter (where r.remaining > 0))::int,
         (count(*) filter (where r.product_id is null))::int,
         (count(*) filter (where r.product_id is null and r.remaining > 0))::int
    into v_total, v_to_buy, v_typed, v_typed_to_buy
    from public.market_rows(p_date) r;

  return jsonb_build_object(
    'date', p_date,
    'rows_total', v_total,
    'rows_to_buy', v_to_buy,
    'typed_rows', v_typed,
    'typed_to_buy', v_typed_to_buy
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- purchase_entries_list: the purchase history of one medicine, unit and date, cancelled entries included.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_entries_list(p_product uuid, p_unit text, p_date date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_key text := public.norm_text(p_unit);
  v_entries jsonb;
  v_bought int;
  v_requested int;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_product is null or p_date is null or v_key = '' then
    return jsonb_build_object('found', false);
  end if;
  if not exists (select 1 from public.products p where p.id = p_product and p.business_id = v_biz) then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(jsonb_agg(public.purchase_entry_to_json(v_biz, e.id) order by e.created_at desc, e.id), '[]'::jsonb),
         coalesce(sum(e.quantity) filter (where v.entry_id is null), 0)::int
    into v_entries, v_bought
    from public.purchase_entries e
    left join public.purchase_voids v on v.entry_id = e.id and v.business_id = e.business_id
   where e.business_id = v_biz and e.product_id = p_product
     and public.norm_text(e.unit) = v_key and e.purchase_date = p_date;

  select coalesce(sum(r.total_requested), 0)::int
    into v_requested
    from public.market_rows(p_date) r
   where r.product_id = p_product and public.norm_text(r.unit) = v_key;

  return jsonb_build_object('found', true, 'entries', v_entries, 'purchased', v_bought, 'requested', v_requested);
end;
$$;

-- ---------------------------------------------------------------------------
-- purchase_record: one real purchase. The entry id is the request id.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_record(
  p_id uuid,
  p_product uuid,
  p_unit text,
  p_date date,
  p_quantity int,
  p_unit_cost text,
  p_supplier text,
  p_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_fields jsonb := '{}'::jsonb;
  v_unit text;
  v_cost numeric(12, 2);
  v_supplier text;
  v_reference text;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_existing public.purchase_entries;
  v_money_re constant text := '^[0-9]{1,10}(\.[0-9]{1,2})?$';
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  if p_id is null then
    v_fields := v_fields || jsonb_build_object('id', 'A request id is required.');
  end if;
  if p_product is null then
    v_fields := v_fields || jsonb_build_object('product_id', 'Choose a medicine.');
  end if;

  v_unit := btrim(regexp_replace(coalesce(p_unit, ''), '\s+', ' ', 'g'));
  if char_length(v_unit) < 1 or char_length(v_unit) > 50 then
    v_fields := v_fields || jsonb_build_object('unit', 'Enter the unit (1 to 50 characters).');
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    v_fields := v_fields || jsonb_build_object('quantity', 'Enter a whole number from 1 to 100,000.');
  end if;

  if p_unit_cost is not null and btrim(p_unit_cost) <> '' then
    if btrim(p_unit_cost) ~ v_money_re then
      v_cost := btrim(p_unit_cost)::numeric(12, 2);
    else
      v_fields := v_fields || jsonb_build_object('unit_cost', 'Enter an amount like 125 or 125.50, or leave it empty.');
    end if;
  end if;

  v_supplier := nullif(btrim(coalesce(p_supplier, '')), '');
  if v_supplier is not null and char_length(v_supplier) > 200 then
    v_fields := v_fields || jsonb_build_object('supplier_name', 'Use at most 200 characters.');
  end if;

  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if v_reference is not null and char_length(v_reference) > 100 then
    v_fields := v_fields || jsonb_build_object('reference', 'Use at most 100 characters.');
  end if;

  if p_date is null then
    v_fields := v_fields || jsonb_build_object('purchase_date', 'Choose a date.');
  elsif p_date > v_today or p_date < date '2000-01-01' then
    v_fields := v_fields || jsonb_build_object('purchase_date', 'Choose today or an earlier day.');
  end if;

  if v_fields <> '{}'::jsonb then
    return jsonb_build_object('done', false, 'reason', 'invalid_purchase', 'fields', v_fields);
  end if;

  -- One writer per entry id: a simultaneous identical request waits here, then finds the stored entry.
  perform pg_advisory_xact_lock(hashtext('purchase:' || p_id::text));

  select * into v_existing from public.purchase_entries e where e.business_id = v_biz and e.id = p_id;
  if found then
    if v_existing.product_id = p_product
       and public.norm_text(v_existing.unit) = public.norm_text(v_unit)
       and v_existing.purchase_date = p_date
       and v_existing.quantity = p_quantity
       and v_existing.unit_cost is not distinct from v_cost
       and v_existing.supplier_name is not distinct from v_supplier
       and v_existing.reference is not distinct from v_reference then
      return jsonb_build_object('done', true, 'replayed', true,
        'entry', public.purchase_entry_to_json(v_biz, p_id));
    end if;
    return jsonb_build_object('done', false, 'reason', 'request_reused');
  end if;

  if not exists (select 1 from public.products p where p.id = p_product and p.business_id = v_biz) then
    return jsonb_build_object('done', false, 'reason', 'product_not_found');
  end if;

  insert into public.purchase_entries
    (id, business_id, product_id, unit, purchase_date, quantity, unit_cost, supplier_name, reference)
  values
    (p_id, v_biz, p_product, v_unit, p_date, p_quantity, v_cost, v_supplier, v_reference);

  return jsonb_build_object('done', true, 'replayed', false,
    'entry', public.purchase_entry_to_json(v_biz, p_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- purchase_void: cancel one entry with a reason. The entry stays; cancelling twice cancels once.
-- ---------------------------------------------------------------------------

create or replace function public.purchase_void(p_entry uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing public.purchase_voids;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_entry is null then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if char_length(v_reason) < 1 then
    return jsonb_build_object('done', false, 'reason', 'invalid_void',
      'fields', jsonb_build_object('reason', 'Write why this entry is cancelled.'));
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object('done', false, 'reason', 'invalid_void',
      'fields', jsonb_build_object('reason', 'Use at most 500 characters.'));
  end if;

  perform pg_advisory_xact_lock(hashtext('purchase:' || p_entry::text));

  if not exists (select 1 from public.purchase_entries e where e.business_id = v_biz and e.id = p_entry) then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  select * into v_existing from public.purchase_voids v where v.business_id = v_biz and v.entry_id = p_entry;
  if found then
    return jsonb_build_object('done', true, 'replayed', true,
      'entry', public.purchase_entry_to_json(v_biz, p_entry));
  end if;

  insert into public.purchase_voids (entry_id, business_id, reason) values (p_entry, v_biz, v_reason);

  return jsonb_build_object('done', true, 'replayed', false,
    'entry', public.purchase_entry_to_json(v_biz, p_entry));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. The list functions never select a price or a cost.
-- ---------------------------------------------------------------------------

revoke all on function public.purchase_entry_to_json(uuid, uuid) from public, anon;
revoke all on function public.market_rows(date) from public, anon;
revoke all on function public.market_list(date, text, text, uuid[]) from public, anon;
revoke all on function public.market_summary(date) from public, anon;
revoke all on function public.purchase_entries_list(uuid, text, date) from public, anon;
revoke all on function public.purchase_record(uuid, uuid, text, date, int, text, text, text) from public, anon;
revoke all on function public.purchase_void(uuid, text) from public, anon;

grant execute on function public.purchase_entry_to_json(uuid, uuid) to authenticated;
grant execute on function public.market_rows(date) to authenticated;
grant execute on function public.market_list(date, text, text, uuid[]) to authenticated;
grant execute on function public.market_summary(date) to authenticated;
grant execute on function public.purchase_entries_list(uuid, text, date) to authenticated;
grant execute on function public.purchase_record(uuid, uuid, text, date, int, text, text, text) to authenticated;
grant execute on function public.purchase_void(uuid, text) to authenticated;

commit;
