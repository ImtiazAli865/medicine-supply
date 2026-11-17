-- Module 008: voice order entry with Gemini.
--
-- What this migration adds:
--   * orders.spoken_text: what the supplier said, kept read-only with a voice order (1 to 2,000 characters, only when
--     the source is 'voice', immutable like the source).
--   * order_save gets two trailing parameters, p_source (default 'manual') and p_spoken_text (default null), used ONLY when
--     the order is created. The old six-argument function is dropped so a call stays unambiguous. The body is the Module
--     003 body with exactly three changes: the validation of the two new values, the source in the create insert, and the
--     spoken text in the create insert.
--   * order_to_json (latest definition: 0004) gains 'spoken_text'; orders_guard (latest definition: 0007) refuses a change
--     of spoken_text.
--   * voice_diagnostics: an append-only log of voice failures and doubtful results (kind, parser, counts, the LENGTH of the
--     transcript, a short safe message); never the transcript, a key, a price or a balance. Select-only for users.
--   * voice_parse_attempts and voice_parse_allow(): at most 20 AI parses per business per minute.
--   * voice_diag_add, voice_diag_list, voice_match_products, voice_match_stores.
--
-- It changes no invoice, price snapshot, ledger entry or balance.
--
-- Roll back (safe only while no order has source = 'voice'):
--   drop function if exists public.voice_match_stores(text), public.voice_match_products(jsonb),
--     public.voice_diag_list(integer, integer), public.voice_diag_add(text, text, integer, integer, integer, integer, text),
--     public.voice_parse_allow(), public.voice_diagnostics_append_only();
--   drop table if exists public.voice_parse_attempts, public.voice_diagnostics;
--   drop function if exists public.order_save(uuid, uuid, integer, uuid, text, jsonb, text, text);
--   then re-create order_save (six arguments) from 0003, order_to_json from 0004 and orders_guard from 0007,
--   then: alter table public.orders drop constraint orders_spoken_text_check, drop column spoken_text;
--   and re-issue the grants of order_save(uuid, uuid, int, uuid, text, jsonb).

begin;

-- ---------------------------------------------------------------------------
-- orders.spoken_text
-- ---------------------------------------------------------------------------

alter table public.orders add column if not exists spoken_text text;

alter table public.orders drop constraint if exists orders_spoken_text_check;
alter table public.orders add constraint orders_spoken_text_check check (
  spoken_text is null
  or (source = 'voice' and char_length(btrim(spoken_text)) >= 1 and char_length(spoken_text) <= 2000)
);

-- Replaced from the latest definition (0007), with only the spoken_text immutability added.
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
  if new.spoken_text is distinct from old.spoken_text then
    raise exception 'spoken_text is immutable' using errcode = '22023';
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

-- Replaced from the latest definition (0004), with only 'spoken_text' added to the order object.
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
    'spoken_text', v_row.spoken_text,
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
-- order_save: the Module 003 body with three changes (see the header). The six-argument form is dropped.
-- ---------------------------------------------------------------------------

drop function if exists public.order_save(uuid, uuid, int, uuid, text, jsonb);

