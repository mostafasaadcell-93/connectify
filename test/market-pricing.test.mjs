import test from "node:test";
import assert from "node:assert/strict";
import {execSync} from "node:child_process";
import {
  DEFAULT_SETTINGS, undercut, toUsd, parseSpecs, observationsFromWoo, observationsFromShopify,
  parseManualCsv, matchPair, evaluate, canApply, canRestore
} from "../market/engine.mjs";

const phone = {
  sku: "unit:u12", kind: "phone", ref: {unit: "u12"}, title: "iPhone 17 Pro Max",
  detail: "256GB, Silver, new, psim", price: 1542, cost: 1400,
  specs: {brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver", warrantyYears: null, region: null}
};

function quote(overrides) {
  const specs = Object.assign({
    brand: "apple", model: "17promax", storage: 256, ram: null, condition: "new", sim: "psim", color: "silver", warrantyYears: null, region: null
  }, overrides.specs || {});
  return Object.assign({
    store: "Najem Starcall", name: "iPhone 17 Pro Max 256GB Silver 1 SIM New", price: 1515, currency: "USD",
    url: "https://najemstarcall.com/product/iphone-17-pro-max", available: true, checkedAt: "2026-10-15T09:00:00Z",
    status: "ok", error: "", specs
  }, overrides, {specs});
}

test("price tiers use one band and never invent a missing price", () => {
  assert.equal(undercut(80).target, 78.4);
  assert.equal(undercut(100).rate, 0.02);
  assert.equal(undercut(100.01).rate, 0.01);
  assert.equal(undercut(500).rate, 0.01);
  assert.equal(undercut(500).target, 495);
  assert.equal(undercut(500.01).rate, 0.005);
  assert.equal(undercut(1000).rate, 0.005);
  assert.equal(undercut(1000).target, 995);
  assert.equal(undercut(1542).rate, 0.002);
  assert.equal(undercut(1542).target, 1538.92);
  assert.equal(undercut(0).ok, false);
  assert.equal(undercut(null).ok, false);
  assert.equal(DEFAULT_SETTINGS.automationEnabled, false);
  assert.equal(DEFAULT_SETTINGS.writesEnabled, false);
});

test("an eSIM-only listing does not match a physical SIM unit", () => {
  const esim = quote({name: "iPhone 17 Pro Max 256GB Silver eSIM only New", specs: {sim: "esim"}});
  assert.equal(matchPair(phone, esim).level, "reject");
  assert.equal(matchPair(phone, esim).reasons.includes("conflict_sim"), true);
  const otherStorage = quote({specs: {storage: 512}});
  assert.equal(matchPair(phone, otherStorage).reasons.includes("conflict_storage"), true);
  const used = quote({specs: {condition: "used"}});
  assert.equal(matchPair(phone, used).level, "reject");
  const missingSim = quote({specs: {sim: null}});
  assert.equal(matchPair(phone, missingSim).level, "review");
  const exact = quote({});
  assert.equal(matchPair(phone, exact).level, "high");
});

test("names are parsed without treating a different variant as the same phone", () => {
  const parsed = parseSpecs("Apple iPhone 17 Pro Max 256GB 1 SIM UK (2 Years Warranty) Silver New");
  assert.equal(parsed.model, "17promax");
  assert.equal(parsed.storage, 256);
  assert.equal(parsed.sim, "psim");
  assert.equal(parsed.region, "uk");
  assert.equal(parsed.warrantyYears, 2);
  assert.equal(parsed.condition, "new");
  const ram = parseSpecs("Samsung Galaxy A56 8/256GB");
  assert.equal(ram.ram, 8);
  assert.equal(ram.storage, 256);
  assert.equal(ram.model, "a56");
  const esim = parseSpecs("iPhone 17 Pro Max 256GB eSIM only");
  assert.equal(esim.sim, "esim");
  assert.equal(parseSpecs("iPhone 17 Pro Max Clear Case").model, null);
  assert.equal(parseSpecs("Samsung 25W USB-C Charger").model, null);
  assert.equal(parseSpecs("10-in-1 Protection Kit for iPhone 17 Pro Max").model, null);
});

test("the lowest verified in-stock quote sets the recommendation", () => {
  const high = quote({store: "Class Cellulars", price: 1600, url: "https://classcellulars.com/p/1"});
  const lower = quote({store: "Gadgetlb", price: 1500, url: "https://gadgetlb.com/p/1"});
  const soldOut = quote({store: "Phonefinity", price: 1400, url: "https://phonefinity.net/p/1", available: false, status: "out_of_stock"});
  const ambiguous = quote({store: "Abed Tahan", price: 1300, url: "https://abedtahan.com/p/1", specs: {sim: null}});
  const failed = {store: "BMS", name: "Galaxy", price: null, currency: "USD", url: "", available: null, status: "failed", error: "timeout", specs: {}};
  const result = evaluate([phone], [high, lower, soldOut, ambiguous, failed], {minMarginPct: 2}, []);
  const proposal = result.proposals[0];
  assert.equal(proposal.competitor, 1500);
  assert.equal(proposal.store, "Gadgetlb");
  assert.equal(proposal.target, 1497);
  assert.equal(proposal.confidence, "high");
  assert.equal(proposal.block, null);
  assert.equal(proposal.sources.some(source => source.price === 1400), false);
  assert.equal(result.matches.some(match => match.level === "exclude" && match.reasons.includes("out_of_stock")), true);
  assert.equal(result.matches.some(match => match.obs.store === "Abed Tahan" && match.level === "review"), true);
  const twin = Object.assign({}, phone, {sku: "unit:u13", ref: {unit: "u13"}});
  const both = evaluate([phone, twin], [quote({price: 1515})], {minMarginPct: 2}, []);
  assert.equal(both.proposals.every(row => row.competitor === 1515 && row.target === 1511.97), true);
});

test("missing cost, a thin margin, a jump, or a currency without a rate blocks the change", () => {
  const row = quote({price: 1515});
  const noCost = evaluate([Object.assign({}, phone, {cost: null})], [row], {minMarginPct: 5}, []);
  assert.equal(noCost.proposals[0].block, "missing_cost");
  const tight = evaluate([Object.assign({}, phone, {cost: 1520})], [row], {minMarginPct: 5}, []);
  assert.equal(tight.proposals[0].block, "below_margin");
  const sudden = evaluate([phone], [row], {minMarginPct: 2}, [{store: row.store, url: row.url, currency: "USD", price: 1000, checkedAt: "2026-10-14T09:00:00Z"}]);
  assert.equal(sudden.proposals[0].block, "no_verified_price");
  assert.equal(sudden.proposals[0].notes.includes("sudden_change"), true);
  const older = quote({price: 1000, checkedAt: "2026-10-14T09:00:00Z"});
  const newer = quote({price: 1515, checkedAt: "2026-10-15T09:00:00Z"});
  const stale = evaluate([phone], [older, newer], {minMarginPct: 2}, [older, newer]);
  assert.equal(stale.proposals[0].block, "no_verified_price");
  assert.equal(stale.proposals[0].competitor, null);
  const lbp = quote({price: 135000000, currency: "LBP"});
  assert.equal(evaluate([phone], [lbp], {minMarginPct: 2}, []).proposals[0].block, "no_verified_price");
  const converted = evaluate([phone], [lbp], {minMarginPct: 2, lbpPerUsd: 90000, lbpRateVerified: true}, []);
  assert.equal(converted.proposals[0].competitor, 1500);
  assert.equal(toUsd(100, "EUR", {}).reason, "unsupported_currency");
});

test("apply and restore stay off unless every gate is open, and they do not touch stock or orders", () => {
  const proposal = evaluate([phone], [quote({price: 1515})], {minMarginPct: 2}, []).proposals[0];
  assert.equal(canApply(proposal, {}, "approved").reason, "automation_disabled");
  const open = Object.assign({}, DEFAULT_SETTINGS, {automationEnabled: true, writesEnabled: true, minMarginPct: 2, productAuto: {"unit:u12": true}});
  const allowed = canApply(proposal, open, "approved");
  assert.equal(allowed.ok, true);
  assert.equal(allowed.price, proposal.target);
  assert.equal(Object.hasOwn(allowed, "qty"), false);
  assert.equal(JSON.stringify(allowed).includes("C-"), false);
  assert.equal(canApply(proposal, open, "approved").ok, true);
  open.appliedKeys = [allowed.key];
  assert.equal(canApply(proposal, open, "approved").reason, "already_applied");
  assert.equal(canApply(proposal, Object.assign({}, open, {appliedKeys: [], productAuto: {}}), "approved").reason, "product_disabled");
  assert.equal(canRestore({sku: phone.sku, previous: 1542}, DEFAULT_SETTINGS).reason, "writes_disabled");
  assert.equal(canRestore({sku: phone.sku, previous: 1542, ref: phone.ref, kind: "phone"}, Object.assign({}, DEFAULT_SETTINGS, {writesEnabled: true})).price, 1542);
});

test("public catalog records keep only a real variant price", () => {
  const woo = observationsFromWoo(
    {id: "class", name: "Class Cellulars", currency: "USD"},
    {name: "iPhone 17 Pro Max", type: "simple", permalink: "https://classcellulars.com/product/iphone", is_in_stock: true, prices: {price: "151500", currency_code: "USD", currency_minor_unit: 2}},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(woo[0].price, 1515);
  assert.equal(woo[0].available, true);
  const ranged = observationsFromWoo(
    {id: "najem", name: "Najem Starcall", currency: "USD"},
    {name: "iPhone 17 Pro Max", type: "variable", permalink: "https://najemstarcall.com/p", variations: [11, 12], prices: {price: "150000", currency_minor_unit: 2, currency_code: "USD", price_range: {min_amount: "150000", max_amount: "180000"}}},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(ranged[0].price, null);
  assert.equal(ranged[0].status, "incomplete");
  const shop = observationsFromShopify(
    {id: "bms", name: "BMS", origin: "https://lb.bmsmena.com", currency: "USD", brandAllow: ["samsung"]},
    {title: "Samsung Galaxy S26 Ultra", handle: "s26", vendor: "BMS Samsung Lebanon", options: [{name: "Color"}, {name: "Storage"}], variants: [
      {id: 1, title: "Black", price: "1180.00", available: true, option1: "Black", option2: "256GB"},
      {id: 2, title: "Silver", price: "0.00", available: true, option1: "Silver", option2: "256GB"}
    ]},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(shop.filter(row => row.price > 0).length, 1);
  assert.equal(shop.find(row => row.price > 0).price, 1180);
  assert.equal(shop.find(row => !(row.price > 0)).status, "incomplete");
  const other = observationsFromShopify(
    {id: "bms", name: "BMS", origin: "https://lb.bmsmena.com", currency: "USD", brandAllow: ["samsung"]},
    {title: "LG Oven", handle: "oven", vendor: "LG", variants: [{id: 3, title: "Default Title", price: "400.00", available: true}]},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(other.length, 0);
  const csv = parseManualCsv("store,name,price,currency,url,available\nNajem,iPhone,,USD,https://najemstarcall.com/x,in_stock\n", "2026-10-15T09:00:00Z");
  assert.equal(csv[0].price, null);
  assert.equal(csv[0].status, "incomplete");
});

test("the storefront diff does not rewrite checkout or availability markup", () => {
  const diff = execSync("git diff -U0 main -- index.html", {encoding: "utf8"});
  for (const needle of ["cardPill", "phoneActsHTML", "applyStock", "Ask for availability", "availText", "CX_UPRICE", "store_state"]) {
    assert.equal(diff.includes(needle), false, needle);
  }
  assert.match(diff, /data-go="market"/);
  assert.match(diff, /market\/admin\.js/);
});
