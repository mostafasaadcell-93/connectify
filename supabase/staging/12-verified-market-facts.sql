-- Add nullable warranty_provider and activation to market_sku_facts.
-- CREATE THIS FILE ONLY. Do not run it until a later explicit approval.
-- This script cannot read the hosted Supabase project id.
-- In the SQL Editor, read the project reference yourself.
-- If it is yxkzjwcmmtiljakttyfh, stop. Do not run this on production.
-- If it is akgilfixljswqljmedmg, run this in the same SQL Editor session before pasting this file:
--   select set_config('connectify.project_ref', 'akgilfixljswqljmedmg', false);
-- That setting is your confirmation of the editor. It is not proof of which database this is.
-- The checks below require the known synthetic staging fixtures and refuse anything else.
-- Install this only after supabase/staging/10-atomic-market-pricing.sql and supabase/staging/11-store-revision.sql.
-- Existing fact rows stay as they are. Missing provider and activation stay null.
-- This file does not backfill, guess, or mark any row verified.
-- This file does not enable automatic pricing, automatic writes, or the scheduler.
-- This file does not change store_state, prices, stock, orders, or audit rows.

do $migration$
declare
  project_ref text := current_setting('connectify.project_ref', true);
  unit_count int;
  order_count int;
  silver jsonb;
  blue jsonb;
begin
  if project_ref is distinct from 'akgilfixljswqljmedmg' then
    raise exception 'refusing to install verified facts: set connectify.project_ref to akgilfixljswqljmedmg in this session only after the SQL Editor shows that reference. This script cannot read the hosted project id. Stop if the editor shows yxkzjwcmmtiljakttyfh.';
  end if;
  if to_regclass('public.store_state') is null
     or to_regclass('public.orders') is null
     or to_regclass('public.market_settings') is null
     or to_regclass('public.market_query_config') is null
     or to_regclass('public.market_decisions') is null
     or to_regclass('public.market_sku_facts') is null then
    raise exception 'refusing to install verified facts: required staging tables are missing';
  end if;
  if to_regprocedure('public.market_commit_price(text,text,numeric,numeric,text,jsonb,jsonb)') is null then
    raise exception 'refusing to install verified facts: market_commit_price is missing. Install migration 10 first.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'store_state' and column_name = 'revision'
  ) then
    raise exception 'refusing to install verified facts: store revision is missing. Install migration 11 first.';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'store_state'
      and t.tgname = 'store_state_revision_guard'
      and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'refusing to install verified facts: store_state_revision_guard is missing or disabled. Install migration 11 first.';
  end if;
  if not exists (
    select 1 from public.store_state
    where key = 'units' and jsonb_typeof(data) = 'array'
  ) then
    raise exception 'refusing to install verified facts: unexpected or missing synthetic units';
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
    raise exception 'refusing to install verified facts: unexpected or missing synthetic units';
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
    raise exception 'refusing to install verified facts: unexpected or missing synthetic orders';
  end if;

  if not exists (
    select 1 from public.store_state
    where key = 'ph'
      and data is not distinct from '{"stage-ph":{"v":{"0":{"p":25,"q":4}}}}'::jsonb
  ) then
    raise exception 'refusing to install verified facts: unexpected or missing synthetic phone fixture';
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
    raise exception 'refusing to install verified facts: unexpected or missing synthetic private fixture';
  end if;

  if not exists (
    select 1 from public.market_settings
    where id = 1 and automation_enabled is false and writes_enabled is false
  ) or exists (
    select 1 from public.market_settings
    where automation_enabled is true or writes_enabled is true
  ) then
    raise exception 'refusing to install verified facts: automation or writes are enabled';
  end if;
  if not exists (
    select 1 from public.market_query_config
    where id = 1 and enabled is false
  ) or exists (
    select 1 from public.market_query_config where enabled is true
  ) then
    raise exception 'refusing to install verified facts: scheduler is enabled or missing';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'market_sku_facts' and c.relrowsecurity is true
  ) then
    raise exception 'refusing to install verified facts: row level security is not enabled on market_sku_facts';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'market_sku_facts'
      and policyname = 'staff read market facts' and cmd = 'SELECT' and 'authenticated' = any(roles)
      and coalesce(qual, '') ~* 'public\.is_staff\s*\(' and with_check is null
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'market_sku_facts'
      and policyname = 'staff insert market facts' and cmd = 'INSERT' and 'authenticated' = any(roles)
      and qual is null and coalesce(with_check, '') ~* 'public\.is_staff\s*\('
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'market_sku_facts'
      and policyname = 'staff update market facts' and cmd = 'UPDATE' and 'authenticated' = any(roles)
      and coalesce(qual, '') ~* 'public\.is_staff\s*\(' and coalesce(with_check, '') ~* 'public\.is_staff\s*\('
  ) then
    raise exception 'refusing to install verified facts: staff fact policies do not enforce is_staff()';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'market_sku_facts'
      and coalesce(qual, '') !~* 'is_staff\s*\('
      and coalesce(with_check, '') !~* 'is_staff\s*\('
  ) then
    raise exception 'refusing to install verified facts: a market_sku_facts policy does not enforce is_staff()';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'market_sku_facts'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and ('anon' = any(roles) or 'public' = any(roles))
  ) then
    raise exception 'refusing to install verified facts: anonymous write policy is present';
  end if;

  execute $sql$
alter table public.market_sku_facts add column if not exists warranty_provider text;
alter table public.market_sku_facts add column if not exists activation text;
alter table public.market_sku_facts drop constraint if exists market_sku_facts_warranty_provider_check;
alter table public.market_sku_facts add constraint market_sku_facts_warranty_provider_check
  check (warranty_provider is null or warranty_provider in ('apple','samsung','seller','international','local'));
alter table public.market_sku_facts drop constraint if exists market_sku_facts_activation_check;
alter table public.market_sku_facts add constraint market_sku_facts_activation_check
  check (activation is null or activation in ('active','inactive'));
revoke insert, update, delete, truncate, references, trigger on table public.market_sku_facts from public, anon;
$sql$;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'market_sku_facts'
      and column_name in ('warranty_provider', 'activation')
      and is_nullable = 'NO'
  ) then
    raise exception 'refusing to install verified facts: new columns must stay nullable';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'market_sku_facts'
      and grantee in ('anon', 'public')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) then
    raise exception 'refusing to install verified facts: anonymous write access is present';
  end if;
end;
$migration$;
