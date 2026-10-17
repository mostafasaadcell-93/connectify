/* Staging readiness check for migrations 10 and 11.

   Accepts only https://akgilfixljswqljmedmg.supabase.co.
   Refuses the production project yxkzjwcmmtiljakttyfh.
   Uses the anon or publishable key and one staging staff password.
   Does not read a service-role key.

   The default run is read-only. It checks the synthetic fixtures, whether
   market_commit_price and store_state.revision are visible, staff permission,
   and that automation, writes, and the scheduler are off.

   Stored rows are read again after every write. An HTTP status is not proof.
   Write checks run only when STAGING_SYNTHETIC_WRITE_CHECK is exactly
   apply-and-restore. They touch only synthetic unit u-stage-1, between 900
   and 890, and then restore 900. They do not delete audit rows or rerun the seed.

   Windows PowerShell, from the Connectify repo, after review:

     git checkout cursor/market-pricing-7fc1
     $env:STAGING_SUPABASE_URL='https://akgilfixljswqljmedmg.supabase.co'
     $env:STAGING_ANON_KEY='the anon or publishable key'
     $env:STAGING_STAFF_EMAIL='the staging staff email'
     $env:STAGING_STAFF_PASSWORD='the staging staff password'
     node test/hosted-migration-readiness.mjs

   Add the write opt-in only for the separate synthetic apply and restore:

     $env:STAGING_SYNTHETIC_WRITE_CHECK='apply-and-restore'
*/

import {randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {PRODUCTION_HOST} from "./hosted-staging-check.mjs";

export const STAGING_HOST = "akgilfixljswqljmedmg.supabase.co";
export const STAGING_ORIGIN = "https://" + STAGING_HOST;
export const PRODUCTION_REF = "yxkzjwcmmtiljakttyfh";
export const WRITE_OPT_IN = "apply-and-restore";
export const RECOVERY_TEXT = [
  "Synthetic staging recovery, for review only.",
  "Do not run this on production.",
  "Do not DELETE from market_decisions.",
  "Do not rerun the synthetic seed.",
  "Do not PATCH store_state to change a price.",
  "If u-stage-1 is at 890 and the latest applied market_decisions row for sku unit:u-stage-1 has target 890 and previous 900, sign in as staging staff and call market_commit_price with action restore, sku unit:u-stage-1, target 900, previous 890, and identity {\"color\":\"Silver\",\"storage\":\"256\",\"sim\":\"psim\",\"cond\":\"new\"}.",
  "Read store_state again and confirm u-stage-1 price 900 quantity 2, and u-stage-2 price 910 quantity 1.",
  "Confirm orders C-STAGE-CONF and C-STAGE-NEW are unchanged, and that automation, writes, and the scheduler are still disabled.",
  "If the silver price changed and there is no matching applied or restored audit row, stop. The price and the audit have diverged. Do not write again."
].join(" ");

export const SILVER = {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900, bat: 0, note: "staging-synthetic"};
export const BLUE = {id: "u-stage-2", m: "17promax", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, bat: 0, note: "staging-synthetic"};
export const SILVER_IDENTITY = {color: "Silver", storage: "256", sim: "psim", cond: "new"};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ONLY = new Set([
  "GET /rest/v1/",
  "GET /rest/v1/store_state",
  "GET /rest/v1/orders",
  "GET /rest/v1/market_settings",
  "GET /rest/v1/market_query_config",
  "GET /rest/v1/market_decisions",
  "POST /auth/v1/token",
  "POST /rest/v1/rpc/is_staff"
]);

function fail(message) {
  const error = new Error(message);
  error.code = "READINESS";
  return error;
}

export function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets || []) {
    const value = String(secret || "");
    if (value.length >= 6) out = out.split(value).join("[redacted]");
  }
  return out;
}

function jwtRole(key) {
  if (!key.startsWith("eyJ")) return "";
  const part = key.split(".")[1];
  if (!part) return "unreadable";
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return json && json.role ? String(json.role) : "";
  } catch {
    return "unreadable";
  }
}

