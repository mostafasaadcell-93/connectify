import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {holdLocalStagingLock} from "./staging-db-lock.mjs";

const psql = "/usr/lib/postgresql/16/bin/psql";

function sql(database, args) {
  return execFileSync("sudo", ["-u", "postgres", psql, "-d", database, "-v", "ON_ERROR_STOP=1", ...args], {encoding: "utf8"});
}

test("local staging enforces staff decisions, read-back rows, and a disabled scheduler", async () => {
  const release = await holdLocalStagingLock();
  try {
  const databases = sql("postgres", ["-tAc", "select datname from pg_database where datname = 'connectify_staging'"]).trim();
  if (!databases) sql("postgres", ["-c", "create database connectify_staging"]);
  sql("connectify_staging", ["-f", "/workspace/test/staging-local.sql"]);
  sql("connectify_staging", ["-f", "/workspace/supabase/06-market-pricing.sql"]);
  sql("connectify_staging", ["-c", "grant select, insert, update on public.market_settings, public.market_product_flags, public.market_runs, public.market_observations, public.market_decisions, public.market_sku_facts, public.market_query_config to authenticated"]);
  sql("connectify_staging", ["-c", "grant select on public.market_settings, public.market_product_flags, public.market_runs, public.market_observations, public.market_decisions, public.market_sku_facts, public.market_query_config to anon"]);
  const output = sql("connectify_staging", ["-f", "/workspace/test/staging-checks.sql"]);
  assert.match(output, /ROLLBACK/);
  const enabled = sql("connectify_staging", ["-tAc", "select enabled::text || ',' || automation_enabled::text from public.market_query_config, public.market_settings"]).trim();
  assert.equal(enabled, "false,false");
  const price = sql("connectify_staging", ["-tAc", "select (unit->>'p') || ',' || (unit->>'qty') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u12'"]).trim();
  assert.equal(price, "1542,2");
  const order = sql("connectify_staging", ["-tAc", "select status from public.orders where code = 'C-STAGING-1'"]).trim();
  assert.equal(order, "confirmed");
  } finally {
    release();
  }
});
