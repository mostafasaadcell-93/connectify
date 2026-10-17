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
-- audit path. Do not run either one after migration 10 or this file is installed.

do $migration$
declare
  project_ref text := current_setting('connectify.project_ref', true);
  unit_count int;
  order_count int;
  silver jsonb;
  blue jsonb;
  fn_sql text;
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

  select pg_get_functiondef('public.market_commit_price(text,text,numeric,numeric,text,jsonb,jsonb)'::regprocedure) into fn_sql;
  if fn_sql is null or position('search_path' in lower(fn_sql)) = 0 then
    raise exception 'refusing to install store revisions: market_commit_price has no fixed search_path';
  end if;
  if position('revision = revision + 1' in fn_sql) = 0 then
    if position('set data = new_data, updated_at = clock_timestamp()' in fn_sql) = 0 then
      raise exception 'refusing to install store revisions: market_commit_price does not have the expected price update';
    end if;
    fn_sql := replace(
      fn_sql,
      'set data = new_data, updated_at = clock_timestamp()',
      'set data = new_data, updated_at = clock_timestamp(), revision = revision + 1'
    );
    execute fn_sql;
  end if;

  execute 'revoke all on function public.market_commit_price(text, text, numeric, numeric, text, jsonb, jsonb) from public, anon';
  execute 'grant execute on function public.market_commit_price(text, text, numeric, numeric, text, jsonb, jsonb) to authenticated';
  execute 'revoke all on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) from public, anon';
  execute 'grant execute on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) to authenticated';
end
$migration$;