export function assertReadyTarget(url) {
  const raw = String(url || "").trim();
  if (raw.toLowerCase().includes(PRODUCTION_REF) || raw.includes(PRODUCTION_HOST)) {
    throw fail("refusing production Supabase project");
  }
  let parsed;
  try { parsed = new URL(raw); } catch { throw fail("staging URL is not a URL"); }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.protocol !== "https:" || parsed.host !== STAGING_HOST) {
    throw fail("refusing every host except " + STAGING_ORIGIN);
  }
  return STAGING_ORIGIN;
}

export function assertPublishableKey(key) {
  const value = String(key || "").trim();
  const folded = value.toLowerCase();
  if (!value) throw fail("missing staging anon key");
  if (folded.includes(PRODUCTION_REF)) throw fail("refusing a key that names the production project");
  const role = jwtRole(value).toLowerCase();
  if (folded.startsWith("sb_secret_") || folded.includes("service_role") || folded.includes("supabase_admin")) {
    throw fail("refusing a secret or service-role key");
  }
  if (role && role !== "anon") throw fail("refusing a key that is not the anon or publishable key");
  return value;
}

export function assertStaffEmail(email) {
  const value = String(email || "").trim();
  if (!value.toLowerCase().includes("staging") || value.includes(PRODUCTION_REF)) {
    throw fail("staff email must contain staging");
  }
  return value;
}

export function readinessConfig(env) {
  const source = env || {};
  const origin = assertReadyTarget(source.STAGING_SUPABASE_URL);
  const anon = assertPublishableKey(source.STAGING_ANON_KEY);
  const email = assertStaffEmail(source.STAGING_STAFF_EMAIL);
  const password = String(source.STAGING_STAFF_PASSWORD || "");
  if (!password) throw fail("missing STAGING_STAFF_PASSWORD");
  const writeFlag = source.STAGING_SYNTHETIC_WRITE_CHECK;
  if (writeFlag != null && writeFlag !== "" && writeFlag !== WRITE_OPT_IN) {
    throw fail("refusing write check: STAGING_SYNTHETIC_WRITE_CHECK must be exactly " + WRITE_OPT_IN);
  }
  return {origin, anon, email, password, write: writeFlag === WRITE_OPT_IN};
}

export function sameUnit(found, expected) {
  if (!found || typeof found !== "object") return false;
  const foundKeys = Object.keys(found).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (foundKeys.join() !== expectedKeys.join()) return false;
  return expectedKeys.every(key => String(found[key]) === String(expected[key]));
}

function unit(data, id) {
  return (Array.isArray(data) ? data : []).find(item => item && item.id === id) || null;
}

export function assertCompatibilitySpec(body) {
  if (!body || typeof body !== "object") throw fail("market_commit_price is not installed");
  const paths = body.paths || {};
  const found = Object.keys(paths).some(path => path.replace(/\/$/, "") === "/rpc/market_commit_price");
  if (!found) throw fail("market_commit_price is not installed");
  const schemas = Object.assign({}, body.definitions, body.components && body.components.schemas);
  const visible = Object.values(schemas).some(schema => {
    const properties = schema && schema.properties;
    return properties && properties.key && properties.data && properties.revision;
  });
  if (!visible) throw fail("store_state.revision is not installed");
}

function messageOf(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  return String(body.message || body.error_description || body.error || "");
}

function decisionId(body) {
  const value = typeof body === "string" ? body.trim() : "";
  return UUID.test(value) ? value : "";
}

function summaryOf(checks) {
  return checks.map(item => (item.ok ? "pass " : "fail ") + item.name + (item.message ? ": " + item.message : "")).join("; ");
}

