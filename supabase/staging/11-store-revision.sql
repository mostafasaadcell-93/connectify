-- Reject a stale staff save of store_state.units or store_state.ph.
-- Install this only after supabase/staging/10-atomic-market-pricing.sql.
-- This script cannot read the hosted Supabase project id.
-- In the SQL Editor, read the project reference yourself.
-- If it is yxkzjwcmmtiljakttyfh, stop. Do not run this on production.
-- If it is akgilfixljswqljmedmg, run this in the same SQL Editor session before pasting this file:
--   select set_config('connectify.project_ref', 'akgilfixljswqljmedmg', false);
-- That setting is your confirmation of the editor. It is not proof of which database this is.
-- The checks below require the known synthetic staging fixtures and refuse anything else.
-- This file does not enable automatic pricing, automatic writes, or the scheduler.
-- Do not rerun the synthetic seed.
-- test/hosted-staging-check.mjs and test/hosted-market-race-check.mjs use the pre-migration-10
-- audit path. Their CLI entrypoints refuse to run. Use test/hosted-migration-readiness.mjs.
-- market_commit_price below is the migration 10 body plus revision = revision + 1.
-- Re-applying migration 10 after this file removes that bump. Re-apply this file immediately.

do $migration$
declare
  project_ref text := current_setting('connectify.project_ref', true);
  unit_count int;
  order_count int;
  silver jsonb;
  blue jsonb;
begin
  if project_ref is distinct from 'akgilfixljswqljmedmg' then
    raise exception 'refusing to install store revisions: set connectify.project_ref to akgilfixljswqljmedmg in this session only after the SQL Editor shows that reference. This script cannot read the hosted project id. Stop if the editor shows yxkzjwcmmtiljakttyfh.';
  end if;
  if to_regclass('public.store_state') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.market_settings') is null
     or to_regclass('public.market_query_config') is null
     or to_regclass('public.market_decisions') is null then
    raise exception 'refusing to install store revisions: required staging tables are missing';
  end if;
  if to_regprocedure('public.market_commit_price(text,text,numeric,numeric,text,jsonb,jsonb)') is null then
    raise exception 'refusing to install store revisions: market_commit_price is missing. Install migration 10 first.';
  end if;
  if not exists (
    select 1 from public.store_state
    where key = 'units' and jsonb_typeof(data) = 'array'
  ) then
    raise exception 'refusing to install store revisions: unexpected or missing synthetic units';
  end if;

  select count(*) into unit_count
  from public.store_state, lateral jsonb_array_elements(data) unit
  where key = 'units';
  select unit into silver
  from public.store_state, lateral jsonb_array_elements(data) unit
  where key = 'units' and unit->>'id' = 'u-stage-1';
  select unit into blue
  from public.store_state, lateral jsonb_array_elements(data) unit
  where key = 'units' and unit->>'id' = 'u-stage-2';
  if unit_count is distinct from 2
     or silver is distinct from '{"id":"u-stage-1","m":"17promax","c":"Silver","st":256,"cond":"new","sim":"psim","qty":2,"p":900,"bat":0,"note":"staging-synthetic"}'::jsonb
     or blue is distinct from '{"id":"u-stage-2","m":"17promax","c":"Deep Blue","st":256,"cond":"new","sim":"psim","qty":1,"p":910,"bat":0,"note":"staging-synthetic"}'::jsonb then
    raise exception 'refusing to install store revisions: unexpected or missing synthetic units';
  end if;

  select count(*) into order_count from public.orders;
  if order_count is distinct from 2
     or not exists (
       select 1 from public.orders
       where code = 'C-STAGE-CONF' and type = 'order' and status = 'confirmed' and stock_applied is true
     )
     or not exists (
       select 1 from public.orders
       where code = 'C-STAGE-NEW' and type = 'order' and status = 'new' and stock_applied is false
     ) then
    raise exception 'refusing to install store revisions: unexpected or missing synthetic orders';
  end if;

  if not exists (
    select 1 from public.store_state
    where key = 'ph'
      and jsonb_typeof(data) = 'object'
      and (select array_agg(phone_key order by phone_key) from jsonb_object_keys(data) phone_key) = array['stage-ph']
  ) then
    raise exception 'refusing to install store revisions: unexpected or missing synthetic phone fixture';
  end if;
  if not exists (
    select 1 from public.store_state
    where key = 'priv'
      and jsonb_typeof(data) = 'object'
      and (select array_agg(priv_key order by priv_key) from jsonb_object_keys(data) priv_key) = array['u']
      and (select array_agg(unit_key order by unit_key) from jsonb_object_keys(data->'u') unit_key) = array['u-stage-1','u-stage-2']
      and data #> '{u,u-stage-1}' is not null
      and data #> '{u,u-stage-2}' is not null
  ) then
    raise exception 'refusing to install store revisions: unexpected or missing synthetic private fixture';
  end if;

  if not exists (
    select 1 from public.market_settings
    where id = 1 and automation_enabled is false and writes_enabled is false
  ) or exists (
    select 1 from public.market_settings
    where automation_enabled is true or writes_enabled is true
  ) then
    raise exception 'refusing to install store revisions: automation or writes are enabled';
  end if;
  if not exists (
    select 1 from public.market_query_config
    where id = 1 and enabled is false
  ) or exists (
    select 1 from public.market_query_config where enabled is true
  ) then
    raise exception 'refusing to install store revisions: scheduler is enabled or missing';
  end if;

  execute 'alter table public.store_state add column if not exists revision bigint not null default 1';

  execute $guard$
