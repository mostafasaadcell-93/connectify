-- Serialize manual applies so one approval can be consumed only once.
-- Paste this whole file once in the staging SQL editor. Confirm the project is akgilfixljswqljmedmg.
-- If the editor shows yxkzjwcmmtiljakttyfh, stop. Do not run this on production.
-- It refuses live order codes and inventory that is not staging-synthetic.
-- It does not change prices, stock, orders, or the scheduler, and it does not delete market_decisions.
-- Do not rerun the synthetic seed.

select set_config('connectify.project_ref', 'akgilfixljswqljmedmg', false);

do $migration$
begin
  if current_setting('connectify.project_ref', true) is distinct from 'akgilfixljswqljmedmg' then
    raise exception 'refusing to replace market_decide unless connectify.project_ref is akgilfixljswqljmedmg';
  end if;
  if to_regclass('public.orders') is not null and exists (
    select 1 from public.orders
    where code not like 'C-STAGE-%' and code not like 'T-STAGE-%'
  ) then
    raise exception 'refusing to replace market_decide: this database has orders that are not staging orders';
  end if;
  if to_regclass('public.store_state') is not null and exists (
    select 1 from public.store_state
    where key = 'units'
      and jsonb_typeof(data) = 'array'
      and jsonb_array_length(data) > 0
      and exists (
        select 1 from jsonb_array_elements(data) unit
        where coalesce(unit->>'note', '') is distinct from 'staging-synthetic'
           or coalesce(unit->>'id', '') not like 'u-stage-%'
      )
  ) then
    raise exception 'refusing to replace market_decide: inventory is not marked staging-synthetic';
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
