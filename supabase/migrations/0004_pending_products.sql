-- Module 004: pending products (Quick Register, linking typed order lines, Pending Prices).
--
-- Typed (not registered) order lines become real medicines, or are linked to existing ones, only through the
-- write functions below (pending_line_register, pending_line_link, pending_price_apply). Signed-in users still
-- have SELECT only on the order tables, so a direct request cannot link a line or write a price snapshot. The
-- only controlled exception to the snapshot guard of migration 0003 is the transaction-local flag
-- app.line_snapshot_edit, which is set and reset only inside pending_link_line and pending_price_apply.
-- Every function reads the business from current_business_id() and filters every statement by it.
--
-- This file is safe to run more than once (if not exists, drop trigger if exists, create or replace, and the
-- order_events check is replaced by catalog lookup).
--
-- Roll back (a development or test environment only; production rollback is a new forward migration, because
-- linked and price_filled history rows must not be lost):
--   drop function if exists public.pending_price_apply(uuid, text, uuid, uuid[], boolean),
--     public.pending_price_preview(uuid, text), public.pending_line_link(uuid, uuid, uuid, int, uuid, boolean, text),
--     public.pending_line_register(uuid, uuid, uuid, int, jsonb, boolean, boolean),
--     public.pending_link_line(uuid, uuid, uuid, public.products, text, boolean),
--     public.pending_candidates(uuid), public.pending_prices_list(text, boolean, int, int),
--     public.pending_typed_groups(text, int, int), public.pending_summary(), public.pending_search_ok(text, text, text),
--     public.pending_like_escape(text), public.pending_labels(public.products), public.pending_product_brief(public.products);
--   drop table if exists public.pending_requests;
--   drop index if exists public.order_lines_pending_typed_idx, public.order_lines_waiting_price_idx, public.products_unpriced_idx;
--   drop trigger if exists order_lines_typed_name_once on public.order_lines;
--   drop function if exists public.order_lines_typed_name_once();
--   alter table public.order_lines drop column if exists typed_name;
--   (then restore the order_events check from 0003 and order_to_json from 0003)

begin;

-- ---------------------------------------------------------------------------
-- order_lines.typed_name: the exact text the supplier typed, kept after a line is linked (write-once)
-- ---------------------------------------------------------------------------

alter table public.order_lines add column if not exists typed_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_lines_typed_name_check') then
    alter table public.order_lines
      add constraint order_lines_typed_name_check
      check (typed_name is null or char_length(btrim(typed_name)) between 1 and 200);
  end if;
end $$;

create or replace function public.order_lines_typed_name_once()
returns trigger
language plpgsql
as $$
begin
  if old.typed_name is not null and new.typed_name is distinct from old.typed_name then
    raise exception 'typed_name_immutable: the text the supplier typed cannot change'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists order_lines_typed_name_once on public.order_lines;
create trigger order_lines_typed_name_once
  before update on public.order_lines
  for each row execute function public.order_lines_typed_name_once();

-- ---------------------------------------------------------------------------
-- order_events: two new kinds of history entry
-- ---------------------------------------------------------------------------

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
    check (event_type in ('created', 'confirmed', 'edited', 'cancelled', 'linked', 'price_filled'));
end $$;

-- ---------------------------------------------------------------------------
-- pending_requests: one record per write request, so a repeated request returns the same result
-- ---------------------------------------------------------------------------

create table if not exists public.pending_requests (
  business_id  uuid not null default public.current_business_id()
                 references public.businesses (id) on delete restrict,
  request_id   uuid not null,
  kind         text not null check (kind in ('register', 'link', 'price_apply')),
  result       jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (business_id, request_id)
);

-- Records are never edited. Only the service role (tests and operations, never the app) may delete rows.
create or replace function public.pending_requests_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_user = 'service_role' then
    return old;
  end if;
  raise exception 'pending_requests_append_only: request records cannot be changed or deleted'
    using errcode = '22023';
end;
$$;

drop trigger if exists pending_requests_guard on public.pending_requests;
create trigger pending_requests_guard
  before update or delete on public.pending_requests
  for each row execute function public.pending_requests_guard();

alter table public.pending_requests enable row level security;
revoke all on public.pending_requests from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indexes for the pending lists
-- ---------------------------------------------------------------------------

