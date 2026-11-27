-- Module 012: store-specific selling prices.
--
-- The owner negotiates a different rate for each medicine with each store. This migration adds:
--   * store_rates: the current rate of one medicine for one store (a removed rate stays as a row);
--   * store_rate_events: the append-only history of every rate change;
--   * order_lines.chosen_price (the price typed for an order) and order_lines.price_source (where the recorded
--     price came from: typed, store_rate or catalog).
-- One rule decides the price of a draft line: the typed price, else the order store's rate for the medicine (only
-- when the line uses the medicine's own unit), else the medicine's selling price, else none. A recorded price
-- (a confirmed line) never changes. No price is ever computed from another one.
--
-- Replaced functions (taken from 0003 and 0004 with the changes marked in specs/012-store-rates): order_lines_guard,
-- order_to_json, order_list, order_save, order_confirm (one new parameter), pending_link_line, pending_price_preview,
-- pending_price_apply (one new parameter). Invoices, the ledger, the market list, order sheets and reports are untouched.
--
-- Rollback: drop store_rate_events, store_rates and the two order_lines columns, then run again the replaced
-- functions of 0003 and 0004 (with their old signatures and grants). Confirmed orders and invoices keep their prices.
--
-- Safe to run more than once. Apply the whole file at once.

begin;

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------

create table if not exists public.store_rates (
  business_id           uuid not null default public.current_business_id()
                          references public.businesses (id) on delete restrict,
  store_id              uuid not null,
  product_id            uuid not null,
  rate                  numeric(12, 2) not null check (rate > 0),
  catalog_price_at_set  numeric(12, 2) check (catalog_price_at_set is null or catalog_price_at_set >= 0),
  version               integer not null default 1 check (version >= 1),
  removed_at            timestamptz,
  updated_at            timestamptz not null default now(),
  primary key (business_id, store_id, product_id),
  constraint store_rates_store_fk foreign key (business_id, store_id) references public.stores (business_id, id),
  constraint store_rates_product_fk foreign key (business_id, product_id) references public.products (business_id, id)
);

create index if not exists store_rates_product_idx on public.store_rates (business_id, product_id);

create table if not exists public.store_rate_events (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null default public.current_business_id()
                   references public.businesses (id) on delete restrict,
  store_id       uuid not null,
  product_id     uuid not null,
  event_type     text not null check (event_type in ('set', 'changed', 'removed')),
  old_rate       numeric(12, 2),
  new_rate       numeric(12, 2),
  catalog_price  numeric(12, 2),
  order_id       uuid,
  actor          uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint store_rate_events_store_fk foreign key (business_id, store_id) references public.stores (business_id, id),
  constraint store_rate_events_product_fk foreign key (business_id, product_id) references public.products (business_id, id)
);

create index if not exists store_rate_events_store_idx on public.store_rate_events (business_id, store_id, created_at desc);