create or replace function public.order_save(
  p_id uuid,
  p_request_id uuid,
  p_expected_version int,
  p_store_id uuid,
  p_notes text,
  p_lines jsonb,
  p_source text default 'manual',
  p_spoken_text text default null
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
  v_spoken text := nullif(btrim(coalesce(p_spoken_text, '')), '');
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
  if p_source is null or p_source not in ('manual', 'voice') then
    return jsonb_build_object('saved', false, 'reason', 'invalid_lines', 'detail',
      jsonb_build_object('message', 'The order source must be manual or voice.'));
  end if;
  if p_source = 'voice' and (v_spoken is null or char_length(v_spoken) > 2000) then
    return jsonb_build_object('saved', false, 'reason', 'invalid_lines', 'detail',
      jsonb_build_object('message', 'A voice order needs the spoken text (1 to 2,000 characters).'));
  end if;
  if p_source = 'manual' and p_spoken_text is not null then
    return jsonb_build_object('saved', false, 'reason', 'invalid_lines', 'detail',
      jsonb_build_object('message', 'Spoken text belongs only to a voice order.'));
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

    insert into public.orders (id, business_id, store_id, order_number, source, status, notes, last_request_id, spoken_text)
    values (p_id, v_biz, p_store_id, v_number, p_source, 'draft', v_notes, p_request_id,
            case when p_source = 'voice' then v_spoken else null end);

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

-- ---------------------------------------------------------------------------
-- The diagnostic log (append-only) and the parse rate limit
-- ---------------------------------------------------------------------------

create table if not exists public.voice_diagnostics (
  id                uuid not null default gen_random_uuid(),
  business_id       uuid not null default public.current_business_id()
                      references public.businesses (id) on delete restrict,
  created_at        timestamptz not null default now(),
  kind              text not null check (kind in ('ai_busy', 'ai_timeout', 'ai_invalid', 'ai_not_configured',
                                                  'ai_unavailable', 'rate_limited', 'rules_unreadable', 'low_confidence')),
  parser            text not null check (parser in ('ai', 'rules')),
  item_count        integer not null default 0 check (item_count between 0 and 200),
  doubtful_count    integer not null default 0 check (doubtful_count between 0 and 200),
  unreadable_count  integer not null default 0 check (unreadable_count between 0 and 200),
  transcript_length integer not null default 0 check (transcript_length between 0 and 2000),
  message           text check (message is null or char_length(message) <= 200),
  constraint voice_diagnostics_pkey primary key (business_id, id)
);

create index if not exists voice_diagnostics_biz_created_idx on public.voice_diagnostics (business_id, created_at desc);

-- Records are never edited or deleted. Only the service role (removing a test business) and the writer function's own
-- pruning of records older than 90 days (it sets app.voice_prune for its transaction) may delete.
create or replace function public.voice_diagnostics_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and (current_user = 'service_role' or current_setting('app.voice_prune', true) = 'on') then
    return old;
  end if;
  raise exception 'voice_diagnostics_immutable: diagnostic records are never edited or deleted' using errcode = '22023';
end;
$$;

drop trigger if exists voice_diagnostics_append_only on public.voice_diagnostics;
create trigger voice_diagnostics_append_only
  before update or delete on public.voice_diagnostics
  for each row execute function public.voice_diagnostics_append_only();

alter table public.voice_diagnostics enable row level security;

drop policy if exists voice_diagnostics_select on public.voice_diagnostics;
create policy voice_diagnostics_select on public.voice_diagnostics
  for select to authenticated
  using (business_id = public.current_business_id());

revoke all on public.voice_diagnostics from anon, authenticated;
grant select on public.voice_diagnostics to authenticated;

create table if not exists public.voice_parse_attempts (
  business_id uuid not null default public.current_business_id()
                references public.businesses (id) on delete restrict,
  at          timestamptz not null default now()
);

create index if not exists voice_parse_attempts_biz_at_idx on public.voice_parse_attempts (business_id, at);

-- Only the SECURITY DEFINER function below touches this table: Row Level Security is on and there is no policy and no grant.
alter table public.voice_parse_attempts enable row level security;
revoke all on public.voice_parse_attempts from anon, authenticated;

-- At most 20 AI parses per business per minute. Returns { allowed: true } and records the attempt, or
-- { allowed: false, retry_after_seconds }. The rule-based parser never calls this.
create or replace function public.voice_parse_allow()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_count integer;
  v_oldest timestamptz;
  v_wait integer;
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;

  -- One request at a time per business, so two simultaneous calls at the limit can never both be allowed.
  perform pg_advisory_xact_lock(hashtext('voice_parse:' || v_biz::text));

  delete from public.voice_parse_attempts where business_id = v_biz and at < clock_timestamp() - interval '1 hour';

  select count(*), min(a.at) into v_count, v_oldest
    from public.voice_parse_attempts a
   where a.business_id = v_biz and a.at > clock_timestamp() - interval '60 seconds';

  if v_count >= 20 then
    v_wait := greatest(1, ceil(extract(epoch from (v_oldest + interval '60 seconds' - clock_timestamp())))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', v_wait);
  end if;

  insert into public.voice_parse_attempts (business_id, at) values (v_biz, clock_timestamp());
  return jsonb_build_object('allowed', true);
end;
$$;

-- Appends one diagnostic record for the caller's business. A refusal caused by the app's own limit (rate_limited) is
-- skipped when the business already has one from the last 60 seconds, so a loop cannot flood the log. Records older
-- than 90 days of this business are removed. Never accepts a transcript, a key, a price or a balance: only counts.
create or replace function public.voice_diag_add(
  p_kind text,
  p_parser text,
  p_items integer,
  p_doubtful integer,
  p_unreadable integer,
  p_transcript_length integer,
  p_message text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('ai_busy', 'ai_timeout', 'ai_invalid', 'ai_not_configured', 'ai_unavailable',
                                      'rate_limited', 'rules_unreadable', 'low_confidence') then
    return jsonb_build_object('done', false, 'reason', 'invalid_kind');
  end if;
  if p_parser is null or p_parser not in ('ai', 'rules') then
    return jsonb_build_object('done', false, 'reason', 'invalid_parser');
  end if;
  if coalesce(p_items, -1) not between 0 and 200 or coalesce(p_doubtful, -1) not between 0 and 200
     or coalesce(p_unreadable, -1) not between 0 and 200 then
    return jsonb_build_object('done', false, 'reason', 'invalid_count');
  end if;
  if coalesce(p_transcript_length, -1) not between 0 and 2000 then
    return jsonb_build_object('done', false, 'reason', 'invalid_length');
  end if;
  if v_message is not null and char_length(v_message) > 200 then
    return jsonb_build_object('done', false, 'reason', 'invalid_message');
  end if;

  perform pg_advisory_xact_lock(hashtext('voice_diag:' || v_biz::text));

  if p_kind = 'rate_limited' and exists (
    select 1 from public.voice_diagnostics d
     where d.business_id = v_biz and d.kind = 'rate_limited' and d.created_at > clock_timestamp() - interval '60 seconds'
  ) then
    return jsonb_build_object('done', true, 'skipped', true);
  end if;

  perform set_config('app.voice_prune', 'on', true);
  delete from public.voice_diagnostics where business_id = v_biz and created_at < clock_timestamp() - interval '90 days';
  perform set_config('app.voice_prune', 'off', true);

  insert into public.voice_diagnostics (business_id, created_at, kind, parser, item_count, doubtful_count, unreadable_count,
                                        transcript_length, message)
  values (v_biz, clock_timestamp(), p_kind, p_parser, p_items, p_doubtful, p_unreadable, p_transcript_length, v_message);

  return jsonb_build_object('done', true);
end;
$$;

-- The caller's recent diagnostic records, newest first (Row Level Security applies).
create or replace function public.voice_diag_list(p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_biz uuid := public.current_business_id();
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if v_biz is null then
    raise exception 'no_business' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.voice_diagnostics d where d.business_id = v_biz),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'created_at', x.created_at, 'kind', x.kind, 'parser', x.parser,
               'item_count', x.item_count, 'doubtful_count', x.doubtful_count, 'unreadable_count', x.unreadable_count,
               'transcript_length', x.transcript_length, 'message', x.message) order by x.created_at desc, x.id)
        from (
          select d.* from public.voice_diagnostics d
           where d.business_id = v_biz
           order by d.created_at desc, d.id
           limit v_limit offset v_offset
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidates for the spoken names. FACTS ONLY: whether a spoken name is matched, choose one or unknown is decided by
-- application code. Active records of the caller's business only (SECURITY INVOKER, so Row Level Security applies
-- too); up to five per spoken name; exact forms first, then similarity (floor 0.3). No price, MRP or cost column.
-- ---------------------------------------------------------------------------

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
security invoker
set search_path = public, extensions
as $$
  with spoken as (
    select (t.ord - 1)::integer as idx, public.norm_text(t.val) as q
      from jsonb_array_elements_text(case when jsonb_typeof(p_names) = 'array' then p_names else '[]'::jsonb end)
           with ordinality as t(val, ord)
     where t.ord <= 200
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
      from spoken s
      join public.products p
        on p.business_id = public.current_business_id() and p.is_active
     where s.q <> ''
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

create or replace function public.voice_match_stores(p_name text)
returns table (
  id uuid,
  name text,
  contact_person text,
  phone text,
  is_exact boolean,
  score real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (select public.norm_text(p_name) as q),
  cand as (
    select s.id, s.name, s.contact_person, s.phone,
           (public.norm_text(s.name) = q.q) as is_exact,
           extensions.word_similarity(q.q, s.search_text) as score
      from q
      join public.stores s on s.business_id = public.current_business_id() and s.is_active
     where q.q <> ''
  )
  select c.id, c.name, c.contact_person, c.phone, c.is_exact, c.score
    from cand c
   where c.is_exact or c.score >= 0.3
   order by c.is_exact desc, c.score desc, c.name, c.id
   limit 5
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.order_save(uuid, uuid, int, uuid, text, jsonb, text, text) from public, anon;
revoke all on function public.voice_parse_allow() from public, anon;
revoke all on function public.voice_diag_add(text, text, integer, integer, integer, integer, text) from public, anon;
revoke all on function public.voice_diag_list(integer, integer) from public, anon;
revoke all on function public.voice_match_products(jsonb) from public, anon;
revoke all on function public.voice_match_stores(text) from public, anon;
revoke all on function public.voice_diagnostics_append_only() from public, anon, authenticated;

grant execute on function public.order_save(uuid, uuid, int, uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.voice_parse_allow() to authenticated;
grant execute on function public.voice_diag_add(text, text, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.voice_diag_list(integer, integer) to authenticated;
grant execute on function public.voice_match_products(jsonb) to authenticated;
grant execute on function public.voice_match_stores(text) to authenticated;

commit;