create index if not exists order_lines_pending_typed_idx
  on public.order_lines (business_id, order_id)
  where product_id is null and removed_at is null;

create index if not exists order_lines_waiting_price_idx
  on public.order_lines (business_id, product_id, order_id)
  where product_id is not null and removed_at is null
    and snapshot_taken_at is not null and selling_price_snapshot is null;

create index if not exists products_unpriced_idx
  on public.products (business_id, lower(name))
  where is_active and selling_price is null;

-- ---------------------------------------------------------------------------
-- order_to_json: identical to migration 0003 except each line also returns typed_name
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
    select ol.id, ol.position, ol.created_at, ol.product_id, ol.item_status, ol.name, ol.typed_name, ol.strength, ol.dosage_form,
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

-- ---------------------------------------------------------------------------
-- Small helpers (no purchase price or MRP is ever read or returned)
-- ---------------------------------------------------------------------------

create or replace function public.pending_product_brief(p public.products)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'unit', p.unit,
    'strength', p.strength,
    'dosage_form', p.dosage_form,
    'pack_size', p.pack_size,
    'manufacturer', p.manufacturer,
    'selling_price', p.selling_price::text,
    'is_active', p.is_active
  )
$$;

-- The exact labels a typed line may carry to count as this medicine: name, name + strength,
-- name + strength + dosage form (single spaces, case ignored).
create or replace function public.pending_labels(p public.products)
returns text[]
language sql
immutable
set search_path = public
as $$
  select array[
    public.norm_text(p.name),
    public.norm_text(concat_ws(' ', p.name, nullif(btrim(p.strength), ''))),
    public.norm_text(concat_ws(' ', p.name, nullif(btrim(p.strength), ''), nullif(btrim(p.dosage_form), '')))
  ]
$$;