function assertAllowed(ctx, method, url, body) {
  let parsed;
  try { parsed = new URL(url); } catch { throw fail("refusing a request that is not the hosted staging project"); }
  if (parsed.protocol !== "https:" || parsed.host !== STAGING_HOST) throw fail("refusing a request that is not the hosted staging project");
  const key = String(method || "GET").toUpperCase() + " " + parsed.pathname;
  if (!READ_ONLY.has(key) && !ctx.writesArmed) throw fail("refusing " + key + " before the write opt-in");
  if (!READ_ONLY.has(key)) {
    if (key === "POST /rest/v1/rpc/market_decide") {
      if (!body || body.p_status !== "approved" || body.p_sku !== "unit:u-stage-1" || Number(body.p_target) !== 890 || Number(body.p_previous) !== 900) {
        throw fail("refusing a decision that is not the synthetic approval");
      }
    } else if (key === "POST /rest/v1/rpc/market_commit_price") {
      const apply = body && body.p_action === "apply" && Number(body.p_target) === 890 && Number(body.p_previous) === 900;
      const restore = body && body.p_action === "restore" && Number(body.p_target) === 900 && Number(body.p_previous) === 890;
      if (!body || body.p_sku !== "unit:u-stage-1" || (!apply && !restore)) {
        throw fail("refusing a price commit outside the synthetic silver unit");
      }
    } else if (key === "PATCH /rest/v1/store_state") {
      assertProbe(parsed, body);
    } else {
      throw fail("refusing " + key);
    }
  }
}

function assertProbe(parsed, body) {
  const silver = body && Array.isArray(body.data) ? body.data.find(item => item && item.id === "u-stage-1") : null;
  const blue = body && Array.isArray(body.data) ? body.data.find(item => item && item.id === "u-stage-2") : null;
  const revision = body ? Number(body.revision) : NaN;
  if (!silver || !blue || body.data.length !== 2 || !Number.isInteger(revision)) {
    throw fail("refusing a store write that is not the stale revision probe");
  }
  if (![890, 900].includes(Number(silver.p)) || Number(silver.qty) !== 2 || Number(blue.p) !== 910 || Number(blue.qty) !== 1) {
    throw fail("refusing a store write that changes a synthetic price or quantity");
  }
  if (parsed.searchParams.get("key") !== "eq.units" || parsed.searchParams.get("revision") !== "eq." + revision) {
    throw fail("refusing a store write that is not the stale revision probe");
  }
}

async function request(ctx, method, path, body, extra) {
  const url = ctx.cfg.origin + path;
  assertAllowed(ctx, method, url, body);
  const response = await ctx.fetchImpl(url, {
    method,
    headers: Object.assign({
      apikey: ctx.cfg.anon,
      authorization: "Bearer " + (ctx.token || ctx.cfg.anon),
      "content-type": "application/json"
    }, extra || {}),
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return {status: response.status, body: parsed};
}

async function check(checks, name, fn) {
  try {
    const value = await fn();
    checks.push({name, ok: true});
    return value;
  } catch (error) {
    checks.push({name, ok: false, message: error && error.message ? error.message : String(error)});
    return null;
  }
}

function assertOriginalUnits(data) {
  if (!Array.isArray(data) || data.length !== 2 || !sameUnit(unit(data, "u-stage-1"), SILVER) || !sameUnit(unit(data, "u-stage-2"), BLUE)) {
    throw fail("synthetic inventory is not the expected fixture");
  }
}

function assertPhone(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).join() !== "stage-ph") {
    throw fail("synthetic phone fixture is missing");
  }
  const variant = data["stage-ph"] && Array.isArray(data["stage-ph"].v) ? data["stage-ph"].v[0] : null;
  if (!variant || Number(variant.p) !== 25 || Number(variant.q) !== 4) throw fail("synthetic phone fixture is missing");
}

function assertOrders(rows) {
  if (!Array.isArray(rows) || rows.length !== 2) throw fail("synthetic orders are not the expected fixture");
  const confirmed = rows.find(row => row && row.code === "C-STAGE-CONF");
  const fresh = rows.find(row => row && row.code === "C-STAGE-NEW");
  if (!confirmed || confirmed.status !== "confirmed" || confirmed.stock_applied !== true) throw fail("synthetic orders are not the expected fixture");
  if (!fresh || fresh.status !== "new" || fresh.stock_applied !== false) throw fail("synthetic orders are not the expected fixture");
}

