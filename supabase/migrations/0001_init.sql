-- Module 001: businesses, profiles, stores, products.
-- Every data table carries business_id and has Row Level Security from this first migration.
-- Records are never hard-deleted: no DELETE policy and DELETE is not granted.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Normalization used for duplicate detection: lowercase, trimmed, collapsed whitespace.
create or replace function public.norm_text(value text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')))
$$;

-- ---------------------------------------------------------------------------
-- Business and membership
-- ---------------------------------------------------------------------------

create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 200),
  created_at  timestamptz not null default now()
);

create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  business_id  uuid not null references public.businesses (id) on delete restrict,
  created_at   timestamptz not null default now()
);

create index profiles_business_id_idx on public.profiles (business_id);

-- The caller's business, or null when the account has no profile.
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.business_id from public.profiles p where p.user_id = auth.uid()
$$;

revoke all on function public.current_business_id() from public, anon;
grant execute on function public.current_business_id() to authenticated, service_role;

-- Shared row bookkeeping: immutable id/business_id/created_at, version bump, updated_at.
create or replace function public.set_row_meta()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := now();
  else
    if new.id is distinct from old.id then
      raise exception 'id is immutable' using errcode = '22023';
    end if;
    if new.business_id is distinct from old.business_id then
      raise exception 'business_id is immutable' using errcode = '22023';
    end if;
    new.created_at := old.created_at;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------

create table public.stores (
  id              uuid primary key,
  business_id     uuid not null default public.current_business_id()
                    references public.businesses (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  contact_person  text check (contact_person is null or char_length(contact_person) <= 200),
  phone           text check (phone is null or char_length(phone) <= 50),
  address         text check (address is null or char_length(address) <= 500),
  notes           text check (notes is null or char_length(notes) <= 1000),
  is_active       boolean not null default true,
  search_text     text generated always as (
                    lower(coalesce(name, '') || ' ' || coalesce(contact_person, '') || ' ' || coalesce(phone, ''))
                  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);

create index stores_business_active_name_idx on public.stores (business_id, is_active, lower(name));
create index stores_business_normname_idx on public.stores (business_id, public.norm_text(name));
create index stores_search_trgm_idx on public.stores using gin (search_text extensions.gin_trgm_ops);

create trigger stores_row_meta
  before insert or update on public.stores
  for each row execute function public.set_row_meta();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create table public.products (
  id              uuid primary key,
  business_id     uuid not null default public.current_business_id()
                    references public.businesses (id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  unit            text not null check (char_length(btrim(unit)) between 1 and 50),
  brand           text check (brand is null or char_length(brand) <= 200),
  generic_name    text check (generic_name is null or char_length(generic_name) <= 200),
  strength        text check (strength is null or char_length(strength) <= 100),
  dosage_form     text check (dosage_form is null or char_length(dosage_form) <= 100),
  manufacturer    text check (manufacturer is null or char_length(manufacturer) <= 200),
  pack_size       text check (pack_size is null or char_length(pack_size) <= 100),
  sku             text check (sku is null or char_length(sku) <= 100),
  purchase_price  numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  selling_price   numeric(12, 2) check (selling_price is null or selling_price >= 0),
  mrp             numeric(12, 2) check (mrp is null or mrp >= 0),
  is_active       boolean not null default true,
  search_text     text generated always as (
                    lower(
                      coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(generic_name, '') || ' ' ||
                      coalesce(strength, '') || ' ' || coalesce(manufacturer, '') || ' ' || coalesce(sku, '')
                    )
                  ) stored,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1
);

-- Exact duplicate block. The unit is deliberately not part of the identity, and inactive
-- products are included, so a deactivated product blocks a copy (the UI offers Reactivate).
create unique index products_identity_uniq on public.products (
  business_id,
  public.norm_text(name),
  public.norm_text(strength),
  public.norm_text(dosage_form),
  public.norm_text(pack_size),
  public.norm_text(manufacturer)
);

-- A code (SKU) is unique within a business when present.
create unique index products_sku_uniq on public.products (business_id, lower(btrim(sku)))
  where sku is not null;

create index products_business_active_name_idx on public.products (business_id, is_active, lower(name));
create index products_business_normname_idx on public.products (business_id, public.norm_text(name));
create index products_search_trgm_idx on public.products using gin (search_text extensions.gin_trgm_ops);

create trigger products_row_meta
  before insert or update on public.products
  for each row execute function public.set_row_meta();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.profiles   enable row level security;
alter table public.stores     enable row level security;
alter table public.products   enable row level security;

create policy businesses_select_own on public.businesses
  for select to authenticated
  using (id = (select public.current_business_id()));

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy stores_select on public.stores
  for select to authenticated
  using (business_id = (select public.current_business_id()));
create policy stores_insert on public.stores
  for insert to authenticated
  with check (business_id = (select public.current_business_id()));
create policy stores_update on public.stores
  for update to authenticated
  using (business_id = (select public.current_business_id()))
  with check (business_id = (select public.current_business_id()));

create policy products_select on public.products
  for select to authenticated
  using (business_id = (select public.current_business_id()));
create policy products_insert on public.products
  for insert to authenticated
  with check (business_id = (select public.current_business_id()));
create policy products_update on public.products
  for update to authenticated
  using (business_id = (select public.current_business_id()))
  with check (business_id = (select public.current_business_id()));

-- ---------------------------------------------------------------------------
-- Privileges: signed-out users get nothing; signed-in users cannot delete.
-- ---------------------------------------------------------------------------

revoke all on public.businesses, public.profiles, public.stores, public.products from anon, authenticated;

grant select on public.businesses, public.profiles to authenticated;
grant select, insert, update on public.stores, public.products to authenticated;

-- ---------------------------------------------------------------------------
-- Duplicate lookups. SECURITY INVOKER, so Row Level Security applies: a caller can only ever
-- find rows of their own business. They use the same norm_text rule as the unique indexes.
-- ---------------------------------------------------------------------------

create or replace function public.find_stores_by_name(p_name text, p_exclude uuid default null)
returns setof public.stores
language sql
stable
security invoker
set search_path = public
as $$
  select s.*
  from public.stores s
  where s.business_id = public.current_business_id()
    and public.norm_text(s.name) = public.norm_text(p_name)
    and (p_exclude is null or s.id <> p_exclude)
  order by s.created_at
$$;

create or replace function public.find_products_by_name(p_name text, p_exclude uuid default null)
returns setof public.products
language sql
stable
security invoker
set search_path = public
as $$
  select p.*
  from public.products p
  where p.business_id = public.current_business_id()
    and public.norm_text(p.name) = public.norm_text(p_name)
    and (p_exclude is null or p.id <> p_exclude)
  order by p.created_at
$$;

revoke all on function public.find_stores_by_name(text, uuid) from public, anon;
revoke all on function public.find_products_by_name(text, uuid) from public, anon;
grant execute on function public.find_stores_by_name(text, uuid) to authenticated;
grant execute on function public.find_products_by_name(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guard used by tests: every public table must have RLS enabled, and every table other than
-- businesses/profiles must carry business_id. Only the service role may call it.
-- ---------------------------------------------------------------------------

create or replace function public.rls_audit()
returns table (table_name text, rls_enabled boolean, has_business_id boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
    )
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
$$;

revoke all on function public.rls_audit() from public, anon, authenticated;
grant execute on function public.rls_audit() to service_role;
