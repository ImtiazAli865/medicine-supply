-- Module 010: reports and profit (read only).
--
-- Nothing in this migration creates a table, a column, a stored total or a write path. It adds read-only database
-- functions (SECURITY INVOKER, so Row Level Security of the underlying tables still applies, and every statement also
-- filters by the signed-in user's business) and one partial index. Every report is computed on each read from the
-- issued invoices (the frozen lines), the order lines (the saved purchase price), the purchase entries (actual costs)
-- and, for balances, the existing ledger functions of migration 0008.
--
-- The cost rules (owner's decision of 2026-11-24, spec FR-010 to FR-012):
--   * Estimated cost of a billed line = billed quantity x the purchase price saved on its order line at confirmation.
--   * Realized cost of a billed line = billed quantity x the weighted average actual unit cost
--     (sum(quantity x unit_cost) / sum(quantity)) of the non-cancelled purchase entries WITH a unit cost of the same
--     medicine and unit (compared with norm_text) dated on the Pakistan market date of the line's order (the day the
--     order was confirmed). No other day is used and nothing is borrowed: no such purchase means "cost missing".
--   * Money stays numeric (unrounded line costs); each reported figure is rounded once.
-- A line billed with quantity 0 is left out everywhere (it sells and costs nothing).
--
-- Numbering: 0009 and 0010 belong to the dropped voice work (applied on the TEST and DEV projects, not in this
-- repository); they touch voice tables only and do not clash with anything here.
--
-- Rollback (nothing to undo in the data): drop the functions report_not_in_account, report_cost_missing,
-- report_by_medicine, report_by_store, report_purchases, report_sales, report_sales_lines, report_bucket_end,
-- report_bucket_start, report_figure, report_money, report_check_period, then the index invoices_report_idx.
--
-- Safe to run more than once (create or replace, if not exists).

begin;

-- ---------------------------------------------------------------------------
-- Index: the period read of issued and cancelled invoices
-- ---------------------------------------------------------------------------

create index if not exists invoices_report_idx
  on public.invoices (business_id, invoice_date)
  where status in ('issued', 'cancelled');

-- ---------------------------------------------------------------------------
-- report_check_period: every report calls this first. A refusal is 'invalid_period: <why>' (SQLSTATE 22023).
-- ---------------------------------------------------------------------------

create or replace function public.report_check_period(p_from date, p_to date, p_group text)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_from is null or p_to is null then
    raise exception 'invalid_period: both dates are required' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'invalid_period: the end date is before the start date' using errcode = '22023';
  end if;
  if p_from > (now() at time zone 'Asia/Karachi')::date then
    raise exception 'invalid_period: the period starts in the future' using errcode = '22023';
  end if;
  if p_to - p_from > 730 then
    raise exception 'invalid_period: the period is longer than 731 days' using errcode = '22023';
  end if;
  if p_group is null or p_group not in ('day', 'week', 'month') then
    raise exception 'invalid_period: the group must be day, week or month' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- report_sales_lines: the one base set. One row per billed line (quantity above 0) of every issued invoice whose
-- invoice date is in the period, with both unit costs and both "cost missing" flags. Every report reads this, so the
-- summary, the store rows and the medicine rows cannot disagree.
-- ---------------------------------------------------------------------------

create or replace function public.report_sales_lines(p_biz uuid, p_from date, p_to date)
returns table (
  invoice_id uuid,
  invoice_date date,
  store_id uuid,
  order_id uuid,
  order_line_id uuid,
  product_id uuid,
  name text,
  strength text,
  dosage_form text,
  pack_size text,
  manufacturer text,
  unit text,
  unit_key text,
  billed_qty integer,
  selling_price numeric,
  line_total numeric,
  market_date date,
  est_unit_cost numeric,
  real_unit_cost numeric,
  est_cost numeric,
  real_cost numeric,
  est_missing boolean,
  real_missing boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as materialized (
    select i.id as b_invoice,
           i.invoice_date as b_date,
           i.store_id as b_store,
           i.order_id as b_order,
           il.order_line_id as b_order_line,
           il.product_id as b_product,
           il.name as b_name,
           il.strength as b_strength,
           il.dosage_form as b_form,
           il.pack_size as b_pack,
           il.manufacturer as b_maker,
           il.unit as b_unit,
           public.norm_text(il.unit) as b_unit_key,
           il.delivered_quantity as b_qty,
           il.selling_price as b_price,
           il.line_total as b_total,
           (o.confirmed_at at time zone 'Asia/Karachi')::date as b_market,
           ol.purchase_price_snapshot as b_est
      from public.invoices i
      join public.invoice_lines il on il.business_id = i.business_id and il.invoice_id = i.id
      left join public.orders o on o.business_id = i.business_id and o.id = i.order_id
      left join public.order_lines ol on ol.business_id = il.business_id and ol.id = il.order_line_id
     where i.business_id = p_biz
       and p_biz = public.current_business_id()
       and i.status = 'issued'
       and i.invoice_date between p_from and p_to
       and il.delivered_quantity > 0
       and il.selling_price is not null
  ),
  -- One weighted average per (medicine, unit, day), only for the days the lines need and only entries with a cost.
  day_costs as materialized (
    select pe.product_id as c_product,
           public.norm_text(pe.unit) as c_unit_key,
           pe.purchase_date as c_day,
           sum(pe.quantity::numeric * pe.unit_cost) as c_total,
           sum(pe.quantity)::numeric as c_qty
      from public.purchase_entries pe
     where pe.business_id = p_biz
       and pe.unit_cost is not null
       and pe.purchase_date between (select min(b_market) from base) and (select max(b_market) from base)
       and not exists (
         select 1 from public.purchase_voids pv
          where pv.business_id = pe.business_id and pv.entry_id = pe.id
       )
     group by 1, 2, 3
  )
  select b.b_invoice, b.b_date, b.b_store, b.b_order, b.b_order_line, b.b_product, b.b_name, b.b_strength, b.b_form,
         b.b_pack, b.b_maker, b.b_unit, b.b_unit_key, b.b_qty, b.b_price, b.b_total, b.b_market,
         b.b_est,
         (c.c_total / c.c_qty),
         (b.b_qty * b.b_est),
         (b.b_qty::numeric * c.c_total / c.c_qty),
         b.b_est is null,
         c.c_qty is null
    from base b
    left join day_costs c
      on c.c_product = b.b_product and c.c_unit_key = b.b_unit_key and c.c_day = b.b_market
$$;

-- ---------------------------------------------------------------------------
-- Two pure helpers: money as text, and one profit figure as JSON
-- ---------------------------------------------------------------------------

-- Two decimals, rounded once (half away from zero, PostgreSQL's numeric rounding); a missing sum is 0.00.
create or replace function public.report_money(p_amount numeric)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select round(coalesce(p_amount, 0), 2)::numeric(20, 2)::text
$$;

-- One estimated or realized figure over a set of lines. The profit covers only the lines that have a cost; it is null
-- (not available) when no line has one, never zero standing for unknown.
create or replace function public.report_figure(
  p_cost numeric,
  p_covered numeric,
  p_covered_lines bigint,
  p_missing_lines bigint,
  p_missing_sales numeric
)
returns jsonb
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'cost', public.report_money(p_cost),
    'covered_sales', public.report_money(p_covered),
    'profit', case when coalesce(p_covered_lines, 0) = 0 then null
                   else public.report_money(coalesce(p_covered, 0) - coalesce(p_cost, 0)) end,
    'missing_lines', coalesce(p_missing_lines, 0),
    'missing_sales', public.report_money(p_missing_sales),
    'status', case when coalesce(p_missing_lines, 0) = 0 then 'complete' else 'incomplete' end
  )
$$;

-- The first and last day of the day, week (Monday) or month bucket that holds a day.
create or replace function public.report_bucket_start(p_group text, p_day date)
returns date
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select case p_group
           when 'day' then p_day
           when 'week' then date_trunc('week', p_day::timestamp)::date
           else date_trunc('month', p_day::timestamp)::date
         end
$$;

create or replace function public.report_bucket_end(p_group text, p_start date)
returns date
language sql
immutable
parallel safe
security invoker
set search_path = public
as $$
  select case p_group
           when 'day' then p_start
           when 'week' then p_start + 6
           else (date_trunc('month', p_start::timestamp) + interval '1 month' - interval '1 day')::date
         end
$$;

-- ---------------------------------------------------------------------------
-- report_sales: sales, both profit figures, what was left out and a time series
-- ---------------------------------------------------------------------------

create or replace function public.report_sales(p_from date, p_to date, p_group text default 'day')
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.current_business_id();
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  perform public.report_check_period(p_from, p_to, p_group);

  return (
    with l as materialized (select * from public.report_sales_lines(v_biz, p_from, p_to)),
    s as (
      select public.report_bucket_start(p_group, l.invoice_date) as bucket_start,
             sum(l.line_total) as sales,
             count(distinct l.invoice_id) as invoices,
             sum(l.est_cost) filter (where not l.est_missing) as e_cost,
             sum(l.line_total) filter (where not l.est_missing) as e_cov,
             count(*) filter (where not l.est_missing) as e_cov_n,
             count(*) filter (where l.est_missing) as e_miss_n,
             sum(l.line_total) filter (where l.est_missing) as e_miss_sales,
             sum(l.real_cost) filter (where not l.real_missing) as r_cost,
             sum(l.line_total) filter (where not l.real_missing) as r_cov,
             count(*) filter (where not l.real_missing) as r_cov_n,
             count(*) filter (where l.real_missing) as r_miss_n,
             sum(l.line_total) filter (where l.real_missing) as r_miss_sales
        from l
       group by 1
    ),
    t as (
      select sum(l.line_total) as sales,
             count(distinct l.invoice_id) as invoices,
             count(*) as lines,
             sum(l.billed_qty) as qty,
             sum(l.est_cost) filter (where not l.est_missing) as e_cost,
             sum(l.line_total) filter (where not l.est_missing) as e_cov,
             count(*) filter (where not l.est_missing) as e_cov_n,
             count(*) filter (where l.est_missing) as e_miss_n,
             sum(l.line_total) filter (where l.est_missing) as e_miss_sales,
             sum(l.real_cost) filter (where not l.real_missing) as r_cost,
             sum(l.line_total) filter (where not l.real_missing) as r_cov,
             count(*) filter (where not l.real_missing) as r_cov_n,
             count(*) filter (where l.real_missing) as r_miss_n,
             sum(l.line_total) filter (where l.real_missing) as r_miss_sales
        from l
    )
    select jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'group', p_group, 'generated_at', now()),
      'totals', jsonb_build_object(
        'sales', public.report_money(t.sales), 'invoices', t.invoices, 'lines', t.lines, 'quantity', coalesce(t.qty, 0)),
      'estimated', public.report_figure(t.e_cost, t.e_cov, t.e_cov_n, t.e_miss_n, t.e_miss_sales),
      'realized', public.report_figure(t.r_cost, t.r_cov, t.r_cov_n, t.r_miss_n, t.r_miss_sales),
      'excluded', jsonb_build_object(
        'cancelled_invoices', (
          select count(*) from public.invoices i
           where i.business_id = v_biz and i.status = 'cancelled' and i.invoice_date between p_from and p_to),
        'draft_invoices', (
          select count(*) from public.invoices i
           where i.business_id = v_biz and i.status = 'draft'
             and (i.created_at at time zone 'Asia/Karachi')::date between p_from and p_to)
      ),
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'bucket_start', s.bucket_start,
                 'bucket_end', public.report_bucket_end(p_group, s.bucket_start),
                 'partial', s.bucket_start < p_from or public.report_bucket_end(p_group, s.bucket_start) > p_to,
                 'sales', public.report_money(s.sales),
                 'invoices', s.invoices,
                 'estimated', public.report_figure(s.e_cost, s.e_cov, s.e_cov_n, s.e_miss_n, s.e_miss_sales),
                 'realized', public.report_figure(s.r_cost, s.r_cov, s.r_cov_n, s.r_miss_n, s.r_miss_sales)
               ) order by s.bucket_start)
          from s), '[]'::jsonb)
    )
    from t
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- report_cost_missing: sold medicines (by medicine and unit) that have no cost for a figure
-- ---------------------------------------------------------------------------

