// Observation collector. It does not update selling prices or stock.
// Deploy only after the owner approves. Scheduling is not installed by this file.
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {runCoverage} from "../_shared/market-coverage.mjs";
import {schedulerDecision, selectCoverageBatch} from "../_shared/market-engine.mjs";

const SOURCES = [
  {id: "class", name: "Class Cellulars", kind: "woo", origin: "https://classcellulars.com", endpoint: "https://classcellulars.com/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "najem", name: "Najem Starcall", kind: "woo", origin: "https://najemstarcall.com", endpoint: "https://najemstarcall.com/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "phonefinity", name: "Phonefinity", kind: "woo", origin: "https://phonefinity.net", endpoint: "https://phonefinity.net/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "abedtahan", name: "Abed Tahan", kind: "shopify", origin: "https://abedtahan.com", endpoint: "https://abedtahan.com/products.json", currency: "USD"},
  {id: "gadgetlb", name: "Gadgetlb", kind: "shopify", origin: "https://gadgetlb.com", endpoint: "https://gadgetlb.com/products.json", currency: "USD"},
  {id: "bms", name: "BMS", kind: "shopify", origin: "https://lb.bmsmena.com", endpoint: "https://lb.bmsmena.com/products.json", currency: "USD", brandAllow: ["samsung"]}
];

function normalizeQueries(input: unknown, limit: number) {
  return (Array.isArray(input) ? input : [])
    .map(item => ({text: String(item && (item as {text?: string}).text || "").slice(0, 80), brand: item && (item as {brand?: string}).brand ? String((item as {brand?: string}).brand) : null}))
    .filter(item => item.text)
    .slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", {status: 405});
  const schedulerHeader = req.headers.get("x-connectify-market-scheduler");
  const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {auth: {persistSession: false}});
  let queries: Array<{text: string, brand: string | null}> = [];
  let maxRequests = 24;
  let pairs: Array<{store: string, query: string}> | null = null;
  let scheduler = false;
  let nextOffset: number | null = null;
  if (schedulerHeader !== null) {
    const secret = Deno.env.get("MARKET_SCHEDULER_SECRET") || "";
    const headerGate = schedulerDecision({MARKET_SCHEDULER_SECRET: secret}, schedulerHeader, {enabled: true});
    if (!headerGate.ok) return new Response(headerGate.reason, {status: headerGate.status});
    const {data: config, error: configError} = await supabase.from("market_query_config").select("enabled,queries,batch_size,max_requests,next_offset").eq("id", 1).maybeSingle();
    if (configError || !config) return new Response("scheduler disabled", {status: 403});
    const gate = schedulerDecision({MARKET_SCHEDULER_SECRET: secret}, schedulerHeader, config);
    if (!gate.ok) return new Response(gate.reason, {status: gate.status});
    scheduler = true;
    const limit = Math.min(12, Math.max(1, Number(config.batch_size) || 8));
    queries = normalizeQueries(config.queries, limit);
    maxRequests = Math.min(40, Math.max(1, Number(config.max_requests) || 24));
    const batch = selectCoverageBatch(queries, SOURCES, {max_requests: maxRequests, next_offset: config.next_offset || 0});
    pairs = batch.selected;
    nextOffset = batch.nextOffset;
    if (!queries.length || !pairs.length) return Response.json({observations: 0, errors: [{error: "no queries"}], checked: [], skipped: batch.skipped, pricesChanged: 0}, {status: 400});
  }
  if (!scheduler) {
    const auth = req.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return new Response("Sign in required", {status: 401});
    const userClient = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {global: {headers: {authorization: auth}}});
    const {data: staff, error: staffError} = await userClient.rpc("is_staff");
    if (staffError || staff !== true) return new Response("Staff only", {status: 403});
    let payload: {queries?: Array<{text?: string, brand?: string}>} = {};
    try { payload = await req.json(); } catch { payload = {}; }
    queries = normalizeQueries(payload.queries, 12);
    if (!queries.length) return Response.json({observations: 0, errors: [{error: "no queries"}], pricesChanged: 0}, {status: 400});
  }
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await supabase.from("market_runs").update({status: "failed", finished_at: new Date().toISOString(), error: "timed out"}).eq("status", "running").lt("started_at", staleBefore);
  const {data: running} = await supabase.from("market_runs").select("id").eq("status", "running").limit(1);
  if (running && running.length) return new Response("A check is already running", {status: 409});
  const {data: run, error: runError} = await supabase.from("market_runs").insert({status: "running"}).select("id").single();
  if (runError) return new Response(runError.message, {status: 409});
  try {
    const result = await runCoverage({sources: SOURCES, queries, pairs, perPage: 20, maxPages: 1, delayMs: 1000, timeoutMs: 12000, retries: 1, maxRequests});
    if (result.observations.length) {
      const {error} = await supabase.from("market_observations").insert(result.observations.map(row => ({
        run_id: run.id, store: row.store, name: row.name, price: row.price, currency: row.currency,
        url: row.url, available: row.available, checked_at: row.checkedAt, specs: row.specs, status: row.status, error: row.error || null
      })));
      if (error) throw new Error(error.message);
    }
    if (scheduler && nextOffset != null) {
      await supabase.from("market_query_config").update({next_offset: nextOffset, updated_at: new Date().toISOString()}).eq("id", 1);
    }
    await supabase.from("market_runs").update({status: "ok", finished_at: new Date().toISOString(), error: result.errors.length ? JSON.stringify(result.errors) : null}).eq("id", run.id);
    return Response.json({runId: run.id, observations: result.observations.length, requests: result.requests, errors: result.errors, checked: result.checked, skipped: result.skipped, pricesChanged: 0});
  } catch (error) {
    await supabase.from("market_runs").update({status: "failed", finished_at: new Date().toISOString(), error: String(error.message || error)}).eq("id", run.id);
    return new Response(String(error.message || error), {status: 502});
  }
});
