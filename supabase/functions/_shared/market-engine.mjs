/* Connectify market pricing. Pure functions only: no network, no database, no stock changes. */

export const DEFAULT_SETTINGS = {
  automationEnabled: false,
  writesEnabled: false,
  minMarginPct: null,
  lbpPerUsd: null,
  lbpRateVerified: false,
  productAuto: {},
  appliedKeys: []
};

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function undercut(competitorUsd) {
  const price = Number(competitorUsd);
  if (!Number.isFinite(price) || price <= 0) return {ok: false, reason: "missing_price"};
  let rate;
  if (price <= 100) rate = 0.02;
  else if (price <= 500) rate = 0.01;
  else if (price <= 1000) rate = 0.005;
  else rate = 0.002;
  return {ok: true, rate, target: round2(price * (1 - rate))};
}

export function toUsd(amount, currency, settings) {
  const value = Number(amount);
  const code = String(currency || "").toUpperCase();
  if (!Number.isFinite(value) || value <= 0) return {ok: false, reason: "missing_price"};
  if (code === "USD") return {ok: true, usd: round2(value)};
  if (code === "LBP") {
    const rate = Number(settings && settings.lbpPerUsd);
    if (!(settings && settings.lbpRateVerified) || !(rate > 0)) return {ok: false, reason: "unverified_exchange_rate"};
    return {ok: true, usd: round2(value / rate)};
  }
  return {ok: false, reason: "unsupported_currency"};
}

