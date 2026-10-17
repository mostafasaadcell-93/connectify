-- Serialize manual applies so one approval can be consumed only once.
-- This script cannot read the hosted Supabase project id.
-- In the SQL Editor, read the project reference yourself.
-- If it is yxkzjwcmmtiljakttyfh, stop. Do not run this on production.
-- If it is akgilfixljswqljmedmg, run this in the same SQL Editor session before pasting this file:
--   select set_config('connectify.project_ref', 'akgilfixljswqljmedmg', false);
-- That setting is your confirmation of the editor. It is not proof of which database this is.
-- The checks below require the known synthetic staging fixtures and refuse anything else.
-- This file does not change prices, stock, orders, or the scheduler, and it does not delete market_decisions.
-- Do not rerun the synthetic seed. Do not enable automatic pricing.

do $migration$
declare
  project_ref text := current_setting('connectify.project_ref', true);
  unit_count int;
  order_count int;
  silver jsonb;
  blue jsonb;
begin
  if project_ref is distinct from 'akgilfixljswqljmedmg' then
    raise exception 'refusing to replace market_decide: set connectify.project_ref to akgilfixljswqljmedmg in this session only after the SQL Editor shows that reference. This script cannot read the hosted project id. Stop if the editor shows yxkzjwcmmtiljakttyfh.';
  end if;
  if to_regclass('public.store_state') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.market_settings') is null
     or to_regclass('public.market_query_config') is null
     or to_regclass('public.market_decisions') is null then
    raise exception 'refusing to replace market_decide: required staging tables are missing';
  end if;
  if not exists (
    select 1 from public.store_state
    where key = 'units' and jsonb_typeof(data) = 'array'
  ) then
    raise exception 'refusing to replace market_decide: unexpected or missing synthetic units';
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
    raise exception 'refusing to replace market_decide: unexpected or missing synthetic units';
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
    raise exception 'refusing to replace market_decide: unexpected or missing synthetic orders';
  end if;

  if not exists (
    select 1 from public.store_state
    where key = 'ph'
      and jsonb_typeof(data) = 'object'
      and (select array_agg(phone_key order by phone_key) from jsonb_object_keys(data) phone_key) = array['stage-ph']
  ) then
    raise exception 'refusing to replace market_decide: unexpected or missing synthetic phone fixture';
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
    raise exception 'refusing to replace market_decide: unexpected or missing synthetic private fixture';
  end if;

  if not exists (
    select 1 from public.market_settings
    where id = 1 and automation_enabled is false and writes_enabled is false
  ) or exists (
    select 1 from public.market_settings
    where automation_enabled is true or writes_enabled is true
  ) then
    raise exception 'refusing to replace market_decide: automation or writes are enabled';
  end if;
  if not exists (
    select 1 from public.market_query_config
    where id = 1 and enabled is false
  ) or exists (
    select 1 from public.market_query_config where enabled is true
  ) then
    raise exception 'refusing to replace market_decide: scheduler is enabled or missing';
  end if;

  execute 'create table if not exists public.market_sku_locks (sku text primary key)';
  execute 'alter table public.market_sku_locks enable row level security';
  execute 'revoke all on table public.market_sku_locks from public, anon, authenticated';

  execute $fn$
create or replace function public.market_decide(p_sku text, p_status text, p_target numeric, p_previous numeric, p_apply_key text, p_proposal jsonb, p_mode text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $body$
declare
  new_id uuid;
  settings public.market_settings;
  latest public.market_decisions;
begin
  if not public.is_staff() then
    raise exception 'staff only';
  end if;
  if p_status not in ('approved','rejected','applied','restored') then
    raise exception 'bad status';
  end if;
  if p_mode is null or p_mode not in ('manual','automatic') then
    raise exception 'bad mode';
  end if;
  select * into settings from public.market_settings where id = 1;
  -- Serialize approvals, rejections, applies, and restores for this SKU.
  -- ON CONFLICT DO UPDATE locks the existing row until this transaction ends.
  insert into public.market_sku_locks (sku)
  values (p_sku)
  on conflict (sku) do update set sku = excluded.sku;
  if p_status = 'applied' then
    if p_target is null or p_target <= 0 then
      raise exception 'missing target';
    end if;
    if p_apply_key is null or char_length(p_apply_key) < 3 then
      raise exception 'missing apply key';
    end if;
    if exists (select 1 from public.market_decisions where status = 'applied' and apply_key = p_apply_key) then
      raise exception 'already applied';
    end if;
    if p_mode = 'automatic' then
      if settings.automation_enabled is not true or settings.writes_enabled is not true then
        raise exception 'automation disabled';
      end if;
      if not exists (select 1 from public.market_product_flags where sku = p_sku and auto_enabled) then
        raise exception 'product disabled';
      end if;
    else
      select * into latest from public.market_decisions
      where sku = p_sku and status in ('approved','rejected')
      order by created_at desc, id desc
      limit 1;
      if latest.id is null or latest.status <> 'approved' or latest.target_price is distinct from p_target then
        raise exception 'not approved';
      end if;
      -- Re-read after the SKU lock. An apply or a restore at or after that approval consumes it.
      -- A different apply key does not revive it. An equal timestamp is consumed too.
      if exists (
        select 1 from public.market_decisions later
        where later.sku = p_sku
          and later.status in ('applied','restored')
          and later.id is distinct from latest.id
          and later.created_at >= latest.created_at
      ) then
        raise exception 'not approved: approval already used';
      end if;
    end if;
  end if;
  insert into public.market_decisions (sku, status, target_price, previous_price, apply_key, proposal, created_at)
  values (p_sku, p_status, p_target, p_previous, case when p_status = 'applied' then p_apply_key else null end, coalesce(p_proposal, '{}'::jsonb), clock_timestamp())
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'already applied';
end;
$body$;
$fn$;

  execute 'revoke all on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) from public, anon';
  execute 'grant execute on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) to authenticated';
end
$migration$;
