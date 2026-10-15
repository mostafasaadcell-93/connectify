import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {assertStagingTarget, PRODUCTION_HOST} from "./hosted-staging-check.mjs";

const psql = "/usr/lib/postgresql/16/bin/psql";
const db = "connectify_seedcheck";

function sql(database, args, input) {
  return execFileSync("sudo", ["-u", "postgres", psql, "-d", database, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    input
  });
}

function expectRefusal(match) {
  assert.throws(() => sql(db, ["-f", "/workspace/test/staging-seed-run.sql"]), error => {
    assert.match(String(error.stderr || error.message), match);
    return true;
  });
}

test("the hosted checker refuses the production project and the public fetch has no database key", () => {
  assert.throws(() => assertStagingTarget("https://" + PRODUCTION_HOST), /production/);
  assert.equal(assertStagingTarget("https://abcdefghijklmnopqrst.supabase.co"), "abcdefghijklmnopqrst.supabase.co");
  assert.throws(() => assertStagingTarget("http://abcdefghijklmnopqrst.supabase.co"), /https/);
  const fetchSource = readFileSync(new URL("../market/fetch-public.mjs", import.meta.url), "utf8");
  const checkSource = readFileSync(new URL("../supabase/functions/market-check/index.ts", import.meta.url), "utf8");
  assert.equal(fetchSource.includes(PRODUCTION_HOST), false);
  assert.equal(fetchSource.includes("service_role"), false);
  assert.equal(checkSource.includes(PRODUCTION_HOST), false);
  assert.match(checkSource, /assertCollectorTarget/);
  assert.doesNotMatch(checkSource, /from\("store_state"\)\.(update|insert|upsert|delete)/);
  assert.doesNotMatch(checkSource, /from\("orders"\)\.(update|insert|upsert|delete)/);
});

test("the synthetic seed refuses production-like data and restores only staging rows", () => {
  sql("postgres", ["-c", "drop database if exists " + db]);
  sql("postgres", ["-c", "create database " + db]);
  sql(db, [], `
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.staff (user_id uuid primary key, added_at timestamptz not null default now());
    create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.staff where user_id = auth.uid());
    $$;
    create table public.orders (
      id bigint generated always as identity primary key,
      code text not null unique check (char_length(code) between 3 and 20),
      type text not null,
      created_at timestamptz not null default now(),
      name text not null,
      phone text not null,
      area text,
      pay text,
      status text not null,
      items jsonb not null default '[]'::jsonb,
      stock_applied boolean not null default false
    );
    create table public.store_state (
      key text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    );
    grant usage on schema public to anon, authenticated;
  `);
  sql(db, ["-f", "/workspace/supabase/06-market-pricing.sql"]);

  assert.throws(() => sql(db, [], `
    select set_config('connectify.staging_project', 'connectify-staging', false);
    select set_config('connectify.project_ref', 'yxkzjwcmmtiljakttyfh', false);
    select set_config('connectify.staging_staff_email', 'staging-staff@example.com', false);
    select set_config('connectify.staging_viewer_email', 'staging-viewer@example.com', false);
    \\i /workspace/supabase/staging/07-synthetic-seed.sql
  `), error => {
    assert.match(String(error.stderr || error.message), /production id/);
    return true;
  });

  sql(db, ["-c", `
    insert into auth.users (email) values ('owner@connectify.com');
    insert into public.staff (user_id) select id from auth.users where email = 'owner@connectify.com';
    insert into public.orders (code, type, name, phone, status) values ('C-LIVE-9', 'order', 'Live Buyer', '70123456', 'confirmed');
    insert into public.store_state (key, data) values ('units', '[{"id":"u12","p":1542,"note":""}]'::jsonb);
  `]);
  expectRefusal(/does not contain staging|not staging orders|not marked staging-synthetic/);

  sql(db, ["-c", `
    delete from public.staff;
    delete from public.orders;
    delete from public.store_state;
    delete from auth.users;
    insert into auth.users (email) values ('staging-staff@example.com'), ('staging-viewer@example.com');
  `]);
  const ready = sql(db, ["-f", "/workspace/test/staging-seed-run.sql"]);
  assert.match(ready, /staging seed ready/);
  const state = sql(db, ["-tAc", "select (unit->>'p') || ',' || (unit->>'qty') || ',' || status || ',' || enabled::text || ',' || automation_enabled::text from public.store_state, lateral jsonb_array_elements(data) unit, public.orders, public.market_query_config, public.market_settings where store_state.key = 'units' and unit->>'id' = 'u-stage-1' and orders.code = 'C-STAGE-CONF' and market_query_config.id = 1 and market_settings.id = 1"]).trim();
  assert.equal(state, "900,2,confirmed,false,false");
  sql(db, ["-f", "/workspace/test/staging-seed-run.sql"]);
  assert.equal(sql(db, ["-tAc", "select count(*) from public.orders where code like 'C-STAGE-%'"]).trim(), "2");
  assert.equal(sql(db, ["-tAc", "select count(*) from public.staff s join auth.users u on u.id = s.user_id where u.email = 'staging-viewer@example.com'"]).trim(), "0");

  sql(db, ["-c", "insert into public.orders (code, type, name, phone, status) values ('C-LIVE-2', 'order', 'Live Buyer', '70123456', 'confirmed')"]);
  expectRefusal(/not staging orders/);
  assert.equal(sql(db, ["-tAc", "select (unit->>'p') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u-stage-1'"]).trim(), "900");
  sql("postgres", ["-c", "drop database " + db]);
});