alter table public.order_lines add column if not exists chosen_price numeric(12, 2);
alter table public.order_lines add column if not exists price_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_lines_chosen_price_positive') then
    alter table public.order_lines add constraint order_lines_chosen_price_positive
      check (chosen_price is null or chosen_price > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_lines_price_source_known') then
    alter table public.order_lines add constraint order_lines_price_source_known
      check (price_source is null or price_source in ('typed', 'store_rate', 'catalog'));
  end if;
end $$;

-- The history of rates can never be edited. Only the service role (tests and operations, never the app) may delete
-- rows, for example to remove a test business.
create or replace function public.store_rate_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception 'store_rate_events_append_only: the rate history cannot be changed or deleted'
    using errcode = '22023';
end;
$$;

drop trigger if exists store_rate_events_append_only on public.store_rate_events;
create trigger store_rate_events_append_only
  before update or delete on public.store_rate_events
  for each row execute function public.store_rate_events_append_only();

alter table public.store_rates enable row level security;
alter table public.store_rate_events enable row level security;

drop policy if exists store_rates_select on public.store_rates;
create policy store_rates_select on public.store_rates
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists store_rate_events_select on public.store_rate_events;
create policy store_rate_events_select on public.store_rate_events
  for select to authenticated
  using (business_id = (select public.current_business_id()));

revoke all on public.store_rates, public.store_rate_events from anon, authenticated;
grant select on public.store_rates, public.store_rate_events to authenticated;

-- ---------------------------------------------------------------------------
-- The one price rule
-- ---------------------------------------------------------------------------

-- The store's rate for a line: only a live rate of an active medicine, and only for the medicine's own unit.
create or replace function public.order_line_rate(p_biz uuid, p_store uuid, p_product uuid, p_unit text)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select r.rate
    from public.store_rates r
    join public.products p on p.id = r.product_id and p.business_id = r.business_id
   where r.business_id = p_biz and r.store_id = p_store and r.product_id = p_product
     and r.removed_at is null and p.is_active
     and public.norm_text(p.unit) = public.norm_text(p_unit)
$$;

-- The price a draft line is billed at, and where it comes from. One row, both null when there is no price.
create or replace function public.order_line_effective_price(p_biz uuid, p_store uuid, p_product uuid, p_unit text, p_chosen numeric)
returns table (price numeric(12, 2), source text)
language sql
stable
security invoker
set search_path = public
as $$
  select case
           when p_product is null then null
           else coalesce(p_chosen, s.rate, s.catalog)::numeric(12, 2)
         end,
         case
           when p_product is null then null
           when p_chosen is not null then 'typed'
           when s.rate is not null then 'store_rate'
           when s.catalog is not null then 'catalog'
         end
    from (
      select public.order_line_rate(p_biz, p_store, p_product, p_unit) as rate,
             (select p.selling_price from public.products p where p.id = p_product and p.business_id = p_biz) as catalog
    ) s
$$;

-- Remembers the typed prices the supplier ticked, as part of the same order save. A rate that changed since the screen
-- read it is not overwritten: it is returned instead, and the order is saved all the same. Internal: not callable by users.
create or replace function public.order_remember_rates(p_biz uuid, p_store uuid, p_order uuid, p_lines jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_line record;
  v_prod public.products;
  v_rate public.store_rates;
  v_found boolean;
  v_live boolean;
  v_conflicts jsonb := '[]'::jsonb;
begin
  for v_line in
    select x.product_id, x.unit, x.price, x.rate_version, x.ord
      from jsonb_to_recordset(p_lines) as x(product_id uuid, unit text, price numeric(12, 2), remember boolean, rate_version int, ord int)
     where x.remember and x.price is not null and x.price > 0 and x.product_id is not null
     order by x.ord
  loop
    select * into v_prod from public.products where id = v_line.product_id and business_id = p_biz;
    -- A rate belongs to the medicine's own unit; an inactive medicine gets none.
    continue when not found or not v_prod.is_active or public.norm_text(v_prod.unit) <> public.norm_text(v_line.unit);

    perform pg_advisory_xact_lock(hashtext('rate:' || p_store::text || ':' || v_line.product_id::text));
    select * into v_rate from public.store_rates
     where business_id = p_biz and store_id = p_store and product_id = v_line.product_id for update;
    v_found := found;
    v_live := v_found and v_rate.removed_at is null;

    if v_live and v_rate.rate = v_line.price then
      -- The same rate again: only the catalog price it was agreed against may need updating.
      if v_rate.catalog_price_at_set is distinct from v_prod.selling_price then
        update public.store_rates
           set catalog_price_at_set = v_prod.selling_price, version = version + 1, updated_at = now()
         where business_id = p_biz and store_id = p_store and product_id = v_line.product_id;
        insert into public.store_rate_events (business_id, store_id, product_id, event_type, old_rate, new_rate, catalog_price, order_id)
        values (p_biz, p_store, v_line.product_id, 'changed', v_rate.rate, v_line.price, v_prod.selling_price, p_order);
      end if;
      continue;
    end if;

    -- Changed or removed since the screen read it: never overwrite silently.
    if (v_live and v_line.rate_version is distinct from v_rate.version)
       or (not v_live and v_line.rate_version is not null) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'product_id', v_line.product_id,
        'current_rate', case when v_live then v_rate.rate::text end,
        'current_version', case when v_live then v_rate.version end));
      continue;
    end if;

    insert into public.store_rates (business_id, store_id, product_id, rate, catalog_price_at_set)
    values (p_biz, p_store, v_line.product_id, v_line.price, v_prod.selling_price)
    on conflict (business_id, store_id, product_id) do update
      set rate = excluded.rate, catalog_price_at_set = excluded.catalog_price_at_set,
          version = public.store_rates.version + 1, removed_at = null, updated_at = now();
    insert into public.store_rate_events (business_id, store_id, product_id, event_type, old_rate, new_rate, catalog_price, order_id)
    values (p_biz, p_store, v_line.product_id, case when v_live then 'changed' else 'set' end,
            case when v_live then v_rate.rate end, v_line.price, v_prod.selling_price, p_order);
  end loop;
  return v_conflicts;
end;
$$;

-- ---------------------------------------------------------------------------
-- The line guard (from 0003) now also protects the typed price and its source once a price is recorded
-- ---------------------------------------------------------------------------

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
       or new.chosen_price is distinct from old.chosen_price
       or new.price_source is distinct from old.price_source
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

-- order_to_json (from 0004): draft lines show the effective price, where it comes from and the store's rate
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
    select ol.id, ol.position, ol.created_at, ol.product_id, ol.item_status, ol.name, ol.typed_name, ol.strength, ol.dosage_form,
           ol.pack_size, ol.manufacturer, ol.quantity, ol.unit, ol.delivered_quantity, ol.snapshot_taken_at,
           p.is_active as product_active,
           case
             when ol.snapshot_taken_at is not null then ol.selling_price_snapshot
             when v_row.status = 'draft' then ep.price
             else null
           end as eff_price,
           case
             when ol.snapshot_taken_at is not null then ol.price_source
             when v_row.status = 'draft' then ep.source
             else null
           end as eff_source,
           case when v_row.status = 'draft' then ol.chosen_price end as draft_chosen,
           case when v_row.status = 'draft' then p.selling_price end as catalog_price,
           case when v_row.status = 'draft' then p.unit end as product_unit,
           case when v_row.status = 'draft' and r.product_id is not null then
             jsonb_build_object('rate', r.rate::text, 'version', r.version,
                                'catalog_price_at_set', r.catalog_price_at_set::text)
           end as rate_info
      from public.order_lines ol
      left join public.products p on p.id = ol.product_id and p.business_id = ol.business_id
      left join lateral public.order_line_effective_price(p_biz, v_row.store_id, ol.product_id, ol.unit, ol.chosen_price) ep on true
      left join public.store_rates r
        on r.business_id = p_biz and r.store_id = v_row.store_id and r.product_id = ol.product_id
       and r.removed_at is null and p.is_active and public.norm_text(p.unit) = public.norm_text(ol.unit)
     where ol.order_id = p_order and ol.business_id = p_biz and ol.removed_at is null
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id,
        'position', l.position,
        'product_id', l.product_id,
        'item_status', l.item_status,
        'name', l.name,
        'typed_name', l.typed_name,
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
        'price_source', l.eff_source,
        'chosen_price', l.draft_chosen::text,
        'catalog_price', l.catalog_price::text,
        'product_unit', l.product_unit,
        'rate', l.rate_info,
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