create or replace function public.pending_like_escape(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(replace(replace(coalesce(p_value, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- Every word of the search must appear in the text (or in the second text).
create or replace function public.pending_search_ok(p_text text, p_text2 text, p_q text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1
      from unnest(string_to_array(btrim(coalesce(p_q, '')), ' ')) as t(word)
     where t.word <> ''
       and coalesce(p_text, '') not ilike ('%' || public.pending_like_escape(t.word) || '%')
       and coalesce(p_text2, '') not ilike ('%' || public.pending_like_escape(t.word) || '%')
  )
$$;

-- ---------------------------------------------------------------------------
-- Linking one line (internal, shared by register and link). Not callable by signed-in users.
-- ---------------------------------------------------------------------------

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
  v_version int;
begin
  select * into v_order from public.orders where id = p_order and business_id = p_biz;
  select * into v_line from public.order_lines where id = p_line and order_id = p_order and business_id = p_biz;

  -- The medicine's selling price goes onto the line only when the supplier agreed, the order is confirmed,
  -- the line has no price yet and the medicine has one.
  v_apply := coalesce(p_apply_price, false)
             and v_order.status = 'confirmed'
             and v_line.snapshot_taken_at is not null
             and v_line.selling_price_snapshot is null
             and p_product.selling_price is not null;
  if v_apply then
    v_price := p_product.selling_price;
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
         selling_price_snapshot = case when v_apply then v_price else selling_price_snapshot end
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

-- ---------------------------------------------------------------------------
-- Quick Register: create the medicine and link the line, all or nothing
-- ---------------------------------------------------------------------------

create or replace function public.pending_line_register(
  p_order uuid,
  p_line uuid,
  p_request_id uuid,
  p_expected_version int,
  p_product jsonb,
  p_confirm_similar boolean,
  p_apply_price boolean
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
  v_order public.orders;
  v_line public.order_lines;
  v_fields jsonb := '{}'::jsonb;
  v_id uuid;
  v_name text;
  v_unit text;
  v_brand text;
  v_generic text;
  v_strength text;
  v_form text;
  v_maker text;
  v_pack text;
  v_sku text;
  v_pp text;
  v_sp text;
  v_mrp text;
  v_matches jsonb;
  v_row public.products;
  v_link jsonb;
  v_result jsonb;
  v_constraint text;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_money_re constant text := '^[0-9]{1,10}(\.[0-9]{1,2})?$';
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_order is null or p_line is null or p_request_id is null or p_product is null
     or jsonb_typeof(p_product) <> 'object' then
    return jsonb_build_object('done', false, 'reason', 'invalid_product',
      'fields', jsonb_build_object('name', 'The medicine details are required.'));
  end if;

  -- Replay, first look (a request that already succeeded returns its stored result).
  select * into v_cached from public.pending_requests where business_id = v_biz and request_id = p_request_id;
  if found then
    if v_cached.kind <> 'register' then
      return jsonb_build_object('done', false, 'reason', 'invalid_request');
    end if;
    return v_cached.result || jsonb_build_object('replayed', true, 'order', public.order_to_json(v_biz, p_order, true));
  end if;

  perform pg_advisory_xact_lock(hashtext('product:' || coalesce(p_product ->> 'id', '')));
  perform pg_advisory_xact_lock(hashtext('order:' || p_order::text));

  -- Replay, second look: a simultaneous identical request may have stored its result while this one waited.
  select * into v_cached from public.pending_requests where business_id = v_biz and request_id = p_request_id;
  if found then
    if v_cached.kind <> 'register' then
      return jsonb_build_object('done', false, 'reason', 'invalid_request');
    end if;
    return v_cached.result || jsonb_build_object('replayed', true, 'order', public.order_to_json(v_biz, p_order, true));
  end if;

  select * into v_order from public.orders where id = p_order and business_id = v_biz for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if v_order.status in ('cancelled', 'fulfilled') then
    return jsonb_build_object('done', false, 'reason', 'order_not_editable',
      'current', public.order_to_json(v_biz, p_order, true));
  end if;
  if p_expected_version is null or v_order.version <> p_expected_version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
      'current', public.order_to_json(v_biz, p_order, true));
  end if;

  select * into v_line from public.order_lines
   where id = p_line and order_id = p_order and business_id = v_biz and removed_at is null;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'line_not_found');
  end if;
  if v_line.product_id is not null then
    return jsonb_build_object('done', false, 'reason', 'line_not_pending',
      'current', public.order_to_json(v_biz, p_order, true));
  end if;

  -- Field checks (the Module 001 limits). Nothing is defaulted and nothing is parsed out of the name.
  v_name := nullif(btrim(regexp_replace(coalesce(p_product ->> 'name', ''), '[[:space:]]+', ' ', 'g')), '');
  v_unit := nullif(btrim(coalesce(p_product ->> 'unit', '')), '');
  v_brand := nullif(btrim(coalesce(p_product ->> 'brand', '')), '');
  v_generic := nullif(btrim(coalesce(p_product ->> 'generic_name', '')), '');
  v_strength := nullif(btrim(coalesce(p_product ->> 'strength', '')), '');
  v_form := nullif(btrim(coalesce(p_product ->> 'dosage_form', '')), '');
  v_maker := nullif(btrim(coalesce(p_product ->> 'manufacturer', '')), '');
  v_pack := nullif(btrim(coalesce(p_product ->> 'pack_size', '')), '');
  v_sku := nullif(btrim(coalesce(p_product ->> 'sku', '')), '');
  v_pp := nullif(btrim(coalesce(p_product ->> 'purchase_price', '')), '');
  v_sp := nullif(btrim(coalesce(p_product ->> 'selling_price', '')), '');
  v_mrp := nullif(btrim(coalesce(p_product ->> 'mrp', '')), '');

  if coalesce(p_product ->> 'id', '') !~ v_uuid_re then
    v_fields := v_fields || jsonb_build_object('id', 'A valid id is required.');
  end if;
  if v_name is null then
    v_fields := v_fields || jsonb_build_object('name', 'Enter the medicine name.');
  elsif char_length(v_name) > 200 then
    v_fields := v_fields || jsonb_build_object('name', 'Name can be at most 200 characters.');
  end if;
  if v_unit is null then
    v_fields := v_fields || jsonb_build_object('unit', 'Choose or enter a unit.');
  elsif char_length(v_unit) > 50 then
    v_fields := v_fields || jsonb_build_object('unit', 'Unit can be at most 50 characters.');
  end if;
  if char_length(coalesce(v_brand, '')) > 200 then
    v_fields := v_fields || jsonb_build_object('brand', 'Brand can be at most 200 characters.');
  end if;
  if char_length(coalesce(v_generic, '')) > 200 then
    v_fields := v_fields || jsonb_build_object('generic_name', 'Generic name can be at most 200 characters.');
  end if;
  if char_length(coalesce(v_strength, '')) > 100 then
    v_fields := v_fields || jsonb_build_object('strength', 'Strength can be at most 100 characters.');
  end if;
  if char_length(coalesce(v_form, '')) > 100 then
    v_fields := v_fields || jsonb_build_object('dosage_form', 'Dosage form can be at most 100 characters.');
  end if;
  if char_length(coalesce(v_maker, '')) > 200 then
    v_fields := v_fields || jsonb_build_object('manufacturer', 'Manufacturer can be at most 200 characters.');
  end if;
  if char_length(coalesce(v_pack, '')) > 100 then
    v_fields := v_fields || jsonb_build_object('pack_size', 'Pack size can be at most 100 characters.');
  end if;
  if char_length(coalesce(v_sku, '')) > 100 then
    v_fields := v_fields || jsonb_build_object('sku', 'SKU can be at most 100 characters.');
  end if;
  if v_pp is not null and v_pp !~ v_money_re then
    v_fields := v_fields || jsonb_build_object('purchase_price', 'Enter an amount in PKR with at most two decimals.');
  end if;
  if v_sp is not null and v_sp !~ v_money_re then
    v_fields := v_fields || jsonb_build_object('selling_price', 'Enter an amount in PKR with at most two decimals.');
  end if;
  if v_mrp is not null and v_mrp !~ v_money_re then
    v_fields := v_fields || jsonb_build_object('mrp', 'Enter an amount in PKR with at most two decimals.');
  end if;
  if v_fields <> '{}'::jsonb then
    return jsonb_build_object('done', false, 'reason', 'invalid_product', 'fields', v_fields);
  end if;

  v_id := (p_product ->> 'id')::uuid;
  if exists (select 1 from public.products where id = v_id) then
    return jsonb_build_object('done', false, 'reason', 'unusable_id');
  end if;

  -- A code already used by another medicine.
  if v_sku is not null then
    select coalesce(jsonb_agg(public.pending_product_brief(p) order by lower(p.name), p.id), '[]'::jsonb)
      into v_matches
      from public.products p
     where p.business_id = v_biz and lower(btrim(p.sku)) = lower(v_sku);
    if v_matches <> '[]'::jsonb then
      return jsonb_build_object('done', false, 'reason', 'sku_conflict', 'matches', v_matches);
    end if;
  end if;

  -- An exact duplicate (inactive medicines included) is blocked.
  select coalesce(jsonb_agg(public.pending_product_brief(p) order by lower(p.name), p.id), '[]'::jsonb)
    into v_matches
    from public.products p
   where p.business_id = v_biz
     and public.norm_text(p.name) = public.norm_text(v_name)
     and public.norm_text(p.strength) = public.norm_text(v_strength)
     and public.norm_text(p.dosage_form) = public.norm_text(v_form)
     and public.norm_text(p.pack_size) = public.norm_text(v_pack)
     and public.norm_text(p.manufacturer) = public.norm_text(v_maker);
  if v_matches <> '[]'::jsonb then
    return jsonb_build_object('done', false, 'reason', 'duplicate_product', 'matches', v_matches);
  end if;

  -- The same name with another strength, form, pack or maker needs the supplier's explicit confirmation.
  if not coalesce(p_confirm_similar, false) then
    select coalesce(jsonb_agg(public.pending_product_brief(p) order by lower(p.name), p.id), '[]'::jsonb)
      into v_matches
      from public.products p
     where p.business_id = v_biz and public.norm_text(p.name) = public.norm_text(v_name);
    if v_matches <> '[]'::jsonb then
      return jsonb_build_object('done', false, 'reason', 'similar_products', 'matches', v_matches);
    end if;
  end if;

  begin
    insert into public.products (id, business_id, name, unit, brand, generic_name, strength, dosage_form,
                                 manufacturer, pack_size, sku, purchase_price, selling_price, mrp)
    values (v_id, v_biz, v_name, v_unit, v_brand, v_generic, v_strength, v_form, v_maker, v_pack, v_sku,
            v_pp::numeric(12, 2), v_sp::numeric(12, 2), v_mrp::numeric(12, 2))
    returning * into v_row;
  exception when unique_violation then
    -- A race with another session (a different request): report it like the checks above. The insert
    -- is undone, so no medicine is created and the line stays as it was.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'products_sku_uniq' then
      select coalesce(jsonb_agg(public.pending_product_brief(p) order by lower(p.name), p.id), '[]'::jsonb)
        into v_matches from public.products p
       where p.business_id = v_biz and lower(btrim(p.sku)) = lower(v_sku);
      return jsonb_build_object('done', false, 'reason', 'sku_conflict', 'matches', v_matches);
    end if;
    select coalesce(jsonb_agg(public.pending_product_brief(p) order by lower(p.name), p.id), '[]'::jsonb)
      into v_matches from public.products p
     where p.business_id = v_biz and public.norm_text(p.name) = public.norm_text(v_name);
    return jsonb_build_object('done', false, 'reason', 'duplicate_product', 'matches', v_matches);
  end;

  v_link := public.pending_link_line(v_biz, p_order, p_line, v_row, 'registered', p_apply_price);

  v_result := jsonb_build_object(
    'done', true,
    'replayed', false,
    'product', public.pending_product_brief(v_row),
    'price_applied', (v_link ->> 'price_applied')::boolean,
    'order', public.order_to_json(v_biz, p_order, true)
  );
  insert into public.pending_requests (business_id, request_id, kind, result)
  values (v_biz, p_request_id, 'register', v_result - 'replayed');
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Link a typed line to an existing medicine the supplier picked and confirmed
-- ---------------------------------------------------------------------------

create or replace function public.pending_line_link(
  p_order uuid,
  p_line uuid,
  p_request_id uuid,
  p_expected_version int,
  p_product_id uuid,
  p_apply_price boolean,
  p_how text default 'existing'
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
  v_order public.orders;
  v_line public.order_lines;
  v_prod public.products;
  v_link jsonb;
  v_result jsonb;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_order is null or p_line is null or p_request_id is null or p_product_id is null then
    return jsonb_build_object('done', false, 'reason', 'invalid_request');
  end if;

  select * into v_cached from public.pending_requests where business_id = v_biz and request_id = p_request_id;
  if found then
    if v_cached.kind <> 'link' then
      return jsonb_build_object('done', false, 'reason', 'invalid_request');
    end if;
    return v_cached.result || jsonb_build_object('replayed', true, 'order', public.order_to_json(v_biz, p_order, true));
  end if;

  perform pg_advisory_xact_lock(hashtext('product:' || p_product_id::text));
  perform pg_advisory_xact_lock(hashtext('order:' || p_order::text));

  select * into v_cached from public.pending_requests where business_id = v_biz and request_id = p_request_id;
  if found then
    if v_cached.kind <> 'link' then
      return jsonb_build_object('done', false, 'reason', 'invalid_request');
    end if;
    return v_cached.result || jsonb_build_object('replayed', true, 'order', public.order_to_json(v_biz, p_order, true));
  end if;

  select * into v_order from public.orders where id = p_order and business_id = v_biz for update;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'not_found');
  end if;
  if v_order.status in ('cancelled', 'fulfilled') then
    return jsonb_build_object('done', false, 'reason', 'order_not_editable',
      'current', public.order_to_json(v_biz, p_order, true));
  end if;
  if p_expected_version is null or v_order.version <> p_expected_version then
    return jsonb_build_object('done', false, 'reason', 'version_conflict',
      'current', public.order_to_json(v_biz, p_order, true));
  end if;

  select * into v_line from public.order_lines
   where id = p_line and order_id = p_order and business_id = v_biz and removed_at is null;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'line_not_found');
  end if;
  if v_line.product_id is not null then
    return jsonb_build_object('done', false, 'reason', 'line_not_pending',
      'current', public.order_to_json(v_biz, p_order, true));
  end if;

  select * into v_prod from public.products where id = p_product_id and business_id = v_biz;
  if not found then
    return jsonb_build_object('done', false, 'reason', 'product_not_found');
  end if;
  if not v_prod.is_active then
    return jsonb_build_object('done', false, 'reason', 'product_inactive');
  end if;

  v_link := public.pending_link_line(v_biz, p_order, p_line, v_prod,
                                     case when p_how = 'proposal' then 'proposal' else 'existing' end,
                                     p_apply_price);

  v_result := jsonb_build_object(
    'done', true,
    'replayed', false,
    'product', public.pending_product_brief(v_prod),
    'price_applied', (v_link ->> 'price_applied')::boolean,
    'order', public.order_to_json(v_biz, p_order, true)
  );
  insert into public.pending_requests (business_id, request_id, kind, result)
  values (v_biz, p_request_id, 'link', v_result - 'replayed');
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pending Prices: preview the exact lines a price would fill (read-only)
-- ---------------------------------------------------------------------------

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
           'quantity', t.quantity, 'line_total', (t.quantity * v_price)::numeric(18, 2)::text
         ) order by t.order_number, t.position, t.id), '[]'::jsonb)
    into v_lines
    from (
      select ol.id, ol.order_id, o.order_number, ol.position, ol.quantity, s.name as store_name
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

-- ---------------------------------------------------------------------------
-- Pending Prices: set a price once and give it to exactly the reviewed lines, all or nothing
-- ---------------------------------------------------------------------------

create or replace function public.pending_price_apply(
  p_product uuid,
  p_price text,
  p_request_id uuid,
  p_line_ids uuid[],
  p_fill_lines boolean
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

  if p_fill_lines and (
       (select coalesce(array_agg(x order by x), '{}'::uuid[]) from unnest(v_ids) as x)
       is distinct from
       (select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) from unnest(v_want) as x)
     ) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', t.id, 'order_id', t.order_id, 'order_number', t.order_number, 'store_name', t.store_name,
             'quantity', t.quantity, 'line_total', (t.quantity * v_price)::numeric(18, 2)::text
           ) order by t.order_number, t.position, t.id), '[]'::jsonb)
      into v_current
      from (
        select ol.id, ol.order_id, o.order_number, ol.position, ol.quantity, s.name as store_name
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
    update public.order_lines
       set selling_price_snapshot = v_price
     where id = any (v_ids) and business_id = v_biz and product_id = p_product
       and removed_at is null and snapshot_taken_at is not null and selling_price_snapshot is null;
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
               'previous_price', null, 'new_price', v_price::text
             ) order by ol.position, ol.id), '[]'::jsonb))
        from public.order_lines ol
       where ol.order_id = v_order and ol.id = any (v_ids) and ol.business_id = v_biz;
      v_touched := v_touched + 1;
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
             'line_id', t.id, 'order_id', t.order_id, 'order_number', t.order_number, 'store_name', t.store_name,
             'quantity', t.quantity, 'line_total', (t.quantity * v_price)::numeric(18, 2)::text
           ) order by t.order_number, t.position, t.id), '[]'::jsonb)
      into v_filled
      from (
        select ol.id, ol.order_id, o.order_number, ol.position, ol.quantity, s.name as store_name
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
-- Reading: counts for Home and the two lists. SECURITY INVOKER, so Row Level Security applies.
-- Purchase price and MRP are never selected.
-- ---------------------------------------------------------------------------

create or replace function public.pending_summary()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_typed_lines int;
  v_typed_groups int;
  v_items int;
  v_items_waiting int;
  v_lines_waiting int;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  select count(*), count(distinct public.norm_text(ol.name))
    into v_typed_lines, v_typed_groups
    from public.order_lines ol
    join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
   where ol.business_id = v_biz and ol.product_id is null and ol.removed_at is null
     and o.status in ('draft', 'confirmed');

  with waiting as (
    select ol.product_id, count(*) as n
      from public.order_lines ol
      join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
      join public.products p on p.id = ol.product_id and p.business_id = ol.business_id and p.is_active
     where ol.business_id = v_biz and ol.product_id is not null and ol.removed_at is null
       and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null
     group by ol.product_id
  ),
  items as (
    select p.id, coalesce(w.n, 0) as n
      from public.products p
      left join waiting w on w.product_id = p.id
     where p.business_id = v_biz and p.is_active and (p.selling_price is null or w.n is not null)
  )
  select count(*), count(*) filter (where n > 0), coalesce((select sum(n) from waiting), 0)
    into v_items, v_items_waiting, v_lines_waiting
    from items;

  return jsonb_build_object(
    'typed_lines', v_typed_lines,
    'typed_groups', v_typed_groups,
    'price_items', v_items,
    'price_items_with_waiting_lines', v_items_waiting,
    'lines_waiting', v_lines_waiting
  );
end;
$$;

create or replace function public.pending_typed_groups(p_q text, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_items jsonb;
  v_more boolean;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  with typed as (
    select ol.id as line_id, ol.order_id, o.order_number, o.status as order_status, o.store_id, s.name as store_name,
           ol.name as typed_text, ol.quantity, ol.unit, ol.created_at, public.norm_text(ol.name) as key
      from public.order_lines ol
      join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
      join public.stores s on s.id = o.store_id and s.business_id = o.business_id
     where ol.business_id = v_biz and ol.product_id is null and ol.removed_at is null
       and o.status in ('draft', 'confirmed')
       and public.pending_search_ok(ol.name, null, p_q)
  ),
  groups as (
    select t.key,
           (array_agg(t.typed_text order by t.created_at, t.line_id))[1] as typed_text,
           count(*) as line_count,
           jsonb_agg(jsonb_build_object(
             'line_id', t.line_id, 'order_id', t.order_id, 'order_number', t.order_number,
             'order_status', t.order_status, 'store_id', t.store_id, 'store_name', t.store_name,
             'typed_text', t.typed_text, 'quantity', t.quantity, 'unit', t.unit
           ) order by t.order_number, t.line_id) as lines
      from typed t
     group by t.key
  ),
  page as (
    select g.* from groups g order by lower(g.typed_text), g.key limit v_limit + 1 offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'typed_text', pg.typed_text, 'line_count', pg.line_count, 'lines', pg.lines
         ) order by lower(pg.typed_text), pg.key) filter (where pg.rn <= v_limit), '[]'::jsonb),
         coalesce(bool_or(pg.rn > v_limit), false)
    into v_items, v_more
    from (select p.*, row_number() over (order by lower(p.typed_text), p.key) as rn from page p) pg;

  return jsonb_build_object('items', v_items, 'next_offset', case when v_more then v_offset + v_limit else null end);
