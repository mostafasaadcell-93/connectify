import test from "node:test";
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const psql = "/usr/lib/postgresql/16/bin/psql";
const root = "/workspace";
const migrationPath = root + "/supabase/staging/09-approval-consumption-lock.sql";
const fixturePath = root + "/test/migration-09-fixture.sql";
const schemaPath = root + "/supabase/06-market-pricing.sql";
const db = "connectify_migration_09";
const emptyDb = "connectify_migration_09_empty";
const staffA = "11111111-1111-1111-1111-111111111111";
const staffB = "33333333-3333-3333-3333-333333333333";
const outsider = "22222222-2222-2222-2222-222222222222";
const stagingRef = "akgilfixljswqljmedmg";
const productionRef = "yxkzjwcmmtiljakttyfh";
function sql(database, args, input) {
  return execFileSync("sudo", ["-u", "postgres", psql, "-d", database, "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", ...args], {
    encoding: "utf8",
    input
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function executableSql(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(line => !/^\s*--/.test(line)).join("\n");
}

function withProjectRef(ref) {
  return ["-c", "select set_config('connectify.project_ref', '" + ref + "', false)", "-f", migrationPath];
}

function detailOf(error) {
  return String(error.stderr || error.stdout || error.message);
}

function expectError(database, args, pattern, input) {
  try {
    sql(database, args, input);
  } catch (error) {
    const detail = detailOf(error);
    assert.match(detail, pattern, detail);
    assert.equal(detail.includes("sb_publishable_"), false);
    assert.equal(detail.includes("sb_secret_"), false);
    return detail;
  }
  assert.fail("expected SQL error " + pattern);
}

function dropDatabase(name) {
  sql("postgres", ["-c", "select pg_terminate_backend(pid) from pg_stat_activity where datname = '" + name + "' and pid <> pg_backend_pid()"]);
  sql("postgres", ["-c", "drop database if exists " + name]);
}

function recreate(name) {
  dropDatabase(name);
  sql("postgres", ["-c", "create database " + name]);
}

function marker() {
  return sql(db, ["-c", "select coalesce(string_agg(prosrc, ' '), '') from pg_proc where proname = 'market_decide'"]).trim();
}

function lockTable() {
  return sql(db, ["-c", "select coalesce(to_regclass('public.market_sku_locks')::text, '')"]).trim();
}

function snapshot() {
  return {
    units: sql(db, ["-c", "select string_agg(unit->>'id' || ':' || (unit->>'c') || ':' || (unit->>'qty') || ':' || (unit->>'p') || ':' || (unit->>'note'), '|' order by unit->>'id') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units'"]).trim(),
    orders: sql(db, ["-c", "select string_agg(code || ':' || type || ':' || status || ':' || stock_applied::text, '|' order by code) from public.orders"]).trim(),
    phone: sql(db, ["-c", "select (data ? 'stage-ph')::text from public.store_state where key = 'ph'"]).trim(),
    priv: sql(db, ["-c", "select md5(data::text) from public.store_state where key = 'priv'"]).trim(),
    flags: sql(db, ["-c", "select automation_enabled::text || ',' || writes_enabled::text || ',' || (select enabled::text from public.market_query_config where id = 1) from public.market_settings where id = 1"]).trim()
  };
}

function openSession(applicationName) {
  const child = spawn("sudo", ["-u", "postgres", "/usr/bin/stdbuf", "-oL", "-eL", psql, "-d", db, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.stderr.on("data", chunk => { err += chunk; });
  const session = {
    child,
    send(text) { child.stdin.write(text.endsWith("\n") ? text : text + "\n"); },
    async until(predicate, ms) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const snapshotState = {out, err, code: child.exitCode};
        if (predicate(snapshotState)) return snapshotState;
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

test("migration 09 applies on an isolated synthetic fixture and consumes one approval", async () => {
  const migration = readFileSync(migrationPath, "utf8");
  const executable = executableSql(migration);
  assert.equal(/set_config\s*\(/i.test(executable), false);
  assert.match(migration, /cannot read the hosted project id/);
  assert.match(migration, /unexpected or missing synthetic units/);
  assert.match(migration, /unexpected or missing synthetic orders/);
  assert.match(migration, /on conflict \(sku\) do update set sku = excluded.sku/);
  assert.equal(executable.includes("delete from public.market_decisions"), false);
  assert.equal(executable.includes("update public.store_state"), false);
  assert.equal(executable.includes("update public.orders"), false);
  assert.equal(executable.includes("automation_enabled = true"), false);
  assert.equal(executable.includes("enabled = true"), false);

  let holder;
  let applyA;
  let applyB;

  recreate(emptyDb);
  recreate(db);
  try {
    expectError(emptyDb, ["-f", fixturePath], /outside connectify_migration_09/);
    expectError(emptyDb, ["-f", migrationPath], /cannot read the hosted project id/);
    expectError(emptyDb, withProjectRef(productionRef), /cannot read the hosted project id/);
    expectError(emptyDb, withProjectRef(stagingRef), /required staging tables are missing/);
    assert.equal(sql(emptyDb, ["-c", "select count(*) from pg_proc where proname = 'market_decide'"]).trim(), "0");

    sql(db, ["-f", fixturePath]);
    sql(db, ["-f", schemaPath]);
    sql(db, ["-c", "grant select on public.market_settings, public.market_product_flags, public.market_runs, public.market_observations, public.market_decisions, public.market_sku_facts, public.market_query_config to anon"]);
    sql(db, ["-c", "grant select, update on public.market_settings to authenticated"]);
    sql(db, ["-c", "grant select, insert, update on public.market_product_flags to authenticated"]);
    sql(db, ["-c", "grant select on public.market_runs to authenticated"]);
    sql(db, ["-c", "grant select, insert on public.market_observations to authenticated"]);
    sql(db, ["-c", "grant select, insert on public.market_decisions to authenticated"]);
    sql(db, ["-c", "grant select, insert, update on public.market_sku_facts to authenticated"]);
    sql(db, ["-c", "grant select, update on public.market_query_config to authenticated"]);
    const before = snapshot();
    assert.equal(before.units, "u-stage-1:Silver:2:900:staging-synthetic|u-stage-2:Deep Blue:1:910:staging-synthetic");
    assert.equal(before.orders, "C-STAGE-CONF:order:confirmed:true|C-STAGE-NEW:order:new:false");
    assert.equal(before.phone, "true");
    assert.equal(before.flags, "false,false,false");

    sql(db, ["-c", "drop table public.market_sku_locks"]);
    sql(db, ["-c", `create or replace function public.market_decide(p_sku text, p_status text, p_target numeric, p_previous numeric, p_apply_key text, p_proposal jsonb, p_mode text default 'manual') returns uuid language plpgsql as $$ begin raise exception 'pre-migration marker'; end $$`]);
    assert.match(marker(), /pre-migration marker/);
    assert.equal(lockTable(), "");

    expectError(db, ["-f", migrationPath], /cannot read the hosted project id/);
    expectError(db, withProjectRef(productionRef), /cannot read the hosted project id/);
    expectError(db, withProjectRef("other-project-ref"), /cannot read the hosted project id/);
    assert.match(marker(), /pre-migration marker/);
    assert.equal(lockTable(), "");

    sql(db, ["-c", "delete from public.orders where code = 'C-STAGE-NEW'"]);
    expectError(db, withProjectRef(stagingRef), /unexpected or missing synthetic orders/);
    sql(db, ["-f", fixturePath]);
    sql(db, ["-c", "insert into public.orders (code, type, name, phone, area, pay, status, items, stock_applied) values ('C-STAGE-EXTRA', 'order', 'Extra', '701110009', 'Beirut', 'Cash', 'new', '[]'::jsonb, false)"]);
    expectError(db, withProjectRef(stagingRef), /unexpected or missing synthetic orders/);
    sql(db, ["-c", "delete from public.orders where code = 'C-STAGE-EXTRA'"]);

    sql(db, ["-c", "update public.store_state set data = data || '[{\"id\":\"u-stage-3\",\"m\":\"17promax\",\"c\":\"Silver\",\"st\":256,\"cond\":\"new\",\"sim\":\"psim\",\"qty\":1,\"p\":900,\"bat\":0,\"note\":\"staging-synthetic\"}]'::jsonb where key = 'units'"]);
    expectError(db, withProjectRef(stagingRef), /unexpected or missing synthetic units/);
    sql(db, ["-f", fixturePath]);
    sql(db, ["-c", "update public.store_state set data = '[]'::jsonb where key = 'units'"]);
    expectError(db, withProjectRef(stagingRef), /unexpected or missing synthetic units/);
    sql(db, ["-f", fixturePath]);

    sql(db, ["-c", "update public.market_settings set automation_enabled = true where id = 1"]);
    expectError(db, withProjectRef(stagingRef), /automation or writes are enabled/);
    sql(db, ["-c", "update public.market_settings set automation_enabled = false, writes_enabled = false where id = 1"]);
    sql(db, ["-c", "delete from public.market_query_config where id = 1"]);
    expectError(db, withProjectRef(stagingRef), /scheduler is enabled or missing/);
    sql(db, ["-c", "insert into public.market_query_config (id, enabled) values (1, false)"]);
    assert.match(marker(), /pre-migration marker/);
    assert.equal(lockTable(), "");
    assert.deepEqual(snapshot(), before);

    sql(db, ["-c", "drop function public.market_decide(text, text, numeric, numeric, text, jsonb, text)"]);
    assert.equal(marker(), "");
    sql(db, withProjectRef(stagingRef));
    assert.match(marker(), /approval already used/);
    assert.equal(marker().includes("pre-migration marker"), false);
    assert.equal(lockTable(), "market_sku_locks");
    sql(db, withProjectRef(stagingRef));
    assert.equal(sql(db, ["-c", "select count(*) from pg_proc where proname = 'market_decide'"]).trim(), "1");

    const sequential = sql(db, [], `
begin;
do $check$
declare
  n int;
  decision_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '${outsider}', true);
  execute 'set local role authenticated';
  begin
    perform public.market_decide('unit:seq-09', 'approved', 890, 900, null, '{}'::jsonb, 'manual');
    raise exception 'non-staff decide was allowed';
  exception when others then
    if sqlerrm not like '%staff only%' then raise exception 'non-staff decide returned %', sqlerrm; end if;
  end;
  begin
    insert into public.market_decisions (sku, status) values ('unit:seq-09', 'approved');
    raise exception 'direct decision insert was allowed';
  exception when insufficient_privilege or check_violation then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%permission denied%' then
      raise exception 'direct decision insert returned %', sqlerrm;
    end if;
  end;
  begin
    insert into public.market_sku_locks (sku) values ('unit:seq-09');
    raise exception 'direct lock insert was allowed';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  begin
    perform public.market_decide('unit:seq-09', 'approved', 890, 900, null, '{}'::jsonb, 'manual');
    raise exception 'anon decide was allowed';
  exception when insufficient_privilege then
    null;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', '${staffA}', true);
  execute 'set local role authenticated';
  begin
    perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-missing', '{}'::jsonb, 'manual');
    raise exception 'apply without approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'apply without approval returned %', sqlerrm; end if;
  end;
  begin
    perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-auto', '{}'::jsonb, 'automatic');
    raise exception 'automatic apply was allowed';
  exception when others then
    if sqlerrm not like '%automation disabled%' then raise exception 'automatic apply returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:seq-09', 'approved', 890, 900, null, '{}'::jsonb, 'manual');
  perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-apply', '{}'::jsonb, 'manual');
  begin
    perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-apply', '{}'::jsonb, 'manual');
    raise exception 'duplicate apply was allowed';
  exception when others then
    if sqlerrm not like '%already applied%' then raise exception 'duplicate apply returned %', sqlerrm; end if;
  end;
  begin
    perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-other', '{}'::jsonb, 'manual');
    raise exception 'reused approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'reused approval returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:seq-09', 'rejected', 890, 900, null, '{}'::jsonb, 'manual');
  begin
    perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-rejected', '{}'::jsonb, 'manual');
    raise exception 'rejected approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'rejected approval returned %', sqlerrm; end if;
  end;
  perform public.market_decide('unit:seq-09', 'approved', 890, 900, null, '{}'::jsonb, 'manual');
  decision_id := public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-fresh', '{}'::jsonb, 'manual');
  if decision_id is null then raise exception 'fresh apply returned null'; end if;
  perform public.market_decide('unit:seq-09', 'restored', 900, 890, null, '{}'::jsonb, 'manual');
  begin
    perform public.market_decide('unit:seq-09', 'applied', 890, 900, 'seq-restored', '{}'::jsonb, 'manual');
    raise exception 'restored approval was allowed';
  exception when others then
    if sqlerrm not like '%not approved%' then raise exception 'restored approval returned %', sqlerrm; end if;
  end;
  select count(*) into n from public.market_decisions where sku = 'unit:seq-09' and status = 'approved';
  if n <> 2 then raise exception 'approval history changed: %', n; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:seq-09' and status = 'applied';
  if n <> 2 then raise exception 'apply history changed: %', n; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:seq-09' and status = 'rejected';
  if n <> 1 then raise exception 'rejection history changed: %', n; end if;
  select count(*) into n from public.market_decisions where sku = 'unit:seq-09' and status = 'restored';
  if n <> 1 then raise exception 'restore history changed: %', n; end if;
end
$check$;
rollback;
`);
    assert.equal(sequential.includes("ERROR"), false);
    assert.equal(sql(db, ["-c", "select count(*) from public.market_decisions"]).trim(), "0");

    const approved = sql(db, [], `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
select public.market_decide('unit:u-stage-1', 'approved', 890, 900, null, '{"sku":"unit:u-stage-1"}'::jsonb, 'manual');
commit;
`).trim().split("\n").filter(Boolean).pop();
    assert.match(approved, /^[0-9a-f-]{36}$/);
    sql(db, withProjectRef(stagingRef));
    assert.equal(sql(db, ["-c", "select count(*) from public.market_decisions where sku = 'unit:u-stage-1' and status = 'approved'"]).trim(), "1");
    assert.deepEqual(snapshot(), before);

    holder = openSession("m09-holder");
    applyA = openSession("m09-apply-a");
    applyB = openSession("m09-apply-b");
    holder.send("begin;\ninsert into public.market_sku_locks (sku) values ('unit:u-stage-1') on conflict (sku) do update set sku = excluded.sku;\nselect 'LOCK_HELD';\n");
    await holder.until(state => state.out.includes("LOCK_HELD"), 8000);

    const other = sql(db, [], `
begin;
set local statement_timeout = '3s';
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
select public.market_decide('unit:u-stage-2', 'approved', 905, 910, null, '{}'::jsonb, 'manual');
commit;
`).trim().split("\n").filter(Boolean).pop();
    assert.match(other, /^[0-9a-f-]{36}$/);

    const decide = (applyKey, staff) => `
begin;
select set_config('request.jwt.claim.sub', '${staff}', true);
set local role authenticated;
select public.market_decide('unit:u-stage-1', 'applied', 890, 900, '${applyKey}', '{}'::jsonb, 'manual');
commit;
select 'done-${applyKey}';
`;
    applyA.send(decide("stage-key-a", staffA));
    applyB.send(decide("stage-key-b", staffB));
    const started = Date.now();
    let waiting = "";
    while (Date.now() - started < 10000) {
      waiting = sql(db, ["-c", "select string_agg(application_name || '=' || coalesce(wait_event_type, 'none'), ',' order by application_name) from pg_stat_activity where datname = '" + db + "' and application_name like 'm09-apply-%'"]).trim();
      if (waiting.split(",").filter(item => item.endsWith("=Lock")).length >= 2) break;
      await sleep(50);
    }
    assert.match(waiting, /m09-apply-a=Lock/);
    assert.match(waiting, /m09-apply-b=Lock/);

    holder.send("commit;\nselect 'LOCK_RELEASED';\n");
    await holder.until(state => state.out.includes("LOCK_RELEASED"), 8000);
    const finishedA = await applyA.until(state => state.out.includes("done-stage-key-a") || state.err.includes("ERROR") || state.code !== null, 10000);
    const finishedB = await applyB.until(state => state.out.includes("done-stage-key-b") || state.err.includes("ERROR") || state.code !== null, 10000);
    const combined = finishedA.out + "\n" + finishedA.err + "\n" + finishedB.out + "\n" + finishedB.err;
    const successes = [finishedA, finishedB].filter(state => /done-stage-key-/.test(state.out) && !state.err.includes("ERROR"));
    const failures = [finishedA, finishedB].filter(state => state.err.includes("not approved"));
    assert.equal(successes.length, 1, combined);
    assert.equal(failures.length, 1, combined);

    const appliedRows = sql(db, ["-c", "select status || ':' || coalesce(apply_key, '') from public.market_decisions where sku = 'unit:u-stage-1' and status = 'applied' order by apply_key"]).trim();
    assert.match(appliedRows, /^applied:stage-key-[ab]$/);
    assert.equal(appliedRows.includes("\n"), false);
    assert.equal(sql(db, ["-c", "select count(*) from public.market_decisions where sku = 'unit:u-stage-1' and status = 'approved'"]).trim(), "1");
    assert.equal(sql(db, ["-c", "select count(*) from pg_extension where extname = 'pg_cron'"]).trim(), "0");
    expectError(db, [], /scheduler disabled/, "update public.market_query_config set enabled = true where id = 1;");
    assert.deepEqual(snapshot(), before);
  } finally {
    if (holder) {
      holder.send("rollback;\n");
      holder.close();
    }
    if (applyA) applyA.close();
    if (applyB) applyB.close();
    await sleep(200);
    dropDatabase(db);
    dropDatabase(emptyDb);
  }
});
