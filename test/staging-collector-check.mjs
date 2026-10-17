/* Collects public competitor quotes into the staging observations table.
   It refuses every project except akgilfixljswqljmedmg.
   It never writes store_state or orders.
   --dry-run fetches quotes and prints a match report without signing in. */

import {SOURCES} from "../market/sources.mjs";
import {assertCollectorTarget, commercialDrift, matchReport} from "../market/engine.mjs";
import {runCoverage} from "../market/coverage.mjs";

const STAGING_QUERY = {text: "iPhone 17 Pro Max", brand: "apple"};
const SYNTHETIC_UNITS = [
  {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900},
  {id: "u-stage-2", m: "17promax", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910}
];

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error("missing " + name);
  return value;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return {status: response.status, body};
}

function headers(anon, token, extra) {
  return Object.assign({"apikey": anon, "authorization": "Bearer " + (token || anon), "content-type": "application/json"}, extra || {});
}

async function rest(base, anon, token, method, path, body, extra) {
  return request(base + path, {method, headers: headers(anon, token, extra), body: body == null ? undefined : JSON.stringify(body)});
}

function messageOf(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  return body.message || body.error_description || body.error || body.msg || JSON.stringify(body);
}

export function catalogFromUnits(units) {
  return (units || []).map(unit => ({
    sku: "unit:" + unit.id,
    kind: "phone",
    title: unit.m === "17promax" ? "iPhone 17 Pro Max" : String(unit.m || ""),
    detail: [unit.st + "GB", unit.c, unit.cond, unit.sim].filter(Boolean).join(", "),
    price: Number(unit.p) > 0 ? Number(unit.p) : null,
    specs: {
      brand: "apple",
      model: unit.m,
      storage: Number(unit.st),
      ram: null,
      condition: unit.cond,
      sim: unit.sim,
      color: String(unit.c || "").toLowerCase(),
      warrantyYears: unit.warrantyYears == null || unit.warrantyYears === "" ? null : Number(unit.warrantyYears),
      warrantyProvider: unit.warrantyProvider || null,
      region: unit.region || null,
      activation: unit.activation || null
    }
  }));
}

function quoteRows(observations) {
  return (observations || []).filter(row => row && row.price > 0).map(row => ({
    store: row.store,
    name: row.name,
    price: row.price,
    currency: row.currency,
    url: row.url,
    checkedAt: row.checkedAt || row.checked_at,
    available: row.available,
    status: row.status
  }));
}

export function collectionSummary(result, units, ordersBefore, ordersAfter) {
  const catalog = catalogFromUnits(units);
  const report = matchReport(catalog, result.observations, {minMarginPct: null});
  const drift = commercialDrift(units, ordersBefore, units, ordersAfter);
  const byStore = {};
  for (const source of SOURCES) byStore[source.name] = {checked: 0, errors: [], observations: 0, priced: 0};
  for (const row of result.checked || []) {
    if (!byStore[row.store]) byStore[row.store] = {checked: 0, errors: [], observations: 0, priced: 0};
    byStore[row.store].checked += 1;
  }
  for (const row of result.errors || []) {
    if (!byStore[row.store]) byStore[row.store] = {checked: 0, errors: [], observations: 0, priced: 0};
    byStore[row.store].errors.push(row.error);
  }
  for (const row of result.observations || []) {
    if (!byStore[row.store]) byStore[row.store] = {checked: 0, errors: [], observations: 0, priced: 0};
    byStore[row.store].observations += 1;
    if (row.price > 0) byStore[row.store].priced += 1;
  }
  const successful = Object.entries(byStore).filter(([, row]) => row.checked > 0 && !row.errors.length).map(([store]) => store);
  const failed = Object.entries(byStore).filter(([, row]) => row.errors.length).map(([store, row]) => ({store, errors: row.errors}));
  return {
    checkedAt: result.checkedAt,
    requests: result.requests,
    observations: (result.observations || []).length,
    priced: (result.observations || []).filter(row => row.price > 0).length,
    successfulSources: successful,
    failedSources: failed,
    skipped: result.skipped || [],
    pricesChanged: drift.pricesChanged,
    stockChanged: drift.stockChanged,
    ordersChanged: drift.ordersChanged,
    exactMatches: report.high,
    reviewMatches: report.review,
    unmatched: report.unmatched,
    highSkus: report.highSkus,
    reviewSkus: report.reviewSkus,
    quotes: quoteRows(result.observations).slice(0, 40)
  };
}

async function signIn(base, anon, email, password) {
  const result = await request(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {"apikey": anon, "content-type": "application/json"},
    body: JSON.stringify({email, password})
  });
  if (result.status !== 200 || !result.body || !result.body.access_token) {
    throw new Error("sign-in failed (" + result.status + ")");
  }
  return result.body.access_token;
}

async function readUnits(base, anon, token) {
  const result = await rest(base, anon, token, "GET", "/rest/v1/store_state?key=eq.units&select=data");
  if (result.status !== 200 || !Array.isArray(result.body) || !result.body[0]) throw new Error("units read failed (" + result.status + ")");
  return result.body[0].data;
}

async function readOrders(base, anon, token) {
  const result = await rest(base, anon, token, "GET", "/rest/v1/orders?select=id,code,status,stock_applied,items&order=id.asc");
  if (result.status !== 200 || !Array.isArray(result.body)) throw new Error("orders read failed (" + result.status + ")");
  return result.body;
}

