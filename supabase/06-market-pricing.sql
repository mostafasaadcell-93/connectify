-- Connectify market pricing audit tables.
-- Do not run this on production until the owner approves it.
-- Safe to run more than once. It creates new tables only.
-- It does not change selling prices, stock, orders, or store_state rows.

create table if not exists public.market_settings (
  id int primary key default 1 check (id = 1),
  automation_enabled boolean not null default false,
  writes_enabled boolean not null default false,
  min_margin_pct numeric check (min_margin_pct is null or min_margin_pct >= 0),
  lbp_per_usd numeric check (lbp_per_usd is null or lbp_per_usd > 0),
  lbp_rate_verified boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.market_settings (id) values (1) on conflict (id) do nothing;
alter table public.market_settings enable row level security;
drop policy if exists "staff read market settings" on public.market_settings;
create policy "staff read market settings" on public.market_settings for select to authenticated using (public.is_staff());
drop policy if exists "staff update market settings" on public.market_settings;
create policy "staff update market settings" on public.market_settings for update to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.market_product_flags (
  sku text primary key check (char_length(sku) between 1 and 80),
  auto_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.market_product_flags enable row level security;
drop policy if exists "staff read market flags" on public.market_product_flags;
create policy "staff read market flags" on public.market_product_flags for select to authenticated using (public.is_staff());
drop policy if exists "staff write market flags" on public.market_product_flags;
create policy "staff write market flags" on public.market_product_flags for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update market flags" on public.market_product_flags;
create policy "staff update market flags" on public.market_product_flags for update to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.market_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running','ok','failed')),
  error text
);
create unique index if not exists market_one_open_run on public.market_runs ((status)) where status = 'running';
alter table public.market_runs enable row level security;
drop policy if exists "staff read market runs" on public.market_runs;
create policy "staff read market runs" on public.market_runs for select to authenticated using (public.is_staff());

create table if not exists public.market_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.market_runs(id) on delete set null,
  store text not null,
  name text not null,
  price numeric,
  currency text,
  url text,
  available boolean,
  checked_at timestamptz not null default now(),
  specs jsonb not null default '{}'::jsonb,
  status text not null,
  error text,
  confidence text
);
create index if not exists market_observations_checked_idx on public.market_observations (checked_at desc);
alter table public.market_observations enable row level security;
drop policy if exists "staff read market observations" on public.market_observations;
create policy "staff read market observations" on public.market_observations for select to authenticated using (public.is_staff());
drop policy if exists "staff insert market observations" on public.market_observations;
create policy "staff insert market observations" on public.market_observations for insert to authenticated with check (public.is_staff());

create table if not exists public.market_decisions (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  status text not null check (status in ('proposed','approved','rejected','applied','restored')),
  target_price numeric,
  previous_price numeric,
  apply_key text,
  proposal jsonb not null default '{}'::jsonb,
  actor uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists market_apply_once on public.market_decisions (apply_key) where status = 'applied' and apply_key is not null;
alter table public.market_decisions enable row level security;
drop policy if exists "staff read market decisions" on public.market_decisions;
create policy "staff read market decisions" on public.market_decisions for select to authenticated using (public.is_staff());
drop policy if exists "staff write market decisions" on public.market_decisions;
-- No direct insert policy. Staff write decisions only through market_decide, which checks is_staff().

-- Manual approval is allowed while scheduled automation stays off.
-- Applied is recorded only after the caller has confirmed the staff price save.
-- This function does not write product prices, stock, or orders.
drop function if exists public.market_decide(text, text, numeric, numeric, text, jsonb);
create or replace function public.market_decide(p_sku text, p_status text, p_target numeric, p_previous numeric, p_apply_key text, p_proposal jsonb, p_mode text default 'manual')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
  if p_status = 'applied' then
    if p_target is null or p_target <= 0 then
      raise exception 'missing target';
    end if;
    if p_apply_key is null or char_length(p_apply_key) < 3 then
      raise exception 'missing apply key';
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
    end if;
  end if;
  insert into public.market_decisions (sku, status, target_price, previous_price, apply_key, proposal)
  values (p_sku, p_status, p_target, p_previous, case when p_status = 'applied' then p_apply_key else null end, coalesce(p_proposal, '{}'::jsonb))
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'already applied';
end;
$$;
revoke all on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) from public, anon;
grant execute on function public.market_decide(text, text, numeric, numeric, text, jsonb, text) to authenticated;

-- One checker at a time. Observations only; prices stay where they are.
create or replace function public.market_begin_run()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if not public.is_staff() then
    raise exception 'staff only';
  end if;
  insert into public.market_runs (status) values ('running') returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'a price check is already running';
end;
$$;
revoke all on function public.market_begin_run() from public, anon;
grant execute on function public.market_begin_run() to authenticated;

create or replace function public.market_finish_run(p_id uuid, p_status text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'staff only';
  end if;
  if p_status not in ('ok','failed') then
    raise exception 'bad status';
  end if;
  update public.market_runs set status = p_status, error = p_error, finished_at = now() where id = p_id and status = 'running';
end;
$$;
revoke all on function public.market_finish_run(uuid, text, text) from public, anon;
grant execute on function public.market_finish_run(uuid, text, text) to authenticated;

-- Scheduling stays off. After approval, a 12-hour job may call the market-check function.
-- That function stores observations only. Do not point it at product price rows.
-- Example, not executed here:
-- select cron.schedule('connectify-market', '0 */12 * * *', $$select 1$$);
