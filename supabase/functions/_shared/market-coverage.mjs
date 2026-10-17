/* Rate-limited public catalog reads. No prices are written here. */
import {
  coverageUrl, listingKind, observationsFromShopifyJs, observationsFromShopifySuggest, observationsFromWoo
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
  const checked = [];
  const skipped = [];
  let requests = 0;
  const only = options.pairs || null;

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
        if (response.status === 401 || response.status === 403 || response.status === 429) throw new Error("unavailable HTTP " + response.status);
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

  function phoneQuery(query) {
    if (!query || query.kind === "accessory" || listingKind(query.text) === "accessory") return false;
    return query.kind === "phone" || listingKind(query.text) === "phone";
  }

  function take(source, query, rows) {
    if (!rows || !rows.length) return;
    if (!phoneQuery(query)) {
      observations.push(...rows);
      return;
    }
    let accessories = 0;
    for (const row of rows) {
      if (row && row.specs && row.specs.listing === "accessory") accessories += 1;
      else observations.push(row);
    }
    if (accessories) skipped.push({store: source.name, storeId: source.id, query: query.text, reason: "accessory", count: accessories});
  }

  const work = [];
  if (only) {
    for (const source of sources) {
      for (const query of queries) {
        if (source.brandAllow && query.brand && !source.brandAllow.includes(query.brand)) {
          skipped.push({store: source.name, storeId: source.id, query: query.text, reason: "brand_not_sold"});
        }
      }
    }
    for (const pair of only) {
      const source = sources.find(item => item.id === pair.store);
      const query = queries.find(item => item.text === pair.query);
      if (!source || !query) continue;
      if (source.brandAllow && query.brand && !source.brandAllow.includes(query.brand)) continue;
      work.push({source, query});
    }
  } else {
    for (const source of sources) {
      for (const query of queries) {
        if (source.brandAllow && query.brand && !source.brandAllow.includes(query.brand)) {
          skipped.push({store: source.name, storeId: source.id, query: query.text, reason: "brand_not_sold"});
          continue;
        }
        work.push({source, query});
      }
    }
  }
  for (const item of work) {
    const source = item.source;
    const query = item.query;
    if (requests >= maxRequests) {
      skipped.push({store: source.name, storeId: source.id, query: query.text, reason: "request_cap"});
      continue;
    }
    if (source.kind === "woo") {
      let pagesSeen = 0;
      let lastPage = 0;
      for (let page = 1; page <= maxPages; page++) {
        if (requests >= maxRequests) {
          skipped.push({store: source.name, storeId: source.id, query: query.text, reason: "request_cap", page});
          break;
        }
        const result = await one(coverageUrl(source, query.text, page, perPage));
        await pause(delayMs);
        if (!result || result.error) {
          errors.push({store: source.name, query: query.text, page, error: result ? result.error : "failed"});
          break;
        }
        pagesSeen = result.pages || pagesSeen;
        lastPage = page;
        const products = Array.isArray(result.body) ? result.body : [];
        take(source, query, products.flatMap(product => observationsFromWoo(source, product, checkedAt)));
        if (products.length < perPage) break;
        if (result.pages && page >= result.pages) break;
      }
      checked.push({store: source.name, storeId: source.id, query: query.text, pages: lastPage});
      if (pagesSeen > lastPage) skipped.push({store: source.name, storeId: source.id, query: query.text, reason: "further_pages_not_fetched", pages: pagesSeen});
    } else {
      const result = await one(coverageUrl(source, query.text, 1, perPage));
      await pause(delayMs);
      if (!result || result.error) {
        errors.push({store: source.name, query: query.text, error: result ? result.error : "failed"});
        checked.push({store: source.name, storeId: source.id, query: query.text, pages: 0});
        continue;
      }
      checked.push({store: source.name, storeId: source.id, query: query.text, pages: 1});
      const found = observationsFromShopifySuggest(source, result.body, checkedAt);
      const ranged = found.filter(row => row.error === "variant_price_range" && row.handle).slice(0, 4);
      take(source, query, found.filter(row => row.error !== "variant_price_range"));
      for (const product of ranged) {
        if (requests >= maxRequests) {
          take(source, query, [product]);
          skipped.push({store: source.name, storeId: source.id, query: product.handle, reason: "request_cap"});
          continue;
        }
        const js = await one(source.origin + "/products/" + product.handle + ".js");
        await pause(delayMs);
        if (!js || js.error) {
          take(source, query, [product]);
          errors.push({store: source.name, query: product.handle, error: js ? js.error : "failed"});
          continue;
        }
        take(source, query, observationsFromShopifyJs(source, js.body, checkedAt));
      }
    }
  }
  return {observations: dedupe(observations), errors, requests, checkedAt, checked, skipped};
}