function assertFlags(settings, config) {
  const setting = Array.isArray(settings) ? settings[0] : null;
  const query = Array.isArray(config) ? config[0] : null;
  if (!setting || settings.length !== 1 || setting.automation_enabled !== false || setting.writes_enabled !== false) {
    throw fail("automatic pricing or writes are enabled");
  }
  if (!query || config.length !== 1 || query.enabled !== false) throw fail("the scheduler is enabled");
}

function revisionOf(row) {
  const value = Number(row && row.revision);
  if (!Number.isInteger(value) || value < 1) throw fail("store_state.revision is not installed");
  return value;
}

async function readOnlyPreflight(ctx) {
  const checks = [];
  const units = await check(checks, "synthetic fixtures", async () => {
    const result = await request(ctx, "GET", "/rest/v1/store_state?key=eq.units&select=key,data");
    if (result.status !== 200 || !Array.isArray(result.body) || !result.body[0]) throw fail("units read failed (" + result.status + ")");
    assertOriginalUnits(result.body[0].data);
    return result.body[0].data;
  });
  await check(checks, "synthetic phone", async () => {
    const result = await request(ctx, "GET", "/rest/v1/store_state?key=eq.ph&select=key,data");
    if (result.status !== 200 || !Array.isArray(result.body) || !result.body[0]) throw fail("phone read failed (" + result.status + ")");
    assertPhone(result.body[0].data);
  });
  await check(checks, "synthetic orders", async () => {
    const result = await request(ctx, "GET", "/rest/v1/orders?select=code,status,stock_applied&order=code.asc");
    if (result.status !== 200) throw fail("orders read failed (" + result.status + ")");
    assertOrders(result.body);
  });
  await check(checks, "disabled automation", async () => {
    const settings = await request(ctx, "GET", "/rest/v1/market_settings?id=eq.1&select=automation_enabled,writes_enabled");
    const config = await request(ctx, "GET", "/rest/v1/market_query_config?id=eq.1&select=enabled");
    if (settings.status !== 200 || config.status !== 200) throw fail("settings read failed");
    assertFlags(settings.body, config.body);
  });
  await check(checks, "anonymous private costs", async () => {
    const result = await request(ctx, "GET", "/rest/v1/store_state?key=eq.priv&select=key");
    if (result.status === 401 || result.status === 403) return;
    if (result.status !== 200 || !Array.isArray(result.body) || result.body.length !== 0) throw fail("anonymous client can see private costs");
  });
  const revisions = await check(checks, "revisions", async () => {
    const rows = await request(ctx, "GET", "/rest/v1/store_state?key=in.(units,ph)&select=key,revision");
    if (rows.status !== 200 || !Array.isArray(rows.body)) throw fail("store_state.revision is not installed");
    const unitsRow = rows.body.find(row => row.key === "units");
    const phoneRow = rows.body.find(row => row.key === "ph");
    return {units: revisionOf(unitsRow), ph: revisionOf(phoneRow)};
  });
  await check(checks, "migration compatibility", async () => {
    const result = await request(ctx, "GET", "/rest/v1/", null, {accept: "application/openapi+json"});
    if (result.status !== 200) throw fail("market_commit_price is not installed");
    assertCompatibilitySpec(result.body);
  });
  const fixtureOk = checks.filter(item => ["synthetic fixtures", "synthetic phone", "synthetic orders", "disabled automation"].includes(item.name)).every(item => item.ok);
  if (fixtureOk) {
    await check(checks, "anonymous staff permission", async () => {
      const result = await request(ctx, "POST", "/rest/v1/rpc/is_staff", {});
      if (result.body === true) throw fail("anonymous client is staff");
      if (result.status < 400 && result.body !== false) throw fail("anonymous staff check was not rejected");
    });
    await check(checks, "staff permission", async () => {
      const signIn = await request(ctx, "POST", "/auth/v1/token?grant_type=password", {
        email: ctx.cfg.email,
        password: ctx.cfg.password
      });
      if (signIn.status !== 200 || !signIn.body || !signIn.body.access_token) throw fail("staff sign-in was rejected (" + signIn.status + ")");
      ctx.token = signIn.body.access_token;
      const staff = await request(ctx, "POST", "/rest/v1/rpc/is_staff", {});
      if (staff.body !== true) throw fail("staff authorization was rejected");
      const again = await request(ctx, "GET", "/rest/v1/store_state?key=eq.units&select=key,data");
      if (again.status !== 200 || !again.body[0]) throw fail("staff read did not match the synthetic inventory");
      assertOriginalUnits(again.body[0].data);
    });
  }
  if (checks.some(item => !item.ok)) throw fail(summaryOf(checks));
  return {checks: checks.map(item => item.name), revisions};
}

