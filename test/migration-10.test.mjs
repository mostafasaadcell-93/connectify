import test from "node:test";
import assert from "node:assert/strict";
import {spawn, execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const psql = "/usr/lib/postgresql/16/bin/psql";
const root = "/workspace";
const migrationPath = root + "/supabase/staging/10-atomic-market-pricing.sql";
const fixturePath = root + "/test/migration-10-fixture.sql";
const schemaPath = root + "/supabase/06-market-pricing.sql";
const db = "connectify_migration_10";
const emptyDb = "connectify_migration_10_empty";
const staffA = "11111111-1111-1111-1111-111111111111";
const staffB = "33333333-3333-3333-3333-333333333333";
const outsider = "22222222-2222-2222-2222-222222222222";
const stagingRef = "akgilfixljswqljmedmg";
const productionRef = "yxkzjwcmmtiljakttyfh";
const silverId = '{"color":"Silver","storage":"256","sim":"psim","cond":"new"}';
const blueId = '{"color":"Deep Blue","storage":"256","sim":"psim","cond":"new"}';
const phoneId = '{"id":"stage-ph","variant":"0"}';

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
  return sql(db, ["-c", "select string_agg(unit->>'id' || ':' || (unit->>'c') || ':' || (unit->>'st') || ':' || (unit->>'sim') || ':' || (unit->>'cond') || ':' || (unit->>'qty') || ':' || (unit->>'p') || ':' || (unit->>'note') || ':' || coalesce(unit->>'bat',''), '|' order by unit->>'id') from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units'"]).trim();
}

function phoneState() {
  return sql(db, ["-c", "select data #>> '{stage-ph,v,0,p}' || ':' || (data #>> '{stage-ph,v,0,q}') from public.store_state where key = 'ph'"]).trim();
}

function ordersState() {
  return sql(db, ["-c", "select string_agg(code || ':' || status || ':' || stock_applied::text, '|' order by code) from public.orders"]).trim();
}

function flagsState() {
  return sql(db, ["-c", "select automation_enabled::text || ',' || writes_enabled::text || ',' || (select enabled::text from public.market_query_config where id = 1) from public.market_settings where id = 1"]).trim();
}

function privState() {
  return sql(db, ["-c", "select data::text from public.store_state where key = 'priv'"]).trim();
}

