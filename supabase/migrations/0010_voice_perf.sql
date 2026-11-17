-- Module 008 follow-up: make voice matching fast at scale (SC-009).
--
-- Found by tests/integration/voice-scale.test.ts (5,000 medicines, a 200-item spoken order): voice_match_products
-- compared every spoken name with every medicine (a million pairs) and computed the text similarity for each pair, so the
-- request ran into the database's statement time limit (more than 8 seconds) instead of finishing in about 2 seconds.
--
-- A second cause: as a "security invoker" function it ran under row level security, and PostgreSQL does not use an index
-- for a condition that calls a function that is not marked leakproof (norm_text, the trigram operator) while a row level
-- security rule applies to the table. So the indexes could never be used.
--
-- What changes (tests/integration/db-voice-scale.pglite.test.ts compares the new function with the plain definition):
--   1. voice_match_products first looks for EXACT matches of each spoken name through equality indexes (the four exact
--      forms: name, name with strength, name with strength and form, brand). Only a spoken name that has NO exact match is
--      searched for similar names, through the trigram GiST index (the 50 nearest, the same 0.3 similarity floor). Then the
--      exactness and the score are computed for the rows found, and ranked as before. Everything that is decided stays as
--      it was: a name is Matched only when exactly one medicine matches exactly, a name with no exact match is offered the
--      similar names to choose from, and all exact matches (for example two strengths of one name) are always returned.
--      The one visible difference: a spoken name that matches a medicine EXACTLY no longer also lists similar-but-different
--      medicines after it, so such a line has no "choose a different one" list (the supplier can still remove the line and
--      search). Among several EQUALLY similar names at the last place either may be shown;
--   2. it is now "security definer" like the project's other database functions, and every read of products is limited
--      by an explicit "business_id = the caller's business" condition (and "is_active"), so a business can never see
--      another business's rows; a caller without a business gets nothing. The grants are unchanged (signed-in users only);
--   3. four small indexes: the three exact forms and the trigram GiST index for the nearest-name search.
-- Only the function body is replaced and indexes are added; tables, grants and data are untouched. Safe to re-run.

create index if not exists products_business_name_strength_idx
  on public.products (business_id, public.norm_text(name || ' ' || coalesce(strength, '')));

create index if not exists products_business_name_strength_form_idx
  on public.products (business_id, public.norm_text(name || ' ' || coalesce(strength, '') || ' ' || coalesce(dosage_form, '')));

create index if not exists products_business_brand_idx
  on public.products (business_id, public.norm_text(brand))
  where brand is not null;

-- Nearest-name search: the trigram GiST index can return the closest names directly instead of every name above the floor.
create index if not exists products_search_gist_idx
  on public.products using gist (search_text extensions.gist_trgm_ops);

create or replace function public.voice_match_products(p_names jsonb)
returns table (
  idx integer,
  id uuid,
  name text,
  brand text,
  strength text,
  dosage_form text,
  manufacturer text,
  pack_size text,
  unit text,
  is_exact boolean,
  score real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with me as (
    select public.current_business_id() as biz
  ),
  spoken as (
    select (t.ord - 1)::integer as idx, public.norm_text(t.val) as q
      from jsonb_array_elements_text(case when jsonb_typeof(p_names) = 'array' then p_names else '[]'::jsonb end)
           with ordinality as t(val, ord)
     where t.ord <= 200 and public.norm_text(t.val) <> ''
  ),
  exact_found as materialized (
    select s.idx, f.id
      from spoken s
      cross join me
      cross join lateral (
        select p.id from public.products p
         where p.business_id = me.biz and p.is_active and public.norm_text(p.name) = s.q
        union
        select p.id from public.products p
         where p.business_id = me.biz and p.is_active and public.norm_text(p.name || ' ' || coalesce(p.strength, '')) = s.q
        union
        select p.id from public.products p
         where p.business_id = me.biz and p.is_active
           and public.norm_text(p.name || ' ' || coalesce(p.strength, '') || ' ' || coalesce(p.dosage_form, '')) = s.q
        union
        select p.id from public.products p
         where p.business_id = me.biz and p.is_active and p.brand is not null and public.norm_text(p.brand) = s.q
      ) f
  ),
  similar_found as (
    select s.idx, n.id
      from (select s0.idx, s0.q from spoken s0 where not exists (select 1 from exact_found e where e.idx = s0.idx)) s
      cross join me
      cross join lateral (
        -- The 50 nearest names by word similarity, from the trigram GiST index (no setting is needed: the 0.3 similarity
        -- floor is applied below, when the rows are ranked). Only the best five candidates are ever shown.
        select p.id from public.products p
         where p.business_id = me.biz and p.is_active
         order by s.q <<-> p.search_text
         limit 50
      ) n
  ),
  found as (
    select idx, id from exact_found
    union
    select idx, id from similar_found
  ),
  cand as (
    select s.idx, p.id, p.name, p.brand, p.strength, p.dosage_form, p.manufacturer, p.pack_size, p.unit,
           (
             public.norm_text(p.name) = s.q
             or public.norm_text(p.name || ' ' || coalesce(p.strength, '')) = s.q
             or public.norm_text(p.name || ' ' || coalesce(p.strength, '') || ' ' || coalesce(p.dosage_form, '')) = s.q
             or (p.brand is not null and public.norm_text(p.brand) = s.q)
           ) as is_exact,
           extensions.word_similarity(s.q, p.search_text) as score
      from found f
      join spoken s on s.idx = f.idx
      join public.products p on p.id = f.id
  ),
  ranked as (
    select c.*, row_number() over (partition by c.idx order by c.is_exact desc, c.score desc, c.name, c.id) as rn
      from cand c
     where c.is_exact or c.score >= 0.3
  )
  select r.idx, r.id, r.name, r.brand, r.strength, r.dosage_form, r.manufacturer, r.pack_size, r.unit, r.is_exact, r.score
    from ranked r
   where r.rn <= 5
   order by r.idx, r.rn
$$;

revoke all on function public.voice_match_products(jsonb) from public, anon;
grant execute on function public.voice_match_products(jsonb) to authenticated;