end;
$$;

create or replace function public.pending_prices_list(p_q text, p_only_waiting boolean, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_items jsonb;
  v_more boolean;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  with waiting as (
    select ol.product_id, count(*) as lines_waiting, count(distinct ol.order_id) as orders_waiting
      from public.order_lines ol
      join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
      join public.products p on p.id = ol.product_id and p.business_id = ol.business_id and p.is_active
     where ol.business_id = v_biz and ol.product_id is not null and ol.removed_at is null
       and o.status = 'confirmed' and ol.snapshot_taken_at is not null and ol.selling_price_snapshot is null
     group by ol.product_id
  ),
  items as (
    select p.id, p.name, p.strength, p.dosage_form, p.pack_size, p.manufacturer, p.unit, p.selling_price,
           coalesce(w.lines_waiting, 0) as lines_waiting, coalesce(w.orders_waiting, 0) as orders_waiting
      from public.products p
      left join waiting w on w.product_id = p.id
     where p.business_id = v_biz and p.is_active and (p.selling_price is null or w.lines_waiting is not null)
       and public.pending_search_ok(p.search_text, p.dosage_form, p_q)
       and (not coalesce(p_only_waiting, false) or coalesce(w.lines_waiting, 0) > 0)
  ),
  ranked as (
    select i.*, row_number() over (order by i.lines_waiting desc, lower(i.name), i.id) as rn
      from items i
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', r.id, 'name', r.name, 'strength', r.strength, 'dosage_form', r.dosage_form,
           'pack_size', r.pack_size, 'manufacturer', r.manufacturer, 'unit', r.unit,
           'selling_price', r.selling_price::text, 'lines_waiting', r.lines_waiting, 'orders_waiting', r.orders_waiting
         ) order by r.rn) filter (where r.rn > v_offset and r.rn <= v_offset + v_limit), '[]'::jsonb),
         coalesce(bool_or(r.rn > v_offset + v_limit), false)
    into v_items, v_more
    from ranked r;

  return jsonb_build_object('items', v_items, 'next_offset', case when v_more then v_offset + v_limit else null end);