-- order_list (from 0003): draft totals follow the effective price
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
                       when o.status = 'draft' then ep.price
                       else null
                     end as price
                from public.order_lines ol
                left join lateral public.order_line_effective_price(ol.business_id, o.store_id, ol.product_id, ol.unit, ol.chosen_price) ep on true
               where ol.order_id = o.id and ol.business_id = o.business_id and ol.removed_at is null
            ) t
        ) agg
    ) x;

  return v_result;
end;
$$;

-- order_save (from 0003): typed prices, remembered rates, billed price in the history
-- The dropped voice work (migration 0009, applied only to the maintainer's test and development projects) had
-- replaced order_save with an eight-argument form. It is dropped here so that exactly one order_save exists; on a
-- project without 0009 this does nothing.
drop function if exists public.order_save(uuid, uuid, int, uuid, text, jsonb, text, text);
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
  v_conflicts jsonb := '[]'::jsonb;
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
           'has_price', e.elem ? 'price',
           'price_text', e.elem->>'price',
           'price', case when e.elem->>'price' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then (e.elem->>'price')::numeric(12, 2) end,
           'remember', coalesce(e.elem->>'remember', '') = 'true',
           'rate_version', case when e.elem->>'rate_version' ~ '^[0-9]{1,9}$' then (e.elem->>'rate_version')::int end,
           'has_expected', e.elem ? 'expected_price',
           'expected', case when e.elem->>'expected_price' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then (e.elem->>'expected_price')::numeric(12, 2) end,
           'ord', e.ord
         ) order by e.ord), '[]'::jsonb)
    into v_src
    from jsonb_array_elements(p_lines) with ordinality as e(elem, ord);

  with x as (
    select * from jsonb_to_recordset(v_src)
      as t(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int,
           has_price boolean, price_text text, price numeric(12, 2))
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
    when exists (select 1 from x where price_text is not null and (price is null or price <= 0))
      then 'Enter a price above 0 with at most two decimals.'
    when exists (select 1 from x where price_text is not null and product_id is null)
      then 'Register the medicine before setting its price.'
    when exists (select 1 from x join public.order_lines ol
                    on ol.id = x.id and ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
                  where ol.snapshot_taken_at is not null and x.price is not null
                    and x.price is distinct from ol.selling_price_snapshot)
      then 'A recorded price cannot be changed.'
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
                                    strength, dosage_form, pack_size, manufacturer, quantity, unit, chosen_price)
    select x.id, v_biz, p_id, x.ord, x.product_id,
           case when x.product_id is null then 'pending_registration' else 'registered' end,
           case when x.product_id is null then x.name else p.name end,
           p.strength, p.dosage_form, p.pack_size, p.manufacturer, x.quantity, x.unit, x.price
      from jsonb_to_recordset(v_src)
             as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int, price numeric(12, 2))
      left join public.products p on p.id = x.product_id and p.business_id = v_biz;

    insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
    values (v_biz, p_id, 'created', 1, auth.uid(),
            jsonb_build_object('created', jsonb_build_object('store_id', p_store_id, 'order_number', v_number)));

    v_conflicts := public.order_remember_rates(v_biz, p_store_id, p_id, v_src);

    return jsonb_build_object('saved', true, 'replayed', false, 'created', true,
      'order', public.order_to_json(v_biz, p_id, true), 'rate_conflicts', v_conflicts);
  end if;

  -- ---------------------------------------------------------------- update (draft) or edit (confirmed)
  v_snapshot := v_order.status = 'confirmed';

  if v_snapshot then
    perform 1 from public.products p
      where p.business_id = v_biz
        and p.id in (select (e->>'product_id')::uuid from jsonb_array_elements(v_src) e where e->>'product_id' is not null)
      for share;
    perform 1 from public.store_rates r where r.business_id = v_biz and r.store_id = p_store_id for share;
    if exists (
      select 1
        from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, unit text, price numeric(12, 2),
                                            has_expected boolean, expected numeric(12, 2))
        left join lateral public.order_line_effective_price(v_biz, p_store_id, x.product_id, x.unit, x.price) ep on true
       where x.has_expected
         and not exists (select 1 from public.order_lines ol where ol.id = x.id)
         and ep.price is distinct from x.expected
    ) then
      return jsonb_build_object('saved', false, 'reason', 'price_changed',
        'current', public.order_to_json(v_biz, p_id, true));
    end if;
  end if;

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
                                  'quantity', x.quantity, 'unit', x.unit, 'selling_price', ep.price::text)
               || case when ep.source in ('typed', 'store_rate') then jsonb_build_object('price_source', ep.source)
                       else '{}'::jsonb end
          from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int, price numeric(12, 2))
          left join public.products p on p.id = x.product_id and p.business_id = v_biz
          left join lateral public.order_line_effective_price(v_biz, p_store_id, x.product_id, x.unit, x.price) ep on true
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
         delivered_quantity = case when v_snapshot then x.quantity else ol.delivered_quantity end,
         chosen_price = case
           when ol.snapshot_taken_at is not null then ol.chosen_price
           when x.has_price then x.price
           when public.norm_text(ol.unit) <> public.norm_text(x.unit) then null
           else ol.chosen_price
         end
    from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int, has_price boolean, price numeric(12, 2))
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
                                  snapshot_taken_at, chosen_price, price_source)
  select x.id, v_biz, p_id, x.ord, x.product_id,
         case when x.product_id is null then 'pending_registration' else 'registered' end,
         case when x.product_id is null then x.name else p.name end,
         p.strength, p.dosage_form, p.pack_size, p.manufacturer, x.quantity, x.unit,
         case when v_snapshot then x.quantity end,
         case when v_snapshot then p.purchase_price end,
         case when v_snapshot then ep.price end,
         case when v_snapshot then p.mrp end,
         case when v_snapshot then now() end,
         x.price,
         case when v_snapshot then ep.source end
    from jsonb_to_recordset(v_src) as x(id uuid, product_id uuid, bad_product boolean, name text, quantity int, unit text, ord int, price numeric(12, 2))
    left join public.products p on p.id = x.product_id and p.business_id = v_biz
    left join lateral public.order_line_effective_price(v_biz, p_store_id, x.product_id, x.unit, x.price) ep on true
   where not exists (select 1 from public.order_lines ol where ol.id = x.id);

  if v_snapshot and jsonb_array_length(v_changes) > 0 then
    select version into v_version from public.orders where id = p_id and business_id = v_biz;
    insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
    values (v_biz, p_id, 'edited', v_version, auth.uid(), jsonb_build_object('edited', jsonb_build_object('changes', v_changes)));
  end if;

  v_conflicts := public.order_remember_rates(v_biz, p_store_id, p_id, v_src);

  return jsonb_build_object('saved', true, 'replayed', false, 'created', false,
    'order', public.order_to_json(v_biz, p_id, true), 'rate_conflicts', v_conflicts);
