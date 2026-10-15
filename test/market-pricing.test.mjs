import test from "node:test";
import assert from "node:assert/strict";
import {execSync} from "node:child_process";
import {
  DEFAULT_SETTINGS, undercut, toUsd, parseSpecs, observationsFromWoo, observationsFromShopify,
  observationsFromShopifySuggest, observationsFromShopifyJs, coverageQueries, coverageUrl,
  decideRecord, parseManualCsv, matchPair, evaluate, canApply, canRestore
} from "../market/engine.mjs";
import {runCoverage} from "../market/coverage.mjs";

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

test("manual approval does not require scheduled automation, and automatic updates stay off", () => {
  const proposal = evaluate([phone], [quote({price: 1515})], {minMarginPct: 2}, []).proposals[0];
  const manual = canApply(proposal, DEFAULT_SETTINGS, "approved", "manual");
  assert.equal(manual.ok, true);
  assert.equal(manual.mode, "manual");
  assert.equal(manual.price, proposal.target);
  assert.equal(Object.hasOwn(manual, "qty"), false);
  assert.equal(JSON.stringify(manual).includes("C-"), false);
  assert.equal(canApply(proposal, DEFAULT_SETTINGS, "approved", "automatic").reason, "automation_disabled");
  const open = Object.assign({}, DEFAULT_SETTINGS, {automationEnabled: true, writesEnabled: true, minMarginPct: 2, productAuto: {}});
  assert.equal(canApply(proposal, open, "approved", "automatic").reason, "product_disabled");
  open.productAuto = {"unit:u12": true};
  assert.equal(canApply(proposal, open, "approved", "automatic").ok, true);
  open.appliedKeys = [manual.key];
  assert.equal(canApply(proposal, open, "approved", "manual").reason, "already_applied");
  assert.equal(canRestore({sku: phone.sku, previous: 1542, ref: phone.ref, kind: "phone"}).price, 1542);
  assert.equal(canRestore({sku: phone.sku}).reason, "no_previous_price");
});