end;
$$;

-- After a medicine is registered or linked: typed lines that clearly match it (proposed) and look-alikes
-- (listed, never proposed). Nothing is written here.
create or replace function public.pending_candidates(p_product uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_prod public.products;
  v_labels text[];
  v_first text;
  v_proposed jsonb;
  v_not jsonb;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  select * into v_prod from public.products where id = p_product and business_id = v_biz;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;
  v_labels := public.pending_labels(v_prod);
  v_first := split_part(public.norm_text(v_prod.name), ' ', 1);

  with typed as (
    select ol.id as line_id, ol.order_id, o.order_number, o.status as order_status, s.name as store_name,
           ol.name as typed_text, ol.quantity, ol.unit, ol.created_at, public.norm_text(ol.name) as key
      from public.order_lines ol
      join public.orders o on o.id = ol.order_id and o.business_id = ol.business_id
      join public.stores s on s.id = o.store_id and s.business_id = o.business_id
     where ol.business_id = v_biz and ol.product_id is null and ol.removed_at is null
       and o.status in ('draft', 'confirmed')
  ),
  tagged as (
    select t.*,
           (t.key = any (v_labels)) as exact,
           exists (
             select 1 from public.products p2
              where p2.business_id = v_biz and p2.is_active and p2.id <> v_prod.id
                and t.key = any (public.pending_labels(p2))
           ) as ambiguous
      from typed t
  ),
  proposed as (
    select * from tagged where exact and not ambiguous
     order by order_number, line_id limit 200
  ),
  other as (
    select * from tagged
     where (exact and ambiguous) or (not exact and split_part(key, ' ', 1) = v_first)
     order by order_number, line_id limit 200
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
        'line_id', p.line_id, 'order_id', p.order_id, 'order_number', p.order_number,
        'order_status', p.order_status, 'store_name', p.store_name, 'typed_text', p.typed_text,
        'quantity', p.quantity, 'unit', p.unit
      ) order by p.order_number, p.line_id), '[]'::jsonb) from proposed p),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'line_id', o.line_id, 'order_id', o.order_id, 'order_number', o.order_number,
        'order_status', o.order_status, 'store_name', o.store_name, 'typed_text', o.typed_text,
        'quantity', o.quantity, 'unit', o.unit
      ) order by o.order_number, o.line_id), '[]'::jsonb) from other o)
    into v_proposed, v_not;

  return jsonb_build_object('ok', true, 'proposed', v_proposed, 'not_proposed', v_not);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: signed-in users may call the public functions; the internal helper is not callable at all