function clean(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function isAccessory(text) {
  return /\b(cases?|covers?|chargers?|cables?|protectors?|protection|tempered|magsafe|holders?|earbuds?|earphones?|headphones?|adapters?|power\s*banks?|screen\s*guards?|films?|lenses|lens|mounts?|kits?|skins?|bumpers?|pouches|straps?)\b/i.test(text);
}

const COLOR_PHRASES = [
  ["cosmic orange", "cosmic orange"],
  ["deep blue", "deep blue"],
  ["space black", "space black"],
  ["natural titanium", "natural titanium"],
  ["black titanium", "black titanium"],
  ["white titanium", "white titanium"],
  ["blue titanium", "blue titanium"],
  ["desert titanium", "desert titanium"],
  ["pacific blue", "pacific blue"],
  ["sierra blue", "sierra blue"],
  ["alpine green", "alpine green"],
  ["phantom black", "phantom black"],
  ["titanium black", "titanium black"],
  ["titanium gray", "titanium gray"],
  ["titanium grey", "titanium grey"],
  ["titanium violet", "titanium violet"],
  ["cobalt violet", "cobalt violet"],
  ["awesome navy", "awesome navy"],
  ["awesome lightgray", "awesome lightgray"],
  ["jet black", "jetblack"],
  ["jetblack", "jetblack"],
  ["icy blue", "icyblue"],
  ["icyblue", "icyblue"],
  ["product red", "product red"],
  ["midnight", "midnight"],
  ["starlight", "starlight"],
  ["graphite", "graphite"],
  ["ultramarine", "ultramarine"],
  ["lavender", "lavender"],
  ["silver", "silver"],
  ["black", "black"],
  ["white", "white"],
  ["blue", "blue"],
  ["green", "green"],
  ["gold", "gold"],
  ["pink", "pink"],
  ["purple", "purple"],
  ["yellow", "yellow"],
  ["orange", "orange"],
  ["coral", "coral"],
  ["cream", "cream"],
  ["navy", "navy"],
  ["gray", "gray"],
  ["grey", "grey"],
  ["beige", "beige"],
  ["red", "red"]
].sort((a, b) => b[0].length - a[0].length);

export function colorFromText(text) {
  const s = clean(text).toLowerCase();
  if (!s) return null;
  for (const [phrase, canon] of COLOR_PHRASES) {
    const token = phrase.replace(/\s+/g, "\\s+");
    if (new RegExp("\\b" + token + "\\b", "i").test(s)) return canon;
  }
  return null;
}

export function storageFromText(text) {
  const s = clean(text).toLowerCase();
  if (!s) return null;
  const terra = s.match(/(\d+(?:\.\d+)?)\s*terra\b/);
  if (terra) return Number(terra[1]) * 1024;
  const tb = s.match(/(\d+(?:\.\d+)?)\s*tb\b/);
  if (tb) return Number(tb[1]) * 1024;
  const gb = s.match(/(\d+(?:\.\d+)?)\s*gb\b/);
  if (gb) return Number(gb[1]);
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return null;
}

export function simFromText(text) {
  const s = clean(text);
  if (!s) return null;
  if (/e-?\s*sim\s*only/i.test(s)) return "esim";
  if (/\bdual\b/i.test(s)) return "dual";
  if (/nano|physical|1\s*sim|single\s*sim/i.test(s)) return "psim";
  if (/\besim\b|e-sim/i.test(s)) return "esim";
  return null;
}

function modelFrom(text) {
  const s = clean(text);
  const rules = [
    [/iphone\s*air\b/i, "apple", () => "air"],
    [/iphone\s*(\d+)\s*pro\s*max/i, "apple", m => m[1] + "promax"],
    [/iphone\s*(\d+)\s*pro\b/i, "apple", m => m[1] + "pro"],
    [/iphone\s*(\d+)\s*plus/i, "apple", m => m[1] + "plus"],
    [/iphone\s*(\d+)\s*(?:mini|e)\b/i, "apple", m => m[1] + (/\bmini\b/i.test(m[0]) ? "mini" : "e")],
    [/iphone\s*(\d+)\b/i, "apple", m => m[1]],
    [/galaxy\s*(?:s\s*)?(\d+)\s*ultra/i, "samsung", m => "s" + m[1] + "ultra"],
    [/galaxy\s*(?:s\s*)?(\d+)\s*(?:plus|\+)/i, "samsung", m => "s" + m[1] + "plus"],
    [/galaxy\s*s\s*(\d+)\b/i, "samsung", m => "s" + m[1]],
    [/galaxy\s*z\s*fold\s*(\d+)/i, "samsung", m => "fold" + m[1]],
    [/galaxy\s*z\s*flip\s*(\d+)/i, "samsung", m => "flip" + m[1]],
    [/galaxy\s*tab\s*([a-z0-9]+)/i, "samsung", m => "tab" + m[1].toLowerCase()],
    [/galaxy\s*a\s*(\d+)/i, "samsung", m => "a" + m[1]],
    [/redmi\s*note\s*(\d+)\s*pro\s*\+/i, "xiaomi", m => "redminote" + m[1] + "proplus"],
    [/redmi\s*note\s*(\d+)\s*pro/i, "xiaomi", m => "redminote" + m[1] + "pro"],
    [/redmi\s*note\s*(\d+)/i, "xiaomi", m => "redminote" + m[1]],
    [/poco\s*([a-z]\d+)/i, "xiaomi", m => "poco" + m[1].toLowerCase()],
    [/ipad\s*pro\b/i, "apple", () => "ipadpro"],
    [/ipad\s*air\b/i, "apple", () => "ipadair"],
    [/ipad\b/i, "apple", () => "ipad"]
  ];
  for (const [re, brand, model] of rules) {
    const found = s.match(re);
    if (found) return {brand, model: isAccessory(s) ? null : model(found)};
  }
  const brand = /samsung|galaxy/i.test(s) ? "samsung"
    : /apple|iphone|ipad/i.test(s) ? "apple"
    : /xiaomi|redmi|poco/i.test(s) ? "xiaomi"
    : /infinix/i.test(s) ? "infinix"
    : /tecno/i.test(s) ? "tecno"
    : /honor/i.test(s) ? "honor"
    : null;
  return {brand, model: null};
}

export function parseSpecs(text, hints) {
  const s = clean(text);
  const extra = hints || {};
  const identity = modelFrom(s + " " + (extra.name || ""));
  let storage = null;
  let ram = null;
  const ramWord = s.match(/(\d+(?:\.\d+)?)\s*gb\s*ram\b/i);
  if (ramWord) ram = Number(ramWord[1]);
  const pair = s.match(/(\d+(?:\.\d+)?)\s*gb\s*\/\s*(\d+(?:\.\d+)?)\s*(gb|tb)\b/i)
    || s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(gb|tb)\b/i);
  if (pair) {
    ram = ram == null ? Number(pair[1]) : ram;
    storage = pair[3].toLowerCase() === "tb" ? Number(pair[2]) * 1024 : Number(pair[2]);
  }
  if (storage == null) {
    const terra = s.match(/(\d+(?:\.\d+)?)\s*terra\b/i);
    if (terra) storage = Number(terra[1]) * 1024;
  }
  if (storage == null) {
    const sizes = [];
    const re = /(\d+(?:\.\d+)?)\s*(tb|gb)\b/ig;
    let m;
    while ((m = re.exec(s))) {
      if (/mah/i.test(s.slice(Math.max(0, m.index - 6), m.index + m[0].length + 4))) continue;
      const gb = m[2].toLowerCase() === "tb" ? Number(m[1]) * 1024 : Number(m[1]);
      if (ram != null && gb === ram) continue;
      sizes.push(gb);
    }
    if (sizes.length) storage = Math.max(...sizes);
  }
  let condition = null;
  if (/like[\s-]*new/i.test(s)) condition = "likenew";
  else if (/open\s*box/i.test(s)) condition = "open";
  else if (/refurb/i.test(s)) condition = "refurb";
  else if (/\bused\b/i.test(s)) condition = "used";
  else if (/\bnew\b/i.test(s)) condition = "new";
  const sim = simFromText(s);
  const warranty = s.match(/(\d+)\s*year/i);
  let region = null;
  const regionMatch = s.match(/\b(uk|usa|us|hong kong|hk|eu|uae|ae|japan|china)\b/i);
  if (regionMatch) region = regionMatch[1].toLowerCase().replace("usa", "us").replace("hong kong", "hk").replace("uae", "ae");
  const hintedStorage = extra.storage != null && extra.storage !== "" ? storageFromText(extra.storage) : null;
  const specs = {
    brand: identity.brand || extra.brand || null,
    model: isAccessory(s) ? null : (extra.model || identity.model),
    storage: hintedStorage != null ? hintedStorage : storage,
    ram: extra.ram != null && extra.ram !== "" ? Number(extra.ram) : ram,
    condition: extra.condition || condition,
    sim: extra.sim || sim,
    color: extra.color ? (colorFromText(extra.color) || String(extra.color).toLowerCase()) : colorFromText(s),
    warrantyYears: extra.warrantyYears != null && extra.warrantyYears !== "" ? Number(extra.warrantyYears) : (warranty ? Number(warranty[1]) : null),
    region: extra.region || region
  };
  return specs;
}

