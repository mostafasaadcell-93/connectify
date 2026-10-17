import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS, evaluate, matchPair, parseSpecs, safeListingUrl, simulatePrices, PROPOSED_QUOTE_MAX_AGE_HOURS
} from "../market/engine.mjs";

const now = "2026-10-17T12:00:00Z";
const fresh = "2026-10-16T12:00:00Z";
const identity = {
  brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver",
  warrantyYears: 1, warrantyProvider: "apple", region: "us", activation: "inactive"
};

function phone(extra = {}) {
  return Object.assign({
    sku: "unit:u12", kind: "phone", ref: {unit: "u12"}, title: "iPhone 17 Pro Max",
    detail: "256GB, Silver, new, psim", price: 1542, cost: 1400, qty: 2
  }, extra, {specs: Object.assign({}, identity, extra.specs || {})});
}

function quote(extra = {}) {
  return Object.assign({
    store: "Najem Starcall",
    name: "iPhone 17 Pro Max 256GB Silver 1 SIM New US Apple warranty 1 year Not Active",
    price: 1515, currency: "USD", url: "https://najemstarcall.com/product/iphone-17-pro-max",
    available: true, checkedAt: fresh, status: "ok", error: "",
    specs: Object.assign({}, identity)
  }, extra, {specs: Object.assign({}, identity, extra.specs || {})});
}

function row(report) {
  return report.rows[0];
}

test("an exact phone with fresh evidence is eligible for review and writes nothing", () => {
  const item = phone();
  const settings = {minMarginPct: 2, automationEnabled: false, writesEnabled: false};
  const orders = [{code: "C-1", status: "new"}];
  const report = simulatePrices({catalog: [item], observations: [quote()], settings, now});
  const result = row(report);
  assert.equal(result.eligibility, "Eligible for review");
  assert.equal(result.eligible, true);
  assert.equal(result.observed, 1515);
  assert.equal(result.target, 1511.97);
  assert.equal(result.difference, -30.03);
  assert.equal(result.current, 1542);
  assert.equal(result.store, "Najem Starcall");
  assert.equal(result.url, "https://najemstarcall.com/product/iphone-17-pro-max");
  assert.equal(result.margin > 0, true);
  assert.equal(report.written, false);
  assert.equal(report.pricesChanged, false);
  assert.equal(report.approved, false);
  assert.equal(report.automationEnabled, false);
  assert.equal(report.writesEnabled, false);
  assert.equal(report.schedulerEnabled, false);
  assert.equal(report.proposedMaxAgeHours, PROPOSED_QUOTE_MAX_AGE_HOURS);
  assert.equal(item.price, 1542);
  assert.equal(item.qty, 2);
  assert.equal(settings.automationEnabled, false);
  assert.equal(orders[0].status, "new");
  assert.equal(DEFAULT_SETTINGS.automationEnabled, false);
  assert.equal(DEFAULT_SETTINGS.writesEnabled, false);
});

test("a different storage, SIM, condition, warranty, region, or color is not eligible", () => {
  const item = phone();
  const cases = [
    [{storage: 512}, "conflict_storage"],
    [{sim: "esim"}, "conflict_sim"],
    [{condition: "used"}, "conflict_condition"],
    [{condition: "open"}, "conflict_condition"],
    [{condition: "refurb"}, "conflict_condition"],
    [{warrantyYears: 2}, "conflict_warrantyYears"],
    [{region: "hk"}, "conflict_region"],
    [{color: "black"}, "conflict_color"],
    [{activation: "active"}, "conflict_activation"],
    [{warrantyProvider: "seller"}, "conflict_warrantyProvider"],
    [{ram: 8}, "missing_ram"]
  ];
  for (const [specs, reason] of cases) {
    const pair = matchPair(item, quote({specs}));
    assert.equal(pair.level === "high", false, reason);
    if (reason.startsWith("conflict_")) assert.equal(pair.reasons[0], reason);
    const report = simulatePrices({catalog: [item], observations: [quote({specs})], settings: {minMarginPct: 2}, now});
    assert.equal(row(report).eligible, false, reason);
    assert.equal(row(report).target, null, reason);
  }
  const blank = phone({specs: {warrantyYears: null, warrantyProvider: null, region: null, activation: null, sim: null}});
  const unknown = quote({specs: {warrantyYears: null, warrantyProvider: null, region: null, activation: null, sim: null}});
  const missing = matchPair(blank, unknown);
  assert.equal(missing.level, "review");
  for (const field of ["sim", "warrantyYears", "warrantyProvider", "region", "activation"]) {
    assert.equal(missing.reasons.includes("missing_" + field), true, field);
  }
  const simulated = simulatePrices({catalog: [blank], observations: [unknown], settings: {minMarginPct: 2}, now});
  assert.equal(row(simulated).eligibility, "Insufficient product specifications");
  assert.equal(row(simulated).eligible, false);
});

