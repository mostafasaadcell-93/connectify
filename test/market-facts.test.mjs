import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {applyVerifiedFacts, simulatePrices} from "../market/engine.mjs";
import {
  ACTIVATIONS, LEGACY_FACT_COLUMNS, UPGRADED_FACT_COLUMNS, WARRANTY_PROVIDERS,
  factSaveNote, factWrite, factsFromRow, missingFactColumn
} from "../market/facts.mjs";

const now = "2026-10-17T12:00:00Z";
const fresh = "2026-10-17T00:00:00Z";
const identity = {
  brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver",
  warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"
};

function phone(extra = {}) {
  return {
    sku: "unit:u12", kind: "phone", title: "iPhone 17 Pro Max", price: 1542, cost: 1400,
    specs: Object.assign({}, identity, {warrantyProvider: null, activation: null}, extra.specs || {})
  };
}

function quote(extra = {}) {
  return Object.assign({
    store: "Fresh Shop", price: 1515, currency: "USD", url: "https://fresh-shop.example/p/1",
    available: true, checkedAt: fresh, status: "ok", specs: Object.assign({}, identity)
  }, extra, {specs: Object.assign({}, identity, extra.specs || {})});
}

function savedRow(extra = {}) {
  return Object.assign({
    sku: "unit:u12", warranty_years: 1, region: "us", sim: "psim", condition: "new",
    warranty_provider: "apple", activation: "inactive", verified: true
  }, extra);
}