function wooAmount(prices) {
  if (!prices || prices.price == null || prices.price === "") return {ok: false, reason: "missing_price"};
  const raw = Number(prices.price);
  const minor = Number(prices.currency_minor_unit ?? 2);
  if (!Number.isFinite(raw) || raw <= 0) return {ok: false, reason: "missing_price"};
  const range = prices.price_range;
  if (range && range.min_amount != null && range.max_amount != null && String(range.min_amount) !== String(range.max_amount)) {
    return {ok: false, reason: "variant_price_range"};
  }
  return {ok: true, amount: round2(raw / (10 ** minor)), currency: prices.currency_code || ""};
}

function attrMap(attributes) {
  const out = {};
  for (const attr of attributes || []) {
    const name = clean(attr.name || attr.taxonomy || "").toLowerCase();
    let values = (attr.terms || attr.options || []).map(term => clean(term.name || term.value || term)).filter(Boolean);
    if (!values.length && attr.value) values = [clean(attr.value)];
    if (name && values.length === 1) out[name] = values[0];
  }
  return out;
}

function sharedAttr(variations, names) {
  const objects = (variations || []).filter(item => item && typeof item === "object");
  if (!objects.length) return null;
  const values = [];
  for (const variation of objects) {
    const attrs = attrMap(variation.attributes);
    let found = null;
    for (const name of names) {
      if (attrs[name]) { found = attrs[name]; break; }
    }
    if (!found) return null;
    values.push(found);
  }
  if (new Set(values.map(value => value.toLowerCase())).size !== 1) return null;
  return values[0];
}

function wooHints(attrs) {
  return {
    color: colorFromText((attrs && (attrs.color || attrs.colour)) || "") || null,
    storage: storageFromText((attrs && (attrs.storage || attrs["storage-capacity"] || attrs.capacity)) || ""),
    sim: simFromText((attrs && (attrs.sim || attrs["sim-type"] || attrs["sim type"])) || "")
  };
}

export function observationsFromWoo(store, product, checkedAt) {
  const name = clean(product && product.name);
  const when = checkedAt || null;
  const base = {
    store: store.name,
    sourceId: store.id,
    url: product && product.permalink || "",
    checkedAt: when,
    currency: store.currency || "USD"
  };
  if (!product || !name) return [{...base, name: name || "", price: null, available: null, status: "failed", error: "missing_product", specs: parseSpecs("")}];
  const variations = Array.isArray(product.variations) ? product.variations : [];
  const detailed = variations.filter(v => v && typeof v === "object" && ((v.prices && v.prices.price != null && v.prices.price !== "") || (v.price != null && v.price !== "")));
  let rows = detailed.length ? detailed : (product.type === "variation" || product.type === "simple" || !variations.length ? [product] : []);
  const parentMoney = wooAmount(product.prices);
  const parentRange = product.prices && product.prices.price_range;
  const parentRanged = parentRange && parentRange.min_amount != null && parentRange.max_amount != null && String(parentRange.min_amount) !== String(parentRange.max_amount);
  const usingParent = !rows.length && !parentRanged && parentMoney.ok;
  if (usingParent) rows = [product];
  const shared = usingParent ? {
    color: sharedAttr(variations, ["color", "colour"]),
    storage: sharedAttr(variations, ["storage", "storage-capacity", "capacity"]),
    sim: sharedAttr(variations, ["sim", "sim-type", "sim type"])
  } : {};
  if (!rows.length) {
    return [{
      ...base, name, price: null, available: null, status: "incomplete",
      error: parentRanged ? "variant_price_range" : "needs_variant",
      specs: parseSpecs(name)
    }];
  }
  return rows.map(row => {
    const prices = row.prices || product.prices;
    const money = wooAmount(prices);
    const attrs = attrMap(row.attributes || product.attributes);
    const hints = row === product && usingParent ? {
      color: colorFromText(shared.color || "") || null,
      storage: storageFromText(shared.storage || ""),
      sim: simFromText(shared.sim || "")
    } : wooHints(attrs);
    const label = [name, clean(row.name && row.name !== name ? row.name : ""), shared.color, shared.storage, shared.sim, attrs.color, attrs.storage, attrs["storage-capacity"]].filter(Boolean).join(" ");
    const available = row.is_in_stock != null ? !!row.is_in_stock : (product.is_in_stock != null ? !!product.is_in_stock : null);
    const specs = parseSpecs(label, {
      color: hints.color || null,
      storage: hints.storage,
      sim: hints.sim
    });
    let status = "ok";
    let error = "";
    if (!money.ok) { status = "incomplete"; error = money.reason; }
    else if (available == null) { status = "unverified_stock"; error = "stock_not_stated"; }
    else if (!available) { status = "out_of_stock"; }
    if (/pre-?\s*order/i.test(label)) { status = "incomplete"; error = "preorder"; }
    return {
      ...base,
      name: clean(label),
      url: row.permalink || base.url,
      price: money.ok ? money.amount : null,
      currency: money.ok ? (money.currency || base.currency) : base.currency,
      available: available === true,
      status, error, specs
    };
  }).filter(row => !store.brandAllow || (row.specs.brand && store.brandAllow.includes(row.specs.brand)));
}

