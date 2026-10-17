/* Hosted staging concurrency check for one manual price approval.

   Run it only after review, with the same staging variables as
   supabase/staging/HOSTED.md section 5. This process does not run the
   hosted calls when the file is imported.

   Windows PowerShell, from the Connectify repo:

     git checkout cursor/market-pricing-7fc1
     git pull origin cursor/market-pricing-7fc1
     $env:STAGING_SUPABASE_URL='https://akgilfixljswqljmedmg.supabase.co'
     $env:STAGING_ANON_KEY='the anon public key'
     $env:STAGING_STAFF_EMAIL='the staging staff email'
     $env:STAGING_STAFF_PASSWORD='the staging staff password'
     node test/hosted-market-race-check.mjs

   The script refuses every Supabase host except akgilfixljswqljmedmg.
   It uses the anon key and two password grants for the existing staging
   staff user. It does not read a service-role key. It writes audit rows
   only for a new fake SKU, through market_decide. It does not change
   prices, stock, orders, settings, or the scheduler, and it leaves the
   new audit rows in place.
*/

import {randomBytes} from "node:crypto";
import {pathToFileURL} from "node:url";
import {PRODUCTION_HOST, assertStagingTarget} from "./hosted-staging-check.mjs";

export const STAGING_HOST = "akgilfixljswqljmedmg.supabase.co";
export const FIRST_TARGET = 890;
export const SECOND_TARGET = 891;
export const CONCURRENCY_NOTE = "Overlapping HTTP calls are not proof that two PostgreSQL transactions overlapped. Requests can still be serialized before they reach the database. The local test test/market-approval-race.test.mjs is the lock-contention check. This script only reports hosted HTTP behavior.";