create or replace function public.report_cost_missing(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.current_business_id();
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  perform public.report_check_period(p_from, p_to, 'day');

  return (
    with l as materialized (
      select * from public.report_sales_lines(v_biz, p_from, p_to) x where x.est_missing or x.real_missing
    ),
    g as materialized (
      select coalesce(l.product_id::text, 'typed:' || public.norm_text(l.name)) as g_key,
             l.product_id as g_product,
             l.unit_key as g_unit_key,
             (array_agg(l.name order by l.invoice_date desc, l.invoice_id))[1] as g_name,
             (array_agg(l.strength order by l.invoice_date desc, l.invoice_id))[1] as g_strength,
             (array_agg(l.dosage_form order by l.invoice_date desc, l.invoice_id))[1] as g_form,
             (array_agg(l.pack_size order by l.invoice_date desc, l.invoice_id))[1] as g_pack,
             (array_agg(l.manufacturer order by l.invoice_date desc, l.invoice_id))[1] as g_maker,
             (array_agg(l.unit order by l.invoice_date desc, l.invoice_id))[1] as g_unit,
             sum(l.line_total) as g_sales,
             sum(l.billed_qty) as g_qty,
             count(*) as g_lines,
             bool_or(l.est_missing) as g_est,
             bool_or(l.real_missing) as g_real,
             array_agg(distinct l.market_date order by l.market_date) filter (where l.real_missing) as g_dates
        from l
       group by 1, 2, 3
    ),
    r as (
      select g.*,
             case
               when g.g_product is null then 'typed_line'
               when g.g_real and exists (
                      select 1 from public.purchase_entries pe
                       where pe.business_id = v_biz and pe.product_id = g.g_product and pe.unit_cost is not null
                         and public.norm_text(pe.unit) <> g.g_unit_key
                         and pe.purchase_date = any (g.g_dates)
                         and not exists (select 1 from public.purchase_voids pv where pv.business_id = pe.business_id and pv.entry_id = pe.id)
                    ) then 'unit_differs'
               when g.g_real then 'no_purchase_on_market_day'
               else 'no_purchase_price_saved'
             end as g_reason
        from g
    )
    select jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'group', 'day', 'generated_at', now()),
      'total', (select count(*) from r),
      'truncated', (select count(*) from r) > 500,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'product_id', x.g_product,
                 'name', x.g_name,
                 'strength', x.g_strength,
                 'dosage_form', x.g_form,
                 'pack_size', x.g_pack,
                 'manufacturer', x.g_maker,
                 'unit', x.g_unit,
                 'sales_amount', public.report_money(x.g_sales),
                 'billed_quantity', x.g_qty,
                 'lines', x.g_lines,
                 'estimate_missing', x.g_est,
                 'realized_missing', x.g_real,
                 'realized_dates', to_jsonb(coalesce(x.g_dates[1:10], '{}'::date[])),
                 'reason', x.g_reason
               ) order by x.g_sales desc, lower(x.g_name), x.g_unit_key)
          from (select * from r order by r.g_sales desc, lower(r.g_name), r.g_unit_key limit 500) x), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- report_purchases: the money spent from actual quantity and actual unit cost