end;
$$;

-- order_confirm (from 0003): records the effective price and its source; the old signature is dropped first so
-- that only one function of this name exists
drop function if exists public.order_confirm(uuid, uuid, int);
create or replace function public.order_confirm(p_id uuid, p_request_id uuid, p_expected_version int,
                                                p_expected_prices jsonb default null)
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

  -- Nothing these prices depend on may change between this check and the record.
  perform 1 from public.products p
    where p.business_id = v_biz
      and p.id in (select l.product_id from public.order_lines l
                    where l.order_id = p_id and l.business_id = v_biz and l.removed_at is null)
    for share;
  perform 1 from public.store_rates r where r.business_id = v_biz and r.store_id = v_order.store_id for share;

  -- The price recorded must be the price the supplier was shown.
  if p_expected_prices is not null and exists (
    select 1
      from public.order_lines ol
      left join lateral public.order_line_effective_price(v_biz, v_order.store_id, ol.product_id, ol.unit, ol.chosen_price) ep on true
      left join lateral (
        select e.value from jsonb_array_elements(p_expected_prices) e where e.value->>'line_id' = ol.id::text limit 1
      ) x on true
     where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null
       and (x.value is null or ep.price is distinct from (
             case when x.value->>'selling_price' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
                  then (x.value->>'selling_price')::numeric(12, 2) end))
  ) then
    return jsonb_build_object('confirmed', false, 'reason', 'price_changed',
      'current', public.order_to_json(v_biz, p_id, true));
  end if;

  -- Catalog lines: description and prices exactly as they are now (empty stays empty).
  update public.order_lines ol
     set name = p.name,
         strength = p.strength,
         dosage_form = p.dosage_form,
         pack_size = p.pack_size,
         manufacturer = p.manufacturer,
         purchase_price_snapshot = p.purchase_price,
         selling_price_snapshot = (select e.price from public.order_line_effective_price(
                                     v_biz, v_order.store_id, ol.product_id, ol.unit, ol.chosen_price) e),
         price_source = (select e.source from public.order_line_effective_price(
                           v_biz, v_order.store_id, ol.product_id, ol.unit, ol.chosen_price) e),
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
            'priced_total', v_totals -> 'priced_total',
            'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                          'line_id', ol.id, 'name', ol.name,
                          'selling_price', ol.selling_price_snapshot::text, 'price_source', ol.price_source
                        ) order by ol.position, ol.id), '[]'::jsonb)
                        from public.order_lines ol
                       where ol.order_id = p_id and ol.business_id = v_biz and ol.removed_at is null))));

  return jsonb_build_object('confirmed', true, 'replayed', false, 'order', public.order_to_json(v_biz, p_id, true));