test("weak evidence, stale quotes, margin failures, and bad currency stay ineligible", () => {
  const item = phone();
  const settings = {minMarginPct: 2};
  const missingUrl = simulatePrices({catalog: [item], observations: [quote({url: ""})], settings, now});
  assert.equal(row(missingUrl).eligibility, "Needs verification");
  assert.match(row(missingUrl).reason, /missing_url/);
  const unsafe = simulatePrices({catalog: [item], observations: [quote({url: "javascript:alert(1)", name: "<script>alert(1)</script>"})], settings, now});
  assert.equal(safeListingUrl("javascript:alert(1)"), "");
  assert.equal(row(unsafe).url, "");
  assert.match(row(unsafe).reason, /unsafe_url/);
  assert.equal(JSON.stringify(row(unsafe)).includes("<script>"), false);
  const stock = simulatePrices({catalog: [item], observations: [quote({available: false, status: "out_of_stock"})], settings, now});
  assert.equal(row(stock).reason, "out_of_stock");
  assert.equal(row(stock).observed, null);
  const unverified = simulatePrices({catalog: [item], observations: [quote({available: null, status: "unverified_stock", error: "stock_not_stated"})], settings, now});
  assert.equal(row(unverified).eligible, false);
  assert.match(row(unverified).reason, /unverified_stock|stock_not_stated/);
  const old = quote({checkedAt: "2026-10-01T12:00:00Z"});
  const aged = evaluate([item], [old], settings, []);
  assert.equal(aged.proposals[0].target, 1511.97);
  const stale = simulatePrices({catalog: [item], observations: [old], settings, now});
  assert.equal(row(stale).eligibility, "Stale quote");
  assert.equal(row(stale).target, null);
  assert.equal(row(stale).observed, 1515);
  const eur = simulatePrices({catalog: [item], observations: [quote({currency: "EUR"})], settings, now});
  assert.match(row(eur).reason, /unsupported_currency/);
  const noCost = simulatePrices({catalog: [phone({specs: {}, cost: null})], observations: [quote()], settings, now});
  assert.equal(row(noCost).eligibility, "Needs verification");
  assert.equal(row(noCost).reason, "missing_cost");
  const loss = simulatePrices({catalog: [Object.assign(phone(), {cost: 1600})], observations: [quote()], settings, now});
  assert.equal(row(loss).eligibility, "Blocked by margin");
  assert.equal(row(loss).reason, "negative_profit");
  assert.equal(row(loss).target, null);
  const thin = simulatePrices({catalog: [Object.assign(phone(), {cost: 1490})], observations: [quote()], settings: {minMarginPct: 5}, now});
  assert.equal(row(thin).eligibility, "Blocked by margin");
  assert.equal(row(thin).reason, "below_margin");
  const jump = simulatePrices({catalog: [item], observations: [quote({price: 1800})], settings, now});
  assert.equal(row(jump).eligibility, "Needs verification");
  assert.equal(row(jump).reason, "unusual_change");
  const failed = simulatePrices({catalog: [item], observations: [{store: "BMS", name: "iPhone", price: null, status: "failed", error: "timeout", specs: {}}], settings, now});
  assert.equal(row(failed).eligibility, "No reliable competitor match");
  assert.equal(row(failed).reason, "failed_collector");
  assert.equal(row(failed).observed, null);
});

test("duplicate offers keep the newest listing and the lowest fresh verified price", () => {
  const item = phone();
  const older = quote({price: 1400, checkedAt: "2026-10-15T12:00:00Z"});
  const newer = quote({price: 1515, checkedAt: fresh});
  const replaced = simulatePrices({catalog: [item], observations: [older, newer], settings: {minMarginPct: 2}, now});
  assert.equal(row(replaced).observed, 1515);
  const other = quote({store: "Gadgetlb", price: 1500, url: "https://gadgetlb.com/p/1"});
  const lowest = simulatePrices({catalog: [item], observations: [quote({price: 1600, store: "Class Cellulars", url: "https://classcellulars.com/p/1"}), other], settings: {minMarginPct: 2}, now});
  assert.equal(row(lowest).observed, 1500);
  assert.equal(row(lowest).store, "Gadgetlb");
  assert.equal(row(lowest).eligible, true);
});

test("requested automation flags are not executed by the simulation", () => {
  const settings = {minMarginPct: 2, automationEnabled: true, writesEnabled: true};
  const report = simulatePrices({catalog: [phone()], observations: [quote()], settings, now});
  assert.equal(settings.automationEnabled, true);
  assert.equal(settings.writesEnabled, true);
  assert.equal(report.written, false);
  assert.equal(report.approved, false);
  assert.equal(report.automationEnabled, false);
  assert.equal(report.writesEnabled, false);
  assert.equal(report.schedulerEnabled, false);
  assert.equal(row(report).eligibility, "Eligible for review");
  assert.equal(parseSpecs("iPhone 17 Pro Max 256GB").warrantyProvider, null);
});
