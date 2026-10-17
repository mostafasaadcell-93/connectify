import test from "node:test";
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const psql = "/usr/lib/postgresql/16/bin/psql";
const root = "/workspace";
const migrationPath = root + "/supabase/staging/11-store-revision.sql";
const migration10Path = root + "/supabase/staging/10-atomic-market-pricing.sql";
const fixturePath = root + "/test/migration-11-fixture.sql";
const schemaPath = root + "/supabase/06-market-pricing.sql";
const db = "connectify_migration_11";
const emptyDb = "connectify_migration_11_empty";
const staffA = "11111111-1111-1111-1111-111111111111";
const staffB = "33333333-3333-3333-3333-333333333333";
const stagingRef = "akgilfixljswqljmedmg";
const productionRef = "yxkzjwcmmtiljakttyfh";
const silverId = '{"color":"Silver","storage":"256","sim":"psim","cond":"new"}';

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

function commitFunction(text) {
  const start = text.indexOf("create or replace function public.market_commit_price");
  const end = text.indexOf("$body$;", start);
  if (start < 0 || end < 0) throw new Error("market_commit_price body missing");
  return text.slice(start, end + "$body$;".length);
}

function withProjectRef(path, ref) {
  return ["-c", "select set_config('connectify.project_ref', '" + ref + "', false)", "-f", path];
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

function staffScript(staff, statement) {
  return `
begin;
select set_config('request.jwt.claim.sub', '${staff}', true);
set local role authenticated;
${statement}
commit;
`;
}

function staffSql(staff, statement) {
  return sql(db, [], staffScript(staff, statement));
}

function staffValue(staff, statement) {
  return staffSql(staff, statement).trim().split("\n").filter(Boolean).pop();
}

function unitState() {
  return sql(db, ["-c", "select string_agg(unit->>'id' || ':' || (unit->>'c') || ':' || (unit->>'qty') || ':' || (unit->>'p') || ':' || (unit->>'note'), '|' order by unit->>'id') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units'"]).trim();
}

function phoneState() {
  return sql(db, ["-c", "select data #>> '{stage-ph,v,0,p}' || ':' || (data #>> '{stage-ph,v,0,q}') from public.store_state where key = 'ph'"]).trim();
}

function revisionOf(key) {
  return sql(db, ["-c", "select revision::text from public.store_state where key = '" + key + "'"]).trim();
}

function ordersState() {
  return sql(db, ["-c", "select string_agg(code || ':' || status || ':' || stock_applied::text, '|' order by code) from public.orders"]).trim();
}

function privState() {
  return sql(db, ["-c", "select data::text from public.store_state where key = 'priv'"]).trim();
}

function flagsState() {
  return sql(db, ["-c", "select automation_enabled::text || ',' || writes_enabled::text || ',' || (select enabled::text from public.market_query_config where id = 1) from public.market_settings where id = 1"]).trim();
}

function saveUnits(staff, revision, price, qty) {
  return `
with upd as (
  update public.store_state
  set data = (
    select jsonb_agg(
      case when unit->>'id' = 'u-stage-1'
        then jsonb_set(jsonb_set(unit, '{p}', to_jsonb(${price}::numeric)), '{qty}', to_jsonb(${qty}))
        else unit
      end
      order by unit->>'id'
    )
    from jsonb_array_elements(data) unit
  ),
  revision = revision + 1
  where key = 'units' and revision = ${revision}
  returning revision
)
select case when count(*) = 1 then 'saved:' || max(revision)::text else 'rejected' end from upd;
`;
}

function savePhone(staff, revision, price) {
  return `
with upd as (
  update public.store_state
  set data = jsonb_set(data, '{stage-ph,v,0,p}', to_jsonb(${price}::numeric), false),
      revision = revision + 1
  where key = 'ph' and revision = ${revision}
  returning revision
)
select case when count(*) = 1 then 'saved:' || max(revision)::text else 'rejected' end from upd;
`;
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
    send(text) { child.stdin.write(text.endsWith("\n") ? text : text + "\n"); },
    async until(predicate, ms) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const snapshot = {out, err, code: child.exitCode};
        if (predicate(snapshot)) return snapshot;
        await sleep(40);
      }
      throw new Error(applicationName + " timed out\n" + out + "\n" + err);
    },
    close() { try { child.stdin.end(); } catch { /* already closed */ } },
    dump() { return out + "\n" + err + "\ncode=" + child.exitCode; }
  };
  session.send("set application_name = '" + applicationName + "';\n");
  return session;
}

