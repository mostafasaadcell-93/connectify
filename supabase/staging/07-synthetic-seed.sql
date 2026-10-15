-- Synthetic Connectify staging data.
-- Run this only in a new hosted project, after the schema files in supabase/staging/HOSTED.md.
-- It refuses the production project id, non-staging staff, live-looking orders, and real inventory.
-- Re-running it restores the synthetic prices below. It does not enable the scheduler.

begin;

do $$
declare
  project_name text := current_setting('connectify.staging_project', true);
  project_ref text := current_setting('connectify.project_ref', true);
  staff_email text := current_setting('connectify.staging_staff_email', true);
  viewer_email text := current_setting('connectify.staging_viewer_email', true);
begin
  if project_name is distinct from 'connectify-staging' then
    raise exception 'refusing to seed: set connectify.staging_project to connectify-staging';
  end if;
  if project_ref is null or length(project_ref) < 10 or project_ref = 'yxkzjwcmmtiljakttyfh' then
    raise exception 'refusing to seed: set connectify.project_ref to the new project id, never the production id';
  end if;
  if staff_email is null or viewer_email is null
     or staff_email ilike '%replace-with%' or viewer_email ilike '%replace-with%'
     or staff_email not ilike '%staging%' or viewer_email not ilike '%staging%'
     or lower(staff_email) = lower(viewer_email) then
    raise exception 'refusing to seed: set two different emails that each contain staging';
  end if;
  if exists (
    select 1 from public.staff s
    join auth.users u on u.id = s.user_id
    where u.email not ilike '%staging%'
  ) then
    raise exception 'refusing to seed: a staff email does not contain staging';
  end if;
  if to_regclass('public.orders') is not null and exists (
    select 1 from public.orders
    where code not like 'C-STAGE-%' and code not like 'T-STAGE-%'
  ) then
    raise exception 'refusing to seed: this database has orders that are not staging orders';
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
    raise exception 'refusing to seed: inventory is not marked staging-synthetic';
  end if;
  if not exists (select 1 from auth.users where lower(email) = lower(staff_email)) then
    raise exception 'create the staging staff user in Authentication before seeding';
  end if;
  if not exists (select 1 from auth.users where lower(email) = lower(viewer_email)) then
    raise exception 'create the staging viewer user in Authentication before seeding';
  end if;
end $$;

-- API roles can reach the tables. Row policies still decide who can see or change a row.
grant select on public.store_state, public.orders to anon;
grant insert on public.orders to anon;
grant select, insert, update, delete on public.store_state, public.orders to authenticated;
grant select on public.staff to authenticated;
grant select, update on public.market_settings to authenticated;
grant select, insert, update on public.market_product_flags to authenticated;
grant select on public.market_runs to authenticated;
grant select, insert on public.market_observations to authenticated;
grant select on public.market_decisions to authenticated;
grant select, insert, update on public.market_sku_facts to authenticated;
grant select, update on public.market_query_config to authenticated;
grant select on public.market_settings, public.market_product_flags, public.market_runs,
  public.market_observations, public.market_decisions, public.market_sku_facts, public.market_query_config to anon;
grant usage, select on all sequences in schema public to authenticated;

insert into public.staff (user_id)
select id from auth.users
where lower(email) = lower(current_setting('connectify.staging_staff_email'))
on conflict (user_id) do nothing;

insert into public.store_state (key, data) values
  ('units', '[
    {"id":"u-stage-1","m":"17promax","c":"Silver","st":256,"cond":"new","sim":"psim","qty":2,"p":900,"bat":0,"note":"staging-synthetic"},
    {"id":"u-stage-2","m":"17promax","c":"Deep Blue","st":256,"cond":"new","sim":"psim","qty":1,"p":910,"bat":0,"note":"staging-synthetic"}
  ]'::jsonb),
  ('ph', '{"stage-ph":{"v":{"0":{"p":25,"q":4}}}}'::jsonb),
  ('priv', '{"u":{"u-stage-1":{"cost":700},"u-stage-2":{"cost":720}}}'::jsonb)
on conflict (key) do update set data = excluded.data, updated_at = now();

insert into public.orders (code, type, name, phone, area, pay, status, items, stock_applied)
values
  ('C-STAGE-CONF', 'order', 'Staging Buyer', '701110001', 'Beirut', 'Cash', 'confirmed',
    '[{"title":"Staging phone","detail":"256GB, Silver, new, psim","price":900,"qty":1}]'::jsonb, true),
  ('C-STAGE-NEW', 'order', 'Staging Shopper', '701110002', 'Beirut', 'Cash', 'new',
    '[{"title":"Staging phone","detail":"256GB, Deep Blue, new, psim","price":910,"qty":1}]'::jsonb, false)
on conflict (code) do update
  set status = excluded.status, items = excluded.items, stock_applied = excluded.stock_applied;

update public.market_settings
set automation_enabled = false,
    writes_enabled = false,
    min_margin_pct = 2,
    lbp_per_usd = null,
    lbp_rate_verified = false,
    updated_at = now()
where id = 1;

update public.market_query_config
set enabled = false,
    queries = '[{"text":"iPhone 17 Pro Max","brand":"apple"}]'::jsonb,
    batch_size = 8,
    max_requests = 24,
    next_offset = 0,
    updated_at = now()
where id = 1;

insert into public.market_sku_facts (sku, warranty_years, region, sim, condition, verified, note)
values ('unit:u-stage-1', null, null, null, null, false, 'staging placeholder, not verified')
on conflict (sku) do update
  set verified = false, warranty_years = null, region = null, sim = null, condition = null, note = excluded.note, updated_at = now();

do $$
declare
  price text;
  qty text;
  scheduler boolean;
  automation boolean;
begin
  select unit->>'p', unit->>'qty' into price, qty
  from public.store_state, lateral jsonb_array_elements(data) unit
  where key = 'units' and unit->>'id' = 'u-stage-1';
  select enabled into scheduler from public.market_query_config where id = 1;
  select automation_enabled into automation from public.market_settings where id = 1;
  if price is distinct from '900' or qty is distinct from '2' or scheduler is true or automation is true then
    raise exception 'staging seed did not leave the synthetic price and disabled flags in place';
  end if;
end $$;

commit;

select 'staging seed ready' as result,
  (select unit->>'p' from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u-stage-1') as silver_price,
  (select status from public.orders where code = 'C-STAGE-CONF') as confirmed_order,
  (select enabled from public.market_query_config where id = 1) as scheduler_enabled,
  (select automation_enabled from public.market_settings where id = 1) as automation_enabled;