export function observationsFromShopify(store, product, checkedAt) {
  const title = clean(product && product.title);
  const handle = product && product.handle;
  const when = checkedAt || null;
  if (!product || !title) return [];
  const brandHint = clean(product.vendor);
  return (product.variants || []).map(variant => {
    const options = {};
    (product.options || []).forEach((opt, i) => {
      const key = clean(opt.name).toLowerCase();
      options[key] = variant["option" + (i + 1)] && variant["option" + (i + 1)] !== "Default Title" ? variant["option" + (i + 1)] : "";
    });
    const bits = [title, options.color, options.storage, options.capacity, variant.title !== "Default Title" ? variant.title : ""].filter(Boolean);
    const label = clean(bits.join(" "));
    const price = variant.price == null || variant.price === "" ? null : Number(variant.price);
    const available = variant.available;
    const specs = parseSpecs(label, {color: options.color || null, brand: /samsung/i.test(brandHint) && !identityBrand(title) ? "samsung" : null});
    let status = "ok";
    let error = "";
    if (!Number.isFinite(price) || price <= 0) { status = "incomplete"; error = "missing_price"; }
    else if (available == null) { status = "unverified_stock"; error = "stock_not_stated"; }
    else if (!available) status = "out_of_stock";
    if (/pre-?\s*order/i.test(label)) { status = "incomplete"; error = "preorder"; }
    return {
      store: store.name,
      sourceId: store.id,
      name: label,
      price: Number.isFinite(price) && price > 0 ? round2(price) : null,
      currency: store.currency || "USD",
      url: handle ? store.origin + "/products/" + handle + (variant.id ? "?variant=" + variant.id : "") : "",
      available: available === true,
      checkedAt: when,
      status, error, specs
    };
  }).filter(row => !store.brandAllow || (row.specs.brand && store.brandAllow.includes(row.specs.brand)));
}

export function observationsFromShopifySuggest(store, payload, checkedAt) {
  const products = ((((payload || {}).resources || {}).results || {}).products) || [];
  const when = checkedAt || null;
  return products.flatMap(product => {
    const title = clean(product && product.title);
    if (!title) return [];
    const min = Number(product.price_min != null ? product.price_min : product.price);
    const max = Number(product.price_max != null ? product.price_max : product.price);
    const handle = product.handle || "";
    const specs = parseSpecs(title, {brand: /samsung/i.test(product.vendor || "") ? "samsung" : null});
    const url = handle ? store.origin + "/products/" + handle : "";
    const single = Number.isFinite(min) && Number.isFinite(max) && min > 0 && min === max;
    let status = "ok";
    let error = "";
    if (!single) { status = "incomplete"; error = "variant_price_range"; }
    else if (product.available == null) { status = "unverified_stock"; error = "stock_not_stated"; }
    else if (!product.available) status = "out_of_stock";
    if (/pre-?\s*order/i.test(title)) { status = "incomplete"; error = "preorder"; }
    return [{
      store: store.name, sourceId: store.id, name: title, handle,
      price: single && status !== "incomplete" ? round2(min) : null,
      currency: store.currency || "USD", url, available: product.available === true,
      checkedAt: when, status, error, specs
    }];
  }).filter(row => !store.brandAllow || (row.specs.brand && store.brandAllow.includes(row.specs.brand)));
}

export function observationsFromShopifyJs(store, product, checkedAt) {
  const variants = ((product && product.variants) || []).map(variant => Object.assign({}, variant, {
    price: Number.isFinite(Number(variant.price)) ? (Number(variant.price) / 100).toFixed(2) : ""
  }));
  return observationsFromShopify(store, Object.assign({}, product, {variants}), checkedAt);
}

