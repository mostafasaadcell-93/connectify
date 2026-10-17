import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {evaluate} from "../market/engine.mjs";
import {PROPOSED_CADENCE_HOURS, dryRun, dryRunSequence, formatDryRun} from "../market/dry-run.mjs";

const fixturePath = new URL("./fixtures/market-dry-run-snapshot.json", import.meta.url);
const snapshot = JSON.parse(readFileSync(fixturePath, "utf8"));

function row(report, sku) {
  return report.proposals.find(item => item.sku === sku);
}

function phone(sku, extra = {}) {
  return Object.assign({
    sku, kind: "phone", title: "iPhone 17 Pro Max", price: 1542, cost: 1400,
    specs: {
      brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver",
      warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"
    }
  }, extra, {specs: Object.assign({
    brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver",
    warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"
  }, extra.specs || {})});
}

function quote(extra = {}) {
  return Object.assign({
    store: "Fresh Shop", price: 1515, currency: "USD", url: "https://fresh-shop.example/p/1",
    available: true, checkedAt: "2026-10-17T11:00:00Z", status: "ok",
    specs: {
      brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver",
      warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"
    }
  }, extra, {specs: Object.assign({
    brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver",
    warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"
  }, extra.specs || {})});
}

function sequenceSnapshot() {
  return {
    snapshotAt: "2026-10-17T12:00:00Z",
    executedAt: "2026-10-17T12:00:00Z",
    settings: {minMarginPct: 2, automationEnabled: true, writesEnabled: true},
    catalog: [phone("unit:cadence")],
    observations: [
      quote({store: "Old Shop", price: 1500, url: "https://old-shop.example/p/1", checkedAt: "2026-10-15T00:00:00Z"}),
      quote({store: "Fresh Shop", price: 1515, url: "https://fresh-shop.example/p/1", checkedAt: "2026-10-17T11:00:00Z"})
    ]
  };
}

test("a 12-hour dry run classifies the synthetic snapshot without writing", () => {
  assert.equal(PROPOSED_CADENCE_HOURS, 12);
  const report = dryRun(snapshot);
  assert.equal(report.ok, true);
  assert.equal(report.skuCount, 8);
  assert.equal(report.eligibleForReview, 1);
  assert.equal(report.blocked, 7);
  assert.deepEqual(report.reasonCounts, {
    eligible_for_manual_review: 1,
    insufficient_specifications: 1,
    stale_competitor_price: 1,
    no_reliable_match: 1,
    margin_or_cost_block: 1,
    unverified_currency: 1,
    unusual_price_change: 1,
    other_rejection: 1
  });
  const eligible = row(report, "unit:eligible");
  assert.equal(eligible.target, 1511.97);
  assert.equal(eligible.difference, -30.03);
  assert.equal(eligible.observed, 1515);
  assert.deepEqual(report.candidateUrls, ["https://fresh-shop.example/p/eligible"]);
  assert.equal(eligible.excluded.some(item => item.store === "Old Shop" && item.price === 1500 && item.reason === "quote_older_than_72h"), true);
  assert.equal(row(report, "unit:specs").category, "insufficient_specifications");
  assert.match(row(report, "unit:specs").reason, /missing_warrantyProvider/);
  assert.match(row(report, "unit:specs").reason, /missing_activation/);
  assert.equal(row(report, "unit:stale").category, "stale_competitor_price");
  assert.equal(row(report, "unit:stale").target, null);
  assert.equal(row(report, "unit:future").category, "other_rejection");
  assert.match(row(report, "unit:future").reason, /quote_in_future/);
  assert.equal(report.written, false);
  assert.equal(report.networkRequests, 0);
  assert.equal(report.databaseWrites, 0);
  assert.deepEqual(report.rpcCalls, []);
});

test("repeating the same snapshot is deterministic", () => {
  const first = dryRun(snapshot);
  const second = dryRun(snapshot);
  assert.deepEqual(first, second);
  const sequence = dryRunSequence(sequenceSnapshot(), {cadenceHours: 12, runs: 7});
  assert.deepEqual(sequence, dryRunSequence(sequenceSnapshot(), {cadenceHours: 12, runs: 7}));
  assert.equal(JSON.stringify(snapshot).includes("1511.97"), false);
});