test("migration 12 adds nullable provider and activation without backfilling or widening access", () => {
  const sql = readFileSync(new URL("../supabase/staging/12-verified-market-facts.sql", import.meta.url), "utf8");
  const ten = readFileSync(new URL("../supabase/staging/10-atomic-market-pricing.sql", import.meta.url), "utf8");
  const eleven = readFileSync(new URL("../supabase/staging/11-store-revision.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists warranty_provider text/);
  assert.match(sql, /add column if not exists activation text/);
  for (const value of WARRANTY_PROVIDERS) assert.match(sql, new RegExp("'" + value + "'"));
  for (const value of ACTIVATIONS) assert.match(sql, new RegExp("'" + value + "'"));
  assert.match(sql, /akgilfixljswqljmedmg/);
  assert.match(sql, /yxkzjwcmmtiljakttyfh/);
  assert.match(sql, /u-stage-1/);
  assert.match(sql, /C-STAGE-CONF/);
  assert.match(sql, /\{"stage-ph":\{"v":\{"0":\{"p":25,"q":4\}\}\}\}/);
  assert.match(sql, /automation_enabled is false/);
  assert.match(sql, /enabled is false/);
  assert.match(sql, /relrowsecurity is true/);
  assert.match(sql, /\(public\\\.\)\?is_staff/);
  assert.match(sql, /store_state_revision_guard/);
  assert.match(sql, /tgenabled in \('O', 'A'\)/);
  assert.match(sql, /staff read market facts/);
  assert.match(sql, /staff insert market facts/);
  assert.match(sql, /staff update market facts/);
  assert.match(sql, /staff fact policies do not enforce is_staff\(\)/);
  assert.match(sql, /anonymous write policy is present/);
  assert.match(sql, /anonymous write access is present/);
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on table public\.market_sku_facts from public, anon/);
  assert.match(sql, /new columns must stay nullable/);
  const alterAt = sql.indexOf("add column if not exists warranty_provider");
  for (const needle of ["relrowsecurity is true", "store_state_revision_guard", "tgenabled in ('O', 'A')", '{"stage-ph":{"v":{"0":{"p":25,"q":4}}}}', "staff fact policies do not enforce is_staff()"]) {
    assert.equal(sql.indexOf(needle) < alterAt, true, needle);
  }
  assert.equal(sql.indexOf("anonymous write access is present") > sql.indexOf("revoke insert, update, delete"), true);
  assert.equal(/\bgrant\s+(select|insert|update|delete|all)\b/i.test(sql), false);
  assert.equal(/disable row level security/i.test(sql), false);
  assert.equal(/enable row level security/i.test(sql), false);
  assert.equal(/exception\s+when/i.test(sql), false);
  assert.equal(/update\s+public\.market_sku_facts/i.test(sql), false);
  assert.equal(/insert\s+into\s+public\.market_sku_facts/i.test(sql), false);
  assert.equal(/update\s+public\.store_state/i.test(sql), false);
  assert.equal(/update\s+public\.orders/i.test(sql), false);
  assert.equal(/set\s+automation_enabled\s*=\s*true/i.test(sql), false);
  assert.equal(/set\s+enabled\s*=\s*true/i.test(sql), false);
  assert.equal(/set\s+verified\s*=\s*true/i.test(sql), false);
  assert.equal(sql.includes("store_state.units"), false);
  assert.equal(ten.includes("warranty_provider"), false);
  assert.equal(eleven.includes("warranty_provider"), false);
});

const silverUnit = {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900, bat: 0, note: "staging-synthetic"};
const blueUnit = {id: "u-stage-2", m: "17promax", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, bat: 0, note: "staging-synthetic"};
const phoneFixture = { "stage-ph": { v: { "0": { p: 25, q: 4 } } } };

function staffPolicies(expr = "is_staff()") {
  return [
    {name: "staff read market facts", cmd: "SELECT", roles: ["authenticated"], qual: expr, withCheck: null},
    {name: "staff insert market facts", cmd: "INSERT", roles: ["authenticated"], qual: null, withCheck: expr},
    {name: "staff update market facts", cmd: "UPDATE", roles: ["authenticated"], qual: expr, withCheck: expr}
  ];
}

function readyStaging() {
  return {
    projectRef: "akgilfixljswqljmedmg",
    commitPrice: true,
    revisionColumn: true,
    trigger: {name: "store_state_revision_guard", table: "store_state", enabled: "O"},
    units: [silverUnit, blueUnit],
    orders: [
      {code: "C-STAGE-CONF", type: "order", status: "confirmed", stockApplied: true},
      {code: "C-STAGE-NEW", type: "order", status: "new", stockApplied: false}
    ],
    ph: phoneFixture,
    automation: false,
    writes: false,
    scheduler: false,
    rls: true,
    policies: staffPolicies(),
    grants: [
      {grantee: "anon", privilege: "SELECT"},
      {grantee: "authenticated", privilege: "SELECT"},
      {grantee: "authenticated", privilege: "INSERT"},
      {grantee: "authenticated", privilege: "UPDATE"}
    ]
  };
}

function exactStaff(text) {
  return text != null && /^\s*(\(\s*)?(public\.)?is_staff\s*\(\s*\)\s*\)?\s*$/i.test(String(text));
}

function migrationGuard(state) {
  if (state.projectRef !== "akgilfixljswqljmedmg") return "project ref";
  if (!state.commitPrice) return "market_commit_price is missing";
  if (!state.revisionColumn) return "store revision is missing";
  const trigger = state.trigger;
  if (!trigger || trigger.name !== "store_state_revision_guard" || trigger.table !== "store_state" || !["O", "A"].includes(trigger.enabled)) {
    return "store_state_revision_guard is missing or disabled";
  }
  if (!Array.isArray(state.units) || state.units.length !== 2 || JSON.stringify(state.units[0]) !== JSON.stringify(silverUnit) || JSON.stringify(state.units[1]) !== JSON.stringify(blueUnit)) {
    return "unexpected or missing synthetic units";
  }
  const orders = state.orders || [];
  const confirmed = orders.find(row => row.code === "C-STAGE-CONF" && row.type === "order" && row.status === "confirmed" && row.stockApplied === true);
  const fresh = orders.find(row => row.code === "C-STAGE-NEW" && row.type === "order" && row.status === "new" && row.stockApplied === false);
  if (orders.length !== 2 || !confirmed || !fresh) return "unexpected or missing synthetic orders";
  if (JSON.stringify(state.ph) !== JSON.stringify(phoneFixture)) return "unexpected or missing synthetic phone fixture";
  if (state.automation || state.writes) return "automation or writes are enabled";
  if (state.scheduler !== false) return "scheduler is enabled or missing";
  if (state.rls !== true) return "row level security is not enabled on market_sku_facts";
  const policies = state.policies || [];
  const read = policies.find(row => row.name === "staff read market facts" && row.cmd === "SELECT" && row.roles.includes("authenticated") && exactStaff(row.qual) && row.withCheck == null);
  const insert = policies.find(row => row.name === "staff insert market facts" && row.cmd === "INSERT" && row.roles.includes("authenticated") && row.qual == null && exactStaff(row.withCheck));
  const update = policies.find(row => row.name === "staff update market facts" && row.cmd === "UPDATE" && row.roles.includes("authenticated") && exactStaff(row.qual) && exactStaff(row.withCheck));
  if (!read || !insert || !update) return "staff fact policies do not enforce is_staff()";
  if (policies.some(row => (row.qual == null && row.withCheck == null) || (row.qual != null && !exactStaff(row.qual)) || (row.withCheck != null && !exactStaff(row.withCheck)))) {
    return "a market_sku_facts policy does not enforce is_staff()";
  }
  if (policies.some(row => ["INSERT", "UPDATE", "DELETE", "ALL"].includes(row.cmd) && row.roles.some(role => role === "anon" || role === "public"))) {
    return "anonymous write policy is present";
  }
  if ((state.grants || []).some(row => ["anon", "public"].includes(row.grantee) && ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].includes(row.privilege))) {
    return "anonymous write access is present";
  }
  return "";
}