function silverAt(data, price) {
  const expected = Object.assign({}, SILVER, {p: price});
  if (!sameUnit(unit(data, "u-stage-1"), expected) || !sameUnit(unit(data, "u-stage-2"), BLUE)) {
    throw fail("stored inventory did not match the synthetic read-back. " + RECOVERY_TEXT);
  }
}

async function readUnits(ctx) {
  const result = await request(ctx, "GET", "/rest/v1/store_state?key=eq.units&select=key,data,revision");
  if (result.status !== 200 || !Array.isArray(result.body) || !result.body[0]) throw fail("units read-back failed (" + result.status + "). " + RECOVERY_TEXT);
  return {data: result.body[0].data, revision: revisionOf(result.body[0])};
}

async function readDecisions(ctx) {
  const result = await request(ctx, "GET", "/rest/v1/market_decisions?sku=eq.unit:u-stage-1&select=id,sku,status,target_price,previous_price,apply_key&order=created_at.desc&limit=100");
  if (result.status === 401 || result.status === 403) throw fail("audit read was blocked. " + RECOVERY_TEXT);
  if (result.status !== 200 || !Array.isArray(result.body)) throw fail("audit read failed (" + result.status + "). " + RECOVERY_TEXT);
  if (result.body.length >= 100) throw fail("audit history for the synthetic sku is too large to verify. No audit rows were deleted. " + RECOVERY_TEXT);
  return result.body;
}

async function requireNewDecision(ctx, beforeIds, rpc, predicate, label) {
  const created = (await readDecisions(ctx)).filter(row => predicate(row) && !beforeIds.has(String(row.id)));
  if (created.length !== 1) {
    throw fail(label + " was not stored. HTTP " + rpc.status + " is not proof. " + RECOVERY_TEXT);
  }
  const id = decisionId(rpc.body);
  if (id && id !== String(created[0].id)) {
    throw fail(label + " read-back did not match the response. HTTP " + rpc.status + " is not proof. " + RECOVERY_TEXT);
  }
  return created[0];
}

async function commit(ctx, action, target, previous, applyKey) {
  return request(ctx, "POST", "/rest/v1/rpc/market_commit_price", {
    p_sku: "unit:u-stage-1",
    p_action: action,
    p_target: target,
    p_previous: previous,
    p_apply_key: applyKey,
    p_identity: SILVER_IDENTITY,
    p_proposal: {}
  });
}

async function recoverSilver(ctx) {
  const stored = await readUnits(ctx);
  if (sameUnit(unit(stored.data, "u-stage-1"), SILVER) && sameUnit(unit(stored.data, "u-stage-2"), BLUE)) return {ok: true};
  const silver = unit(stored.data, "u-stage-1");
  if (!silver || Number(silver.p) !== 890 || Number(silver.qty) !== 2 || !sameUnit(unit(stored.data, "u-stage-2"), BLUE)) {
    return {ok: false, message: RECOVERY_TEXT};
  }
  const audits = await readDecisions(ctx);
  const applied = audits.find(row => row.status === "applied" && Number(row.target_price) === 890 && Number(row.previous_price) === 900);
  if (!applied) return {ok: false, message: "The silver price and the audit have diverged. " + RECOVERY_TEXT};
  await commit(ctx, "restore", 900, 890, null);
  const after = await readUnits(ctx);
  if (sameUnit(unit(after.data, "u-stage-1"), SILVER) && sameUnit(unit(after.data, "u-stage-2"), BLUE)) return {ok: true};
  return {ok: false, message: "restore read-back failed. " + RECOVERY_TEXT};
}

