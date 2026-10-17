import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {assertCollectorTarget, commercialDrift, COLLECTOR_PRODUCTION_HOST, COLLECTOR_STAGING_HOST} from "../market/engine.mjs";
import {collectionSummary} from "./staging-collector-check.mjs";

test("the collector accepts only the staging project", () => {
  assert.equal(assertCollectorTarget("https://" + COLLECTOR_STAGING_HOST).ok, true);
  assert.equal(assertCollectorTarget("https://" + COLLECTOR_PRODUCTION_HOST).reason, "refusing production project");
  assert.equal(assertCollectorTarget("https://otherexampleproject.supabase.co").ok, false);
  assert.equal(assertCollectorTarget("http://" + COLLECTOR_STAGING_HOST).ok, false);
  assert.equal(assertCollectorTarget("").ok, false);
});

test("quote collection drift counts price, stock, and order changes", () => {
  const units = [{id: "u-stage-1", p: 900, qty: 2}];
  const orders = [{id: 1, code: "C-STAGE-CONF", status: "confirmed", stock_applied: true, items: [{price: 900}]}];
  assert.deepEqual(commercialDrift(units, orders, units, orders), {pricesChanged: 0, stockChanged: 0, ordersChanged: 0});
  assert.equal(commercialDrift(units, orders, [{id: "u-stage-1", p: 890, qty: 2}], orders).pricesChanged, 1);
  assert.equal(commercialDrift(units, orders, [{id: "u-stage-1", p: 900, qty: 7}], orders).stockChanged, 1);
  assert.equal(commercialDrift(units, orders, units, [{id: 1, code: "C-STAGE-CONF", status: "new", stock_applied: true, items: [{price: 900}]}]).ordersChanged, 1);
});

test("the edge function refuses other projects before it creates a client and does not write commercial rows", () => {
  const source = readFileSync(new URL("../supabase/functions/market-check/index.ts", import.meta.url), "utf8");
  const deploy = readFileSync(new URL("../supabase/staging/deploy-market-check.sh", import.meta.url), "utf8");
  assert.ok(source.indexOf("const target = assertCollectorTarget") < source.indexOf("const supabase = createClient"));
  assert.equal(source.includes(COLLECTOR_PRODUCTION_HOST), false);
  assert.doesNotMatch(source, /from\("store_state"\)\.(update|insert|upsert|delete)/);
  assert.doesNotMatch(source, /from\("orders"\)\.(update|insert|upsert|delete)/);
  assert.match(source, /from\("store_state"\)\.select/);
  assert.match(deploy, /akgilfixljswqljmedmg/);
  assert.doesNotMatch(deploy, /--no-verify-jwt/);
  assert.throws(() => execFileSync("bash", ["supabase/staging/deploy-market-check.sh", COLLECTOR_PRODUCTION_HOST], {encoding: "utf8", cwd: "/workspace"}), error => {
    assert.match(String(error.stderr || error.message), /refusing extra arguments/);
    return true;
  });
});

test("the deploy script refuses the production project id in the environment", () => {
  assert.throws(() => execFileSync("bash", ["supabase/staging/deploy-market-check.sh"], {
    encoding: "utf8",
    cwd: "/workspace",
    env: Object.assign({}, process.env, {SUPABASE_URL: "https://" + COLLECTOR_PRODUCTION_HOST})
  }), error => {
    assert.match(String(error.stderr || error.message), /production/);
    return true;
  });
});

test("a collection summary keeps exact matches separate from review rows", () => {
  const observations = [{
    store: "Class Cellulars", name: "iPhone 17 Pro Max 256GB Silver new nano-SIM", price: 880, currency: "USD",
    url: "https://classcellulars.com/example", available: true, checkedAt: "2026-10-15T00:00:00.000Z", status: "ok",
    specs: {brand: "apple", model: "17promax", storage: 256, condition: "new", sim: "psim", color: "silver", warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"}
  }];
  const summary = collectionSummary({observations, checked: [{store: "Class Cellulars"}], errors: [], skipped: [], requests: 1, checkedAt: observations[0].checkedAt}, [
    {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", p: 900, qty: 2, warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"}
  ], [], []);
  assert.equal(summary.exactMatches, 1);
  assert.equal(summary.pricesChanged, 0);
  assert.equal(summary.quotes[0].url, "https://classcellulars.com/example");
});
