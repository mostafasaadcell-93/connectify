import test from "node:test";
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {holdLocalStagingLock} from "./staging-db-lock.mjs";

const psql = "/usr/lib/postgresql/16/bin/psql";
const root = "/workspace";
const staffA = "11111111-1111-1111-1111-111111111111";
const staffB = "33333333-3333-3333-3333-333333333333";
const outsider = "22222222-2222-2222-2222-222222222222";

function sql(database, args, input) {
  return execFileSync("sudo", ["-u", "postgres", psql, "-d", database, "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", ...args], {
    encoding: "utf8",
    input
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function openSession(applicationName) {
  const child = spawn("sudo", ["-u", "postgres", "/usr/bin/stdbuf", "-oL", "-eL", psql, "-d", "connectify_staging", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.stderr.on("data", chunk => { err += chunk; });
  const session = {
    child,
    send(text) { child.stdin.write(text.endsWith("\n") ? text : text + "\n"); },
    text() { return {out, err, code: child.exitCode}; },
    async until(predicate, ms) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const snapshot = {out, err, code: child.exitCode};
        if (predicate(snapshot)) return snapshot;
        await sleep(40);
      }
      throw new Error(applicationName + " timed out\n" + out + "\n" + err);
    },
    close() {
      try { child.stdin.end(); } catch { /* already closed */ }
    }
  };
  session.send("set application_name = '" + applicationName + "';\n");
  return session;
}

test("one manual approval cannot be applied twice at the same time", async () => {
  const release = await holdLocalStagingLock();
  try {
  const migration = readFileSync(root + "/supabase/staging/09-approval-consumption-lock.sql", "utf8");
  const executable = migration.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(line => !/^\s*--/.test(line)).join("\n");
  assert.equal(/set_config\s*\(/i.test(executable), false);
  assert.match(migration, /cannot read the hosted project id/);
  assert.match(migration, /unexpected or missing synthetic orders/);
  assert.match(migration, /unexpected or missing synthetic units/);
  assert.match(migration, /market_sku_locks/);
  assert.match(migration, /on conflict \(sku\) do update set sku = excluded.sku/);
  assert.equal(migration.includes("delete from public.market_decisions"), false);
  assert.equal(migration.includes("update public.store_state"), false);
  assert.equal(migration.includes("update public.orders"), false);
  assert.equal(migration.includes("automation_enabled = true"), false);
  assert.equal(migration.includes("enabled = true"), false);

  const databases = sql("postgres", ["-c", "select datname from pg_database where datname = 'connectify_staging'"]).trim();
  if (!databases) sql("postgres", ["-c", "create database connectify_staging"]);
  sql("connectify_staging", ["-f", root + "/test/staging-local.sql"]);
  sql("connectify_staging", ["-f", root + "/supabase/06-market-pricing.sql"]);
  sql("connectify_staging", ["-c", "grant select, insert, update on public.market_settings, public.market_product_flags, public.market_runs, public.market_observations, public.market_decisions, public.market_sku_facts, public.market_query_config to authenticated"]);
  sql("connectify_staging", ["-c", "grant select on public.market_settings, public.market_product_flags, public.market_runs, public.market_observations, public.market_decisions, public.market_sku_facts, public.market_query_config to anon"]);

  const sequential = sql("connectify_staging", [], `
begin;
do $check$
declare
  n int;
  price text;
  qty text;
  order_status text;
  decision_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '${outsider}', true);
  execute 'set local role authenticated';
  begin
    perform public.market_decide('unit:race-seq', 'approved', 10, 12, null, '{}'::jsonb, 'manual');
    raise exception 'non-staff decide was allowed';
  exception when others then
    if sqlerrm not like '%staff only%' then raise exception 'non-staff decide returned %', sqlerrm; end if;
  end;
  begin
    insert into public.market_sku_locks (sku) values ('unit:race-seq');
    raise exception 'authenticated lock insert was allowed';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', '${staffA}', true);
  execute 'set local role authenticated';
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-missing', '{}'::jsonb, 'manual');
    raise exception 'apply without approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'apply without approval returned %', sqlerrm; end if;
  end;
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-auto', '{}'::jsonb, 'automatic');
    raise exception 'automatic apply was allowed';
  exception when others then
    if sqlerrm not like '%automation disabled%' then raise exception 'automatic apply returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:race-seq', 'approved', 10, 12, null, '{}'::jsonb, 'manual');
  perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-apply', '{}'::jsonb, 'manual');
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-apply', '{}'::jsonb, 'manual');
    raise exception 'duplicate apply was allowed';
  exception when others then
    if sqlerrm not like '%already applied%' then raise exception 'duplicate apply returned %', sqlerrm; end if;
  end;
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-other', '{}'::jsonb, 'manual');
    raise exception 'changed apply key was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'changed apply key returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:race-seq', 'restored', 12, 10, null, '{}'::jsonb, 'manual');
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-stale', '{}'::jsonb, 'manual');
    raise exception 'stale approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'stale approval returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:race-seq', 'rejected', 10, 12, null, '{}'::jsonb, 'manual');
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-reject', '{}'::jsonb, 'manual');
    raise exception 'rejected approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'rejected approval returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:race-seq', 'approved', 10, 12, null, '{}'::jsonb, 'manual');
  decision_id := public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-fresh', '{}'::jsonb, 'manual');
  if decision_id is null then raise exception 'fresh apply returned null'; end if;
  begin
    perform public.market_decide('unit:race-seq', 'applied', 10, 12, 'seq-fresh-2', '{}'::jsonb, 'manual');
    raise exception 'reused fresh approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'reused fresh approval returned %', sqlerrm; end if;
  end;
  select count(*) into n from public.market_decisions where sku = 'unit:race-seq' and status = 'approved';
  if n <> 2 then raise exception 'approval history changed: %', n; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:race-seq' and status = 'applied';
  if n <> 2 then raise exception 'apply history changed: %', n; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:race-seq' and status = 'rejected';
  if n <> 1 then raise exception 'rejection history changed: %', n; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:race-seq' and status = 'restored';
  if n <> 1 then raise exception 'restore history changed: %', n; end if;
  execute 'reset role';
  select unit->>'p', unit->>'qty' into price, qty from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u12';
  if price <> '1542' or qty <> '2' then raise exception 'decision test changed the unit to % qty %', price, qty; end if;
  select status into order_status from public.orders where code = 'C-STAGING-1';
  if order_status <> 'confirmed' then raise exception 'decision test changed the order: %', order_status; end if;
end
$check$;
rollback;
`);
  assert.equal(sequential.includes("ERROR"), false);

  sql("connectify_staging", ["-c", "insert into public.staff (user_id) values ('" + staffB + "') on conflict (user_id) do nothing"]);
  sql("connectify_staging", ["-c", "delete from public.market_decisions where sku in ('unit:race-lock','unit:race-other')"]);
  sql("connectify_staging", ["-c", "delete from public.market_sku_locks where sku in ('unit:race-lock','unit:race-other')"]);
  const approved = sql("connectify_staging", [], `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
select public.market_decide('unit:race-lock', 'approved', 1511.97, 1542, null, '{"sku":"unit:race-lock"}'::jsonb, 'manual');
commit;
`).trim().split("\n").filter(Boolean).pop();
  assert.match(approved, /^[0-9a-f-]{36}$/);
  assert.notEqual(approved, staffA);

  const holder = openSession("race-holder");
  const applyA = openSession("race-apply-a");
  const applyB = openSession("race-apply-b");
  try {
    holder.send("begin;\ninsert into public.market_sku_locks (sku) values ('unit:race-lock') on conflict (sku) do update set sku = excluded.sku;\nselect 'LOCK_HELD';\n");
    await holder.until(snapshot => snapshot.out.includes("LOCK_HELD"), 8000);

    const other = sql("connectify_staging", [], `
begin;
set local statement_timeout = '3s';
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
select public.market_decide('unit:race-other', 'approved', 20, 22, null, '{}'::jsonb, 'manual');
commit;
`).trim().split("\n").filter(Boolean).pop();
    assert.match(other, /^[0-9a-f-]{36}$/);
    assert.notEqual(other, staffA);

    const decide = (skuKey, staff) => `
begin;
select set_config('request.jwt.claim.sub', '${staff}', true);
set local role authenticated;
select public.market_decide('unit:race-lock', 'applied', 1511.97, 1542, '${skuKey}', '{}'::jsonb, 'manual');
commit;
select 'done-${skuKey}';
`;
    applyA.send(decide("race-key-a", staffA));
    applyB.send(decide("race-key-b", staffB));

    const started = Date.now();
    let waiting = "";
    while (Date.now() - started < 10000) {
      waiting = sql("connectify_staging", ["-c", "select string_agg(application_name || '=' || coalesce(wait_event_type, 'none'), ',' order by application_name) from pg_stat_activity where application_name like 'race-apply-%'"]).trim();
      const locked = waiting.split(",").filter(item => item.endsWith("=Lock"));
      if (locked.length >= 2) break;
      await sleep(50);
    }
    assert.match(waiting, /race-apply-a=Lock/);
    assert.match(waiting, /race-apply-b=Lock/);

    holder.send("commit;\nselect 'LOCK_RELEASED';\n");
    await holder.until(snapshot => snapshot.out.includes("LOCK_RELEASED"), 8000);
    const finishedA = await applyA.until(snapshot => snapshot.out.includes("done-race-key-a") || snapshot.err.includes("ERROR") || snapshot.code !== null, 10000);
    const finishedB = await applyB.until(snapshot => snapshot.out.includes("done-race-key-b") || snapshot.err.includes("ERROR") || snapshot.code !== null, 10000);
    const combined = finishedA.out + "\n" + finishedA.err + "\n" + finishedB.out + "\n" + finishedB.err;
    const successes = [finishedA, finishedB].filter(snapshot => /done-race-key-/.test(snapshot.out) && !snapshot.err.includes("ERROR"));
    const failures = [finishedA, finishedB].filter(snapshot => snapshot.err.includes("not approved"));
    assert.equal(successes.length, 1, combined);
    assert.equal(failures.length, 1, combined);

    const appliedRows = sql("connectify_staging", ["-c", "select status || ':' || coalesce(apply_key, '') from public.market_decisions where sku = 'unit:race-lock' and status = 'applied' order by apply_key"]).trim();
    assert.match(appliedRows, /^applied:race-key-[ab]$/);
    assert.equal(appliedRows.includes("\n"), false);
    const history = sql("connectify_staging", ["-c", "select count(*) from public.market_decisions where sku = 'unit:race-lock' and status = 'approved'"]).trim();
    assert.equal(history, "1");
  } finally {
    holder.send("rollback;\n");
    holder.close();
    applyA.close();
    applyB.close();
    await sleep(200);
    sql("connectify_staging", ["-c", "delete from public.market_decisions where sku in ('unit:race-lock','unit:race-other')"]);
    sql("connectify_staging", ["-c", "delete from public.market_sku_locks where sku in ('unit:race-lock','unit:race-other','unit:race-seq')"]);
    sql("connectify_staging", ["-c", "delete from public.staff where user_id = '" + staffB + "'"]);
  }

  const price = sql("connectify_staging", ["-c", "select (unit->>'p') || ',' || (unit->>'qty') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u12'"]).trim();
  assert.equal(price, "1542,2");
  const order = sql("connectify_staging", ["-c", "select status from public.orders where code = 'C-STAGING-1'"]).trim();
  assert.equal(order, "confirmed");
  const flags = sql("connectify_staging", ["-c", "select enabled::text || ',' || automation_enabled::text from public.market_query_config, public.market_settings"]).trim();
  assert.equal(flags, "false,false");

  let refused = false;
  try {
    sql("connectify_staging", ["-f", root + "/supabase/staging/09-approval-consumption-lock.sql"]);
  } catch (error) {
    refused = true;
    const detail = String(error.stderr || error.stdout || error.message);
    assert.match(detail, /cannot read the hosted project id/);
    assert.equal(detail.includes("sb_publishable_"), false);
    assert.equal(detail.includes("sb_secret_"), false);
  }
  assert.equal(refused, true);
  const priceAfter = sql("connectify_staging", ["-c", "select (unit->>'p') || ',' || (unit->>'qty') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u12'"]).trim();
  assert.equal(priceAfter, "1542,2");
  } finally {
    release();
  }
});