async function readFlags(base, anon, token) {
  const settings = await rest(base, anon, token, "GET", "/rest/v1/market_settings?id=eq.1&select=automation_enabled,writes_enabled");
  const config = await rest(base, anon, token, "GET", "/rest/v1/market_query_config?id=eq.1&select=enabled");
  const setting = Array.isArray(settings.body) ? settings.body[0] : null;
  const row = Array.isArray(config.body) ? config.body[0] : null;
  if (!setting || !row) throw new Error("flags read failed");
  return {automation: setting.automation_enabled === true, writes: setting.writes_enabled === true, scheduler: row.enabled === true};
}

async function collectPublic() {
  return runCoverage({
    sources: SOURCES,
    queries: [STAGING_QUERY],
    perPage: 20,
    maxPages: 1,
    delayMs: 1000,
    timeoutMs: 12000,
    retries: 1,
    maxRequests: 24
  });
}

async function insertStaff(base, anon, token, result) {
  const begun = await rest(base, anon, token, "POST", "/rest/v1/rpc/market_begin_run", {});
  if (begun.status >= 400 || !begun.body) throw new Error("run start failed: " + messageOf(begun.body));
  const runId = begun.body;
  try {
    if (result.observations.length) {
      const rows = result.observations.map(row => ({
        run_id: runId, store: row.store, name: row.name, price: row.price, currency: row.currency,
        url: row.url, available: row.available, checked_at: row.checkedAt, specs: row.specs, status: row.status, error: row.error || null
      }));
      const inserted = await rest(base, anon, token, "POST", "/rest/v1/market_observations", rows, {"prefer": "return=minimal"});
      if (inserted.status >= 400) throw new Error("observation insert failed: " + messageOf(inserted.body));
    }
    const finished = await rest(base, anon, token, "POST", "/rest/v1/rpc/market_finish_run", {
      p_id: runId, p_status: "ok", p_error: result.errors.length ? JSON.stringify(result.errors).slice(0, 500) : null
    });
    if (finished.status >= 400) throw new Error("run finish failed: " + messageOf(finished.body));
    return runId;
  } catch (error) {
    await rest(base, anon, token, "POST", "/rest/v1/rpc/market_finish_run", {p_id: runId, p_status: "failed", p_error: String(error.message || error).slice(0, 500)});
    throw error;
  }
}

export async function main(argv) {
  const dryRun = argv.includes("--dry-run");
  if (dryRun) {
    const result = await collectPublic();
    const summary = collectionSummary(result, SYNTHETIC_UNITS, [], []);
    console.log(JSON.stringify(Object.assign({ok: true, mode: "dry-run", inserted: false, host: null, automation: false, scheduler: false}, summary), null, 2));
    return summary;
  }
  const base = env("STAGING_SUPABASE_URL").replace(/\/$/, "");
  const anon = env("STAGING_ANON_KEY");
  const target = assertCollectorTarget(base);
  if (!target.ok) throw new Error(target.reason);
  const token = await signIn(base, anon, env("STAGING_STAFF_EMAIL"), env("STAGING_STAFF_PASSWORD"));
  const beforeUnits = await readUnits(base, anon, token);
  const beforeOrders = await readOrders(base, anon, token);
  const beforeFlags = await readFlags(base, anon, token);
  if (beforeFlags.automation || beforeFlags.writes || beforeFlags.scheduler) throw new Error("automation or scheduler is enabled");
  let mode = "edge-function";
  let runId = null;
  let result = null;
  const called = await request(base + "/functions/v1/market-check", {
    method: "POST",
    headers: headers(anon, token),
    body: JSON.stringify({queries: [STAGING_QUERY]})
  });
  if (called.status === 404) {
    mode = "staff-insert";
    result = await collectPublic();
    runId = await insertStaff(base, anon, token, result);
  } else if (called.status >= 400) {
    throw new Error("market-check returned " + called.status + ": " + messageOf(called.body));
  } else {
    runId = called.body && called.body.runId;
    const saved = await rest(base, anon, token, "GET", "/rest/v1/market_observations?run_id=eq." + runId + "&select=store,name,price,currency,url,available,checked_at,specs,status,error");
    if (saved.status !== 200 || !Array.isArray(saved.body)) throw new Error("saved observations read failed");
    result = {
      observations: saved.body.map(row => Object.assign({}, row, {checkedAt: row.checked_at})),
      errors: called.body.errors || [],
      requests: called.body.requests,
      checked: called.body.checked || [],
      skipped: called.body.skipped || [],
      checkedAt: saved.body[0] ? saved.body[0].checked_at : null
    };
    if (called.body.pricesChanged || called.body.stockChanged || called.body.ordersChanged) {
      throw new Error("edge function reported a commercial change");
    }
  }
  const afterUnits = await readUnits(base, anon, token);
  const afterOrders = await readOrders(base, anon, token);
  const afterFlags = await readFlags(base, anon, token);
  const drift = commercialDrift(beforeUnits, beforeOrders, afterUnits, afterOrders);
  if (drift.pricesChanged || drift.stockChanged || drift.ordersChanged) throw new Error("collection changed selling prices, stock, or orders");
  if (afterFlags.automation || afterFlags.writes || afterFlags.scheduler) throw new Error("collection enabled automation or the scheduler");
  const summary = collectionSummary(result, afterUnits, beforeOrders, afterOrders);
  console.log(JSON.stringify(Object.assign({
    ok: drift.pricesChanged === 0 && drift.stockChanged === 0 && drift.ordersChanged === 0,
    mode, inserted: true, runId, host: target.host,
    automation: afterFlags.automation, scheduler: afterFlags.scheduler
  }, summary), null, 2));
  return summary;
}

import {pathToFileURL} from "node:url";

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}