test("later scheduled runs drop stale quotes and keep a fresher exact offer", () => {
  const source = sequenceSnapshot();
  const manual = evaluate(source.catalog, source.observations, source.settings, []);
  assert.equal(manual.proposals[0].competitor, 1500);
  const sequence = dryRunSequence(source, {cadenceHours: 12, runs: 7});
  assert.equal(sequence.ok, true);
  assert.equal(sequence.cadenceHours, 12);
  assert.equal(sequence.written, false);
  assert.equal(sequence.runs[0].runAt, "2026-10-17T12:00:00.000Z");
  assert.equal(sequence.runs[1].runAt, "2026-10-18T00:00:00.000Z");
  assert.equal(sequence.runs[2].runAt, "2026-10-18T12:00:00.000Z");
  for (const index of [0, 1]) {
    const result = sequence.runs[index].proposals[0];
    assert.equal(result.eligible, true, String(index));
    assert.equal(result.observed, 1500, String(index));
    assert.equal(result.target, 1497, String(index));
  }
  for (const index of [2, 3, 4, 5]) {
    const result = sequence.runs[index].proposals[0];
    assert.equal(result.eligible, true, String(index));
    assert.equal(result.observed, 1515, String(index));
    assert.equal(result.target, 1511.97, String(index));
    assert.equal(result.excluded[0].store, "Old Shop");
    assert.equal(result.excluded[0].reason, "quote_older_than_72h");
  }
  const expired = sequence.runs[6].proposals[0];
  assert.equal(expired.eligible, false);
  assert.equal(expired.category, "stale_competitor_price");
  assert.equal(expired.target, null);
  assert.equal(expired.observed, null);
  assert.equal(expired.excluded.length, 2);
});

test("missing warranty provider or activation blocks eligibility until verified facts supply them", () => {
  const base = {
    snapshotAt: "2026-10-17T12:00:00Z",
    executedAt: "2026-10-17T12:00:00Z",
    settings: {minMarginPct: 2},
    catalog: [phone("unit:gap", {specs: {warrantyProvider: null, activation: null}})],
    observations: [quote()]
  };
  const missing = dryRun(base);
  assert.equal(row(missing, "unit:gap").category, "insufficient_specifications");
  assert.equal(row(missing, "unit:gap").eligible, false);
  const unverified = dryRun(Object.assign({}, base, {facts: {"unit:gap": {verified: false, warrantyProvider: "apple", activation: "inactive"}}}));
  assert.equal(row(unverified, "unit:gap").eligible, false);
  const verified = dryRun(Object.assign({}, base, {facts: {"unit:gap": {verified: true, warrantyProvider: "apple", activation: "inactive"}}}));
  assert.equal(row(verified, "unit:gap").category, "eligible_for_manual_review");
  assert.equal(row(verified, "unit:gap").target, 1511.97);
});

test("mismatched SIM, storage, or condition never becomes eligible", () => {
  for (const specs of [{sim: "esim"}, {storage: 512}, {condition: "used"}]) {
    const report = dryRun({
      snapshotAt: "2026-10-17T12:00:00Z",
      executedAt: "2026-10-17T12:00:00Z",
      settings: {minMarginPct: 2},
      catalog: [phone("unit:conflict")],
      observations: [quote({specs})]
    });
    assert.equal(row(report, "unit:conflict").eligible, false, JSON.stringify(specs));
    assert.equal(row(report, "unit:conflict").target, null, JSON.stringify(specs));
    assert.equal(row(report, "unit:conflict").category, "no_reliable_match", JSON.stringify(specs));
  }
});

test("margin and missing purchase cost still block a dry run", () => {
  assert.equal(row(dryRun(snapshot), "unit:cost").category, "margin_or_cost_block");
  assert.equal(row(dryRun(snapshot), "unit:cost").reason, "missing_cost");
  assert.equal(row(dryRun(snapshot), "unit:eur").category, "unverified_currency");
  assert.equal(row(dryRun(snapshot), "unit:jump").category, "unusual_price_change");
  const thin = dryRun({
    snapshotAt: "2026-10-17T12:00:00Z",
    executedAt: "2026-10-17T12:00:00Z",
    settings: {minMarginPct: 5},
    catalog: [phone("unit:thin", {cost: 1490})],
    observations: [quote()]
  });
  assert.equal(row(thin, "unit:thin").category, "margin_or_cost_block");
  assert.equal(row(thin, "unit:thin").reason, "below_margin");
  assert.equal(row(thin, "unit:thin").target, null);
});

