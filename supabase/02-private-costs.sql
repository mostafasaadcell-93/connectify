-- Connectify update 2: cost prices and private notes (staff only)
-- Paste into Supabase > SQL Editor > New query, then click Run. Safe to run more than once.

alter table public.store_state drop constraint if exists store_state_key_check;
alter table public.store_state add constraint store_state_key_check
  check (key in ('ph','units','newp','content','trade','custom','priv'));

-- customers can read the store, but never the 'priv' row (costs and private notes)
drop policy if exists "everyone reads the store" on public.store_state;
create policy "everyone reads the store" on public.store_state for select to anon, authenticated
  using (key <> 'priv' or public.is_staff());

-- Check: should say "private row hidden from customers"
select case when exists (select 1 from pg_policies where tablename='store_state' and qual like '%priv%')
  then 'private row hidden from customers' else 'NOT applied' end as result;
