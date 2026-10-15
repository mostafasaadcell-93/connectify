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
  let sim = null;
  if (/e-?\s*sim\s*only/i.test(s)) sim = "esim";
  else if (/dual/i.test(s)) sim = "dual";
  else if (/nano|physical|1\s*sim|single\s*sim/i.test(s)) sim = "psim";
  else if (/\besim\b|e-sim/i.test(s)) sim = "esim";
  const warranty = s.match(/(\d+)\s*year/i);
  let region = null;
  const regionMatch = s.match(/\b(uk|usa|us|hong kong|hk|eu|uae|ae|japan|china)\b/i);
  if (regionMatch) region = regionMatch[1].toLowerCase().replace("usa", "us").replace("hong kong", "hk").replace("uae", "ae");
  const specs = {
    brand: identity.brand || extra.brand || null,
    model: isAccessory(s) ? null : (extra.model || identity.model),
    storage: extra.storage != null ? Number(extra.storage) : storage,
    ram: extra.ram != null ? Number(extra.ram) : ram,
    condition: extra.condition || condition,
    sim: extra.sim || sim,
    color: extra.color ? String(extra.color).toLowerCase() : null,
    warrantyYears: extra.warrantyYears != null ? Number(extra.warrantyYears) : (warranty ? Number(warranty[1]) : null),
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
    const values = (attr.terms || attr.options || []).map(term => clean(term.name || term.value || term)).filter(Boolean);
    if (name && values.length === 1) out[name] = values[0];
  }
  return out;
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
  const detailed = variations.filter(v => v && typeof v === "object" && (v.prices || v.price != null));
  const rows = detailed.length ? detailed : (product.type === "variation" || product.type === "simple" || !variations.length ? [product] : []);
  if (!rows.length) {
    return [{
      ...base, name, price: null, available: null, status: "incomplete", error: "needs_variant",
      specs: parseSpecs(name)
    }];
  }
  return rows.map(row => {
    const prices = row.prices || product.prices;
    const money = wooAmount(prices);
    const attrs = attrMap(row.attributes || product.attributes);
    const label = [name, clean(row.name && row.name !== name ? row.name : ""), attrs.color, attrs.storage, attrs["storage-capacity"]].filter(Boolean).join(" ");
    const available = row.is_in_stock != null ? !!row.is_in_stock : (product.is_in_stock != null ? !!product.is_in_stock : null);
    const specs = parseSpecs(label, {color: attrs.color || null});
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

export function canApply(proposal, settings, decision) {
  const cfg = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  if (!cfg.automationEnabled || !cfg.writesEnabled) return {ok: false, reason: "automation_disabled"};
  if (!cfg.productAuto || !cfg.productAuto[proposal.sku]) return {ok: false, reason: "product_disabled"};
  if (decision !== "approved") return {ok: false, reason: "not_approved"};
  if (!proposal || proposal.block || !(proposal.target > 0)) return {ok: false, reason: (proposal && proposal.block) || "no_verified_price"};
  const key = applyKey(proposal);
  if ((cfg.appliedKeys || []).includes(key)) return {ok: false, reason: "already_applied"};
  return {ok: true, reason: "ok", price: proposal.target, previous: proposal.current, key, sku: proposal.sku, ref: proposal.ref, kind: proposal.kind};
}

export function canRestore(entry, settings) {
  const cfg = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  if (!cfg.writesEnabled) return {ok: false, reason: "writes_disabled"};
  if (!entry || !(entry.previous > 0) || !entry.sku) return {ok: false, reason: "no_previous_price"};
  return {ok: true, price: entry.previous, sku: entry.sku, ref: entry.ref, kind: entry.kind};
}
