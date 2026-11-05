-- Module 002: business settings, setup checklist state, catalog import.
-- Builds on 0001_init.sql. Every new table carries business_id and has Row Level Security.
-- Nothing is ever hard-deleted: no DELETE is granted on any new table.
-- The whole script runs as one transaction, so a failure leaves nothing half-applied.

begin;

-- ---------------------------------------------------------------------------
-- business_settings: one row per business
-- ---------------------------------------------------------------------------

create table if not exists public.business_settings (
  business_id              uuid primary key references public.businesses (id) on delete cascade,
  phone                    text check (phone is null or char_length(phone) <= 50),
  address                  text check (address is null or char_length(address) <= 500),
  thermal_paper_mm         integer not null default 80 check (thermal_paper_mm between 40 and 120),
  account_summary_default  boolean not null default false,
  details_saved            boolean not null default false,
  checklist_dismissed      boolean not null default false,
  version                  integer not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Own small trigger (NOT set_row_meta): it only keeps updated_at current and the key immutable.
-- `version` is bumped only inside save_business_settings, so dismissing the checklist never
-- causes a false "changed elsewhere" message on the settings form.
create or replace function public.business_settings_touch()
returns trigger
language plpgsql
as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'business_id is immutable' using errcode = '22023';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists business_settings_touch on public.business_settings;
create trigger business_settings_touch
  before update on public.business_settings
  for each row execute function public.business_settings_touch();

-- Every new business gets a settings row with defaults.
create or replace function public.create_business_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_settings (business_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.create_business_settings() from public, anon, authenticated;

drop trigger if exists businesses_create_settings on public.businesses;
create trigger businesses_create_settings
  after insert on public.businesses
  for each row execute function public.create_business_settings();

-- Backfill: businesses created before this migration (idempotent).
insert into public.business_settings (business_id)
select b.id from public.businesses b
where not exists (select 1 from public.business_settings s where s.business_id = b.id);

alter table public.business_settings enable row level security;

drop policy if exists business_settings_select on public.business_settings;
create policy business_settings_select on public.business_settings
  for select to authenticated
  using (business_id = (select public.current_business_id()));

-- The only direct write: dismissing / re-showing the checklist (column grant below).
drop policy if exists business_settings_update on public.business_settings;
create policy business_settings_update on public.business_settings
  for update to authenticated
  using (business_id = (select public.current_business_id()))
  with check (business_id = (select public.current_business_id()));

revoke all on public.business_settings from anon, authenticated;
grant select on public.business_settings to authenticated;
grant update (checklist_dismissed) on public.business_settings to authenticated;

-- ---------------------------------------------------------------------------
-- imports: one row per applied catalog import
-- ---------------------------------------------------------------------------

create table if not exists public.imports (
  id                     uuid primary key,
  business_id            uuid not null default public.current_business_id()
                           references public.businesses (id) on delete restrict,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  file_name              text not null check (char_length(file_name) between 1 and 255),
  file_kind              text not null check (file_kind in ('csv', 'xlsx')),
  submitted_rows         integer not null check (submitted_rows >= 0),
  created_count          integer not null check (created_count >= 0),
  created_similar_count  integer not null check (created_similar_count >= 0),
  skipped_count          integer not null check (skipped_count >= 0),
  status_counts          jsonb not null,
  skipped                jsonb not null,
  fingerprint            text not null,
  created_at             timestamptz not null default now(),
  unique (business_id, id)
);

create index if not exists imports_business_created_idx on public.imports (business_id, created_at desc);

alter table public.imports enable row level security;

drop policy if exists imports_select on public.imports;
create policy imports_select on public.imports
  for select to authenticated
  using (business_id = (select public.current_business_id()));

drop policy if exists imports_insert on public.imports;
create policy imports_insert on public.imports
  for insert to authenticated
  with check (business_id = (select public.current_business_id()));

revoke all on public.imports from anon, authenticated;
grant select, insert on public.imports to authenticated;

-- products: each imported medicine links to its import. The composite foreign key makes it
-- impossible to point at another business's import, even through a direct API call.
alter table public.products add column if not exists import_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_import_fk') then
    alter table public.products
      add constraint products_import_fk
      foreign key (business_id, import_id) references public.imports (business_id, id);
  end if;
end;
$$;

create index if not exists products_import_idx on public.products (import_id) where import_id is not null;

-- ---------------------------------------------------------------------------
-- Settings JSON and the one narrow write function
-- ---------------------------------------------------------------------------

create or replace function public.settings_to_json(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'name', b.name,
    'phone', s.phone,
    'address', s.address,
    'thermal_paper_mm', s.thermal_paper_mm,
    'account_summary_default', s.account_summary_default,
    'details_saved', s.details_saved,
    'checklist_dismissed', s.checklist_dismissed,
    'version', s.version
  )
  from public.businesses b
  join public.business_settings s on s.business_id = b.id
  where b.id = p_business
$$;

revoke all on function public.settings_to_json(uuid) from public, anon, authenticated;

-- Saves the whole settings form (business name + settings) in one transaction.
-- Returns { saved: true, settings } or { saved: false, reason: 'version_conflict', current }.
create or replace function public.save_business_settings(
  p_expected_version int,
  p_name text,
  p_phone text,
  p_address text,
  p_thermal_paper_mm int,
  p_account_summary_default boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_row public.business_settings;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  -- A missing row should never happen (trigger + backfill); create defaults if it does.
  insert into public.business_settings (business_id) values (v_biz) on conflict do nothing;

  select * into v_row from public.business_settings where business_id = v_biz for update;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('saved', false, 'reason', 'version_conflict', 'current', public.settings_to_json(v_biz));
  end if;

  update public.businesses set name = btrim(p_name) where id = v_biz;

  update public.business_settings
     set phone = nullif(btrim(p_phone), ''),
         address = nullif(btrim(p_address), ''),
         thermal_paper_mm = p_thermal_paper_mm,
         account_summary_default = p_account_summary_default,
         details_saved = true,
         version = version + 1
   where business_id = v_biz;

  return jsonb_build_object('saved', true, 'settings', public.settings_to_json(v_biz));
end;
$$;

revoke all on function public.save_business_settings(int, text, text, text, int, boolean) from public, anon;
grant execute on function public.save_business_settings(int, text, text, text, int, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalog import. SECURITY INVOKER everywhere, so Row Level Security always applies and a
-- caller can only ever see or create rows of their own business.
-- ---------------------------------------------------------------------------

-- One classification, written once: used by the preview and by the confirmed import, so they
-- cannot disagree. Input: JSON array of rows that already passed field validation, each
-- { row_no, name, strength, dosage_form, pack_size, manufacturer, sku, ... }.
-- Priority when several apply: file_duplicate, exists, sku_used, similar, new.
create or replace function public.import_classify(p_rows jsonb)
returns table (row_no int, status text, conflict_product_id uuid, conflict_name text)
language sql
stable
security invoker
set search_path = public
as $$
  with biz as (
    select public.current_business_id() as id
  ),
  input as (
    select
      (r ->> 'row_no')::int                       as row_no,
      public.norm_text(r ->> 'name')              as n_name,
      public.norm_text(r ->> 'strength')          as n_strength,
      public.norm_text(r ->> 'dosage_form')       as n_form,
      public.norm_text(r ->> 'pack_size')         as n_pack,
      public.norm_text(r ->> 'manufacturer')      as n_manu,
      nullif(lower(btrim(r ->> 'sku')), '')       as sku_key
    from jsonb_array_elements(p_rows) as r
  ),
  ranked as (
    select i.*,
      row_number() over (partition by i.n_name, i.n_strength, i.n_form, i.n_pack, i.n_manu order by i.row_no) as id_rank,
      row_number() over (partition by i.sku_key order by i.row_no) as sku_rank
    from input i
  )
  select
    r.row_no,
    case
      when r.id_rank > 1 then 'file_duplicate'
      when ex.id is not null then 'exists'
      when r.sku_key is not null and (r.sku_rank > 1 or sk.id is not null) then 'sku_used'
      when sm.id is not null then 'similar'
      else 'new'
    end::text as status,
    case
      when r.id_rank > 1 then null::uuid
      when ex.id is not null then ex.id
      when r.sku_key is not null and (r.sku_rank > 1 or sk.id is not null) then sk.id
      when sm.id is not null then sm.id
      else null::uuid
    end as conflict_product_id,
    case
      when r.id_rank > 1 then null::text
      when ex.id is not null then ex.name
      when r.sku_key is not null and (r.sku_rank > 1 or sk.id is not null) then sk.name
      when sm.id is not null then sm.name
      else null::text
    end as conflict_name
  from ranked r
  left join lateral (
    select p.id, p.name from public.products p
    where p.business_id = (select id from biz)
      and public.norm_text(p.name) = r.n_name
      and public.norm_text(p.strength) = r.n_strength
      and public.norm_text(p.dosage_form) = r.n_form
      and public.norm_text(p.pack_size) = r.n_pack
      and public.norm_text(p.manufacturer) = r.n_manu
    order by p.created_at limit 1
  ) ex on true
  left join lateral (
    select p.id, p.name from public.products p
    where r.sku_key is not null
      and p.business_id = (select id from biz)
      and lower(btrim(p.sku)) = r.sku_key
    order by p.created_at limit 1
  ) sk on true
  left join lateral (
    select p.id, p.name from public.products p
    where p.business_id = (select id from biz)
      and public.norm_text(p.name) = r.n_name
    order by p.created_at limit 1
  ) sm on true
  order by r.row_no
$$;

-- The text that goes into the fingerprint for one classified row.
create or replace function public.import_row_key(p_row_no int, p_status text, p_conflict uuid)
returns text
language sql
immutable
as $$
  select p_row_no::text || ':' || p_status || ':' || coalesce(p_conflict::text, '')
$$;

-- Read-only preview: the classification plus a fingerprint identifying this exact result.
create or replace function public.import_preview(p_rows jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with c as (select * from public.import_classify(p_rows))
  select jsonb_build_object(
    'fingerprint', md5(coalesce(string_agg(public.import_row_key(c.row_no, c.status, c.conflict_product_id), ',' order by c.row_no), '')),
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'row_no', c.row_no,
          'status', c.status,
          'conflict_product_id', c.conflict_product_id,
          'conflict_name', c.conflict_name
        ) order by c.row_no
      ),
      '[]'::jsonb
    )
  )
  from c
$$;

-- Summary of one import as JSON (same shape for a fresh result and a replay).
create or replace function public.import_to_json(i public.imports, p_with_skipped boolean)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', i.id,
    'file_name', i.file_name,
    'file_kind', i.file_kind,
    'submitted_rows', i.submitted_rows,
    'created_count', i.created_count,
    'created_similar_count', i.created_similar_count,
    'skipped_count', i.skipped_count,
    'status_counts', i.status_counts,
    'created_at', i.created_at
  ) || case when p_with_skipped then jsonb_build_object('skipped', i.skipped) else '{}'::jsonb end
$$;

-- The confirmed import: one transaction, all-or-nothing, idempotent on p_import_id.
-- p_rows: valid rows (JSON objects with every column); p_invalid: [{row_no, field, message}].
-- Returns { applied: true, replayed, import } or { applied: false, reason: 'catalog_changed' }.
create or replace function public.import_apply(
  p_import_id uuid,
  p_file_name text,
  p_file_kind text,
  p_rows jsonb,
  p_invalid jsonb,
  p_fingerprint text,
  p_create_similar int[]
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_import public.imports;
  v_cl jsonb;
  v_fp text;
  v_choose int[] := coalesce(p_create_similar, '{}'::int[]);
  v_created int;
  v_created_similar int;
  v_skipped jsonb;
  v_status_counts jsonb;
  v_inserted int;
  v_invalid jsonb := coalesce(p_invalid, '[]'::jsonb);
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  -- Imports of one business run one at a time; a second one sees the first one's rows.
  perform pg_advisory_xact_lock(hashtext(v_biz::text));

  -- Replay: the same import id returns the original result and changes nothing.
  select * into v_import from public.imports where id = p_import_id and business_id = v_biz;
  if found then
    return jsonb_build_object('applied', true, 'replayed', true, 'import', public.import_to_json(v_import, true));
  end if;

  -- Re-classify against the CURRENT catalog and compare with the approved preview.
  select coalesce(jsonb_agg(to_jsonb(c) order by c.row_no), '[]'::jsonb)
    into v_cl
    from public.import_classify(p_rows) c;

  select md5(coalesce(string_agg(public.import_row_key(x.row_no, x.status, x.conflict_product_id), ',' order by x.row_no), ''))
    into v_fp
    from jsonb_to_recordset(v_cl) as x(row_no int, status text, conflict_product_id uuid, conflict_name text);

  if v_fp is distinct from p_fingerprint then
    return jsonb_build_object('applied', false, 'reason', 'catalog_changed');
  end if;

  -- A chosen "create as separate" row must really be a similar row.
  if exists (
    select 1 from unnest(v_choose) n
    where not exists (
      select 1 from jsonb_to_recordset(v_cl) as x(row_no int, status text) where x.row_no = n and x.status = 'similar'
    )
  ) then
    return jsonb_build_object('applied', false, 'reason', 'catalog_changed');
  end if;

  -- Counts, known before anything is written.
  select count(*)::int,
         count(*) filter (where x.status = 'similar')::int
    into v_created, v_created_similar
    from jsonb_to_recordset(v_cl) as x(row_no int, status text)
   where x.status = 'new' or (x.status = 'similar' and x.row_no = any (v_choose));

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
         || case when jsonb_array_length(v_invalid) > 0
                 then jsonb_build_object('invalid', jsonb_array_length(v_invalid)) else '{}'::jsonb end
    into v_status_counts
    from (
      select x.status, count(*)::int as n
      from jsonb_to_recordset(v_cl) as x(row_no int, status text)
      group by x.status
    ) s;

  -- Every row that is not created, with the reason, plus the invalid rows.
  select coalesce(jsonb_agg(e.item order by e.row_no), '[]'::jsonb)
    into v_skipped
    from (
      select x.row_no,
             jsonb_build_object(
               'row_no', x.row_no,
               'status', x.status,
               'message', case x.status
                 when 'exists' then 'Already exists in your catalog' || coalesce(' as "' || x.conflict_name || '"', '')
                 when 'similar' then 'Similar to' || coalesce(' "' || x.conflict_name || '"', ' an existing medicine') || '; skipped (not chosen as a separate product)'
                 when 'file_duplicate' then 'Same medicine as an earlier row in this file'
                 when 'sku_used' then 'SKU already used' || coalesce(' by "' || x.conflict_name || '"', ' by an earlier row in this file')
                 else x.status end,
               'conflict_name', x.conflict_name
             ) as item
        from jsonb_to_recordset(v_cl) as x(row_no int, status text, conflict_product_id uuid, conflict_name text)
       where not (x.status = 'new' or (x.status = 'similar' and x.row_no = any (v_choose)))
      union all
      select (iv ->> 'row_no')::int,
             jsonb_build_object(
               'row_no', (iv ->> 'row_no')::int,
               'status', 'invalid',
               'message', coalesce(nullif(iv ->> 'field', '') || ': ', '') || coalesce(iv ->> 'message', 'Invalid row'),
               'conflict_name', null
             )
        from jsonb_array_elements(v_invalid) as iv
    ) e;

  -- The import record first (products reference it), then the products in ONE statement.
  insert into public.imports (
    id, file_name, file_kind, submitted_rows, created_count, created_similar_count,
    skipped_count, status_counts, skipped, fingerprint
  ) values (
    p_import_id, p_file_name, p_file_kind,
    jsonb_array_length(p_rows) + jsonb_array_length(v_invalid),
    v_created, v_created_similar,
    jsonb_array_length(v_skipped), v_status_counts, v_skipped, p_fingerprint
  )
  returning * into v_import;

  with chosen as (
    select x.row_no
      from jsonb_to_recordset(v_cl) as x(row_no int, status text)
     where x.status = 'new' or (x.status = 'similar' and x.row_no = any (v_choose))
  )
  insert into public.products (
    id, name, unit, brand, generic_name, strength, dosage_form, manufacturer, pack_size, sku,
    purchase_price, selling_price, mrp, is_active, import_id
  )
  select
    gen_random_uuid(),
    btrim(r ->> 'name'),
    btrim(r ->> 'unit'),
    nullif(btrim(r ->> 'brand'), ''),
    nullif(btrim(r ->> 'generic_name'), ''),
    nullif(btrim(r ->> 'strength'), ''),
    nullif(btrim(r ->> 'dosage_form'), ''),
    nullif(btrim(r ->> 'manufacturer'), ''),
    nullif(btrim(r ->> 'pack_size'), ''),
    nullif(btrim(r ->> 'sku'), ''),
    nullif(btrim(r ->> 'purchase_price'), '')::numeric(12, 2),
    nullif(btrim(r ->> 'selling_price'), '')::numeric(12, 2),
    nullif(btrim(r ->> 'mrp'), '')::numeric(12, 2),
    true,
    p_import_id
  from jsonb_array_elements(p_rows) as r
  join chosen on chosen.row_no = (r ->> 'row_no')::int;

  get diagnostics v_inserted = row_count;
  if v_inserted <> v_created then
    raise exception 'import row count mismatch (% inserted, % expected)', v_inserted, v_created;
  end if;

  return jsonb_build_object('applied', true, 'replayed', false, 'import', public.import_to_json(v_import, true));
end;
$$;

revoke all on function public.import_classify(jsonb) from public, anon;
revoke all on function public.import_row_key(int, text, uuid) from public, anon;
revoke all on function public.import_preview(jsonb) from public, anon;
revoke all on function public.import_to_json(public.imports, boolean) from public, anon;
revoke all on function public.import_apply(uuid, text, text, jsonb, jsonb, text, int[]) from public, anon;
grant execute on function public.import_classify(jsonb) to authenticated;
grant execute on function public.import_row_key(int, text, uuid) to authenticated;
grant execute on function public.import_preview(jsonb) to authenticated;
grant execute on function public.import_to_json(public.imports, boolean) to authenticated;
grant execute on function public.import_apply(uuid, text, text, jsonb, jsonb, text, int[]) to authenticated;

commit;
