-- Local staging stand-in for Connectify market pricing.
-- Refuses every database except connectify_staging. Do not point this at production.

do $$ begin
  if current_database() <> 'connectify_staging' then
    raise exception 'refusing to run outside connectify_staging';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to postgres;

create table if not exists public.staff (
  user_id uuid primary key,
  added_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  code text not null unique,
  type text not null,
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  status text not null default 'new',
  items jsonb not null default '[]'::jsonb,
  stock_applied boolean not null default false
);
alter table public.orders enable row level security;
drop policy if exists "anyone can place an order" on public.orders;
create policy "anyone can place an order" on public.orders for insert to anon, authenticated
  with check (status = 'new' and stock_applied = false);
drop policy if exists "staff read orders" on public.orders;
create policy "staff read orders" on public.orders for select to authenticated using (public.is_staff());
drop policy if exists "staff update orders" on public.orders;
create policy "staff update orders" on public.orders for update to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.store_state (
  key text primary key check (key in ('ph','units','newp','content','trade','custom','priv')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.store_state enable row level security;
drop policy if exists "everyone reads the store" on public.store_state;
create policy "everyone reads the store" on public.store_state for select to anon, authenticated using (key <> 'priv' or public.is_staff());
drop policy if exists "staff insert store" on public.store_state;
create policy "staff insert store" on public.store_state for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update store" on public.store_state;
create policy "staff update store" on public.store_state for update to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.staff (user_id) values ('11111111-1111-1111-1111-111111111111') on conflict (user_id) do nothing;
insert into public.store_state (key, data) values
  ('units', '[{"id":"u12","m":"17promax","c":"Silver","st":256,"cond":"new","sim":"psim","qty":2,"p":1542}]'::jsonb),
  ('ph', '{}'::jsonb),
  ('priv', '{"u":{"u12":{"cost":1400}}}'::jsonb)
on conflict (key) do update set data = excluded.data;
insert into public.orders (code, type, name, phone, status, items, stock_applied)
values ('C-STAGING-1', 'order', 'Staging Buyer', '70123456', 'confirmed', '[{"sku":"u12","p":1542,"qty":1}]'::jsonb, true)
on conflict (code) do nothing;

grant select on public.staff to authenticated;
grant select, insert, update on public.orders to anon, authenticated;
grant select, insert, update on public.store_state to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
