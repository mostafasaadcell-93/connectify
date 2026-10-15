/* Staging retriever. Writes nothing to Connectify prices or Supabase.
   Default is one page per store. It does not solve CAPTCHAs or sign in. */

import {SOURCES} from "./sources.mjs";
import {observationsFromShopify, observationsFromWoo} from "./engine.mjs";

const args = new Map();
for (const part of process.argv.slice(2)) {
  const [key, value] = part.replace(/^--/, "").split("=");
  args.set(key, value == null ? "1" : value);
}
const pages = Math.min(3, Math.max(1, Number(args.get("pages") || 1)));
const perPage = Math.min(20, Math.max(1, Number(args.get("perPage") || 10)));
const timeoutMs = 12000;
const delayMs = 1000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "accept": "application/json",
        "user-agent": "ConnectifyMarketFetch/1.0 (public catalog; rate limited)"
      }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const checkedAt = new Date().toISOString();
const observations = [];
const errors = [];
for (const source of SOURCES) {
  for (let page = 1; page <= pages; page++) {
    const url = source.kind === "woo"
      ? source.endpoint + "?per_page=" + perPage + "&page=" + page
      : source.endpoint + "?limit=" + perPage + "&page=" + page;
    try {
      const body = await getJson(url);
      const rows = source.kind === "woo"
        ? (Array.isArray(body) ? body : []).flatMap(product => observationsFromWoo(source, product, checkedAt))
        : ((body && body.products) || []).flatMap(product => observationsFromShopify(source, product, checkedAt));
      observations.push(...rows);
      if (!rows.length) break;
    } catch (error) {
      errors.push({store: source.name, page, error: error.name === "AbortError" ? "timeout" : String(error.message || error)});
      break;
    }
    await sleep(delayMs);
  }
}
const summary = {
  checkedAt,
  pages,
  observations: observations.length,
  priced: observations.filter(row => row.price > 0 && row.available).length,
  incomplete: observations.filter(row => row.status === "incomplete" || row.status === "unverified_stock").length,
  failedStores: errors,
  note: "This file is a quote of public prices. It does not change Connectify prices."
};
console.log(JSON.stringify({summary, observations, errors}, null, 2));