test("migration 12 guards reject missing RLS, a disabled trigger, a bad phone fixture, and a weak policy", () => {
  assert.equal(migrationGuard(readyStaging()), "");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: staffPolicies("is_staff()")})), "");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: staffPolicies("public.is_staff()")})), "");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: staffPolicies("(is_staff())")})), "");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: staffPolicies("is_staff() OR true")})), "staff fact policies do not enforce is_staff()");
  const looseExtra = staffPolicies().concat([{name: "loose", cmd: "SELECT", roles: ["authenticated"], qual: "is_staff() OR true", withCheck: null}]);
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: looseExtra})), "a market_sku_facts policy does not enforce is_staff()");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {rls: false})), "row level security is not enabled on market_sku_facts");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {trigger: {name: "store_state_revision_guard", table: "store_state", enabled: "D"}})), "store_state_revision_guard is missing or disabled");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {trigger: null})), "store_state_revision_guard is missing or disabled");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {revisionColumn: false})), "store revision is missing");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {commitPrice: false})), "market_commit_price is missing");
  const wrongPhone = {"stage-ph": {v: {"0": {p: 26, q: 4}}}};
  assert.equal(migrationGuard(Object.assign(readyStaging(), {ph: wrongPhone})), "unexpected or missing synthetic phone fixture");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {ph: {"stage-ph": {v: []}}})), "unexpected or missing synthetic phone fixture");
  const openRead = staffPolicies();
  openRead[0] = {name: "staff read market facts", cmd: "SELECT", roles: ["authenticated"], qual: "true", withCheck: null};
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: openRead})), "staff fact policies do not enforce is_staff()");
  const publicWrite = staffPolicies().concat([{name: "anon write", cmd: "INSERT", roles: ["anon"], qual: null, withCheck: "public.is_staff()"}]);
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: publicWrite})), "anonymous write policy is present");
  const wideOpen = staffPolicies().concat([{name: "public read", cmd: "SELECT", roles: ["public"], qual: "true", withCheck: null}]);
  assert.equal(migrationGuard(Object.assign(readyStaging(), {policies: wideOpen})), "a market_sku_facts policy does not enforce is_staff()");
  const anonInsert = readyStaging();
  anonInsert.grants = anonInsert.grants.concat([{grantee: "anon", privilege: "INSERT"}]);
  assert.equal(migrationGuard(anonInsert), "anonymous write access is present");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {automation: true})), "automation or writes are enabled");
  assert.equal(migrationGuard(Object.assign(readyStaging(), {scheduler: true})), "scheduler is enabled or missing");
  const changedPrice = readyStaging();
  changedPrice.units = [Object.assign({}, silverUnit, {p: 901}), blueUnit];
  assert.equal(migrationGuard(changedPrice), "unexpected or missing synthetic units");
});

test("unknown provider and activation stay null and are rejected when invalid", () => {
  const unknown = factWrite({
    sku: "unit:u12", warrantyYears: "", region: "", sim: "", condition: "",
    warrantyProvider: "", activation: "", verified: false, updatedAt: now
  }, true);
  assert.equal(unknown.body.warranty_provider, null);
  assert.equal(unknown.body.activation, null);
  assert.equal(unknown.body.verified, false);
  assert.equal(factWrite({sku: "unit:u12", warrantyProvider: "guessed"}, true).ok, false);
  assert.equal(factWrite({sku: "unit:u12", activation: "yes"}, true).ok, false);
  const row = factsFromRow({sku: "unit:u12", warranty_provider: "not-a-provider", activation: "maybe", verified: true});
  assert.equal(row.warrantyProvider, null);
  assert.equal(row.activation, null);
});

