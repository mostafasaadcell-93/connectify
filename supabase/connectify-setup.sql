-- =====================================================================
-- Connectify store database setup
-- Paste all of this into Supabase > SQL Editor > New query, then click Run.
-- Safe to run more than once.
-- =====================================================================

-- ---------- who is staff (only these logins can see orders and edit the store) ----------
create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

drop policy if exists "staff can see staff" on public.staff;
create policy "staff can see staff" on public.staff for select to authenticated using (public.is_staff());

-- ---------- orders and trade-in requests ----------
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
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and pg_column_size(items) < 20000),
  trade jsonb check (trade is null or pg_column_size(trade) < 4000),
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
drop policy if exists "staff delete orders" on public.orders;
create policy "staff delete orders" on public.orders for delete to authenticated using (public.is_staff());

-- ---------- store settings: prices, stock, new products, storefront text, trade-in prices ----------
create table if not exists public.store_state (
  key text primary key check (key in ('ph','units','newp','content','trade','custom')),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.store_state enable row level security;

drop policy if exists "everyone reads the store" on public.store_state;
create policy "everyone reads the store" on public.store_state for select to anon, authenticated using (true);
drop policy if exists "staff insert store" on public.store_state;
create policy "staff insert store" on public.store_state for insert to authenticated with check (public.is_staff());
drop policy if exists "staff update store" on public.store_state;
create policy "staff update store" on public.store_state for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete store" on public.store_state;
create policy "staff delete store" on public.store_state for delete to authenticated using (public.is_staff());

-- ---------- what customers look at and search for (feeds the dashboard) ----------
create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('view','want','miss')),
  key text not null check (char_length(key) between 1 and 80)
);
create index if not exists events_created_idx on public.events (created_at desc);
alter table public.events enable row level security;

drop policy if exists "anyone logs a visit" on public.events;
create policy "anyone logs a visit" on public.events for insert to anon, authenticated with check (true);
drop policy if exists "staff read events" on public.events;
create policy "staff read events" on public.events for select to authenticated using (public.is_staff());
drop policy if exists "staff clear events" on public.events;
create policy "staff clear events" on public.events for delete to authenticated using (public.is_staff());

-- ---------- product photos the owner uploads ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists "staff upload photos" on storage.objects;
create policy "staff upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_staff());
drop policy if exists "staff change photos" on storage.objects;
create policy "staff change photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_staff());
drop policy if exists "staff remove photos" on storage.objects;
create policy "staff remove photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_staff());

-- ---------- make the owner's login staff ----------
-- 1) First create the owner in Authentication > Users > Add user (email + password).
-- 2) Put that same email below (keep the quotes), then run this whole script.
insert into public.staff (user_id)
select id from auth.users where lower(email) = lower('PUT-OWNER-EMAIL-HERE')
on conflict do nothing;

-- Check: this should show 1 row with the owner's email.
select u.email, s.added_at from public.staff s join auth.users u on u.id = s.user_id;
