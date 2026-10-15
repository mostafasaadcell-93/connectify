/* Staging retriever. Prints a match report and writes nothing to Connectify prices or Supabase.
   It uses each store's public search, pages forward only while results fill the page,
   and stops at a request cap. It does not follow CAPTCHA redirects or sign in. */

import {readFileSync} from "node:fs";
import {SOURCES} from "./sources.mjs";
import {catalogFromHtml} from "./catalog.mjs";
import {coverageQueries, matchReport, selectCoverageBatch} from "./engine.mjs";
import {runCoverage} from "./coverage.mjs";

const args = new Map();
for (const part of process.argv.slice(2)) {
  const [key, value] = part.replace(/^--/, "").split("=");
  args.set(key, value == null ? "1" : value);
}
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const catalog = catalogFromHtml(html);
const queries = coverageQueries(catalog);
const perPage = Math.min(20, Math.max(1, Number(args.get("perPage") || 20)));
const maxPages = Math.min(3, Math.max(1, Number(args.get("maxPages") || 1)));
const delayMs = Math.max(1000, Number(args.get("delayMs") || 1000));
const batchSize = Math.min(24, Math.max(1, Number(args.get("batch") || 24)));
const observations = [];
const checked = [];
const skipped = [];
const failed = [];
let requests = 0;
let offset = 0;
let rounds = 0;
let checkedAt = null;
const seenSkip = new Set();
do {
  const batch = selectCoverageBatch(queries, SOURCES, {max_requests: batchSize, next_offset: offset});
  for (const row of batch.skipped) {
    if (row.reason !== "brand_not_sold") continue;
    const key = row.store + "|" + row.query + "|" + row.reason;
    if (seenSkip.has(key)) continue;
    seenSkip.add(key);
    skipped.push(row);
  }
  if (!batch.selected.length) break;
  const result = await runCoverage({
    sources: SOURCES,
    queries,
    pairs: batch.selected,
    perPage,
    maxPages,
    delayMs,
    maxRequests: batchSize,
    retries: 1,
    timeoutMs: 12000
  });
  checkedAt = result.checkedAt;
  requests += result.requests;
  observations.push(...result.observations);
  checked.push(...result.checked);
  for (const row of result.skipped) {
    if (row.reason === "brand_not_sold") continue;
    skipped.push(row);
  }
  failed.push(...result.errors);
  let done = 0;
  for (const pair of batch.selected) {
    if (result.checked.some(row => row.storeId === pair.store && row.query === pair.query)) done += 1;
    else break;
  }
  if (!done) break;
  offset += done;
  if (offset >= batch.eligible) offset = 0;
  rounds += 1;
} while (offset !== 0 && rounds < 20);
const checkedKeys = new Set(checked.map(row => row.store + "|" + row.query));
const seenSkips = new Set();
const skippedFinal = skipped.filter(row => {
  if (row.reason === "request_cap" && checkedKeys.has((row.store || "") + "|" + row.query)) return false;
  const key = [row.reason, row.store, row.query].join("|");
  if (seenSkips.has(key)) return false;
  seenSkips.add(key);
  return true;
});
const report = matchReport(catalog, observations, {minMarginPct: null});
const reasonCounts = {};
for (const row of report.reviewSkus.concat(report.unmatchedSkus || [])) {
  for (const reason of row.reasons || []) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
}
console.log(JSON.stringify({
  summary: {
    checkedAt,
    requests,
    rounds,
    queries: queries.length,
    observations: observations.length,
    priced: observations.filter(row => row.price > 0 && row.available).length,
    incomplete: observations.filter(row => row.status === "incomplete" || row.status === "unverified_stock").length,
    checked: checked.length,
    skipped: skippedFinal.length,
    failed,
    relevantSkus: report.relevant,
    highMatches: report.high,
    reviewMatches: report.review,
    unmatched: report.unmatched,
    reasonCounts,
    pricesChanged: 0,
    scheduler: "disabled",
    note: "Public quotes only. Selling prices were not changed. Further result pages past the page cap are skipped."
  },
  checked,
  skipped: skippedFinal,
  highSkus: report.highSkus,
  reviewSkus: report.reviewSkus,
  unmatchedSkus: report.unmatchedSkus || []
}, null, 2));
