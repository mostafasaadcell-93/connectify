-- Connectify update 3: customer reviews with stars
-- Paste into Supabase > SQL Editor > New query, then click RUN (not just Save). Safe to run more than once.

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 40),
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 600),
  order_code text check (order_code is null or char_length(order_code) <= 20),
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  verified boolean not null default false
);
create index if not exists reviews_status_idx on public.reviews (status, created_at desc);
alter table public.reviews enable row level security;

-- customers can send a review, but it always starts as "waiting" and unverified
drop policy if exists "anyone sends a review" on public.reviews;
create policy "anyone sends a review" on public.reviews for insert to anon, authenticated
  with check (status = 'pending' and verified = false);

-- customers only see approved reviews
drop policy if exists "everyone reads approved reviews" on public.reviews;
create policy "everyone reads approved reviews" on public.reviews for select to anon, authenticated
  using (status = 'approved' or public.is_staff());

drop policy if exists "staff update reviews" on public.reviews;
create policy "staff update reviews" on public.reviews for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete reviews" on public.reviews;
create policy "staff delete reviews" on public.reviews for delete to authenticated using (public.is_staff());

-- the public can't read order codes, even on approved reviews
revoke all on public.reviews from anon;
grant select (id, created_at, name, rating, body, status, verified) on public.reviews to anon;
grant insert (name, rating, body, order_code) on public.reviews to anon;

select 'reviews ready' as result;
