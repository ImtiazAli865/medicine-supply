-- Module 004 follow-up: make the pending reads fast at scale (SC-011).
--
-- Found by tests/integration/pending-scale.test.ts (1,000 waiting lines, 1,000 typed lines, 500 medicines
-- without a price): with the planner's row estimate of 1 for the helper-function conditions it re-ran the
-- "waiting lines" aggregate once for every medicine (501 times), and re-computed every medicine's labels for every
-- typed line. Two small changes, no change in what is returned:
--   1. the "waiting" aggregate is MATERIALIZED, so it runs once (pending_summary, pending_prices_list);
--   2. pending_candidates computes the labels of the other medicines once, then looks each typed line up in them.
-- Only function bodies are replaced (create or replace); tables, grants and data are untouched. Safe to re-run.

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

  with waiting as materialized (
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

  with waiting as materialized (
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

  with plabels as materialized (
    select distinct lbl.label
      from public.products p2
     cross join lateral unnest(public.pending_labels(p2)) as lbl(label)
     where p2.business_id = v_biz and p2.is_active and p2.id <> v_prod.id
  ),
  typed as (
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
           (t.key in (select pl.label from plabels pl)) as ambiguous
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

revoke all on function public.pending_summary(), public.pending_prices_list(text, boolean, int, int), public.pending_candidates(uuid) from public, anon;
grant execute on function public.pending_summary(), public.pending_prices_list(text, boolean, int, int), public.pending_candidates(uuid) to authenticated;