-- ---------------------------------------------------------------------------
-- Cancelled entries (a row in purchase_voids) are left out and counted. An entry without an actual unit cost is counted
-- and its quantity reported, adds nothing to the money and makes the total incomplete. A tick on the market list is not a
-- purchase: only recorded entries are read.

create or replace function public.report_purchases(p_from date, p_to date, p_group text default 'day')
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.current_business_id();
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  perform public.report_check_period(p_from, p_to, p_group);

  return (
    with e as materialized (
      select pe.purchase_date as e_date, pe.quantity as e_qty, pe.unit_cost as e_cost, (pv.entry_id is not null) as e_voided
        from public.purchase_entries pe
        left join public.purchase_voids pv on pv.business_id = pe.business_id and pv.entry_id = pe.id
       where pe.business_id = v_biz and pe.purchase_date between p_from and p_to
    ),
    live as materialized (select * from e where not e_voided),
    s as (
      select public.report_bucket_start(p_group, e_date) as bucket_start,
             sum(e_qty::numeric * e_cost) filter (where e_cost is not null) as cost,
             count(*) as entries,
             count(*) filter (where e_cost is null) as no_cost
        from live
       group by 1
    ),
    t as (
      select sum(e_qty::numeric * e_cost) filter (where e_cost is not null) as cost,
             count(*) as entries,
             count(*) filter (where e_cost is not null) as with_cost,
             count(*) filter (where e_cost is null) as no_cost,
             coalesce(sum(e_qty) filter (where e_cost is null), 0) as qty_no_cost
        from live
    )
    select jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'group', p_group, 'generated_at', now()),
      'totals', jsonb_build_object(
        'cost', public.report_money(t.cost),
        'entries', t.entries,
        'entries_with_cost', t.with_cost,
        'entries_without_cost', t.no_cost,
        'quantity_without_cost', t.qty_no_cost,
        'cancelled_entries_left_out', (select count(*) from e where e_voided),
        'status', case when t.no_cost = 0 then 'complete' else 'incomplete' end),
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'bucket_start', s.bucket_start,
                 'bucket_end', public.report_bucket_end(p_group, s.bucket_start),
                 'partial', s.bucket_start < p_from or public.report_bucket_end(p_group, s.bucket_start) > p_to,
                 'cost', public.report_money(s.cost),
                 'entries', s.entries,
                 'entries_without_cost', s.no_cost
               ) order by s.bucket_start)
          from s), '[]'::jsonb)
    )
    from t
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- report_by_store: sales and both profit figures per store
-- ---------------------------------------------------------------------------
-- p_sort: sales (default), profit (the REALIZED profit; stores whose realized profit is not available come last) or name.
-- p_limit is at most 5001 (the screens ask for 20; the CSV asks for 5001 so it can tell when there are more than 5000 stores).
-- p_q: every word must be in the store name. totals cover the whole period, filtered_totals only the rows that match.