end;
$$;

-- pending_link_line (from 0004): the store's rate first
create or replace function public.pending_link_line(
  p_biz uuid,
  p_order uuid,
  p_line uuid,
  p_product public.products,
  p_how text,
  p_apply_price boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_line public.order_lines;
  v_apply boolean;
  v_price numeric(12, 2);
  v_source text;
  v_found numeric(12, 2);
  v_version int;
begin
  select * into v_order from public.orders where id = p_order and business_id = p_biz;
  select * into v_line from public.order_lines where id = p_line and order_id = p_order and business_id = p_biz;

  -- The medicine's selling price goes onto the line only when the supplier agreed, the order is confirmed,
  -- the line has no price yet and the medicine has one.
  -- The order store's rate comes first (only for the medicine's own unit), else the medicine's selling price.
  v_found := public.order_line_rate(p_biz, v_order.store_id, p_product.id, v_line.unit);
  v_apply := coalesce(p_apply_price, false)
             and v_order.status = 'confirmed'
             and v_line.snapshot_taken_at is not null
             and v_line.selling_price_snapshot is null
             and coalesce(v_found, p_product.selling_price) is not null;
  if v_apply then
    v_price := coalesce(v_found, p_product.selling_price);
    v_source := case when v_found is not null then 'store_rate' else 'catalog' end;
  end if;

  if v_line.snapshot_taken_at is not null then
    perform set_config('app.line_snapshot_edit', 'on', true);
  end if;

  update public.order_lines
     set typed_name = name,
         product_id = p_product.id,
         item_status = 'registered',
         name = p_product.name,
         strength = p_product.strength,
         dosage_form = p_product.dosage_form,
         pack_size = p_product.pack_size,
         manufacturer = p_product.manufacturer,
         selling_price_snapshot = case when v_apply then v_price else selling_price_snapshot end,
         price_source = case when v_apply then v_source else price_source end
   where id = p_line and business_id = p_biz;

  perform set_config('app.line_snapshot_edit', 'off', true);

  -- One update of the order row, so its version moves by exactly one and open editors see the change.
  update public.orders set updated_at = now()
   where id = p_order and business_id = p_biz
   returning version into v_version;

  insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
  values (p_biz, p_order, 'linked', v_version, auth.uid(),
          jsonb_build_object('linked', jsonb_build_array(jsonb_build_object(
            'line_id', p_line,
            'typed_name', v_line.name,
            'product_id', p_product.id,
            'product_name', p_product.name,
            'how', p_how,
            'price_recorded', case when v_apply then v_price::text else null end
          ))));

  return jsonb_build_object('price_applied', v_apply, 'price_recorded', case when v_apply then v_price::text else null end);
end;
$$;

-- pending_price_preview (from 0004): the price each line will get
create or replace function public.pending_price_preview(p_product uuid, p_price text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_prod public.products;
  v_price numeric(12, 2);
  v_lines jsonb;
  v_total int;
  v_untouched int;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_price is null or btrim(p_price) !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' or btrim(p_price)::numeric <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_price');
  end if;
  v_price := btrim(p_price)::numeric(12, 2);

  select * into v_prod from public.products where id = p_product and business_id = v_biz;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;
  if not v_prod.is_active then
    return jsonb_build_object('ok', false, 'reason', 'product_inactive');
  end if;
  if v_prod.selling_price is not null and v_prod.selling_price <> v_price then
    return jsonb_build_object('ok', false, 'reason', 'price_differs', 'current_price', v_prod.selling_price::text);
  end if;

  select count(*) into v_total
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
   where ol.business_id = v_biz and ol.product_id = p_product and ol.removed_at is null
     and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null;

  select count(*) into v_untouched
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
   where ol.business_id = v_biz and ol.product_id = p_product and ol.removed_at is null
     and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'line_id', t.id, 'order_id', t.order_id, 'order_number', t.order_number, 'store_name', t.store_name,
           'quantity', t.quantity, 'price', t.price::text,
           'price_source', case when t.rate is null then 'catalog' else 'store_rate' end,
           'line_total', (t.quantity * t.price)::numeric(18, 2)::text
         ) order by t.order_number, t.position, t.id), '[]'::jsonb)
    into v_lines
    from (
      select ol.id, ol.order_id, o.order_number, ol.position, ol.quantity, s.name as store_name,
             public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit) as rate,
             coalesce(public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit), v_price) as price
        from public.order_lines ol
        join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
        join public.stores s on s.id = o.store_id and s.business_id = o.business_id
       where ol.business_id = v_biz and ol.product_id = p_product and ol.removed_at is null
         and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null
       order by o.order_number, ol.position, ol.id
       limit 1000
    ) t;

  return jsonb_build_object(
    'ok', true,
    'product', public.pending_product_brief(v_prod),
    'price', v_price::text,
    'lines', v_lines,
    'untouched_priced_lines', v_untouched,
    'total_waiting', v_total,
    'batch_limit', 1000
  );
end;
$$;