-- ---------------------------------------------------------------------------

revoke all on function public.pending_link_line(uuid, uuid, uuid, public.products, text, boolean)
  from public, anon, authenticated;

revoke all on function
  public.pending_product_brief(public.products),
  public.pending_labels(public.products),
  public.pending_like_escape(text),
  public.pending_search_ok(text, text, text),
  public.pending_line_register(uuid, uuid, uuid, int, jsonb, boolean, boolean),
  public.pending_line_link(uuid, uuid, uuid, int, uuid, boolean, text),
  public.pending_price_preview(uuid, text),
  public.pending_price_apply(uuid, text, uuid, uuid[], boolean),
  public.pending_summary(),
  public.pending_typed_groups(text, int, int),
  public.pending_prices_list(text, boolean, int, int),
  public.pending_candidates(uuid)
  from public, anon;

grant execute on function
  public.pending_product_brief(public.products),
  public.pending_labels(public.products),
  public.pending_like_escape(text),
  public.pending_search_ok(text, text, text),
  public.pending_line_register(uuid, uuid, uuid, int, jsonb, boolean, boolean),
  public.pending_line_link(uuid, uuid, uuid, int, uuid, boolean, text),
  public.pending_price_preview(uuid, text),
  public.pending_price_apply(uuid, text, uuid, uuid[], boolean),
  public.pending_summary(),
  public.pending_typed_groups(text, int, int),
  public.pending_prices_list(text, boolean, int, int),
  public.pending_candidates(uuid)
  to authenticated;

commit;