const RESERVED_UNIT_IDS = new Set(["u-stage-1", "u-stage-2"]);
const ALLOWED = new Set([
  "GET /rest/v1/store_state",
  "GET /rest/v1/orders",
  "GET /rest/v1/market_settings",
  "GET /rest/v1/market_query_config",
  "GET /rest/v1/market_decisions",
  "POST /auth/v1/token",
  "POST /rest/v1/rpc/is_staff",
  "POST /rest/v1/rpc/market_decide"
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXPECTED_UNITS = [
  {id: "u-stage-1", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900, note: "staging-synthetic"},
  {id: "u-stage-2", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, note: "staging-synthetic"}
];

export function fail(message, code = "RACE_CHECK") {
  const error = new Error(message);
  error.code = code;
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

export function assertRaceTarget(url) {
  const raw = String(url || "").trim();
  if (raw.toLowerCase().includes("yxkzjwcmmtiljakttyfh") || raw.includes(PRODUCTION_HOST)) {
    throw fail("refusing production Supabase project");
  }
  let parsed;
  try { parsed = new URL(raw); } catch { throw fail("staging URL is not a URL"); }
  assertStagingTarget(raw);
  if (parsed.username || parsed.password) throw fail("staging URL must not contain credentials");
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw fail("staging URL must be the project origin");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== STAGING_HOST || parsed.host !== STAGING_HOST) {
    throw fail("refusing every host except akgilfixljswqljmedmg.supabase.co");
  }
  return STAGING_HOST;
}

export function assertAnonKey(key) {
  const value = String(key || "").trim();
  const folded = value.toLowerCase();
  if (!value) throw fail("missing staging anon key");
  if (folded.includes("yxkzjwcmmtiljakttyfh")) throw fail("refusing a key that names the production project");
  const role = jwtRole(value).toLowerCase();
  if (folded.startsWith("sb_secret_") || folded.includes("service_role") || folded.includes("supabase_admin")) {
    throw fail("refusing a secret or service-role key");
  }
  if (role && role !== "anon") throw fail("refusing a key that is not the anon or publishable key");
  return value;
}

export function assertStaffEmail(email) {
  const value = String(email || "").trim();
  if (!value.toLowerCase().includes("staging") || value.includes("yxkzjwcmmtiljakttyfh")) {
    throw fail("staff email must contain staging");
  }
  return value;
}

export function createRunId() {
  return "hosted-race-" + Date.now().toString(36) + randomBytes(4).toString("hex");
}

export function skuForRun(runId) {
  if (!/^hosted-race-[a-z0-9]+$/.test(String(runId || ""))) throw fail("bad run id");
  const sku = "unit:" + runId;
  if (RESERVED_UNIT_IDS.has(runId) || sku === "unit:u-stage-1" || sku === "unit:u-stage-2") {
    throw fail("refusing a fixture sku");
  }
  return sku;
}

export function applyKey(runId, suffix) {
  const key = "race-" + suffix + "-" + runId;
  if (key.length < 3) throw fail("apply key is too short");
  return key;
}

export function assertAllowedRequest(url, method) {
  let parsed;
  try { parsed = new URL(url); } catch { throw fail("refusing a request that is not the hosted staging project"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== STAGING_HOST || parsed.host !== STAGING_HOST || parsed.username || parsed.password) {
    throw fail("refusing a request that is not the hosted staging project");
  }
  const key = String(method || "GET").toUpperCase() + " " + parsed.pathname;
  if (!ALLOWED.has(key)) throw fail("refusing " + key);
}

export function messageOf(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  return String(body.message || body.error_description || body.error || "");
}

export function decisionId(body) {
  const value = typeof body === "string" ? body.trim() : "";
  return UUID.test(value) ? value : "";
}

export function exactCount(status, contentRange) {
  if (status === 401 || status === 403) {
    throw fail("decision read blocked by row level security; not broadening permissions", "RLS_BLOCKED");
  }
  const match = String(contentRange || "").trim().match(/\/(\d+)\s*$/);
  if (!match || (status !== 200 && status !== 206 && !(status === 416 && match[1] === "0"))) {
    throw fail("decision count failed (" + status + ")");
  }
  return Number(match[1]);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

export function fingerprint(value) {
  return JSON.stringify(stable(value));
}

export function assertExpectedUnits(data) {
  if (!Array.isArray(data) || data.length !== EXPECTED_UNITS.length) throw fail("synthetic inventory is not the expected fixture");
  const ids = new Set(data.map(item => item && item.id));
  if (ids.size !== EXPECTED_UNITS.length) throw fail("synthetic inventory is not the expected fixture");
  for (const expected of EXPECTED_UNITS) {
    const found = data.find(item => item && item.id === expected.id);
    if (!found) throw fail("synthetic inventory is not the expected fixture");
    for (const key of Object.keys(expected)) {
      if (String(found[key]) !== String(expected[key])) throw fail("synthetic inventory is not the expected fixture");
    }
  }
}

export function sellingPrices(data) {
  return (Array.isArray(data) ? data : []).map(item => ({
    id: item && item.id,
    p: item && item.p,
    qty: item && item.qty
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function assertSyntheticOrders(rows) {
  if (!Array.isArray(rows)) throw fail("existing orders are not readable");
  const confirmed = rows.find(row => row && row.code === "C-STAGE-CONF");
  const fresh = rows.find(row => row && row.code === "C-STAGE-NEW");
  if (!confirmed || confirmed.status !== "confirmed" || confirmed.stock_applied !== true) throw fail("confirmed staging order is not the expected fixture");
  if (!fresh || fresh.status !== "new" || fresh.stock_applied !== false) throw fail("new staging order is not the expected fixture");
}

export function assertFlagsOff(settingsBody, configBody) {
  const settings = Array.isArray(settingsBody) ? settingsBody[0] : null;
  const config = Array.isArray(configBody) ? configBody[0] : null;
  if (!settings || settings.automation_enabled !== false || settings.writes_enabled !== false || !config || config.enabled !== false) {
    throw fail("automatic pricing, writes, or the scheduler is not disabled");
  }
}

export function assertHttpPair(results) {
  const successes = results.filter(item => item.status >= 200 && item.status < 300);
  const failures = results.filter(item => item.status >= 400);
  if (results.length !== 2 || successes.length !== 1 || failures.length !== 1) {
    throw fail("expected exactly one successful apply and one rejection");
  }
  const message = messageOf(failures[0].body);
  if (!message.includes("approval already used")) throw fail("rejection was not an already-consumed approval");
  const id = decisionId(successes[0].body);
  if (!id) throw fail("successful apply did not return a decision id");
  return {id, message};
}

export function assertOneConsumption(rows, sku, target, keys) {
  if (!Array.isArray(rows) || rows.some(row => row.sku !== sku)) throw fail("decision read returned another sku");
  const approved = rows.filter(row => row.status === "approved");
  const applied = rows.filter(row => row.status === "applied");
  if (rows.length !== 2 || approved.length !== 1 || applied.length !== 1) {
    throw fail("expected one approval and one applied audit row");
  }
  if (Number(approved[0].target_price) !== target || Number(applied[0].target_price) !== target) {
    throw fail("applied audit target was not the synthetic price");
  }
  if (!keys.includes(applied[0].apply_key)) throw fail("applied key was not one of the two requests");
  const loser = keys.find(key => key !== applied[0].apply_key);
  if (rows.some(row => row.apply_key === loser)) throw fail("rejection created a second applied record");
  return {winner: applied[0].apply_key, loser, appliedId: String(applied[0].id)};
}

export function assertFinalRows(rows, sku, firstKey, secondKey) {
  if (!Array.isArray(rows) || rows.some(row => row.sku !== sku)) throw fail("decision read returned another sku");
  const approved = rows.filter(row => row.status === "approved");
  const applied = rows.filter(row => row.status === "applied");
  if (rows.length !== 4 || approved.length !== 2 || applied.length !== 2) {
    throw fail("expected two approvals and two applied audit rows");
  }
  if (!applied.some(row => row.apply_key === firstKey && Number(row.target_price) === FIRST_TARGET)) {
    throw fail("the first applied audit row is missing");
  }
  if (!applied.some(row => row.apply_key === secondKey && Number(row.target_price) === SECOND_TARGET)) {
    throw fail("the fresh applied audit row is missing");
  }
}

export function assertRejected(result, pattern) {
  if (!result || result.status < 400) throw fail("a consumed approval was accepted again");
  const message = messageOf(result.body);
  if (!pattern.test(message)) throw fail("unexpected apply rejection");
  return message;
}

export function describeOverlap(samples, dispatchMs) {
  const overlap = Math.min(samples[0].finished, samples[1].finished) - Math.max(samples[0].started, samples[1].started);
  const origin = Math.min(samples[0].started, samples[1].started);
  const round = value => Math.round(value * 1000) / 1000;
  return {
    httpCallsOverlapped: overlap > 0,
    overlapMs: round(overlap),
    dispatchMs: round(dispatchMs),
    databaseRaceProven: false,
    requests: samples.map(sample => ({
      apply: sample.label,
      startedMs: round(sample.started - origin),
      finishedMs: round(sample.finished - origin),
      httpStatus: sample.status,
      outcome: sample.outcome
    })),
    note: CONCURRENCY_NOTE
  };
}

function envValue(env, name) {
  const value = env[name];
  if (!value) throw fail("missing " + name);
  return value;
}

function blocked(status, label) {
  if (status === 401 || status === 403) {
    throw fail(label + " blocked by row level security; not broadening permissions", "RLS_BLOCKED");
  }
}

async function request(ctx, method, path, token, body, extra) {
  const url = ctx.base + path;
  assertAllowedRequest(url, method);
  const headers = {
    apikey: ctx.anon,
    authorization: "Bearer " + (token || ctx.anon),
    accept: "application/json",
    "content-type": "application/json"
  };
  if (extra) Object.assign(headers, extra);
  const response = await ctx.fetchImpl(url, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  return {
    status: response.status,
    body: parsed,
    header(name) { return response.headers && response.headers.get ? response.headers.get(name) : ""; }
  };
}

async function signIn(ctx, email, password) {
  const result = await request(ctx, "POST", "/auth/v1/token?grant_type=password", null, {email, password});
  if (result.status !== 200 || !result.body || typeof result.body.access_token !== "string" || !result.body.access_token) {
    throw fail("staff sign-in failed (" + result.status + ")");
  }
  ctx.secrets.push(result.body.access_token);
  return result.body.access_token;
}

async function getJson(ctx, token, path, label) {
  const result = await request(ctx, "GET", path, token);
  blocked(result.status, label);
  if (result.status !== 200) throw fail(label + " failed (" + result.status + ")");
  return result.body;
}

async function readSnapshot(ctx, token) {
  const unitsBody = await getJson(ctx, token, "/rest/v1/store_state?key=eq.units&select=key,data", "units read");
  if (!Array.isArray(unitsBody) || !unitsBody[0] || !Array.isArray(unitsBody[0].data)) throw fail("units read failed");
  const units = unitsBody[0].data;
  assertExpectedUnits(units);
  if (units.some(item => item && (item.id === ctx.runId || ("unit:" + item.id) === ctx.sku))) {
    throw fail("fake sku matches an inventory unit");
  }
  const orders = await getJson(ctx, token, "/rest/v1/orders?select=code,status,stock_applied,items&order=code.asc", "orders read");
  assertSyntheticOrders(orders);
  const settings = await getJson(ctx, token, "/rest/v1/market_settings?id=eq.1&select=automation_enabled,writes_enabled", "settings read");
  const config = await getJson(ctx, token, "/rest/v1/market_query_config?id=eq.1&select=enabled", "scheduler read");
  assertFlagsOff(settings, config);
  return {units, orders, settings, config};
}

async function countOtherDecisions(ctx, token) {
  const result = await request(ctx, "GET", "/rest/v1/market_decisions?select=id&sku=neq." + ctx.sku, token, null, {
    prefer: "count=exact",
    range: "0-0",
    "range-unit": "items"
  });
  return exactCount(result.status, result.header("content-range"));
}

async function readSku(ctx, token) {
  const body = await getJson(
    ctx,
    token,
    "/rest/v1/market_decisions?sku=eq." + ctx.sku + "&select=id,sku,status,target_price,previous_price,apply_key,created_at&order=created_at.asc,id.asc",
    "decision read"
  );
  if (!Array.isArray(body)) throw fail("decision read failed");
  if (body.some(row => !row || row.sku !== ctx.sku)) throw fail("decision read returned another sku");
  return body;
}

async function decide(ctx, token, status, target, previous, applyKeyValue) {
  const result = await request(ctx, "POST", "/rest/v1/rpc/market_decide", token, {
    p_sku: ctx.sku,
    p_status: status,
    p_target: target,
    p_previous: previous,
    p_apply_key: applyKeyValue,
    p_proposal: {synthetic: true, run: ctx.runId},
    p_mode: "manual"
  });
  blocked(result.status, "market_decide");
  return result;
}

function capture(fn) {
  try {
    return {ok: true, value: fn()};
  } catch (error) {
    return {ok: false, error};
  }
}

function requireStaff(result) {
  if (!result || result.body !== true) throw fail("staff session is not staff");
}

export async function runHostedRace(options = {}) {
  const env = options.env || process.env;
  const secrets = options.secrets || [];
  const base = envValue(env, "STAGING_SUPABASE_URL").trim().replace(/\/$/, "");
  const anon = assertAnonKey(envValue(env, "STAGING_ANON_KEY"));
  const email = assertStaffEmail(envValue(env, "STAGING_STAFF_EMAIL"));
  const password = envValue(env, "STAGING_STAFF_PASSWORD");
  assertRaceTarget(base);
  secrets.push(anon, password);
  const runId = options.runId || createRunId();
  const sku = skuForRun(runId);
  const keys = {
    a: applyKey(runId, "a"),
    b: applyKey(runId, "b"),
    consumed: applyKey(runId, "d"),
    fresh: applyKey(runId, "c"),
    reuseSecond: applyKey(runId, "e"),
    reuseFirst: applyKey(runId, "f")
  };
  if (new Set([keys.a, keys.b, keys.consumed, keys.fresh, keys.reuseSecond, keys.reuseFirst]).size !== 6) {
    throw fail("apply keys were not unique");
  }
  const ctx = {
    base,
    anon,
    sku,
    runId,
    secrets,
    fetchImpl: options.fetchImpl || fetch
  };

  const tokenA = await signIn(ctx, email, password);
  const tokenB = await signIn(ctx, email, password);
  requireStaff(await request(ctx, "POST", "/rest/v1/rpc/is_staff", tokenA, {}));
  requireStaff(await request(ctx, "POST", "/rest/v1/rpc/is_staff", tokenB, {}));

  const before = await readSnapshot(ctx, tokenA);
  const beforeUnits = fingerprint(before.units);
  const beforePrices = fingerprint(sellingPrices(before.units));
  const beforeOrders = fingerprint(before.orders);
  const otherBefore = await countOtherDecisions(ctx, tokenA);
  const existing = await readSku(ctx, tokenA);
  if (existing.length !== 0) throw fail("fake sku already has audit rows");

  let raceError = null;
  let winner = "";
  let freshApplied = false;
  try {
    const approved = await decide(ctx, tokenA, "approved", FIRST_TARGET, 900, null);
    if (approved.status >= 400 || !decisionId(approved.body)) throw fail("approval failed");
    const approvedRows = await readSku(ctx, tokenA);
    if (approvedRows.length !== 1 || approvedRows[0].status !== "approved" || Number(approvedRows[0].target_price) !== FIRST_TARGET) {
      throw fail("approval did not persist");
    }

    const origin = performance.now();
    const sent = [
      {token: tokenA, key: keys.a, label: "a"},
      {token: tokenB, key: keys.b, label: "b"}
    ].map(item => {
      const started = performance.now();
      return decide(ctx, item.token, "applied", FIRST_TARGET, 900, item.key).then(result => ({
        result,
        started,
        finished: performance.now(),
        label: item.label,
        key: item.key
      }));
    });
    const dispatchStarted = origin;
    const settled = await Promise.allSettled(sent);
    const dispatchMs = performance.now() - dispatchStarted;
    if (settled.some(item => item.status === "rejected")) throw fail("one apply request failed before a database response");
    const samples = settled.map(item => item.value);
    const http = capture(() => assertHttpPair(samples.map(item => item.result)));
    const rows = await readSku(ctx, tokenA);
    const recorded = capture(() => assertOneConsumption(rows, sku, FIRST_TARGET, [keys.a, keys.b]));
    if (!http.ok || !recorded.ok || (http.ok && recorded.ok && http.value.id !== recorded.value.appliedId)) {
      const reason = [];
      if (!http.ok) reason.push(http.error.message);
      if (!recorded.ok) reason.push(recorded.error.message);
      if (http.ok && recorded.ok && http.value.id !== recorded.value.appliedId) reason.push("HTTP success does not match the applied audit row");
      throw fail(reason.join("; "));
    }
    winner = recorded.value.winner;
    const loser = recorded.value.loser;

    assertRejected(await decide(ctx, tokenB, "applied", FIRST_TARGET, 900, keys.consumed), /approval already used/);
    assertRejected(await decide(ctx, tokenA, "applied", FIRST_TARGET, 900, winner), /already applied/);
    assertRejected(await decide(ctx, tokenB, "applied", FIRST_TARGET, 900, loser), /approval already used/);
    const afterFirst = await readSku(ctx, tokenA);
    assertOneConsumption(afterFirst, sku, FIRST_TARGET, [keys.a, keys.b]);

    const again = await decide(ctx, tokenA, "approved", SECOND_TARGET, FIRST_TARGET, null);
    if (again.status >= 400 || !decisionId(again.body)) throw fail("fresh approval failed");
    const fresh = await decide(ctx, tokenB, "applied", SECOND_TARGET, FIRST_TARGET, keys.fresh);
    if (fresh.status >= 400 || !decisionId(fresh.body)) throw fail("fresh approval was not applied");
    freshApplied = true;
    assertRejected(await decide(ctx, tokenA, "applied", SECOND_TARGET, FIRST_TARGET, keys.reuseSecond), /approval already used/);
    assertRejected(await decide(ctx, tokenB, "applied", FIRST_TARGET, 900, keys.reuseFirst), /not approved/);
    assertRejected(await decide(ctx, tokenA, "applied", SECOND_TARGET, FIRST_TARGET, keys.fresh), /already applied/);
    assertRejected(await decide(ctx, tokenB, "applied", FIRST_TARGET, 900, winner), /already applied/);
    const finalRows = await readSku(ctx, tokenA);
    assertFinalRows(finalRows, sku, winner, keys.fresh);

    const summaryConcurrency = describeOverlap(samples.map(item => ({
      label: item.label,
      started: item.started,
      finished: item.finished,
      status: item.result.status,
      outcome: item.result.status < 300 ? "accepted" : "consumed"
    })), dispatchMs);

    const otherAfter = await countOtherDecisions(ctx, tokenB);
    if (otherAfter !== otherBefore) throw fail("previously existing decisions changed");
    const after = await readSnapshot(ctx, tokenB);
    if (fingerprint(after.units) !== beforeUnits) throw fail("synthetic inventory changed");
    if (fingerprint(sellingPrices(after.units)) !== beforePrices) throw fail("selling prices changed");
    if (fingerprint(after.orders) !== beforeOrders) throw fail("existing orders changed");

    return {
      ok: true,
      host: STAGING_HOST,
      sku,
      sessions: 2,
      sameStaffUser: true,
      sessionNote: "Both HTTP calls use the one staging staff user. Each call has its own password-grant sign-in because the hosted check has one staff password.",
      firstApproval: {target: FIRST_TARGET, appliedKey: winner, appliedId: recorded.value.appliedId, loserKey: loser},
      freshApproval: {target: SECOND_TARGET, appliedKey: keys.fresh, applied: freshApplied},
      reuseRejected: true,
      preservedOtherDecisions: {before: otherBefore, after: otherAfter},
      auditRowsLeftInPlace: true,
      integrity: {
        inventory: "unchanged",
        orders: "unchanged",
        sellingPrices: "unchanged",
        automationEnabled: false,
        writesEnabled: false,
        schedulerEnabled: false
      },
      concurrency: summaryConcurrency
    };
  } catch (error) {
    raceError = error;
  }

  let drift = "";
  try {
    const after = await readSnapshot(ctx, tokenA);
    if (fingerprint(after.units) !== beforeUnits) drift = "synthetic inventory changed";
    else if (fingerprint(sellingPrices(after.units)) !== beforePrices) drift = "selling prices changed";
    else if (fingerprint(after.orders) !== beforeOrders) drift = "existing orders changed";
    else assertFlagsOff(after.settings, after.config);
  } catch (error) {
    drift = error.message;
  }
  const parts = [raceError && raceError.message, drift].filter(Boolean);
  throw fail(parts.join("; ") || "hosted race check failed");
}

async function main() {
  const secrets = [];
  try {
    const summary = await runHostedRace({secrets});
    console.log(redact(JSON.stringify(summary, null, 2), secrets));
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    console.error(redact(text, secrets));
    process.exit(1);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) main();
