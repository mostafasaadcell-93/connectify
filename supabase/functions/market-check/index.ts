// Observation collector. It does not update selling prices or stock.
// Deploy only after the owner approves. Scheduling is not installed by this file.
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {observationsFromShopify, observationsFromWoo} from "../_shared/market-engine.mjs";

const SOURCES = [
  {id: "class", name: "Class Cellulars", kind: "woo", origin: "https://classcellulars.com", endpoint: "https://classcellulars.com/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "najem", name: "Najem Starcall", kind: "woo", origin: "https://najemstarcall.com", endpoint: "https://najemstarcall.com/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "phonefinity", name: "Phonefinity", kind: "woo", origin: "https://phonefinity.net", endpoint: "https://phonefinity.net/wp-json/wc/store/v1/products", currency: "USD"},
  {id: "abedtahan", name: "Abed Tahan", kind: "shopify", origin: "https://abedtahan.com", endpoint: "https://abedtahan.com/products.json", currency: "USD"},
  {id: "gadgetlb", name: "Gadgetlb", kind: "shopify", origin: "https://gadgetlb.com", endpoint: "https://gadgetlb.com/products.json", currency: "USD"},
  {id: "bms", name: "BMS", kind: "shopify", origin: "https://lb.bmsmena.com", endpoint: "https://lb.bmsmena.com/products.json", currency: "USD", brandAllow: ["samsung"]}
];

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", {status: 405});
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return new Response("Sign in required", {status: 401});
  const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", {auth: {persistSession: false}});
  const userClient = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {global: {headers: {authorization: auth}}});
  const {data: staff, error: staffError} = await userClient.rpc("is_staff");
  if (staffError || staff !== true) return new Response("Staff only", {status: 403});
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await supabase.from("market_runs").update({status: "failed", finished_at: new Date().toISOString(), error: "timed out"}).eq("status", "running").lt("started_at", staleBefore);
  const {data: running} = await supabase.from("market_runs").select("id").eq("status", "running").limit(1);
  if (running && running.length) return new Response("A check is already running", {status: 409});
  const {data: run, error: runError} = await supabase.from("market_runs").insert({status: "running"}).select("id").single();
  if (runError) return new Response(runError.message, {status: 409});
  const checkedAt = new Date().toISOString();
  const rows = [];
  const errors = [];
  try {
    for (const source of SOURCES) {
      const url = source.kind === "woo" ? source.endpoint + "?per_page=10&page=1" : source.endpoint + "?limit=10&page=1";
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        try {
          const response = await fetch(url, {signal: ctrl.signal, headers: {"accept": "application/json", "user-agent": "ConnectifyMarketFetch/1.0"}});
          if (!response.ok) throw new Error("HTTP " + response.status);
          const body = await response.json();
          const found = source.kind === "woo"
            ? (Array.isArray(body) ? body : []).flatMap(product => observationsFromWoo(source, product, checkedAt))
            : ((body && body.products) || []).flatMap(product => observationsFromShopify(source, product, checkedAt));
          rows.push(...found);
          done = true;
        } catch (error) {
          if (attempt === 2) errors.push({store: source.name, error: error instanceof Error ? error.message : "failed"});
        } finally {
          clearTimeout(timer);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    if (rows.length) {
      const {error} = await supabase.from("market_observations").insert(rows.map(row => ({
        run_id: run.id, store: row.store, name: row.name, price: row.price, currency: row.currency,
        url: row.url, available: row.available, checked_at: row.checkedAt, specs: row.specs, status: row.status, error: row.error || null
      })));
      if (error) throw new Error(error.message);
    }
    await supabase.from("market_runs").update({status: "ok", finished_at: new Date().toISOString(), error: errors.length ? JSON.stringify(errors) : null}).eq("id", run.id);
    return Response.json({runId: run.id, observations: rows.length, errors, pricesChanged: 0});
  } catch (error) {
    await supabase.from("market_runs").update({status: "failed", finished_at: new Date().toISOString(), error: String(error.message || error)}).eq("id", run.id);
    return new Response(String(error.message || error), {status: 502});
  }
});