export function coverageQueries(catalog) {
  const seen = new Set();
  const queries = [];
  for (const sku of catalog || []) {
    if (!sku || sku.kind !== "phone" || !sku.title) continue;
    const key = sku.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push({text: sku.title, brand: (sku.specs && sku.specs.brand) || null});
  }
  return queries;
}

export function coverageUrl(source, query, page, perPage) {
  if (source.kind === "woo") {
    const url = new URL(source.endpoint);
    url.searchParams.set("search", query);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    return url.toString();
  }
  const url = new URL("/search/suggest.json", source.origin);
  url.searchParams.set("q", query);
  url.searchParams.set("resources[type]", "product");
  url.searchParams.set("resources[limit]", String(Math.min(10, perPage)));
  return url.toString();
}

export function matchReport(catalog, observations, settings) {
  const result = evaluate(catalog, observations, settings, observations);
  const phones = (catalog || []).filter(sku => sku.kind === "phone");
  const bySku = new Map(result.proposals.map(row => [row.sku, row]));
  const high = [];
  const review = [];
  const unmatched = [];
  for (const sku of phones) {
    const row = bySku.get(sku.sku);
    const reviews = result.matches.filter(match => match.sku && match.sku.sku === sku.sku && match.level === "review")
      .sort((a, b) => (a.reasons || []).length - (b.reasons || []).length);
    const closest = reviews[0] || null;
    const entry = {
      sku: sku.sku, title: sku.title, detail: sku.detail || "",
      store: row && row.confidence === "high" ? row.store : (closest && closest.obs ? closest.obs.store : ""),
      competitor: row ? row.competitor : null,
      block: row ? row.block : "no_verified_price",
      confidence: row ? row.confidence : "none",
      reasons: row && row.confidence === "high" ? [] : (closest ? closest.reasons : [])
    };
    if (row && row.confidence === "high") high.push(entry);
    else if (row && row.confidence === "review") review.push(entry);
    else unmatched.push(entry);
  }
  return {relevant: phones.length, high: high.length, review: review.length, unmatched: unmatched.length, highSkus: high, reviewSkus: review, unmatchedSkus: unmatched};
}

const FACT_FIELDS = ["warrantyYears", "region", "sim", "condition"];

export function applyVerifiedFacts(sku, facts) {
  if (!sku || !facts || facts.verified !== true) return sku;
  const specs = Object.assign({}, sku.specs);
  for (const field of FACT_FIELDS) {
    const value = facts[field];
    if (value == null || value === "") continue;
    if (specs[field] != null && specs[field] !== "") continue;
    specs[field] = field === "warrantyYears" ? Number(value) : value;
  }
  return Object.assign({}, sku, {specs, factsVerified: true});
}

export function readStoredOffer(record, gate) {
  if (!record || record.key == null) return {ok: false, reason: "no_readback"};
  if (!gate || !gate.ref) return {ok: false, reason: "missing_sku"};
  if (gate.kind === "phone") {
    if (record.key !== "units") return {ok: false, reason: "wrong_key"};
    const units = Array.isArray(record.data) ? record.data : [];
    const unit = units.find(item => item && item.id === gate.ref.unit);
    if (!unit) return {ok: false, reason: "missing_sku"};
    return {ok: true, price: unit.p, qty: unit.qty, color: unit.c, storage: unit.st, sim: unit.sim, cond: unit.cond};
  }
  if (gate.kind === "ph") {
    if (record.key !== "ph") return {ok: false, reason: "wrong_key"};
    const data = record.data && typeof record.data === "object" ? record.data : {};
    const box = data[gate.ref.id];
    const variants = box && box.v && typeof box.v === "object" ? box.v : {};
    const ov = variants[gate.ref.vi] || variants[String(gate.ref.vi)] || null;
    return {ok: true, price: ov && ov.p != null ? Number(ov.p) : null, qty: ov && ov.q != null ? ov.q : null, variant: gate.ref.vi};
  }
  return {ok: false, reason: "unknown_kind"};
}

export function inspectStored(record, gate, expected) {
  const offer = readStoredOffer(record, gate);
  if (!offer.ok) return offer;
  const wanted = expected || {};
  if (gate.kind === "phone") {
    for (const field of ["color", "storage", "sim", "cond"]) {
      if (wanted[field] != null && String(offer[field]) !== String(wanted[field])) {
        return {ok: false, reason: "variant_changed", offer};
      }
    }
  }
  const price = offer.price != null ? offer.price : (wanted.catalogPrice != null ? wanted.catalogPrice : null);
  return {ok: true, offer: Object.assign({}, offer, {price}), priceMatches: Number(price) === Number(gate.price), qty: offer.qty};
}

