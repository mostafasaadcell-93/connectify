-- Runs only against the local connectify_staging database.
do $$ begin
  if current_database() <> 'connectify_staging' then
    raise exception 'refusing to run outside connectify_staging';
  end if;
end $$;

begin;

do $$
declare
  staff uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '22222222-2222-2222-2222-222222222222';
  n int;
  flag boolean;
  price text;
  qty text;
  order_status text;
  order_items jsonb;
  decision_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  if public.is_staff() then raise exception 'anon is_staff returned true'; end if;
  begin
    perform public.market_decide('unit:u12', 'approved', 1511.97, 1542, null, '{}'::jsonb, 'manual');
    raise exception 'anon market_decide was allowed';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from public.market_decisions;
  if n <> 0 then raise exception 'anon can see decisions: %', n; end if;
  select count(*) into n from public.store_state where key = 'priv';
  if n <> 0 then raise exception 'anon can see private costs: %', n; end if;
  select unit->>'p' into price from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u12';
  if price <> '1542' then raise exception 'anon unit read returned %', price; end if;
  update public.store_state set data = '[]'::jsonb where key = 'units';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'anon updated units'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', other::text, true);
  execute 'set local role authenticated';
  begin
    perform public.market_decide('unit:u12', 'approved', 1511.97, 1542, null, '{}'::jsonb, 'manual');
    raise exception 'non-staff decide was allowed';
  exception when others then
    if sqlerrm not like '%staff only%' then raise exception 'non-staff decide returned %', sqlerrm; end if;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', staff::text, true);
  execute 'set local role authenticated';
  if public.is_staff() is not true then raise exception 'staff is_staff returned false'; end if;
  begin
    insert into public.market_decisions (sku, status) values ('unit:u12', 'approved');
    raise exception 'direct decision insert was allowed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.market_decide('unit:u12', 'applied', 1511.97, 1542, 'k-missing', '{}'::jsonb, 'manual');
    raise exception 'apply without approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'apply without approval returned %', sqlerrm; end if;
  end;
  begin
    perform public.market_decide('unit:u12', 'applied', 1511.97, 1542, 'k-auto', '{}'::jsonb, 'automatic');
    raise exception 'automatic apply was allowed';
  exception when others then
    if sqlerrm not like '%automation disabled%' then raise exception 'automatic apply returned %', sqlerrm; end if;
  end;
  begin
    update public.market_query_config set enabled = true where id = 1;
    raise exception 'scheduler enable was allowed';
  exception when others then
    if sqlerrm not like '%scheduler disabled%' then raise exception 'scheduler enable returned %', sqlerrm; end if;
  end;
  decision_id := public.market_decide('unit:u12', 'approved', 1511.97, 1542, null, '{"sku":"unit:u12"}'::jsonb, 'manual');
  if decision_id is null then raise exception 'staff approve returned null'; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:u12' and status = 'approved';
  if n <> 1 then raise exception 'approval did not persist: %', n; end if;
  decision_id := public.market_decide('unit:u12', 'applied', 1511.97, 1542, 'k-apply', '{}'::jsonb, 'manual');
  if decision_id is null then raise exception 'manual apply audit returned null'; end if;
  begin
    perform public.market_decide('unit:u12', 'applied', 1511.97, 1542, 'k-apply', '{}'::jsonb, 'manual');
    raise exception 'duplicate apply was allowed';
  exception when others then
    if sqlerrm not like '%already applied%' then raise exception 'duplicate apply returned %', sqlerrm; end if;
  end;
  insert into public.market_sku_facts (sku, warranty_years, region, sim, condition, verified)
  values ('unit:u12', 2, 'uk', 'psim', 'new', true);
  select verified into flag from public.market_sku_facts where sku = 'unit:u12';
  if flag is not true then raise exception 'verified fact was not stored'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';
  select count(*) into n from public.market_sku_facts;
  if n <> 0 then raise exception 'anon can see facts: %', n; end if;
  execute 'reset role';

  select unit->>'p', unit->>'qty' into price, qty from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u12';
  if price <> '1542' or qty <> '2' then raise exception 'market_decide changed the unit to % qty %', price, qty; end if;
  select status, items into order_status, order_items from public.orders where code = 'C-STAGING-1';
  if order_status <> 'confirmed' or order_items::text not like '%1542%' then
    raise exception 'market_decide changed the order: % %', order_status, order_items;
  end if;
  select enabled into flag from public.market_query_config where id = 1;
  if flag is true then raise exception 'scheduler was enabled'; end if;
  select automation_enabled into flag from public.market_settings where id = 1;
  if flag is true then raise exception 'automation was enabled'; end if;
end $$;

rollback;