create or replace function public.store_state_revision_guard()
returns trigger
language plpgsql
set search_path = public
as $body$
begin
  if new.key is distinct from 'units' and new.key is distinct from 'ph' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.updated_at := clock_timestamp();
    return new;
  end if;
  if new.revision is distinct from old.revision + 1 then
    raise exception 'stale store save';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$body$;
$guard$;

  execute 'drop trigger if exists store_state_revision_guard on public.store_state';
  execute 'create trigger store_state_revision_guard before insert or update on public.store_state for each row execute function public.store_state_revision_guard()';
  execute 'revoke all on function public.store_state_revision_guard() from public, anon, authenticated';

  -- Install the reviewed migration 10 function with one added assignment.
  -- Do not rewrite whatever body is currently installed by matching its text.
  -- Re-applying migration 10 removes the revision bump. Re-apply this file immediately after that.
  execute $commit$
create or replace function public.market_commit_price(p_sku text, p_action text, p_target numeric, p_previous numeric, p_apply_key text, p_identity jsonb, p_proposal jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $body$
declare
  settings public.market_settings;
  latest public.market_decisions;
  applied_row public.market_decisions;
  restored_row public.market_decisions;
  existing public.market_decisions;
  state_key text;
  unit_id text;
  phone_id text;
  variant_index text;
  locked jsonb;
  unit_row jsonb;
  variant_row jsonb;
  idx int;
  current_price numeric;
  new_data jsonb;
  new_id uuid;
begin
  if not public.is_staff() then
    raise exception 'staff only';
  end if;
  if p_action is distinct from 'apply' and p_action is distinct from 'restore' then
    raise exception 'manual only';
  end if;
  if p_target is null or p_target <= 0 or p_previous is null or p_previous <= 0 then
    raise exception 'missing target';
  end if;
  select * into settings from public.market_settings where id = 1;
  if settings.id is null or settings.automation_enabled is true or settings.writes_enabled is true then
    raise exception 'automation disabled';
  end if;
  if exists (select 1 from public.market_query_config where enabled is true) then
    raise exception 'scheduler disabled';
  end if;
  if p_sku is null or p_sku ~ '[[:space:]]' then
    raise exception 'unknown sku';
  end if;
  if p_sku ~ '^unit:[^:]+$' then
    state_key := 'units';
    unit_id := substring(p_sku from 6);
  elsif p_sku ~ '^ph:[^:]+:[0-9]+$' then
    state_key := 'ph';
    phone_id := split_part(p_sku, ':', 2);
    variant_index := split_part(p_sku, ':', 3);
  else
    raise exception 'unknown sku';
  end if;

  insert into public.market_sku_locks (sku)
  values (p_sku)
  on conflict (sku) do update set sku = excluded.sku;

  select data into locked
  from public.store_state
  where key = state_key
  for update;
  if not found then
    raise exception 'missing sku';
  end if;

  if state_key = 'units' then
    if jsonb_typeof(locked) is distinct from 'array' then
      raise exception 'missing sku';
    end if;
    begin
      select (ordinality - 1)::int, unit
      into strict idx, unit_row
      from jsonb_array_elements(locked) with ordinality as found(unit, ordinality)
      where unit->>'id' = unit_id;
    exception
      when no_data_found then
        raise exception 'missing sku';
      when too_many_rows then
        raise exception 'ambiguous sku';
    end;
    if not (unit_row ? 'p') or unit_row->>'p' is null then
      raise exception 'missing price';
    end if;
    if p_identity is null
       or p_identity->>'color' is distinct from unit_row->>'c'
       or p_identity->>'storage' is distinct from unit_row->>'st'
       or p_identity->>'sim' is distinct from unit_row->>'sim'
       or p_identity->>'cond' is distinct from unit_row->>'cond' then
      raise exception 'variant changed';
    end if;
    current_price := (unit_row->>'p')::numeric;
  else
    if jsonb_typeof(locked) is distinct from 'object'
       or locked->phone_id is null
       or jsonb_typeof(locked->phone_id) is distinct from 'object' then
      raise exception 'missing sku';
    end if;
    variant_row := locked #> array[phone_id, 'v', variant_index];
    if variant_row is null or jsonb_typeof(variant_row) is distinct from 'object' or not (variant_row ? 'p') or variant_row->>'p' is null then
      raise exception 'missing sku';
    end if;
    if p_identity is not null and (
      (p_identity ? 'id' and p_identity->>'id' is distinct from phone_id)
      or (p_identity ? 'variant' and p_identity->>'variant' is distinct from variant_index)
    ) then
      raise exception 'variant changed';
    end if;
    current_price := (variant_row->>'p')::numeric;
  end if;

  if p_action = 'apply' then
    if p_apply_key is null or char_length(p_apply_key) < 3 then
      raise exception 'missing apply key';
    end if;
    select * into existing
    from public.market_decisions
    where status = 'applied' and apply_key = p_apply_key;
    if existing.id is not null then
      if existing.sku = p_sku
         and existing.target_price is not distinct from p_target
         and current_price is not distinct from p_target then
        return existing.id;
      end if;
      raise exception 'already applied';
    end if;
    if current_price is distinct from p_previous then
      raise exception 'stale price';
    end if;
    select * into latest
    from public.market_decisions
    where sku = p_sku and status in ('approved','rejected')
    order by created_at desc, id desc
    limit 1;
    if latest.id is null or latest.status <> 'approved' or latest.target_price is distinct from p_target then
      raise exception 'not approved';
    end if;
    if exists (
      select 1 from public.market_decisions later
      where later.sku = p_sku
        and later.status in ('applied','restored')
        and later.id is distinct from latest.id
        and later.created_at >= latest.created_at
    ) then
      raise exception 'not approved: approval already used';
    end if;
  else
    select * into applied_row
    from public.market_decisions
    where sku = p_sku and status = 'applied'
    order by created_at desc, id desc
    limit 1;
    if applied_row.id is null then
      raise exception 'not applied';
    end if;
    select * into restored_row
    from public.market_decisions
    where sku = p_sku
      and status = 'restored'
      and created_at >= applied_row.created_at
    order by created_at desc, id desc
    limit 1;
    if restored_row.id is not null then
      if restored_row.target_price is not distinct from p_target
         and current_price is not distinct from p_target then
        return restored_row.id;
      end if;
      raise exception 'already restored';
    end if;
    if applied_row.target_price is distinct from current_price
       or applied_row.target_price is distinct from p_previous
       or applied_row.previous_price is distinct from p_target then
      raise exception 'stale price';
    end if;
  end if;

  if state_key = 'units' then
    new_data := jsonb_set(locked, array[idx::text, 'p'], to_jsonb(p_target), false);
  else
    new_data := jsonb_set(locked, array[phone_id, 'v', variant_index, 'p'], to_jsonb(p_target), false);
  end if;
  update public.store_state
  set data = new_data, updated_at = clock_timestamp(), revision = revision + 1
  where key = state_key;
  if not found then
    raise exception 'missing sku';
  end if;

  insert into public.market_decisions (sku, status, target_price, previous_price, apply_key, proposal, created_at)
  values (
    p_sku,
    case when p_action = 'apply' then 'applied' else 'restored' end,
    p_target,
    p_previous,
    case when p_action = 'apply' then p_apply_key else null end,
    coalesce(p_proposal, '{}'::jsonb),
    clock_timestamp()
  )
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'already applied';
end;
$body$;
$commit$;

  execute 'revoke all on function public.market_commit_price(text, text, numeric, numeric, text, jsonb, jsonb) from public, anon';
  execute 'grant execute on function public.market_commit_price(text, text, numeric, numeric, text, jsonb, jsonb) to authenticated';
  execute 'revoke all on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) from public, anon';
  execute 'grant execute on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) to authenticated';
end
$migration$;