test("a stale staff save cannot overwrite units or ph", async () => {
  const migration = readFileSync(migrationPath, "utf8");
  const executable = executableSql(migration);
  assert.equal(/set_config\s*\(/i.test(executable), false);
  assert.match(migration, /cannot read the hosted project id/);
  assert.match(migration, /is not proof of which database this is/);
  assert.match(migration, /stale store save/);
  assert.match(executable, /revision = revision \+ 1/);
  assert.equal(executable.includes("pg_get_functiondef"), false);
  assert.match(executable, /create or replace function public\.market_commit_price/);
  const commit10 = commitFunction(readFileSync(migration10Path, "utf8"));
  const commit11 = commitFunction(migration);
  assert.equal(commit11, commit10.replace(
    "set data = new_data, updated_at = clock_timestamp()",
    "set data = new_data, updated_at = clock_timestamp(), revision = revision + 1"
  ));
  assert.equal(executable.includes("automation_enabled = true"), false);
  assert.equal(executable.includes("enabled = true"), false);
  assert.equal(executable.includes("update public.orders"), false);
  assert.match(readFileSync(root + "/test/hosted-staging-check.mjs", "utf8"), /INCOMPATIBLE WITH MIGRATION 10/);
  assert.match(readFileSync(root + "/test/hosted-market-race-check.mjs", "utf8"), /INCOMPATIBLE WITH MIGRATION 10/);

  recreate(emptyDb);
  recreate(db);
  let holder;
  let applyA;
  let applyB;
  try {
    expectError(emptyDb, ["-f", fixturePath], /outside connectify_migration_11/);
    expectError(emptyDb, ["-f", migrationPath], /cannot read the hosted project id/);
    expectError(emptyDb, withProjectRef(migrationPath, productionRef), /cannot read the hosted project id/);
    expectError(emptyDb, withProjectRef(migrationPath, stagingRef), /required staging tables are missing/);

    sql(db, ["-f", fixturePath]);
    sql(db, ["-f", schemaPath]);
    sql(db, ["-c", "grant select, update on public.market_settings to authenticated"]);
    sql(db, ["-c", "grant select, update on public.market_query_config to authenticated"]);
    sql(db, ["-c", "grant select on public.market_decisions to authenticated"]);
    expectError(db, withProjectRef(migrationPath, stagingRef), /market_commit_price is missing/);
    sql(db, withProjectRef(migration10Path, stagingRef));
    const installed = sql(db, withProjectRef(migrationPath, stagingRef));
    assert.equal(installed.includes("ERROR"), false);

    const originalUnits = unitState();
    const originalPhone = phoneState();
    const originalOrders = ordersState();
    const originalPriv = privState();
    assert.equal(originalUnits, "u-stage-1:Silver:2:900:staging-synthetic|u-stage-2:Deep Blue:1:910:staging-synthetic");
    assert.equal(originalPhone, "25:4");
    assert.equal(revisionOf("units"), "1");
    assert.equal(revisionOf("ph"), "1");
    assert.equal(flagsState(), "false,false,false");
    const def = sql(db, ["-c", "select pg_get_functiondef('public.market_commit_price(text,text,numeric,numeric,text,jsonb,jsonb)'::regprocedure)"]);
    assert.match(def, /revision = revision \+ 1/);
    assert.match(def, /search_path/);
    assert.equal(sql(db, ["-c", "select has_function_privilege('anon', 'public.market_commit_price(text,text,numeric,numeric,text,jsonb,jsonb)', 'execute')"]).trim(), "f");
    assert.equal(sql(db, ["-c", "select has_function_privilege('authenticated', 'public.market_commit_price(text,text,numeric,numeric,text,jsonb,jsonb)', 'execute')"]).trim(), "t");

    assert.equal(staffValue(staffA, saveUnits(staffA, 1, 890, 2)), "saved:2");
    assert.equal(unitState().includes("u-stage-1:Silver:2:890:"), true);
    assert.equal(staffValue(staffB, saveUnits(staffB, 1, 905, 4)), "rejected");
    assert.equal(unitState().includes("u-stage-1:Silver:2:890:"), true);
    assert.equal(revisionOf("units"), "2");
    expectError(db, [], /stale store save/, `
begin;
update public.store_state
set data = data, revision = 2
where key = 'units';
commit;
`);
    assert.equal(unitState().includes("u-stage-1:Silver:2:890:"), true);
    expectError(db, [], /stale store save/, `
begin;
insert into public.store_state (key, data)
values ('units', '[]'::jsonb)
on conflict (key) do update set data = excluded.data;
commit;
`);
    assert.equal(unitState(), "u-stage-1:Silver:2:890:staging-synthetic|u-stage-2:Deep Blue:1:910:staging-synthetic");
    assert.equal(ordersState(), originalOrders);
    assert.equal(privState(), originalPriv);

    assert.equal(staffValue(staffB, saveUnits(staffB, 2, 890, 7)), "saved:3");
    assert.equal(unitState().includes("u-stage-1:Silver:7:890:"), true);
    assert.equal(unitState().includes("u-stage-2:Deep Blue:1:910:"), true);
    staffSql(staffA, "update public.store_state set data = data where key = 'priv';");
    assert.equal(privState(), originalPriv);
    assert.equal(revisionOf("units"), "3");

    assert.equal(staffValue(staffA, savePhone(staffA, 1, 22)), "saved:2");
    assert.equal(phoneState(), "22:4");
    assert.equal(staffValue(staffB, savePhone(staffB, 1, 19)), "rejected");
    assert.equal(phoneState(), "22:4");
    assert.equal(revisionOf("ph"), "2");
    assert.equal(staffValue(staffB, savePhone(staffB, 2, 25)), "saved:3");
    assert.equal(phoneState(), originalPhone);

    sql(db, [], `
begin;
set local role anon;
update public.store_state set data = '[]'::jsonb, revision = revision + 1 where key = 'units' and revision = 3;
rollback;
`);
    assert.equal(revisionOf("units"), "3");
    assert.equal(unitState().includes(":7:890:"), true);

    const beforePrice = revisionOf("units");
    staffValue(staffA, "select public.market_decide('unit:u-stage-1', 'approved', 880, 890, null, '{}'::jsonb, 'manual');");
    const applied = staffValue(staffA, `select public.market_commit_price('unit:u-stage-1', 'apply', 880, 890, 'rev-apply', '${silverId}'::jsonb, '{}'::jsonb);`);
    assert.match(applied, /^[0-9a-f-]{36}$/);
    assert.equal(String(Number(revisionOf("units")) - Number(beforePrice)), "1");
    assert.equal(unitState().includes("u-stage-1:Silver:7:880:"), true);
    expectError(db, [], /stale store save/, staffScript(staffB, `
update public.store_state
set data = data, revision = ${beforePrice} + 1
where key = 'units';
`));
    assert.equal(unitState().includes(":7:880:"), true);
    assert.equal(ordersState(), originalOrders);
    assert.equal(privState(), originalPriv);
    assert.equal(flagsState(), "false,false,false");

    const raceRevision = revisionOf("units");
    const nextRevision = String(Number(raceRevision) + 1);
    holder = openSession("rev-holder");
    applyA = openSession("rev-a");
    applyB = openSession("rev-b");
    holder.send("begin;\nselect data from public.store_state where key = 'units' for update;\nselect 'LOCK_HELD';\n");
    await holder.until(snapshot => snapshot.out.includes("LOCK_HELD"), 8000);
    const raceSql = (staff, qty) => `
begin;
select set_config('request.jwt.claim.sub', '${staff}', true);
set local role authenticated;
with upd as (
  update public.store_state
  set data = (
    select jsonb_agg(
      case when unit->>'id' = 'u-stage-1'
        then jsonb_set(unit, '{qty}', to_jsonb(${qty}))
        else unit
      end
      order by unit->>'id'
    )
    from jsonb_array_elements(data) unit
  ),
  revision = revision + 1
  where key = 'units' and revision = ${raceRevision}
  returning revision
)
select case when count(*) = 1 then 'saved' else 'rejected' end from upd;
commit;
select 'done-${qty}';
`;
    applyA.send(raceSql(staffA, 8));
    applyB.send(raceSql(staffB, 9));
    const started = Date.now();
    let waiting = "";
    while (Date.now() - started < 10000) {
      waiting = sql(db, ["-c", "select string_agg(application_name || '=' || coalesce(wait_event_type, 'none'), ',' order by application_name) from pg_stat_activity where application_name like 'rev-%' and application_name <> 'rev-holder'"]).trim();
      const locked = waiting.split(",").filter(item => item.endsWith("=Lock"));
      if (locked.length >= 2) break;
      await sleep(50);
    }
    if (!/rev-a=Lock/.test(waiting) || !/rev-b=Lock/.test(waiting)) {
      const activity = sql(db, ["-c", "select pid || ' ' || application_name || ' ' || state || ' ' || coalesce(wait_event_type,'') || ' ' || left(query, 80) from pg_stat_activity where datname = current_database()"]).trim();
      assert.fail(waiting + "\n" + activity + "\nA " + applyA.dump() + "\nB " + applyB.dump() + "\nH " + holder.dump());
    }
    holder.send("commit;\nselect 'LOCK_RELEASED';\n");
    await holder.until(snapshot => snapshot.out.includes("LOCK_RELEASED"), 8000);
    const finishedA = await applyA.until(snapshot => snapshot.out.includes("done-8") || snapshot.err.includes("ERROR") || snapshot.code !== null, 10000);
    const finishedB = await applyB.until(snapshot => snapshot.out.includes("done-9") || snapshot.err.includes("ERROR") || snapshot.code !== null, 10000);
    const saved = [finishedA, finishedB].filter(snapshot => snapshot.out.includes("\nsaved\n") || snapshot.out.startsWith("saved\n") || /\nsaved\n/.test("\n" + snapshot.out));
    const rejected = [finishedA, finishedB].filter(snapshot => snapshot.out.includes("rejected"));
    assert.equal(saved.length, 1, finishedA.out + finishedA.err + "\n" + finishedB.out + finishedB.err);
    assert.equal(rejected.length, 1, finishedA.out + finishedA.err + "\n" + finishedB.out + finishedB.err);
    assert.equal(revisionOf("units"), nextRevision);
    assert.equal(unitState().includes(":880:"), true);
    const qty = unitState();
    assert.equal(qty.includes(":8:880:") || qty.includes(":9:880:"), true);
    assert.equal(ordersState(), originalOrders);
    assert.equal(privState(), originalPriv);
    assert.equal(flagsState(), "false,false,false");
  } finally {
    if (holder) { holder.send("rollback;\n"); holder.close(); }
    if (applyA) applyA.close();
    if (applyB) applyB.close();
    await sleep(200);
    dropDatabase(db);
    dropDatabase(emptyDb);
  }
});