async function syntheticWrites(ctx) {
  const before = await readUnits(ctx);
  assertOriginalUnits(before.data);
  const orders = await request(ctx, "GET", "/rest/v1/orders?select=code,status,stock_applied&order=code.asc");
  const phone = await request(ctx, "GET", "/rest/v1/store_state?key=eq.ph&select=key,data,revision");
  const settings = await request(ctx, "GET", "/rest/v1/market_settings?id=eq.1&select=automation_enabled,writes_enabled");
  const config = await request(ctx, "GET", "/rest/v1/market_query_config?id=eq.1&select=enabled");
  if (orders.status !== 200 || phone.status !== 200) throw fail("refusing writes because the synthetic snapshot could not be reread. " + RECOVERY_TEXT);
  assertOrders(orders.body);
  assertPhone(phone.body[0].data);
  assertFlags(settings.body, config.body);
  const phoneBefore = JSON.stringify(phone.body[0]);
  const orderBefore = JSON.stringify(orders.body);
  ctx.writesArmed = true;

  const beforeDecisions = await readDecisions(ctx);
  const beforeIds = new Set(beforeDecisions.map(row => String(row.id)));
  const approved = await request(ctx, "POST", "/rest/v1/rpc/market_decide", {
    p_sku: "unit:u-stage-1",
    p_status: "approved",
    p_target: 890,
    p_previous: 900,
    p_apply_key: null,
    p_proposal: {sku: "unit:u-stage-1"},
    p_mode: "manual"
  });
  const approvedRow = await requireNewDecision(ctx, beforeIds, approved, row => row.sku === "unit:u-stage-1" && row.status === "approved" && Number(row.target_price) === 890 && Number(row.previous_price) === 900, "approval");
  beforeIds.add(String(approvedRow.id));
  const unchanged = await readUnits(ctx);
  if (unchanged.revision !== before.revision) throw fail("approval changed the inventory revision. " + RECOVERY_TEXT);
  silverAt(unchanged.data, 900);

  const applyKey = "ready-apply-" + Date.now().toString(36) + randomBytes(4).toString("hex");
  const applied = await commit(ctx, "apply", 890, 900, applyKey);
  const appliedRow = await requireNewDecision(ctx, beforeIds, applied, row => row.status === "applied" && row.apply_key === applyKey && Number(row.target_price) === 890 && Number(row.previous_price) === 900, "apply");
  beforeIds.add(String(appliedRow.id));
  const afterApply = await readUnits(ctx);
  silverAt(afterApply.data, 890);
  if (afterApply.revision !== before.revision + 1) throw fail("apply did not advance the revision by one. HTTP " + applied.status + " is not proof. " + RECOVERY_TEXT);
  ctx.progress.applied = true;

  const retry = await commit(ctx, "apply", 890, 900, applyKey);
  const retryRows = (await readDecisions(ctx)).filter(row => row.apply_key === applyKey && row.status === "applied");
  const afterRetry = await readUnits(ctx);
  if (retry.status >= 400 || retryRows.length !== 1 || String(retryRows[0].id) !== String(appliedRow.id) || decisionId(retry.body) !== String(appliedRow.id) || afterRetry.revision !== afterApply.revision) {
    throw fail("idempotent apply was not stored as one audit row. HTTP " + retry.status + " is not proof. " + RECOVERY_TEXT);
  }
  silverAt(afterRetry.data, 890);

  const probe = await request(ctx, "PATCH", "/rest/v1/store_state?key=eq.units&revision=eq." + afterRetry.revision, {
    data: afterRetry.data,
    revision: afterRetry.revision
  }, {"prefer": "return=representation"});
  const afterProbe = await readUnits(ctx);
  if (probe.status < 400 || !/stale store save/i.test(messageOf(probe.body)) || afterProbe.revision !== afterRetry.revision || JSON.stringify(afterProbe.data) !== JSON.stringify(afterRetry.data)) {
    throw fail("stale save was not rejected. HTTP " + probe.status + " is not a successful revision check. " + RECOVERY_TEXT);
  }

  const restored = await commit(ctx, "restore", 900, 890, null);
  const restoredRow = await requireNewDecision(ctx, beforeIds, restored, row => row.status === "restored" && Number(row.target_price) === 900 && Number(row.previous_price) === 890, "restore");
  beforeIds.add(String(restoredRow.id));
  const afterRestore = await readUnits(ctx);
  silverAt(afterRestore.data, 900);
  if (afterRestore.revision !== afterRetry.revision + 1) throw fail("restore did not advance the revision by one. HTTP " + restored.status + " is not proof. " + RECOVERY_TEXT);

  const restoreRetry = await commit(ctx, "restore", 900, 890, null);
  const afterRestoreRows = await readDecisions(ctx);
  const afterRestoreRetry = await readUnits(ctx);
  const extraRestores = afterRestoreRows.filter(row => row.status === "restored" && !beforeIds.has(String(row.id)));
  if (restoreRetry.status >= 400 || decisionId(restoreRetry.body) !== String(restoredRow.id) || extraRestores.length !== 0 || afterRestoreRetry.revision !== afterRestore.revision) {
    throw fail("idempotent restore was not stored as the same audit row. HTTP " + restoreRetry.status + " is not proof. " + RECOVERY_TEXT);
  }
  silverAt(afterRestoreRetry.data, 900);
  ctx.progress.restored = true;

  const finalOrders = await request(ctx, "GET", "/rest/v1/orders?select=code,status,stock_applied&order=code.asc");
  const finalPhone = await request(ctx, "GET", "/rest/v1/store_state?key=eq.ph&select=key,data,revision");
  const finalSettings = await request(ctx, "GET", "/rest/v1/market_settings?id=eq.1&select=automation_enabled,writes_enabled");
  const finalConfig = await request(ctx, "GET", "/rest/v1/market_query_config?id=eq.1&select=enabled");
  if (JSON.stringify(finalOrders.body) !== orderBefore || JSON.stringify(finalPhone.body[0]) !== phoneBefore) {
    throw fail("orders or the phone fixture changed. " + RECOVERY_TEXT);
  }
  assertFlags(finalSettings.body, finalConfig.body);
  return {
    applyVerifiedByRead: true,
    restoreVerifiedByRead: true,
    idempotentRetryVerified: true,
    staleSaveRejected: true,
    silver: {p: 900, qty: 2},
    blue: {p: 910, qty: 1},
    automationEnabled: false,
    writesEnabled: false,
    schedulerEnabled: false
  };
}