export function confirmReadback(record, gate, expected) {
  const inspected = inspectStored(record, gate, expected);
  if (!inspected.ok) return inspected;
  if (!inspected.priceMatches) return {ok: false, reason: "price_mismatch", offer: inspected.offer};
  return {ok: true, offer: inspected.offer};
}

export const COLLECTOR_STAGING_HOST = "akgilfixljswqljmedmg.supabase.co";
export const COLLECTOR_PRODUCTION_HOST = "yxkzjwcmmtiljakttyfh.supabase.co";

export function assertCollectorTarget(url) {
  let parsed;
  try { parsed = new URL(String(url || "")); }
  catch { return {ok: false, status: 403, reason: "refusing unset project"}; }
  if (parsed.protocol !== "https:") return {ok: false, status: 403, reason: "refusing non-https project"};
  if (parsed.host === COLLECTOR_PRODUCTION_HOST) return {ok: false, status: 403, reason: "refusing production project"};
  if (parsed.host !== COLLECTOR_STAGING_HOST) return {ok: false, status: 403, reason: "market-check is limited to the staging project"};
  return {ok: true, status: 200, host: parsed.host};
}

export function commercialDrift(beforeUnits, beforeOrders, afterUnits, afterOrders) {
  const beforeU = new Map((beforeUnits || []).map(unit => [unit && unit.id, unit]));
  const afterU = new Map((afterUnits || []).map(unit => [unit && unit.id, unit]));
  let pricesChanged = 0;
  let stockChanged = 0;
  for (const id of new Set([...beforeU.keys(), ...afterU.keys()])) {
    const before = beforeU.get(id);
    const after = afterU.get(id);
    if (!before || !after || Number(before.p) !== Number(after.p)) pricesChanged += 1;
    if (!before || !after || Number(before.qty) !== Number(after.qty)) stockChanged += 1;
  }
  const beforeO = new Map((beforeOrders || []).map(order => [order && order.id, order]));
  const afterO = new Map((afterOrders || []).map(order => [order && order.id, order]));
  let ordersChanged = 0;
  for (const id of new Set([...beforeO.keys(), ...afterO.keys()])) {
    const before = beforeO.get(id);
    const after = afterO.get(id);
    const sameItems = before && after && JSON.stringify(before.items || []) === JSON.stringify(after.items || []);
    if (!before || !after || before.status !== after.status || before.stock_applied !== after.stock_applied || before.code !== after.code || !sameItems) ordersChanged += 1;
  }
  return {pricesChanged, stockChanged, ordersChanged};
}

export function schedulerDecision(env, header, config) {
  const secret = env && String(env.MARKET_SCHEDULER_SECRET || "");
  if (!secret) return {ok: false, status: 403, reason: "scheduler secret is not configured"};
  if (!header || header !== secret) return {ok: false, status: 403, reason: "scheduler unauthorized"};
  if (!config || config.enabled !== true) return {ok: false, status: 403, reason: "scheduler disabled"};
  return {ok: true, status: 200, reason: "ok"};
}

export function selectCoverageBatch(queries, sources, config) {
  const maxRequests = Math.min(40, Math.max(1, Number(config && config.max_requests) || 24));
  const offset = Math.max(0, Number(config && config.next_offset) || 0);
  const pairs = [];
  const skipped = [];
  for (const query of queries || []) {
    for (const source of sources || []) {
      if (source.brandAllow && query.brand && !source.brandAllow.includes(query.brand)) {
        skipped.push({store: source.id, query: query.text, reason: "brand_not_sold"});
        continue;
      }
      pairs.push({store: source.id, query: query.text, brand: query.brand || null});
    }
  }
  const selected = pairs.slice(offset, offset + maxRequests);
  const deferred = pairs.slice(0, offset).concat(pairs.slice(offset + maxRequests)).map(pair => ({store: pair.store, query: pair.query, reason: "request_cap"}));
  const nextOffset = !pairs.length || offset + selected.length >= pairs.length ? 0 : offset + selected.length;
  return {selected, skipped: skipped.concat(deferred), nextOffset, eligible: pairs.length};
}