test("invalid or missing snapshot timestamps fail closed", () => {
  const cases = [
    [{}, "missing_snapshot_timestamp"],
    [{snapshotAt: ""}, "missing_snapshot_timestamp"],
    [{snapshotAt: "yesterday"}, "invalid_snapshot_timestamp"],
    [{snapshotAt: "2026-10-17T12:00:00Z"}, "missing_execution_timestamp"],
    [{snapshotAt: "2026-10-17T12:00:00Z", executedAt: "noon"}, "invalid_execution_timestamp"],
    [{snapshotAt: "2026-10-17T12:00:00Z", executedAt: "2026-10-17T11:00:00Z"}, "execution_before_snapshot"]
  ];
  for (const [patch, error] of cases) {
    const report = dryRun(Object.assign({catalog: snapshot.catalog, observations: snapshot.observations}, patch));
    assert.equal(report.ok, false, error);
    assert.equal(report.error, error);
    assert.equal(report.proposals.length, 0, error);
    assert.equal(report.eligibleForReview, 0, error);
    assert.equal(report.written, false, error);
  }
  assert.equal(dryRunSequence(snapshot, {cadenceHours: 0}).error, "invalid_cadence");
  assert.equal(dryRunSequence(snapshot, {runs: 0}).error, "invalid_run_count");
  const planted = Object.assign({}, snapshot, {service_role: "must-not-print"});
  const refused = dryRun(planted);
  assert.equal(refused.error, "credentials_not_allowed");
  assert.equal(JSON.stringify(refused).includes("must-not-print"), false);
});

test("automation flags and the collector stay outside the dry run", () => {
  const calls = [];
  globalThis.fetch = (...args) => { calls.push(args[0]); throw new Error("network"); };
  const report = dryRun(snapshot);
  assert.equal(calls.length, 0);
  assert.equal(snapshot.settings.automationEnabled, true);
  assert.equal(snapshot.settings.writesEnabled, true);
  assert.equal(report.automationEnabled, false);
  assert.equal(report.writesEnabled, false);
  assert.equal(report.schedulerEnabled, false);
  assert.equal(report.approved, false);
  assert.equal(report.pricesChanged, false);
  assert.equal(report.inventoryChanges, 0);
  assert.equal(report.checkoutChanges, 0);
  assert.equal(report.orderChanges, 0);
  const source = readFileSync(new URL("../market/dry-run.mjs", import.meta.url), "utf8");
  const cli = readFileSync(new URL("../market/dry-run-cli.mjs", import.meta.url), "utf8");
  const collector = readFileSync(new URL("../supabase/functions/market-check/index.ts", import.meta.url), "utf8");
  for (const needle of ["market_commit_price", "market_decide", "market_runs", "market_observations", "market_query_config", "fetch(", "createClient", "market-check"]) {
    assert.equal(source.includes(needle), false, needle);
    assert.equal(cli.includes(needle), false, needle);
  }
  assert.equal(collector.includes("market_runs"), true);
  assert.equal(collector.includes("market_observations"), true);
  assert.equal(collector.includes("market_query_config"), true);
  assert.match(formatDryRun(report), /No prices written/);
  const run = spawnSync(process.execPath, ["market/dry-run-cli.mjs", "test/fixtures/market-dry-run-snapshot.json", "--runs", "2", "--cadence", "12"], {
    cwd: new URL("..", import.meta.url), encoding: "utf8"
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /No prices written/);
  assert.match(run.stdout, /Eligible for manual review: 1/);
  assert.equal(run.stdout.includes("akgilfixljswqljmedmg"), false);
  assert.equal(run.stdout.includes("yxkzjwcmmtiljakttyfh"), false);
  assert.equal(run.stdout.includes("market_commit_price"), false);
});
