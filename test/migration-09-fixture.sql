-- Isolated local stand-in for the hosted synthetic staging fixtures.
-- Refuses every database except connectify_migration_09. Do not point this at production or hosted staging.

do $$ begin
  if current_database() <> 'connectify_migration_09' then
    raise exception 'refusing to build the migration 09 fixture outside connectify_migration_09';
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
  code text not null unique check (char_length(code) between 3 and 20),
  type text not null check (type in ('order','tradein')),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  phone text not null check (char_length(phone) between 6 and 25),
  area text check (area is null or char_length(area) <= 60),
  pay text check (pay is null or char_length(pay) <= 40),
  status text not null default 'new' check (status in ('new','confirmed','delivered','cancelled')),
  items jsonb not null default '[]'::jsonb,
  stock_applied boolean not null default false
);
alter table public.orders enable row level security;

create table if not exists public.store_state (
  key text primary key check (key in ('ph','units','newp','content','trade','custom','priv')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.store_state enable row level security;

insert into public.staff (user_id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('33333333-3333-3333-3333-333333333333')
on conflict (user_id) do nothing;

insert into public.store_state (key, data) values
  ('units', '[
    {"id":"u-stage-1","m":"17promax","c":"Silver","st":256,"cond":"new","sim":"psim","qty":2,"p":900,"bat":0,"note":"staging-synthetic"},
    {"id":"u-stage-2","m":"17promax","c":"Deep Blue","st":256,"cond":"new","sim":"psim","qty":1,"p":910,"bat":0,"note":"staging-synthetic"}
  ]'::jsonb),
  ('ph', '{"stage-ph":{"v":{"0":{"p":25,"q":4}}}}'::jsonb),
  ('priv', '{"u":{"u-stage-1":{"cost":700},"u-stage-2":{"cost":720}}}'::jsonb)
on conflict (key) do update set data = excluded.data;

insert into public.orders (code, type, name, phone, area, pay, status, items, stock_applied)
values
  ('C-STAGE-CONF', 'order', 'Staging Buyer', '701110001', 'Beirut', 'Cash', 'confirmed',
    '[{"title":"Staging phone","detail":"256GB, Silver, new, psim","price":900,"qty":1}]'::jsonb, true),
  ('C-STAGE-NEW', 'order', 'Staging Shopper', '701110002', 'Beirut', 'Cash', 'new',
    '[{"title":"Staging phone","detail":"256GB, Deep Blue, new, psim","price":910,"qty":1}]'::jsonb, false)
on conflict (code) do update
  set type = excluded.type, status = excluded.status, items = excluded.items, stock_applied = excluded.stock_applied;

grant select on public.staff to authenticated;
grant select, insert, update on public.orders to anon, authenticated;
grant select, insert, update on public.store_state to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