-- pending_price_apply (from 0004): exactly the prices shown; the old signature is dropped first
drop function if exists public.pending_price_apply(uuid, text, uuid, uuid[], boolean);
create or replace function public.pending_price_apply(
  p_product uuid,
  p_price text,
  p_request_id uuid,
  p_line_ids uuid[],
  p_fill_lines boolean,
  p_expected jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_cached public.pending_requests;
  v_prod public.products;
  v_price numeric(12, 2);
  v_ids uuid[];
  v_want uuid[] := coalesce(p_line_ids, '{}'::uuid[]);
  v_order uuid;
  v_version int;
  v_count int;
  v_filled jsonb := '[]'::jsonb;
  v_touched int := 0;
  v_current jsonb;
  v_result jsonb;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_product is null or p_request_id is null or p_fill_lines is null then
    return jsonb_build_object('done', false, 'reason', 'invalid_request');
  end if;
  if p_price is null or btrim(p_price) !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' or btrim(p_price)::numeric <= 0 then
    return jsonb_build_object('done', false, 'reason', 'invalid_price');
  end if;
  v_price := btrim(p_price)::numeric(12, 2);

  select * into v_cached from public.pending_requests where business_id = v_biz and request_id = p_request_id;
  if found then
    if v_cached.kind <> 'price_apply' then
      return jsonb_build_object('done', false, 'reason', 'invalid_request');
    end if;
    return v_cached.result || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtext('product:' || p_product::text));

  select * into v_prod from public.products where id = p_product and business_id = v_biz for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'product_not_found');
  end if;
  if not v_prod.is_active then
    return jsonb_build_object('done', false, 'reason', 'product_inactive');
  end if;
  if not p_fill_lines and cardinality(v_want) > 0 then
    return jsonb_build_object('done', false, 'reason', 'invalid_request');
  end if;
  if v_prod.selling_price is not null and v_prod.selling_price <> v_price then
    return jsonb_build_object('done', false, 'reason', 'price_differs', 'current_price', v_prod.selling_price::text);
  end if;

  -- Lock the orders of the first 1,000 waiting lines (in id order, like order_save would), then look again.
  for v_order in
    select distinct t.order_id from (
      select ol.order_id
        from public.order_lines ol
        join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
       where ol.business_id = v_biz and ol.product_id = p_product and ol.removed_at is null
         and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null
       order by o.order_number, ol.position, ol.id
       limit 1000
    ) t
    order by t.order_id
  loop
    perform pg_advisory_xact_lock(hashtext('order:' || v_order::text));
  end loop;

  select * into v_cached from public.pending_requests where business_id = v_biz and request_id = p_request_id;
  if found then
    if v_cached.kind <> 'price_apply' then
      return jsonb_build_object('done', false, 'reason', 'invalid_request');
    end if;
    return v_cached.result || jsonb_build_object('replayed', true);
  end if;

  select coalesce(array_agg(t.id order by t.order_number, t.position, t.id), '{}'::uuid[])
    into v_ids
    from (
      select ol.id, o.order_number, ol.position
        from public.order_lines ol
        join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
       where ol.business_id = v_biz and ol.product_id = p_product and ol.removed_at is null
         and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null
       order by o.order_number, ol.position, ol.id
       limit 1000
    ) t;

  -- The rates these lines depend on may not change until the prices are recorded.
  perform 1 from public.store_rates r where r.business_id = v_biz and r.product_id = p_product for share;

  -- No line may get a price the supplier did not see: with the expected prices given, every one must match; without
  -- them (an older screen) no waiting line may have a store rate that differs from the typed price.
  if p_fill_lines and (
       (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(v_ids) as x)
       is distinct from
       (select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) from unnest(v_want) as x)
       or exists (
         select 1
           from public.order_lines ol
           join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
           left join lateral (
             select e.value from jsonb_array_elements(coalesce(p_expected, '[]'::jsonb)) e
              where e.value->>'line_id' = ol.id::text limit 1
           ) x on true
          where ol.id = any (v_ids) and ol.business_id = v_biz
            and case
                  when p_expected is null then
                    coalesce(public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit), v_price) <> v_price
                  else
                    x.value is null or coalesce(public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit), v_price)
                      is distinct from (case when x.value->>'price' ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
                                             then (x.value->>'price')::numeric(12, 2) end)
                end
       )
     ) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', t.id, 'order_id', t.order_id, 'order_number', t.order_number, 'store_name', t.store_name,
             'quantity', t.quantity, 'price', t.price::text,
             'price_source', case when t.rate is null then 'catalog' else 'store_rate' end,
             'line_total', (t.quantity * t.price)::numeric(18, 2)::text
           ) order by t.order_number, t.position, t.id), '[]'::jsonb)
      into v_current
      from (
        select ol.id, ol.order_id, o.order_number, ol.position, ol.quantity, s.name as store_name,
               public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit) as rate,
               coalesce(public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit), v_price) as price
          from public.order_lines ol
          join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
          join public.stores s on s.id = o.store_id and s.business_id = o.business_id
         where ol.id = any (v_ids) and ol.business_id = v_biz
      ) t;
    return jsonb_build_object('done', false, 'reason', 'list_changed', 'current_lines', v_current);
  end if;

  -- The catalog price is set only when the medicine has none; an existing price is never replaced here.
  update public.products set selling_price = v_price
   where id = p_product and business_id = v_biz and selling_price is null;

  if p_fill_lines and cardinality(v_ids) > 0 then
    perform set_config('app.line_snapshot_edit', 'on', true);
    update public.order_lines ol
       set selling_price_snapshot = coalesce(public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit), v_price),
           price_source = case when public.order_line_rate(v_biz, o.store_id, ol.product_id, ol.unit) is null
                               then 'catalog' else 'store_rate' end
      from public.orders o
     where o.id = ol.order_id and o.business_id = ol.business_id
       and ol.id = any (v_ids) and ol.business_id = v_biz and ol.product_id = p_product
       and ol.removed_at is null and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null;
    get diagnostics v_count = row_count;
    perform set_config('app.line_snapshot_edit', 'off', true);
    if v_count <> cardinality(v_ids) then
      raise exception 'price_fill_mismatch: the lines changed while the price was being recorded'
        using errcode = '40001';
    end if;

    for v_order in
      select distinct ol.order_id from public.order_lines ol
       where ol.id = any (v_ids) and ol.business_id = v_biz
       order by ol.order_id
    loop
      update public.orders set updated_at = now()
       where id = v_order and business_id = v_biz
       returning version into v_version;
      insert into public.order_events (business_id, order_id, event_type, order_version, actor, detail)
      select v_biz, v_order, 'price_filled', v_version, auth.uid(),
             jsonb_build_object('price_filled', coalesce(jsonb_agg(jsonb_build_object(
               'line_id', ol.id, 'product_id', p_product, 'quantity', ol.quantity,
               'previous_price', null, 'new_price', ol.selling_price_snapshot::text
             ) || case when ol.price_source = 'store_rate' then jsonb_build_object('price_source', ol.price_source)
                       else '{}'::jsonb end
             order by ol.position, ol.id), '[]'::jsonb))
        from public.order_lines ol
       where ol.order_id = v_order and ol.id = any (v_ids) and ol.business_id = v_biz;
      v_touched := v_touched + 1;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', t.id, 'order_id', t.order_id, 'order_number', t.order_number, 'store_name', t.store_name,
             'quantity', t.quantity, 'price', t.price::text, 'price_source', t.source,
             'line_total', (t.quantity * t.price)::numeric(18, 2)::text
           ) order by t.order_number, t.position, t.id), '[]'::jsonb)
      into v_filled
      from (
        select ol.id, ol.order_id, o.order_number, ol.position, ol.quantity, s.name as store_name,
               ol.selling_price_snapshot as price, ol.price_source as source
          from public.order_lines ol
          join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
          join public.stores s on s.id = o.store_id and s.business_id = o.business_id
         where ol.id = any (v_ids) and ol.business_id = v_biz
      ) t;
  end if;

  select * into v_prod from public.products where id = p_product and business_id = v_biz;
  v_result := jsonb_build_object(
    'done', true,
    'replayed', false,
    'product', public.pending_product_brief(v_prod),
    'filled_count', case when p_fill_lines then cardinality(v_ids) else 0 end,
    'orders_touched', v_touched,
    'filled', v_filled
  );
  insert into public.pending_requests (business_id, request_id, kind, result)
  values (v_biz, p_request_id, 'price_apply', v_result - 'replayed');
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading and managing rates. Identity of the medicine only: never a purchase price or MRP.
-- ---------------------------------------------------------------------------