test("legacy schema keeps the old fact columns and does not claim the new fields were saved", () => {
  assert.equal(UPGRADED_FACT_COLUMNS.includes("warranty_provider"), true);
  assert.equal(LEGACY_FACT_COLUMNS.includes("warranty_provider"), false);
  assert.equal(missingFactColumn({code: "PGRST204", message: "Could not find the 'warranty_provider' column of 'market_sku_facts' in the schema cache"}), true);
  assert.equal(missingFactColumn({code: "42501", message: "permission denied"}), false);
  const legacy = factWrite({
    sku: "unit:u12", warrantyYears: 1, region: "us", sim: "psim", condition: "new",
    warrantyProvider: "apple", activation: "inactive", verified: true, verifiedAt: now, updatedAt: now
  }, false);
  assert.equal(legacy.storedUpgrade, false);
  assert.equal(legacy.requestedUpgrade, true);
  assert.equal(Object.hasOwn(legacy.body, "warranty_provider"), false);
  assert.equal(Object.hasOwn(legacy.body, "activation"), false);
  assert.equal(legacy.body.warranty_years, 1);
  assert.equal(legacy.body.region, "us");
  assert.match(factSaveNote(legacy), /were not saved/);
  assert.match(factSaveNote(legacy), /verified-facts upgrade is not installed/);
  assert.equal(factSaveNote(legacy).includes("Verified facts saved"), false);
  const untouched = factWrite({
    sku: "unit:u12", warrantyYears: 2, region: "uk", sim: "esim", condition: "open",
    warrantyProvider: "", activation: "", verified: true, verifiedAt: now, updatedAt: now
  }, false);
  assert.equal(untouched.body.warranty_years, 2);
  assert.equal(untouched.body.sim, "esim");
  assert.match(factSaveNote(untouched), /stay unknown/);
});

test("a saved provider and activation round-trip into verified matching", () => {
  const stored = factsFromRow(savedRow());
  assert.deepEqual(factsFromRow({
    warranty_years: stored.warrantyYears,
    warranty_provider: stored.warrantyProvider,
    region: stored.region,
    sim: stored.sim,
    condition: stored.condition,
    activation: stored.activation,
    verified: true
  }), stored);
  const upgraded = factWrite({
    sku: "unit:u12", warrantyYears: 1, region: "us", sim: "psim", condition: "new",
    warrantyProvider: "apple", activation: "inactive", verified: true, verifiedAt: now, updatedAt: now
  }, true);
  assert.equal(upgraded.body.warranty_provider, "apple");
  assert.equal(upgraded.body.activation, "inactive");
  assert.match(factSaveNote(upgraded), /Verified facts saved/);
  assert.equal(upgraded.body.price, undefined);
  assert.equal(upgraded.body.qty, undefined);
  assert.equal(upgraded.body.automation_enabled, undefined);
});

test("only an explicitly verified exact provider and activation can make a phone eligible", () => {
  const settings = {minMarginPct: 2, automationEnabled: true, writesEnabled: true};
  const item = phone();
  const offer = quote();
  const before = simulatePrices({catalog: [item], observations: [offer], settings, now});
  assert.equal(before.rows[0].eligibility, "Insufficient product specifications");
  assert.equal(before.rows[0].eligible, false);
  const unverified = factsFromRow(savedRow({verified: false}));
  const ignored = simulatePrices({
    catalog: [applyVerifiedFacts(item, unverified)], observations: [offer], settings, now
  });
  assert.equal(ignored.rows[0].eligible, false);
  const verified = factsFromRow(savedRow());
  const ready = simulatePrices({
    catalog: [applyVerifiedFacts(item, verified)], observations: [offer], settings, now
  });
  assert.equal(ready.rows[0].eligibility, "Eligible for review");
  assert.equal(ready.rows[0].target, 1511.97);
  assert.equal(ready.automationEnabled, false);
  assert.equal(ready.writesEnabled, false);
  assert.equal(ready.schedulerEnabled, false);
  assert.equal(ready.written, false);
  const wrongProvider = simulatePrices({
    catalog: [applyVerifiedFacts(item, factsFromRow(savedRow({warranty_provider: "seller"})))],
    observations: [offer], settings, now
  });
  assert.equal(wrongProvider.rows[0].eligible, false);
  assert.equal(wrongProvider.rows[0].target, null);
  const wrongActivation = simulatePrices({
    catalog: [applyVerifiedFacts(item, factsFromRow(savedRow({activation: "active"})))],
    observations: [offer], settings, now
  });
  assert.equal(wrongActivation.rows[0].eligible, false);
  assert.equal(wrongActivation.rows[0].target, null);
  const stated = phone({specs: {warrantyProvider: "seller", activation: null}});
  const kept = applyVerifiedFacts(stated, factsFromRow(savedRow()));
  assert.equal(kept.specs.warrantyProvider, "seller");
  assert.equal(kept.specs.activation, "inactive");
  const admin = readFileSync(new URL("../market/admin.js", import.meta.url), "utf8");
  assert.equal(admin.includes("warrantyProviderFromText"), false);
  assert.equal(admin.includes("phoneActsHTML"), false);
  assert.equal(admin.includes("cxOrderMessage"), false);
  assert.equal(admin.includes("applyStock"), false);
});