test("approved and rejected decisions survive a second session, and a manual apply is refused without approval", () => {
  const audit = {settings: {automation_enabled: false, writes_enabled: false}, flags: {}, decisions: []};
  assert.equal(decideRecord(audit, {staff: false, status: "approved", sku: "unit:u12", target: 1511.97}).reason, "staff only");
  const approved = decideRecord(audit, {staff: true, status: "approved", sku: "unit:u12", target: 1511.97, previous: 1542, now: "2026-10-15T10:00:00Z"});
  assert.equal(approved.ok, true);
  const second = {settings: audit.settings, flags: audit.flags, decisions: audit.decisions};
  assert.equal(decideRecord(second, {staff: true, status: "applied", sku: "unit:u12", target: 1511.97, previous: 1542, applyKey: "k1", mode: "manual"}).ok, true);
  assert.equal(decideRecord(second, {staff: true, status: "applied", sku: "unit:u12", target: 1511.97, previous: 1542, applyKey: "k1", mode: "manual"}).reason, "already applied");
  assert.equal(decideRecord(second, {staff: true, status: "applied", sku: "unit:u13", target: 900, previous: 1000, applyKey: "k2", mode: "automatic"}).reason, "automation disabled");
  const rejected = decideRecord(second, {staff: true, status: "rejected", sku: "unit:u13", target: 900, now: "2026-10-15T10:05:00Z"});
  assert.equal(rejected.ok, true);
  assert.equal(decideRecord(second, {staff: true, status: "applied", sku: "unit:u13", target: 900, applyKey: "k3", mode: "manual"}).reason, "not approved");
  assert.equal(second.decisions.filter(row => row.status === "approved").length, 1);
  assert.equal(second.decisions.filter(row => row.status === "rejected").length, 1);
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
  const named = observationsFromWoo(
    {id: "najem", name: "Najem Starcall", currency: "USD"},
    {name: "Apple iPhone 17 Pro Max 256GB 1 SIM Silver New", type: "variable", permalink: "https://najemstarcall.com/p", is_in_stock: true, variations: [{id: 3, attributes: [{name: "color", value: "silver"}]}], prices: {price: "1510", currency_code: "USD", currency_minor_unit: 0}},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(named[0].price, 1510);
  assert.equal(named[0].status, "ok");
  const suggest = observationsFromShopifySuggest(
    {id: "abedtahan", name: "Abed Tahan", origin: "https://abedtahan.com", currency: "USD"},
    {resources: {results: {products: [
      {title: "iPhone 17 Pro Max 256GB Nano SIM Silver", handle: "iphone-17", price_min: "1515.00", price_max: "1515.00", available: true, vendor: "APPLE"},
      {title: "iPhone 17 Pro Max", handle: "range", price_min: "1400.00", price_max: "1800.00", available: true, vendor: "APPLE"}
    ]}}},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(suggest[0].price, 1515);
  assert.equal(suggest[1].price, null);
  const js = observationsFromShopifyJs(
    {id: "abedtahan", name: "Abed Tahan", origin: "https://abedtahan.com", currency: "USD"},
    {title: "iPhone 17 Pro Max 256GB", handle: "iphone-17", vendor: "APPLE", variants: [{id: 9, title: "Silver", price: 151500, available: true, option1: "Silver"}]},
    "2026-10-15T09:00:00Z"
  );
  assert.equal(js[0].price, 1515);
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

test("targeted coverage pages through search results and stops at the request cap", async () => {
  const calls = [];
  const headers = (map) => ({get: name => map[String(name).toLowerCase()] || null});
  const fetchImpl = async (url) => {
    calls.push(url);
    if (String(url).includes("captcha")) return {ok: false, status: 202, headers: headers({"content-type": "text/html"}), json: async () => ({})};
    if (String(url).endsWith(".js")) {
      return {ok: true, status: 200, headers: headers({"content-type": "text/javascript"}), json: async () => ({title: "Galaxy S26 Ultra", handle: "s26", vendor: "Samsung", variants: [{id: 1, title: "Black", price: 118000, available: true, option1: "Black"}]})};
    }
    if (String(url).includes("suggest.json")) {
      return {ok: true, status: 200, headers: headers({"content-type": "application/json"}), json: async () => ({resources: {results: {products: [{title: "Galaxy S26 Ultra", handle: "s26", price_min: "1000.00", price_max: "1400.00", available: true, vendor: "Samsung"}]}}})};
    }
    const page = Number(new URL(url).searchParams.get("page") || "1");
    return {ok: true, status: 200, headers: headers({"content-type": "application/json", "x-wp-totalpages": "2"}), json: async () => page === 1 ? [{name: "iPhone 17 Pro Max 256GB Silver 1 SIM New", type: "simple", permalink: "https://classcellulars.com/p/" + page, is_in_stock: true, prices: {price: "151500", currency_code: "USD", currency_minor_unit: 2}}] : []};
  };
  const catalog = [
    phone,
    {sku: "unit:s26", kind: "phone", title: "Galaxy S26 Ultra", specs: {brand: "samsung", model: "s26ultra"}}
  ];
  const result = await runCoverage({
    fetchImpl, sleep: async () => {}, delayMs: 0, retries: 0, maxPages: 2, perPage: 20, maxRequests: 3,
    queries: coverageQueries(catalog),
    sources: [
      {id: "class", name: "Class Cellulars", kind: "woo", origin: "https://classcellulars.com", endpoint: "https://classcellulars.com/wp-json/wc/store/v1/products", currency: "USD"},
      {id: "bms", name: "BMS", kind: "shopify", origin: "https://lb.bmsmena.com", endpoint: "https://lb.bmsmena.com/products.json", currency: "USD", brandAllow: ["samsung"]}
    ]
  });
  assert.equal(result.requests <= 3, true);
  assert.equal(calls.some(url => url.includes("search=iPhone+17+Pro+Max") || url.includes("search=iPhone%2017%20Pro%20Max")), true);
  assert.equal(calls.some(url => url.includes("type=variation")), false);
  assert.equal(result.observations.some(row => row.price === 1515), true);
  assert.equal(coverageUrl({kind: "woo", endpoint: "https://phonefinity.net/wp-json/wc/store/v1/products"}, "iPhone 17", 1, 20).includes("/?rest_route="), false);
});

test("the storefront diff does not rewrite checkout or availability markup", () => {
  const diff = execSync("git diff -U0 main -- index.html", {encoding: "utf8"});
  for (const needle of ["cardPill", "phoneActsHTML", "applyStock", "Ask for availability", "availText", "CX_UPRICE", "store_state"]) {
    assert.equal(diff.includes(needle), false, needle);
  }
  assert.match(diff, /data-go="market"/);
  assert.match(diff, /market\/admin\.js/);
});