create or replace function public.report_by_store(
  p_from date,
  p_to date,
  p_q text default null,
  p_sort text default 'sales',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.current_business_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 5001);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  perform public.report_check_period(p_from, p_to, 'day');
  if coalesce(p_sort, 'sales') not in ('sales', 'profit', 'name') then
    raise exception 'invalid_sort: sort must be sales, profit or name' using errcode = '22023';
  end if;

  return (
    with l as materialized (select * from public.report_sales_lines(v_biz, p_from, p_to)),
    g as materialized (
      select l.store_id as g_store,
             sum(l.line_total) as sales,
             count(distinct l.invoice_id) as invoices,
             sum(l.est_cost) filter (where not l.est_missing) as e_cost,
             sum(l.line_total) filter (where not l.est_missing) as e_cov,
             count(*) filter (where not l.est_missing) as e_cov_n,
             count(*) filter (where l.est_missing) as e_miss_n,
             sum(l.line_total) filter (where l.est_missing) as e_miss_sales,
             sum(l.real_cost) filter (where not l.real_missing) as r_cost,
             sum(l.line_total) filter (where not l.real_missing) as r_cov,
             count(*) filter (where not l.real_missing) as r_cov_n,
             count(*) filter (where l.real_missing) as r_miss_n,
             sum(l.line_total) filter (where l.real_missing) as r_miss_sales
        from l
       group by 1
    ),
    named as materialized (
      select g.*, st.name as g_name,
             case when g.r_cov_n > 0 then g.r_cov - coalesce(g.r_cost, 0) end as r_profit
        from g
        join public.stores st on st.business_id = v_biz and st.id = g.g_store
       where btrim(coalesce(p_q, '')) = '' or public.pending_search_ok(st.name, null, p_q)
    ),
    t as (
      select coalesce(sum(sales), 0) as sales,
             (select count(distinct l.invoice_id) from l) as invoices,
             sum(e_cost) as e_cost, sum(e_cov) as e_cov, coalesce(sum(e_cov_n), 0)::bigint as e_cov_n, coalesce(sum(e_miss_n), 0)::bigint as e_miss_n, sum(e_miss_sales) as e_miss_sales,
             sum(r_cost) as r_cost, sum(r_cov) as r_cov, coalesce(sum(r_cov_n), 0)::bigint as r_cov_n, coalesce(sum(r_miss_n), 0)::bigint as r_miss_n, sum(r_miss_sales) as r_miss_sales
        from g
    ),
    f as (
      select coalesce(sum(sales), 0) as sales,
             coalesce(sum(invoices), 0) as invoices,
             sum(e_cost) as e_cost, sum(e_cov) as e_cov, coalesce(sum(e_cov_n), 0)::bigint as e_cov_n, coalesce(sum(e_miss_n), 0)::bigint as e_miss_n, sum(e_miss_sales) as e_miss_sales,
             sum(r_cost) as r_cost, sum(r_cov) as r_cov, coalesce(sum(r_cov_n), 0)::bigint as r_cov_n, coalesce(sum(r_miss_n), 0)::bigint as r_miss_n, sum(r_miss_sales) as r_miss_sales
        from named
    ),
    ranked as (
      select n.*,
             row_number() over (
               order by (case when p_sort = 'name' then lower(n.g_name) end) asc nulls last,
                        (case when p_sort = 'profit' then n.r_profit end) desc nulls last,
                        n.sales desc, lower(n.g_name), n.g_store
             ) as rn
        from named n
    )
    select jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'group', 'day', 'generated_at', now()),
      'total', (select count(*) from named),
      'totals', jsonb_build_object('sales', public.report_money(t.sales), 'invoices', t.invoices,
        'estimated', public.report_figure(t.e_cost, t.e_cov, t.e_cov_n, t.e_miss_n, t.e_miss_sales),
        'realized', public.report_figure(t.r_cost, t.r_cov, t.r_cov_n, t.r_miss_n, t.r_miss_sales)),
      'filtered_totals', jsonb_build_object('sales', public.report_money(f.sales), 'invoices', f.invoices,
        'estimated', public.report_figure(f.e_cost, f.e_cov, f.e_cov_n, f.e_miss_n, f.e_miss_sales),
        'realized', public.report_figure(f.r_cost, f.r_cov, f.r_cov_n, f.r_miss_n, f.r_miss_sales)),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'store_id', x.g_store,
                 'name', x.g_name,
                 'sales', public.report_money(x.sales),
                 'invoices', x.invoices,
                 'share', case when t.sales = 0 then '0.0' else round(x.sales * 100 / t.sales, 1)::numeric(7, 1)::text end,
                 'estimated', public.report_figure(x.e_cost, x.e_cov, x.e_cov_n, x.e_miss_n, x.e_miss_sales),
                 'realized', public.report_figure(x.r_cost, x.r_cov, x.r_cov_n, x.r_miss_n, x.r_miss_sales)
               ) order by x.rn)
          from (select * from ranked order by rn limit v_limit offset v_offset) x), '[]'::jsonb)
    )
    from t, f
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- report_by_medicine: sales and both profit figures per medicine and unit
-- ---------------------------------------------------------------------------
-- Rows are grouped by the medicine itself (product id) and the unit, never by similar text: another strength, form,
-- manufacturer or pack size is another product and so another row. Lines billed under a typed name (no medicine) are in
-- typed_rows, grouped by the exact typed text compared ignoring capitals and repeated spaces, so no sales are lost.