create or replace function public.store_rate_json(p_biz uuid, p_store uuid, p_product uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
           'product_id', r.product_id,
           'rate', r.rate::text,
           'version', r.version,
           'catalog_price_at_set', r.catalog_price_at_set::text,
           'catalog_price', p.selling_price::text,
           'updated_at', r.updated_at,
           'product', jsonb_build_object('name', p.name, 'strength', p.strength, 'dosage_form', p.dosage_form,
             'pack_size', p.pack_size, 'manufacturer', p.manufacturer, 'unit', p.unit, 'is_active', p.is_active))
    from public.store_rates r
    join public.products p on p.id = r.product_id and p.business_id = r.business_id
   where r.business_id = p_biz and r.store_id = p_store and r.product_id = p_product and r.removed_at is null
$$;

-- The live rates of one store, by medicine name. null when the store is not one of this business.
create or replace function public.store_rates_list(p_store uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
begin
  if v_biz is null or not exists (select 1 from public.stores s where s.id = p_store and s.business_id = v_biz) then
    return null;
  end if;
  return (
    select coalesce(jsonb_agg(public.store_rate_json(v_biz, p_store, r.product_id) order by lower(p.name), p.id), '[]'::jsonb)
      from public.store_rates r
      join public.products p on p.id = r.product_id and p.business_id = r.business_id
     where r.business_id = v_biz and r.store_id = p_store and r.removed_at is null);
end;
$$;

-- Every live rate, page by page, for the copy kept on the phone (selling prices only).
create or replace function public.store_rates_all(p_limit int, p_offset int)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'store_id', t.store_id, 'product_id', t.product_id, 'rate', t.rate::text, 'version', t.version,
           'catalog_price_at_set', t.catalog_price_at_set::text
         ) order by t.store_id, t.product_id), '[]'::jsonb)
    from (
      select r.* from public.store_rates r
       where r.business_id = public.current_business_id() and r.removed_at is null
       order by r.store_id, r.product_id
       limit least(greatest(coalesce(p_limit, 900), 1), 901)
      offset greatest(coalesce(p_offset, 0), 0)
    ) t