export function decideRecord(state, input) {
  const box = state || {};
  const decisions = box.decisions || (box.decisions = []);
  if (!input || input.staff !== true) return {ok: false, reason: "staff only"};
  const status = input.status;
  if (!["approved", "rejected", "applied", "restored"].includes(status)) return {ok: false, reason: "bad status"};
  const settings = box.settings || {};
  if (status === "applied") {
    const mode = input.mode || "manual";
    if (!(Number(input.target) > 0)) return {ok: false, reason: "missing target"};
    if (!input.applyKey) return {ok: false, reason: "missing apply key"};
    if (decisions.some(row => row.status === "applied" && row.apply_key === input.applyKey)) return {ok: false, reason: "already applied"};
    if (mode === "automatic") {
      if (settings.automation_enabled !== true || settings.writes_enabled !== true) return {ok: false, reason: "automation disabled"};
      if (!(box.flags && box.flags[input.sku] === true)) return {ok: false, reason: "product disabled"};
    } else if (mode !== "manual") return {ok: false, reason: "bad mode"};
    else {
      const reviews = decisions.filter(row => row.sku === input.sku && (row.status === "approved" || row.status === "rejected"));
      const latest = reviews[reviews.length - 1];
      if (!latest || latest.status !== "approved" || Number(latest.target_price) !== Number(input.target)) return {ok: false, reason: "not approved"};
    }
  }
  const row = {
    id: "d" + (decisions.length + 1),
    sku: input.sku,
    status,
    target_price: input.target == null ? null : Number(input.target),
    previous_price: input.previous == null ? null : Number(input.previous),
    apply_key: status === "applied" ? input.applyKey : null,
    proposal: input.proposal || {},
    created_at: input.now || new Date().toISOString()
  };
  decisions.push(row);
  return {ok: true, id: row.id, row};
}

export function parseManualCsv(text, checkedAt) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(s => s.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const start = header.includes("store") ? 1 : 0;
  const cols = start ? header : ["store", "name", "price", "currency", "url", "available"];
  return lines.slice(start).map(line => {
    const cells = line.split(",").map(s => s.trim());
    const get = name => {
      const at = cols.indexOf(name);
      return at >= 0 ? cells[at] || "" : "";
    };
    const price = get("price") === "" ? null : Number(get("price"));
    const availableWord = get("available").toLowerCase();
    const available = availableWord === "in_stock" || availableWord === "true" || availableWord === "yes" ? true
      : availableWord === "out_of_stock" || availableWord === "false" || availableWord === "no" ? false : null;
    const specs = parseSpecs(get("name"), {
      brand: get("brand") || null,
      model: get("model") || null,
      storage: get("storage") || null,
      ram: get("ram") || null,
      condition: get("condition") || null,
      sim: get("sim") || null,
      color: get("color") || null,
      warrantyYears: get("warranty") || null,
      region: get("region") || null
    });
    let status = "ok";
    let error = "";
    if (!get("store") || !get("name")) { status = "failed"; error = "missing_identity"; }
    else if (!Number.isFinite(price) || price <= 0) { status = "incomplete"; error = "missing_price"; }
    else if (available == null) { status = "unverified_stock"; error = "stock_not_stated"; }
    else if (!available) status = "out_of_stock";
    return {
      store: get("store"),
      sourceId: "manual",
      name: get("name"),
      price: Number.isFinite(price) && price > 0 ? round2(price) : null,
      currency: (get("currency") || "USD").toUpperCase(),
      url: get("url"),
      available: available === true,
      checkedAt: get("checked_at") || checkedAt || null,
      status, error, specs
    };
  });
}

