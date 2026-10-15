/* Rate-limited public catalog reads. No prices are written here. */
import {
  coverageUrl, observationsFromShopifyJs, observationsFromShopifySuggest, observationsFromWoo
} from "./market-engine.mjs";

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = [row.store, row.url, row.name, row.price].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export async function runCoverage(options) {
  const sources = options.sources || [];
  const queries = options.queries || [];
  const fetchImpl = options.fetchImpl || fetch;
  const checkedAt = options.checkedAt || new Date().toISOString();
  const perPage = Math.min(20, Math.max(1, options.perPage || 20));
  const maxPages = Math.min(3, Math.max(1, options.maxPages || 2));
  const delayMs = options.delayMs == null ? 1000 : options.delayMs;
  const timeoutMs = options.timeoutMs || 12000;
  const retries = options.retries == null ? 1 : options.retries;
  const maxRequests = options.maxRequests || 80;
  const pause = options.sleep || sleep;
  const observations = [];
  const errors = [];
  let requests = 0;

  async function one(url) {
    if (requests >= maxRequests) return {error: "request cap"};
    requests += 1;
    let last = "failed";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          signal: ctrl.signal,
          redirect: "manual",
          headers: {
            "accept": "application/json,text/javascript",
            "user-agent": "ConnectifyMarketFetch/1.0 (public catalog; rate limited)"
          }
        });
        const type = String(response.headers.get("content-type") || "").toLowerCase();
        if (response.status >= 300 && response.status < 400) throw new Error("blocked");
        if (!response.ok || (!type.includes("json") && !type.includes("javascript"))) throw new Error(response.status === 202 ? "blocked" : "HTTP " + response.status);
        const body = await response.json();
        const pages = Number(response.headers.get("x-wp-totalpages") || 0);
        return {body, pages};
      } catch (error) {
        last = error && error.name === "AbortError" ? "timeout" : String((error && error.message) || error);
        if (attempt < retries) await pause(delayMs);
      } finally {
        clearTimeout(timer);
      }
    }
    return {error: last};
  }

  for (const source of sources) {
    for (const query of queries) {
      if (requests >= maxRequests) break;
      if (source.brandAllow && query.brand && !source.brandAllow.includes(query.brand)) continue;
      if (source.kind === "woo") {
        for (let page = 1; page <= maxPages; page++) {
          const result = await one(coverageUrl(source, query.text, page, perPage));
          await pause(delayMs);
          if (!result || result.error) {
            errors.push({store: source.name, query: query.text, page, error: result ? result.error : "failed"});
            break;
          }
          const products = Array.isArray(result.body) ? result.body : [];
          observations.push(...products.flatMap(product => observationsFromWoo(source, product, checkedAt)));
          if (products.length < perPage) break;
          if (result.pages && page >= result.pages) break;
        }
      } else {
        const result = await one(coverageUrl(source, query.text, 1, perPage));
        await pause(delayMs);
        if (!result || result.error) {
          errors.push({store: source.name, query: query.text, error: result ? result.error : "failed"});
          continue;
        }
        const found = observationsFromShopifySuggest(source, result.body, checkedAt);
        const ranged = found.filter(row => row.error === "variant_price_range" && row.handle).slice(0, 4);
        observations.push(...found.filter(row => row.error !== "variant_price_range"));
        for (const item of ranged) {
          const js = await one(source.origin + "/products/" + item.handle + ".js");
          await pause(delayMs);
          if (!js || js.error) {
            observations.push(item);
            errors.push({store: source.name, query: item.handle, error: js ? js.error : "failed"});
            continue;
          }
          observations.push(...observationsFromShopifyJs(source, js.body, checkedAt));
        }
      }
    }
  }
  return {observations: dedupe(observations), errors, requests, checkedAt};
}