create or replace function public.report_by_medicine(
  p_from date,
  p_to date,
  p_q text default null,
  p_sort text default 'sales',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_biz uuid := public.current_business_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 5001);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  perform public.report_check_period(p_from, p_to, 'day');
  if coalesce(p_sort, 'sales') not in ('sales', 'profit', 'name') then
    raise exception 'invalid_sort: sort must be sales, profit or name' using errcode = '22023';
  end if;

  return (
    with l as materialized (select * from public.report_sales_lines(v_biz, p_from, p_to)),
    g as materialized (
      select coalesce(l.product_id::text, 'typed:' || public.norm_text(l.name)) || ':' || l.unit_key as g_key,
             l.product_id as g_product,
             (array_agg(l.name order by l.invoice_date desc, l.invoice_id))[1] as g_name,
             (array_agg(l.strength order by l.invoice_date desc, l.invoice_id))[1] as g_strength,
             (array_agg(l.dosage_form order by l.invoice_date desc, l.invoice_id))[1] as g_form,
             (array_agg(l.pack_size order by l.invoice_date desc, l.invoice_id))[1] as g_pack,
             (array_agg(l.manufacturer order by l.invoice_date desc, l.invoice_id))[1] as g_maker,
             (array_agg(l.unit order by l.invoice_date desc, l.invoice_id))[1] as g_unit,
             sum(l.billed_qty) as qty,
             sum(l.line_total) as sales,
             count(distinct l.invoice_id) as invoices,
             sum(l.est_cost) filter (where not l.est_missing) as e_cost,
             sum(l.line_total) filter (where not l.est_missing) as e_cov,
             count(*) filter (where not l.est_missing) as e_cov_n,
             count(*) filter (where l.est_missing) as e_miss_n,
             sum(l.line_total) filter (where l.est_missing) as e_miss_sales,
             sum(l.real_cost) filter (where not l.real_missing) as r_cost,
             sum(l.line_total) filter (where not l.real_missing) as r_cov,
             count(*) filter (where not l.real_missing) as r_cov_n,
             count(*) filter (where l.real_missing) as r_miss_n,
             sum(l.line_total) filter (where l.real_missing) as r_miss_sales
        from l
       group by 1, 2
    ),
    f as materialized (
      select g.*, case when g.r_cov_n > 0 then g.r_cov - coalesce(g.r_cost, 0) end as r_profit
        from g
       where btrim(coalesce(p_q, '')) = ''
          or public.pending_search_ok(concat_ws(' ', g.g_name, g.g_strength, g.g_form, g.g_pack, g.g_maker), null, p_q)
    ),
    t as (
      select coalesce(sum(sales), 0) as sales,
             (select count(distinct l.invoice_id) from l) as invoices,
             sum(e_cost) as e_cost, sum(e_cov) as e_cov, coalesce(sum(e_cov_n), 0)::bigint as e_cov_n, coalesce(sum(e_miss_n), 0)::bigint as e_miss_n, sum(e_miss_sales) as e_miss_sales,
             sum(r_cost) as r_cost, sum(r_cov) as r_cov, coalesce(sum(r_cov_n), 0)::bigint as r_cov_n, coalesce(sum(r_miss_n), 0)::bigint as r_miss_n, sum(r_miss_sales) as r_miss_sales
        from g
    ),
    ft as (
      select coalesce(sum(sales), 0) as sales,
             coalesce(sum(invoices), 0) as invoices,
             sum(e_cost) as e_cost, sum(e_cov) as e_cov, coalesce(sum(e_cov_n), 0)::bigint as e_cov_n, coalesce(sum(e_miss_n), 0)::bigint as e_miss_n, sum(e_miss_sales) as e_miss_sales,
             sum(r_cost) as r_cost, sum(r_cov) as r_cov, coalesce(sum(r_cov_n), 0)::bigint as r_cov_n, coalesce(sum(r_miss_n), 0)::bigint as r_miss_n, sum(r_miss_sales) as r_miss_sales
        from f
    ),
    ranked as (
      select f.*,
             row_number() over (
               partition by (f.g_product is null)
               order by (case when p_sort = 'name' then lower(f.g_name) end) asc nulls last,
                        (case when p_sort = 'profit' then f.r_profit end) desc nulls last,
                        f.sales desc, lower(f.g_name), f.g_key
             ) as rn
        from f
    )
    select jsonb_build_object(
      'period', jsonb_build_object('from', p_from, 'to', p_to, 'group', 'day', 'generated_at', now()),
      'total', (select count(*) from f where g_product is not null),
      'totals', jsonb_build_object('sales', public.report_money(t.sales), 'invoices', t.invoices,
        'estimated', public.report_figure(t.e_cost, t.e_cov, t.e_cov_n, t.e_miss_n, t.e_miss_sales),
        'realized', public.report_figure(t.r_cost, t.r_cov, t.r_cov_n, t.r_miss_n, t.r_miss_sales)),
      'filtered_totals', jsonb_build_object('sales', public.report_money(ft.sales), 'invoices', ft.invoices,
        'estimated', public.report_figure(ft.e_cost, ft.e_cov, ft.e_cov_n, ft.e_miss_n, ft.e_miss_sales),
        'realized', public.report_figure(ft.r_cost, ft.r_cov, ft.r_cov_n, ft.r_miss_n, ft.r_miss_sales)),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'key', x.g_key, 'product_id', x.g_product, 'name', x.g_name, 'typed_name', null,
                 'strength', x.g_strength, 'dosage_form', x.g_form, 'pack_size', x.g_pack, 'manufacturer', x.g_maker,
                 'unit', x.g_unit, 'billed_quantity', x.qty, 'sales', public.report_money(x.sales),
                 'estimated', public.report_figure(x.e_cost, x.e_cov, x.e_cov_n, x.e_miss_n, x.e_miss_sales),
                 'realized', public.report_figure(x.r_cost, x.r_cov, x.r_cov_n, x.r_miss_n, x.r_miss_sales)
               ) order by x.rn)
          from (select * from ranked where g_product is not null order by rn limit v_limit offset v_offset) x), '[]'::jsonb),
      'typed_rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'key', x.g_key, 'product_id', null, 'name', x.g_name, 'typed_name', x.g_name,
                 'strength', null, 'dosage_form', null, 'pack_size', null, 'manufacturer', null,
                 'unit', x.g_unit, 'billed_quantity', x.qty, 'sales', public.report_money(x.sales),
                 'estimated', public.report_figure(x.e_cost, x.e_cov, x.e_cov_n, x.e_miss_n, x.e_miss_sales),
                 'realized', public.report_figure(x.r_cost, x.r_cov, x.r_cov_n, x.r_miss_n, x.r_miss_sales)
               ) order by x.rn)
          from (select * from ranked where g_product is null order by rn limit 5000) x), '[]'::jsonb)
    )
    from t, ft
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- report_not_in_account: the note shown with Outstanding balances
-- ---------------------------------------------------------------------------
-- Issued invoices from before store accounts existed (Module 007) are in no balance. This counts them, so the balances
-- report can say so. Drafts and cancelled invoices are not counted.