export async function runReadiness({env, fetchImpl} = {}) {
  const cfg = readinessConfig(env || {});
  const ctx = {cfg, fetchImpl: fetchImpl || globalThis.fetch, token: "", writesArmed: false, progress: {applied: false, restored: false}};
  const preflight = await readOnlyPreflight(ctx);
  if (!cfg.write) return {ok: true, mode: "read-only", host: STAGING_HOST, writes: false, preflight};
  try {
    const outcome = await syntheticWrites(ctx);
    return {ok: true, mode: WRITE_OPT_IN, host: STAGING_HOST, writes: true, preflight, outcome};
  } catch (error) {
    let extra = "";
    if (ctx.writesArmed && !ctx.progress.restored) {
      try {
        const recovery = await recoverSilver(ctx);
        if (!recovery.ok) extra = " " + recovery.message;
      } catch (recoveryError) {
        extra = " " + (recoveryError && recoveryError.message ? recoveryError.message : String(recoveryError));
      }
    }
    if (extra) throw fail((error && error.message ? error.message : String(error)) + extra);
    throw error;
  }
}

async function main() {
  const secrets = [process.env.STAGING_ANON_KEY, process.env.STAGING_STAFF_PASSWORD].filter(Boolean);
  try {
    const summary = await runReadiness({env: process.env});
    console.log(redact(JSON.stringify(summary, null, 2), secrets));
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    console.error(redact(text, secrets));
    process.exit(1);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) main();
