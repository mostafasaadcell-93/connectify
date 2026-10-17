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
  assert.equal(row(stale).observed, null);
  assert.equal(row(stale).excluded.length, 1);
  assert.match(row(stale).reason, /Najem Starcall \$1515 \(quote_older_than_72h\)/);
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

test("a stale cheaper quote does not hide a fresh eligible quote", () => {
  const item = phone();
  const settings = {minMarginPct: 2};
  const stale = quote({
    store: "Old Shop", price: 1500, url: "https://old-shop.example/p/1", checkedAt: "2026-10-07T12:00:00Z"
  });
  const freshOffer = quote({
    store: "Fresh Shop", price: 1515, url: "https://fresh-shop.example/p/1", checkedAt: "2026-10-17T11:00:00Z"
  });
  const manual = evaluate([item], [stale, freshOffer], settings, []);
  assert.equal(manual.proposals[0].competitor, 1500);
  assert.equal(manual.proposals[0].store, "Old Shop");
  assert.equal(manual.proposals[0].target, 1497);
  const report = simulatePrices({catalog: [item], observations: [stale, freshOffer], settings, now});
  const result = row(report);
  assert.equal(result.eligibility, "Eligible for review");
  assert.equal(result.eligible, true);
  assert.equal(result.observed, 1515);
  assert.equal(result.store, "Fresh Shop");
  assert.equal(result.target, 1511.97);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].store, "Old Shop");
  assert.equal(result.excluded[0].price, 1500);
  assert.equal(result.excluded[0].reason, "quote_older_than_72h");
  assert.match(result.reason, /Excluded: Old Shop \$1500 \(quote_older_than_72h\)/);
  assert.equal(stale.price, 1500);
  assert.equal(freshOffer.price, 1515);
});

test("all-stale and future-dated quotes are rejected before selection", () => {
  const item = phone();
  const settings = {minMarginPct: 2};
  const older = quote({store: "Old Shop", price: 1480, url: "https://old-shop.example/p/1", checkedAt: "2026-10-01T12:00:00Z"});
  const alsoOld = quote({store: "Older Shop", price: 1500, url: "https://older-shop.example/p/1", checkedAt: "2026-10-07T12:00:00Z"});
  const manual = evaluate([item], [older, alsoOld], settings, []);
  assert.equal(manual.proposals[0].competitor, 1480);
  const stale = simulatePrices({catalog: [item], observations: [older, alsoOld], settings, now});
  assert.equal(row(stale).eligibility, "Stale quote");
  assert.equal(row(stale).eligible, false);
  assert.equal(row(stale).target, null);
  assert.equal(row(stale).observed, null);
  assert.equal(row(stale).excluded.length, 2);
  assert.match(row(stale).reason, /Old Shop \$1480 \(quote_older_than_72h\)/);
  assert.match(row(stale).reason, /Older Shop \$1500 \(quote_older_than_72h\)/);
  const future = quote({store: "Future Shop", price: 1490, url: "https://future-shop.example/p/1", checkedAt: "2026-10-18T12:00:00Z"});
  const ahead = simulatePrices({catalog: [item], observations: [future], settings, now});
  assert.equal(row(ahead).eligibility, "Needs verification");
  assert.equal(row(ahead).eligible, false);
  assert.equal(row(ahead).target, null);
  assert.equal(row(ahead).observed, null);
  assert.equal(row(ahead).excluded[0].reason, "quote_in_future");
  assert.match(row(ahead).reason, /Future Shop \$1490 \(quote_in_future\)/);
  const mixed = simulatePrices({catalog: [item], observations: [future, quote()], settings, now});
  assert.equal(row(mixed).eligible, true);
  assert.equal(row(mixed).observed, 1515);
  assert.equal(row(mixed).excluded[0].reason, "quote_in_future");
  const wrongSim = quote({store: "Wrong SIM", price: 1400, url: "https://wrong-sim.example/p/1", specs: {sim: "esim"}});
  const hidden = simulatePrices({catalog: [item], observations: [wrongSim, alsoOld], settings, now});
  assert.equal(row(hidden).eligibility, "Stale quote");
  assert.equal(row(hidden).observed, null);
  assert.equal(row(hidden).target, null);
  assert.equal(row(hidden).excluded.length, 1);
  assert.equal(row(hidden).excluded[0].store, "Older Shop");
  assert.equal(JSON.stringify(row(hidden)).includes("Wrong SIM"), false);
});

test("several fresh competitors use the lowest verified price", () => {
  const item = phone();
  const settings = {minMarginPct: 2};
  const offers = [
    quote({store: "Class Cellulars", price: 1600, url: "https://classcellulars.com/p/1"}),
    quote({store: "Gadgetlb", price: 1500, url: "https://gadgetlb.com/p/1"}),
    quote({store: "Third Shop", price: 1550, url: "https://third-shop.example/p/1"}),
    quote({store: "Old Shop", price: 1400, url: "https://old-shop.example/p/1", checkedAt: "2026-10-07T12:00:00Z"})
  ];
  const manual = evaluate([item], offers, settings, []);
  assert.equal(manual.proposals[0].competitor, 1400);
  const report = simulatePrices({catalog: [item], observations: offers, settings, now});
  assert.equal(row(report).eligible, true);
  assert.equal(row(report).observed, 1500);
  assert.equal(row(report).store, "Gadgetlb");
  assert.equal(row(report).target, 1497);
  assert.equal(row(report).excluded.length, 1);
  assert.equal(row(report).excluded[0].reason, "quote_older_than_72h");
  const blocked = simulatePrices({
    catalog: [item],
    observations: [quote({price: 1800}), offers[3]],
    settings,
    now
  });
  assert.equal(row(blocked).eligibility, "Needs verification");
  assert.equal(row(blocked).reason.startsWith("unusual_change"), true);
  assert.equal(row(blocked).observed, 1800);
  assert.equal(row(blocked).target, null);
  assert.match(row(blocked).reason, /Old Shop \$1400 \(quote_older_than_72h\)/);
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