create or replace function public.report_not_in_account()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_biz uuid := public.current_business_id();
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  return (
    select jsonb_build_object('invoices', count(*), 'total', public.report_money(sum(i.grand_total)))
      from public.invoices i
     where i.business_id = v_biz and i.status = 'issued' and not i.in_account
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only (revoked from public and anon)
-- ---------------------------------------------------------------------------

revoke all on function public.report_check_period(date, date, text) from public, anon;
revoke all on function public.report_sales_lines(uuid, date, date) from public, anon;
revoke all on function public.report_money(numeric) from public, anon;
revoke all on function public.report_figure(numeric, numeric, bigint, bigint, numeric) from public, anon;
revoke all on function public.report_bucket_start(text, date) from public, anon;
revoke all on function public.report_bucket_end(text, date) from public, anon;
revoke all on function public.report_sales(date, date, text) from public, anon;
revoke all on function public.report_purchases(date, date, text) from public, anon;
revoke all on function public.report_by_store(date, date, text, text, integer, integer) from public, anon;
revoke all on function public.report_by_medicine(date, date, text, text, integer, integer) from public, anon;
revoke all on function public.report_not_in_account() from public, anon;
revoke all on function public.report_cost_missing(date, date) from public, anon;

grant execute on function public.report_check_period(date, date, text) to authenticated;
grant execute on function public.report_sales_lines(uuid, date, date) to authenticated;
grant execute on function public.report_money(numeric) to authenticated;
grant execute on function public.report_figure(numeric, numeric, bigint, bigint, numeric) to authenticated;
grant execute on function public.report_bucket_start(text, date) to authenticated;
grant execute on function public.report_bucket_end(text, date) to authenticated;
grant execute on function public.report_sales(date, date, text) to authenticated;
grant execute on function public.report_purchases(date, date, text) to authenticated;
grant execute on function public.report_by_store(date, date, text, text, integer, integer) to authenticated;
grant execute on function public.report_by_medicine(date, date, text, text, integer, integer) to authenticated;
grant execute on function public.report_not_in_account() to authenticated;
grant execute on function public.report_cost_missing(date, date) to authenticated;

commit;