function same(a, b) {
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function matchPair(sku, obs) {
  const a = sku.specs || {};
  const b = (obs && obs.specs) || {};
  if (!a.brand || !b.brand || !same(a.brand, b.brand)) return {level: "reject", reasons: ["brand"]};
  if (!a.model || !b.model || !same(a.model, b.model)) return {level: "reject", reasons: ["model"]};
  const reasons = [];
  let uncertain = false;
  for (const field of ["storage", "ram", "condition", "sim", "color", "warrantyYears", "region"]) {
    const left = a[field];
    const right = b[field];
    const leftMissing = left == null || left === "";
    const rightMissing = right == null || right === "";
    if (leftMissing && rightMissing) continue;
    if (leftMissing || rightMissing) { uncertain = true; reasons.push("missing_" + field); continue; }
    if (!same(left, right)) return {level: "reject", reasons: ["conflict_" + field]};
  }
  if (sku.kind === "phone") {
    for (const field of ["storage", "condition", "sim"]) {
      if (a[field] == null || b[field] == null) uncertain = true;
    }
  }
  if (uncertain) return {level: "review", reasons};
  return {level: "high", reasons: []};
}

function identityBrand(text) {
  return modelFrom(text).brand;
}

function latestObservations(observations) {
  const best = new Map();
  for (const obs of observations || []) {
    const key = [obs && obs.store, obs && obs.url, obs && obs.name, obs && obs.currency].join("|");
    const prev = best.get(key);
    if (!prev || String(obs.checkedAt || "") > String(prev.checkedAt || "")) best.set(key, obs);
  }
  return [...best.values()];
}

function jumped(obs, history) {
  const prior = (history || []).filter(row => row.store === obs.store && row.url === obs.url && row.currency === obs.currency && (!row.name || !obs.name || row.name === obs.name) && row.price > 0 && row.checkedAt && obs.checkedAt && row.checkedAt < obs.checkedAt)
    .sort((a, b) => a.checkedAt < b.checkedAt ? 1 : -1)[0];
  if (!prior) return false;
  return Math.abs(obs.price - prior.price) / prior.price > 0.2;
}

export function evaluate(catalog, observations, settings, history) {
  const cfg = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const matches = [];
  for (const obs of latestObservations(observations)) {
    if (!obs || obs.status === "failed") {
      matches.push({obs, sku: null, level: "reject", reasons: [obs && obs.error || "failed"]});
      continue;
    }
    if (obs.status === "out_of_stock" || obs.available === false) {
      matches.push({obs, sku: null, level: "exclude", reasons: ["out_of_stock"]});
      continue;
    }
    if (!(obs.price > 0) || obs.status === "incomplete" || obs.status === "unverified_stock") {
      matches.push({obs, sku: null, level: "exclude", reasons: [obs.error || obs.status || "unusable"]});
      continue;
    }
    const hits = [];
    let rejectReasons = ["no_catalog"];
    for (const sku of catalog || []) {
      const result = matchPair(sku, obs);
      if (result.level === "reject") { rejectReasons = result.reasons; continue; }
      hits.push({obs, sku, level: result.level, reasons: result.reasons});
    }
    if (!hits.length) matches.push({obs, sku: null, level: "reject", reasons: rejectReasons});
    else matches.push(...hits);
  }
  const proposals = (catalog || []).map(sku => {
    const related = matches.filter(m => m.sku && m.sku.sku === sku.sku);
    const usable = [];
    const notes = [];
    for (const match of related) {
      if (match.level !== "high") { notes.push(match.level); continue; }
      const money = toUsd(match.obs.price, match.obs.currency, cfg);
      if (!money.ok) { notes.push(money.reason); continue; }
      if (jumped(match.obs, history)) { notes.push("sudden_change"); continue; }
      usable.push({match, usd: money.usd});
    }
    usable.sort((a, b) => a.usd - b.usd);
    const best = usable[0] || null;
    const cut = best ? undercut(best.usd) : {ok: false};
    let block = null;
    if (!best || !cut.ok) block = "no_verified_price";
    else if (cfg.minMarginPct == null || cfg.minMarginPct === "") block = "margin_not_configured";
    else if (!(Number(sku.cost) > 0)) block = "missing_cost";
    else if (cut.target < round2(Number(sku.cost) * (1 + Number(cfg.minMarginPct) / 100))) block = "below_margin";
    else if (sku.price > 0 && (Math.abs(cut.target - sku.price) / sku.price > 0.15 || Math.abs(cut.target - sku.price) > 150)) block = "unusual_change";
    const target = cut.ok ? cut.target : null;
    return {
      sku: sku.sku,
      kind: sku.kind,
      ref: sku.ref || null,
      title: sku.title,
      detail: sku.detail || "",
      current: sku.price == null ? null : sku.price,
      cost: Number(sku.cost) > 0 ? Number(sku.cost) : null,
      competitor: best ? best.usd : null,
      store: best ? best.match.obs.store : "",
      url: best ? best.match.obs.url : "",
      checkedAt: best ? best.match.obs.checkedAt : "",
      confidence: best ? "high" : (related.some(m => m.level === "review") ? "review" : "none"),
      rate: cut.ok ? cut.rate : null,
      target,
      profit: target != null && Number(sku.cost) > 0 ? round2(target - Number(sku.cost)) : null,
      margin: target != null && Number(sku.cost) > 0 ? round2((target - Number(sku.cost)) / Number(sku.cost) * 100) : null,
      sources: usable.map(row => ({store: row.match.obs.store, price: row.usd, url: row.match.obs.url})),
      block,
      status: block ? "blocked" : "proposed",
      notes
    };
  });
  return {matches, proposals};
}

export function applyKey(proposal) {
  return [proposal.sku, proposal.target, proposal.url, proposal.competitor].join("|");
}

export function canApply(proposal, settings, decision, mode) {
  const cfg = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const path = mode || "manual";
  if (path === "automatic") {
    if (!cfg.automationEnabled || !cfg.writesEnabled) return {ok: false, reason: "automation_disabled"};
    if (!cfg.productAuto || !cfg.productAuto[proposal.sku]) return {ok: false, reason: "product_disabled"};
  } else if (path !== "manual") return {ok: false, reason: "bad_mode"};
  if (decision !== "approved") return {ok: false, reason: "not_approved"};
  if (!proposal || proposal.block || !(proposal.target > 0)) return {ok: false, reason: (proposal && proposal.block) || "no_verified_price"};
  const key = applyKey(proposal);
  if ((cfg.appliedKeys || []).includes(key)) return {ok: false, reason: "already_applied"};
  return {ok: true, reason: "ok", price: proposal.target, previous: proposal.current, key, sku: proposal.sku, ref: proposal.ref, kind: proposal.kind, mode: path};
}

export function canRestore(entry) {
  if (!entry || !(entry.previous > 0) || !entry.sku) return {ok: false, reason: "no_previous_price"};
  return {ok: true, price: entry.previous, sku: entry.sku, ref: entry.ref, kind: entry.kind};
}