function appliedCount(sku) {
  return sql(db, ["-c", "select count(*) from public.market_decisions where sku = '" + sku + "' and status = 'applied'"]).trim();
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

function commitPrice(sku, action, target, previous, applyKey, identity) {
  const key = applyKey == null ? "null" : "'" + applyKey + "'";
  return `select public.market_commit_price('${sku}', '${action}', ${target}, ${previous}, ${key}, '${identity}'::jsonb, '{}'::jsonb);`;
}

test("atomic price changes commit the audit with the price and roll back together", async () => {
  const migration = readFileSync(migrationPath, "utf8");
  const executable = executableSql(migration);
  assert.equal(/set_config\s*\(/i.test(executable), false);
  assert.match(migration, /cannot read the hosted project id/);
  assert.match(migration, /is not proof of which database this is/);
  assert.match(migration, /unexpected or missing synthetic units/);
  assert.match(migration, /price changes use market_commit_price/);
  assert.match(executable, /jsonb_set/);
  assert.match(executable, /for update/);
  assert.equal(executable.includes("delete from public.market_decisions"), false);
  assert.equal(executable.includes("update public.orders"), false);
  assert.equal(executable.includes("automation_enabled = true"), false);
  assert.equal(executable.includes("enabled = true"), false);

  recreate(emptyDb);
  recreate(db);
  let holder;
  let applyA;
  let applyB;
  try {
    expectError(emptyDb, ["-f", fixturePath], /outside connectify_migration_10/);
    expectError(emptyDb, ["-f", migrationPath], /cannot read the hosted project id/);
    expectError(emptyDb, withProjectRef(productionRef), /cannot read the hosted project id/);
    expectError(emptyDb, withProjectRef(stagingRef), /required staging tables are missing/);

    sql(db, ["-f", fixturePath]);
    sql(db, ["-f", schemaPath]);
    sql(db, ["-c", "grant select, update on public.market_settings to authenticated"]);
    sql(db, ["-c", "grant select, update on public.market_query_config to authenticated"]);
    sql(db, ["-c", "grant select on public.market_decisions to authenticated"]);
    expectError(db, ["-f", migrationPath], /cannot read the hosted project id/);
    expectError(db, withProjectRef(productionRef), /cannot read the hosted project id/);
    const installed = sql(db, withProjectRef(stagingRef));
    assert.equal(installed.includes("ERROR"), false);
    const originalUnits = unitState();
    const originalPhone = phoneState();
    const originalOrders = ordersState();
    const originalPriv = privState();
    assert.equal(originalUnits, "u-stage-1:Silver:256:psim:new:2:900:staging-synthetic:0|u-stage-2:Deep Blue:256:psim:new:1:910:staging-synthetic:0");
    assert.equal(originalPhone, "25:4");
    assert.equal(originalOrders, "C-STAGE-CONF:confirmed:true|C-STAGE-NEW:new:false");
    assert.equal(flagsState(), "false,false,false");

    expectError(db, [], /permission denied/, `
begin;
set local role anon;
select public.market_commit_price('unit:u-stage-1', 'apply', 890, 900, 'anon-key', '${silverId}'::jsonb, '{}'::jsonb);
commit;
`);
    expectError(db, [], /staff only/, `
begin;
select set_config('request.jwt.claim.sub', '${outsider}', true);
set local role authenticated;
select public.market_commit_price('unit:u-stage-1', 'apply', 890, 900, 'viewer-key', '${silverId}'::jsonb, '{}'::jsonb);
commit;
`);
    expectError(db, [], /price changes use market_commit_price/, `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
select public.market_decide('unit:u-stage-1', 'applied', 890, 900, 'old-path', '{}'::jsonb, 'manual');
commit;
`);
    expectError(db, [], /price changes use market_commit_price/, `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
select public.market_decide('unit:u-stage-1', 'applied', 890, 900, 'old-auto', '{}'::jsonb, 'automatic');
commit;
`);
    expectError(db, [], /manual only/, staffScript(staffA, commitPrice("unit:u-stage-1", "automatic", 890, 900, "auto-key", silverId)));
    assert.equal(unitState(), originalUnits);
    assert.equal(appliedCount("unit:u-stage-1"), "0");
    assert.equal(flagsState(), "false,false,false");

    for (const sku of ["unit:missing", "ph:missing:0", "ph:stage-ph:3", "unit:u-stage-1:extra", "not-a-sku"]) {
      expectError(db, [], /missing sku|unknown sku/, staffScript(staffA, commitPrice(sku, "apply", 890, 900, "bad-" + sku.replace(/[^a-z0-9]/g, ""), sku.startsWith("ph:") ? phoneId : silverId)));
    }
    expectError(db, [], /not approved/, staffScript(staffA, commitPrice("unit:u-stage-1", "apply", 890, 900, "no-approval", silverId)));
    assert.equal(unitState(), originalUnits);

    staffValue(staffA, "select public.market_decide('unit:u-stage-1', 'approved', 890, 900, null, '{}'::jsonb, 'manual');");
    expectError(db, [], /stale price/, staffScript(staffA, commitPrice("unit:u-stage-1", "apply", 890, 901, "stale-key", silverId)));
    expectError(db, [], /variant changed/, staffScript(staffA, commitPrice("unit:u-stage-1", "apply", 890, 900, "variant-key", '{"color":"Gold","storage":"256","sim":"psim","cond":"new"}')));
    expectError(db, [], /not approved/, staffScript(staffA, commitPrice("unit:u-stage-1", "apply", 891, 900, "wrong-target", silverId)));
    assert.equal(appliedCount("unit:u-stage-1"), "0");
    assert.equal(unitState(), originalUnits);

    const appliedId = staffValue(staffA, commitPrice("unit:u-stage-1", "apply", 890, 900, "apply-once", silverId));
    assert.match(appliedId, /^[0-9a-f-]{36}$/);
    assert.equal(unitState(), "u-stage-1:Silver:256:psim:new:2:890:staging-synthetic:0|u-stage-2:Deep Blue:256:psim:new:1:910:staging-synthetic:0");
    assert.equal(staffValue(staffA, commitPrice("unit:u-stage-1", "apply", 890, 900, "apply-once", silverId)), appliedId);
    assert.equal(appliedCount("unit:u-stage-1"), "1");
    expectError(db, [], /not approved/, staffScript(staffA, commitPrice("unit:u-stage-1", "apply", 890, 890, "apply-other", silverId)));
    assert.equal(appliedCount("unit:u-stage-1"), "1");

    staffSql(staffA, `
update public.store_state
set data = (
  select jsonb_agg(case when unit->>'id' = 'u-stage-1' then jsonb_set(unit, '{qty}', to_jsonb(7)) else unit end)
  from jsonb_array_elements(data) unit
)
where key = 'units';
`);
    assert.equal(unitState().includes("u-stage-1:Silver:256:psim:new:7:890:"), true);
    staffSql(staffA, `
update public.store_state
set data = (
  select jsonb_agg(case when unit->>'id' = 'u-stage-1' then jsonb_set(unit, '{qty}', to_jsonb(2)) else unit end)
  from jsonb_array_elements(data) unit
)
where key = 'units';
`);
    assert.equal(unitState().includes(":2:890:"), true);

    const beforeOverwrite = appliedCount("unit:u-stage-1");
    expectError(db, [], /rollback overwrite/, `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
update public.store_state
set data = (
  select jsonb_agg(case when unit->>'id' = 'u-stage-1' then jsonb_set(unit, '{p}', to_jsonb(901)) else unit end)
  from jsonb_array_elements(data) unit
)
where key = 'units';
do $check$
declare price text; audits int;
begin
  select unit->>'p' into price from public.store_state, lateral jsonb_array_elements(data) unit where key = 'units' and unit->>'id' = 'u-stage-1';
  select count(*) into audits from public.market_decisions where sku = 'unit:u-stage-1' and status = 'applied';
  if price is distinct from '901' or audits::text is distinct from '${beforeOverwrite}' then
    raise exception 'overwrite was not visible: % audits %', price, audits;
  end if;
  raise exception 'rollback overwrite';
end
$check$;
rollback;
`);
    assert.equal(unitState().includes(":2:890:"), true);

    const restoredId = staffValue(staffA, commitPrice("unit:u-stage-1", "restore", 900, 890, null, silverId));
    assert.match(restoredId, /^[0-9a-f-]{36}$/);
    assert.equal(unitState(), originalUnits);
    assert.equal(staffValue(staffA, commitPrice("unit:u-stage-1", "restore", 900, 890, null, silverId)), restoredId);
    expectError(db, [], /already restored/, staffScript(staffA, commitPrice("unit:u-stage-1", "restore", 910, 900, null, silverId)));
    expectError(db, [], /not approved/, staffScript(staffA, commitPrice("unit:u-stage-1", "apply", 890, 900, "after-restore", silverId)));
    assert.equal(unitState(), originalUnits);

    staffValue(staffA, "select public.market_decide('unit:u-stage-2', 'approved', 905, 910, null, '{}'::jsonb, 'manual');");
    sql(db, ["-c", `
create or replace function public.market_fail_audit() returns trigger language plpgsql as $$
begin
  if new.apply_key = 'fail-audit' then raise exception 'audit failed'; end if;
  return new;
end $$;
create trigger market_fail_audit before insert on public.market_decisions
for each row execute function public.market_fail_audit();
`]);
    expectError(db, [], /audit failed/, staffScript(staffA, commitPrice("unit:u-stage-2", "apply", 905, 910, "fail-audit", blueId)));
    sql(db, ["-c", "drop trigger market_fail_audit on public.market_decisions; drop function public.market_fail_audit();"]);
    assert.equal(unitState(), originalUnits);
    assert.equal(appliedCount("unit:u-stage-2"), "0");
    const blueIdApplied = staffValue(staffA, commitPrice("unit:u-stage-2", "apply", 905, 910, "blue-once", blueId));
    assert.match(blueIdApplied, /^[0-9a-f-]{36}$/);
    assert.equal(unitState().includes("u-stage-2:Deep Blue:256:psim:new:1:905:"), true);
    assert.equal(unitState().includes("u-stage-1:Silver:256:psim:new:2:900:"), true);
    staffValue(staffA, commitPrice("unit:u-stage-2", "restore", 910, 905, null, blueId));
    assert.equal(unitState(), originalUnits);

    staffValue(staffA, "select public.market_decide('ph:stage-ph:0', 'approved', 22, 25, null, '{}'::jsonb, 'manual');");
    const phoneApplied = staffValue(staffA, commitPrice("ph:stage-ph:0", "apply", 22, 25, "phone-once", phoneId));
    assert.match(phoneApplied, /^[0-9a-f-]{36}$/);
    assert.equal(phoneState(), "22:4");
    assert.equal(unitState(), originalUnits);
    staffValue(staffA, commitPrice("ph:stage-ph:0", "restore", 25, 22, null, phoneId));
    assert.equal(phoneState(), originalPhone);
    expectError(db, [], /variant changed/, staffScript(staffA, commitPrice("ph:stage-ph:0", "apply", 22, 25, "phone-mismatch", '{"id":"other","variant":"0"}')));

    expectError(db, [], /ambiguous sku/, `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
update public.store_state
set data = data || (select jsonb_agg(unit) from jsonb_array_elements(data) unit where unit->>'id' = 'u-stage-1')
where key = 'units';
select public.market_commit_price('unit:u-stage-1', 'apply', 890, 900, 'ambiguous', '${silverId}'::jsonb, '{}'::jsonb);
commit;
`);
    assert.equal(unitState(), originalUnits);

    staffSql(staffA, `
update public.store_state
set data = (
  select jsonb_agg(case when unit->>'id' = 'u-stage-1' then jsonb_set(unit, '{qty}', to_jsonb(7)) else unit end)
  from jsonb_array_elements(data) unit
)
where key = 'units';
`);
    staffValue(staffA, "select public.market_decide('unit:u-stage-1', 'approved', 890, 900, null, '{}'::jsonb, 'manual');");
    const keptQty = staffValue(staffA, commitPrice("unit:u-stage-1", "apply", 890, 900, "keep-qty", silverId));
    assert.match(keptQty, /^[0-9a-f-]{36}$/);
    assert.equal(unitState().includes("u-stage-1:Silver:256:psim:new:7:890:"), true);
    staffValue(staffA, commitPrice("unit:u-stage-1", "restore", 900, 890, null, silverId));
    staffSql(staffA, `
update public.store_state
set data = (
  select jsonb_agg(case when unit->>'id' = 'u-stage-1' then jsonb_set(unit, '{qty}', to_jsonb(2)) else unit end)
  from jsonb_array_elements(data) unit
)
where key = 'units';
`);
    assert.equal(unitState(), originalUnits);

    expectError(db, [], /automation disabled/, `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
update public.market_settings set writes_enabled = true where id = 1;
set local role authenticated;
select public.market_commit_price('unit:u-stage-1', 'apply', 890, 900, 'while-enabled', '${silverId}'::jsonb, '{}'::jsonb);
commit;
`);
    expectError(db, [], /scheduler disabled/, `
begin;
select set_config('request.jwt.claim.sub', '${staffA}', true);
set local role authenticated;
update public.market_query_config set enabled = true where id = 1;
commit;
`);
    assert.equal(flagsState(), "false,false,false");

    sql(db, ["-c", `
drop policy if exists "anyone can place an order" on public.orders;
create policy "anyone can place an order" on public.orders for insert to anon, authenticated
  with check (status = 'new' and stock_applied = false);
`]);
    sql(db, [], `
begin;
set local role anon;
insert into public.orders (code, type, name, phone, status, items, stock_applied)
values ('C-STAGE-TMP', 'order', 'Checkout', '701110009', 'new', '[]'::jsonb, false);
rollback;
`);
    assert.equal(ordersState(), originalOrders);

    staffValue(staffA, "select public.market_decide('unit:u-stage-1', 'approved', 890, 900, null, '{}'::jsonb, 'manual');");
    const beforeRace = appliedCount("unit:u-stage-1");
    holder = openSession("price-holder");
    applyA = openSession("price-apply-a");
    applyB = openSession("price-apply-b");
    holder.send("begin;\ninsert into public.market_sku_locks (sku) values ('unit:u-stage-1') on conflict (sku) do update set sku = excluded.sku;\nselect 'LOCK_HELD';\n");
    await holder.until(snapshot => snapshot.out.includes("LOCK_HELD"), 8000);
    const decide = (applyKey, staff) => `
begin;
select set_config('request.jwt.claim.sub', '${staff}', true);
set local role authenticated;
select public.market_commit_price('unit:u-stage-1', 'apply', 890, 900, '${applyKey}', '${silverId}'::jsonb, '{}'::jsonb);
commit;
select 'done-${applyKey}';
`;
    applyA.send(decide("race-key-a", staffA));
    applyB.send(decide("race-key-b", staffB));
    const started = Date.now();
    let waiting = "";
    while (Date.now() - started < 10000) {
      waiting = sql(db, ["-c", "select string_agg(application_name || '=' || coalesce(wait_event_type, 'none'), ',' order by application_name) from pg_stat_activity where application_name like 'price-apply-%'"]).trim();
      const locked = waiting.split(",").filter(item => item.endsWith("=Lock"));
      if (locked.length >= 2) break;
      await sleep(50);
    }
    assert.match(waiting, /price-apply-a=Lock/, waiting);
    assert.match(waiting, /price-apply-b=Lock/, waiting);
    holder.send("commit;\nselect 'LOCK_RELEASED';\n");
    await holder.until(snapshot => snapshot.out.includes("LOCK_RELEASED"), 8000);
    const finishedA = await applyA.until(snapshot => snapshot.out.includes("done-race-key-a") || snapshot.err.includes("ERROR") || snapshot.code !== null, 10000);
    const finishedB = await applyB.until(snapshot => snapshot.out.includes("done-race-key-b") || snapshot.err.includes("ERROR") || snapshot.code !== null, 10000);
    const successes = [finishedA, finishedB].filter(snapshot => /done-race-key-/.test(snapshot.out) && !snapshot.err.includes("ERROR"));
    const failures = [finishedA, finishedB].filter(snapshot => /not approved|stale price/.test(snapshot.err));
    assert.equal(successes.length, 1, finishedA.out + finishedA.err + finishedB.out + finishedB.err);
    assert.equal(failures.length, 1, finishedA.out + finishedA.err + finishedB.out + finishedB.err);
    assert.equal(String(Number(appliedCount("unit:u-stage-1")) - Number(beforeRace)), "1");
    assert.equal(unitState().includes("u-stage-1:Silver:256:psim:new:2:890:"), true);
    assert.equal(unitState().includes("u-stage-2:Deep Blue:256:psim:new:1:910:"), true);
    staffValue(staffA, commitPrice("unit:u-stage-1", "restore", 900, 890, null, silverId));

    assert.equal(unitState(), originalUnits);
    assert.equal(phoneState(), originalPhone);
    assert.equal(ordersState(), originalOrders);
    assert.equal(privState(), originalPriv);
    assert.equal(flagsState(), "false,false,false");
    const approvedHistory = sql(db, ["-c", "select count(*) from public.market_decisions where sku = 'unit:u-stage-1' and status = 'approved'"]).trim();
    assert.equal(Number(approvedHistory) >= 2, true);
  } finally {
    if (holder) { holder.send("rollback;\n"); holder.close(); }
    if (applyA) applyA.close();
    if (applyB) applyB.close();
    await sleep(200);
    dropDatabase(db);
    dropDatabase(emptyDb);
  }
});
