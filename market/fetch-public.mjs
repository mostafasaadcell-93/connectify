/* Staging retriever. Prints a match report and writes nothing to Connectify prices or Supabase.
   It uses each store's public search, pages forward only while results fill the page,
   and stops at a request cap. It does not follow CAPTCHA redirects or sign in. */

import {readFileSync} from "node:fs";
import {SOURCES} from "./sources.mjs";
import {catalogFromHtml} from "./catalog.mjs";
import {coverageQueries, matchReport} from "./engine.mjs";
import {runCoverage} from "./coverage.mjs";

const args = new Map();
for (const part of process.argv.slice(2)) {
  const [key, value] = part.replace(/^--/, "").split("=");
  args.set(key, value == null ? "1" : value);
}
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const catalog = catalogFromHtml(html);
const queries = coverageQueries(catalog);
const result = await runCoverage({
  sources: SOURCES,
  queries,
  perPage: Math.min(20, Math.max(1, Number(args.get("perPage") || 20))),
  maxPages: Math.min(3, Math.max(1, Number(args.get("maxPages") || 2))),
  delayMs: Math.max(500, Number(args.get("delayMs") || 1000)),
  maxRequests: Math.min(120, Math.max(1, Number(args.get("maxRequests") || 80))),
  retries: 1,
  timeoutMs: 12000
});
const report = matchReport(catalog, result.observations, {minMarginPct: null});
console.log(JSON.stringify({
  summary: {
    checkedAt: result.checkedAt,
    requests: result.requests,
    queries: queries.length,
    observations: result.observations.length,
    priced: result.observations.filter(row => row.price > 0 && row.available).length,
    incomplete: result.observations.filter(row => row.status === "incomplete" || row.status === "unverified_stock").length,
    failed: result.errors,
    relevantSkus: report.relevant,
    highMatches: report.high,
    reviewMatches: report.review,
    unmatched: report.unmatched,
    pricesChanged: 0,
    note: "Public quotes only. Selling prices were not changed."
  },
  highSkus: report.highSkus,
  reviewSkus: report.reviewSkus
}, null, 2));