$$;

-- Sets or changes a rate from the store page. p_expected_version is null when no live rate is expected.
create or replace function public.store_rate_set(p_store uuid, p_product uuid, p_rate text, p_expected_version int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_prod public.products;
  v_row public.store_rates;
  v_live boolean;
  v_rate numeric(12, 2);
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_rate is null or btrim(p_rate) !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' or btrim(p_rate)::numeric <= 0 then
    return jsonb_build_object('done', false, 'reason', 'invalid_rate');
  end if;
  v_rate := btrim(p_rate)::numeric(12, 2);
  if not exists (select 1 from public.stores s where s.id = p_store and s.business_id = v_biz) then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  select * into v_prod from public.products where id = p_product and business_id = v_biz;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(hashtext('rate:' || p_store::text || ':' || p_product::text));
  select * into v_row from public.store_rates
   where business_id = v_biz and store_id = p_store and product_id = p_product for update;
  v_live := found and v_row.removed_at is null;

  -- The same value again (a retry) changes nothing.
  if v_live and v_row.rate = v_rate and v_row.catalog_price_at_set is not distinct from v_prod.selling_price then
    return jsonb_build_object('done', true, 'rate', public.store_rate_json(v_biz, p_store, p_product));
  end if;
  if (v_live and p_expected_version is distinct from v_row.version) or (not v_live and p_expected_version is not null) then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
      'current', public.store_rate_json(v_biz, p_store, p_product));
  end if;

  insert into public.store_rates (business_id, store_id, product_id, rate, catalog_price_at_set)
  values (v_biz, p_store, p_product, v_rate, v_prod.selling_price)
  on conflict (business_id, store_id, product_id) do update
    set rate = excluded.rate, catalog_price_at_set = excluded.catalog_price_at_set,
        version = public.store_rates.version + 1, removed_at = null, updated_at = now();
  insert into public.store_rate_events (business_id, store_id, product_id, event_type, old_rate, new_rate, catalog_price)
  values (v_biz, p_store, p_product, case when v_live then 'changed' else 'set' end,
          case when v_live then v_row.rate end, v_rate, v_prod.selling_price);
  return jsonb_build_object('done', true, 'rate', public.store_rate_json(v_biz, p_store, p_product));
end;
$$;

create or replace function public.store_rate_remove(p_store uuid, p_product uuid, p_expected_version int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_row public.store_rates;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('rate:' || p_store::text || ':' || p_product::text));
  select * into v_row from public.store_rates
   where business_id = v_biz and store_id = p_store and product_id = p_product for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if v_row.removed_at is not null then
    return jsonb_build_object('done', true);
  end if;
  if p_expected_version is distinct from v_row.version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
      'current', public.store_rate_json(v_biz, p_store, p_product));
  end if;
  update public.store_rates set removed_at = now(), version = version + 1, updated_at = now()
   where business_id = v_biz and store_id = p_store and product_id = p_product;
  insert into public.store_rate_events (business_id, store_id, product_id, event_type, old_rate)
  values (v_biz, p_store, p_product, 'removed', v_row.rate);
  return jsonb_build_object('done', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Internal helpers: not callable by users.
revoke all on function public.order_remember_rates(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.pending_link_line(uuid, uuid, uuid, public.products, text, boolean) from public, anon, authenticated;

revoke all on function
  public.order_line_rate(uuid, uuid, uuid, text),
  public.order_line_effective_price(uuid, uuid, uuid, text, numeric),
  public.order_to_json(uuid, uuid, boolean),
  public.order_list(uuid, text, date, date, text, int, int),
  public.order_save(uuid, uuid, int, uuid, text, jsonb),
  public.order_confirm(uuid, uuid, int, jsonb),
  public.pending_price_preview(uuid, text),
  public.pending_price_apply(uuid, text, uuid, uuid[], boolean, jsonb),
  public.store_rate_json(uuid, uuid, uuid),
  public.store_rates_list(uuid),
  public.store_rates_all(int, int),
  public.store_rate_set(uuid, uuid, text, int),
  public.store_rate_remove(uuid, uuid, int)
  from public, anon;

grant execute on function
  public.order_line_rate(uuid, uuid, uuid, text),
  public.order_line_effective_price(uuid, uuid, uuid, text, numeric),
  public.order_to_json(uuid, uuid, boolean),
  public.order_list(uuid, text, date, date, text, int, int),
  public.order_save(uuid, uuid, int, uuid, text, jsonb),
  public.order_confirm(uuid, uuid, int, jsonb),
  public.pending_price_preview(uuid, text),
  public.pending_price_apply(uuid, text, uuid, uuid[], boolean, jsonb),
  public.store_rate_json(uuid, uuid, uuid),
  public.store_rates_list(uuid),
  public.store_rates_all(int, int),
  public.store_rate_set(uuid, uuid, text, int),
  public.store_rate_remove(uuid, uuid, int)
  to authenticated;

commit;
