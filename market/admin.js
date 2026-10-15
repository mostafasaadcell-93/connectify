import {
  DEFAULT_SETTINGS, parseManualCsv, parseSpecs, evaluate, canApply, canRestore, applyVerifiedFacts, inspectStored, confirmReadback
} from "./engine.mjs";

const state = {
  observations: [],
  ledger: [],
  decisions: {},
  facts: {},
  selected: new Set(),
  settings: Object.assign({}, DEFAULT_SETTINGS, {productAuto: {}, appliedKeys: []}),
  quiet: false,
  loaded: false,
  note: "Scheduled automatic updates are off. You can approve and apply one verified price at a time. Nothing changes until a fresh database read confirms that exact variant."
};

function money(n) { return n == null || n === "" ? "—" : "$" + n; }

function catalog() {
  const items = [];
  (DB.units || []).forEach(unit => {
    const model = modelById(unit.m);
    if (!model) return;
    const cost = DB.priv && DB.priv.u && DB.priv.u[unit.id] && DB.priv.u[unit.id].cost;
    items.push({
      sku: "unit:" + unit.id, kind: "phone", ref: {unit: unit.id}, title: model.name,
      detail: [unit.st + "GB", unit.c, unit.cond, unit.sim].filter(Boolean).join(", "),
      price: unit.p > 0 ? unit.p : null, cost: cost > 0 ? cost : null,
      specs: {
        brand: String(brandOf(model) || "").toLowerCase(), model: unit.m, storage: unit.st, ram: null,
        condition: unit.cond, sim: unit.sim, color: String(unit.c || "").toLowerCase(), warrantyYears: null, region: null
      }
    });
    items[items.length - 1] = applyVerifiedFacts(items[items.length - 1], state.facts[items[items.length - 1].sku]);
  });
  (typeof PHI === "undefined" ? [] : PHI).forEach(product => {
    (product.vars || []).forEach((variant, index) => {
      const live = typeof phV === "function" ? phV(product, index) : variant;
      const costMap = DB.priv && DB.priv.ph && DB.priv.ph[product.id] && DB.priv.ph[product.id].cost;
      const specs = parseFallback(product, live);
      items.push({
        sku: "ph:" + product.id + ":" + index, kind: "ph", ref: {id: product.id, vi: index},
        title: product.name, detail: live.t || "", price: live.p > 0 ? live.p : null,
        cost: costMap && costMap[index] > 0 ? costMap[index] : null, specs
      });
    });
  });
  return items;
}

function parseFallback(product, live) {
  return parseSpecs([product.brand, product.name, live.t].filter(Boolean).join(" "));
}

function renderMarket() {
  const root = $("marketRoot");
  if (!root) return;
  if (!isAuthed()) { root.innerHTML = ""; return; }
  if (!state.loaded && window.LIVE && LIVE.sb) { state.loaded = true; loadAudit(); }
  const kept = $("marketQ") && document.activeElement === $("marketQ") ? $("marketQ").value : ($("marketQ") && $("marketQ").value || "");
  const result = state.observations.length ? evaluate(catalog(), state.observations, state.settings, state.observations) : {matches: [], proposals: []};
  const query = kept.trim().toLowerCase();
  const rows = result.proposals.filter(row => row.confidence !== "none" && (!query || (row.title + " " + row.detail).toLowerCase().includes(query))).slice(0, 80);
  root.innerHTML = `<div class="stockbar">
      <button class="btn btn-main" type="button" id="marketRefresh">Refresh quotes</button>
      <button class="abtn" type="button" id="marketApprove">Approve selected</button>
      <button class="abtn" type="button" id="marketReject">Reject selected</button>
      <button class="abtn" type="button" id="marketApply">Apply approved prices</button>
    </div>
    <p class="mktnote">${esc(state.note)}</p>
    <div class="stockbar">
      <label>Minimum margin % <input id="marketMargin" type="number" min="0" step="0.1" value="${state.settings.minMarginPct == null ? "" : esc(String(state.settings.minMarginPct))}"></label>
      <label>Verified LBP per USD <input id="marketLbp" type="number" min="1" step="1" value="${state.settings.lbpPerUsd == null ? "" : esc(String(state.settings.lbpPerUsd))}"></label>
      <label><input id="marketLbpOk" type="checkbox" ${state.settings.lbpRateVerified ? "checked" : ""}> Rate was checked</label>
      <label><input id="marketAuto" type="checkbox" ${state.settings.automationEnabled && state.settings.writesEnabled ? "checked" : ""}> Scheduled automatic updates</label>
      <button class="abtn" type="button" id="marketSaveSettings">Save rules</button>
    </div>
    <div class="stockbar">
      <label>Product facts <select id="factSku">${catalog().filter(item => item.kind === "phone").map(item => `<option value="${esc(item.sku)}">${esc(item.title)} · ${esc(item.detail)}</option>`).join("")}</select></label>
      <label>Warranty <select id="factWarranty"><option value="">Unknown</option><option value="0">None</option><option value="1">1 year</option><option value="2">2 years</option></select></label>
      <label>Region <select id="factRegion"><option value="">Unknown</option><option value="uk">UK</option><option value="us">US</option><option value="hk">Hong Kong</option><option value="eu">EU</option><option value="ae">UAE</option><option value="japan">Japan</option><option value="china">China</option></select></label>
      <label>SIM <select id="factSim"><option value="">Unknown</option><option value="psim">Nano-SIM + eSIM</option><option value="esim">eSIM only</option><option value="dual">Dual physical</option></select></label>
      <label>Condition <select id="factCondition"><option value="">Unknown</option><option value="new">New</option><option value="open">Open box</option><option value="likenew">Like new</option><option value="used">Used</option><option value="refurb">Refurbished</option></select></label>
      <label><input id="factVerified" type="checkbox"> I verified these facts</label>
      <button class="abtn" type="button" id="marketSaveFacts">Save facts</button>
    </div>
    <p class="mktnote">Unknown facts stay blank. Saving them does not change a price, the stock list, or a competitor quote. Only facts you mark as verified fill gaps, and they never replace a value the inventory already states.</p>
    <textarea id="marketCsv" rows="4" placeholder="store,name,price,currency,url,available,storage,condition,sim,color,warranty,region"></textarea>
    <button class="abtn" type="button" id="marketImport">Import manager prices</button>
    <input id="marketQ" placeholder="Filter shown matches" value="${esc(kept)}">
    <table class="mktable"><thead><tr><th></th><th>Product</th><th>Our price</th><th>Lowest verified</th><th>Recommended</th><th>Profit</th><th>Source</th><th>Checked</th><th>Confidence</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(row => `<tr>
      <td><input type="checkbox" data-sku="${esc(row.sku)}" ${state.selected.has(row.sku) ? "checked" : ""}></td>
      <td><b>${esc(row.title)}</b><br><span class="mktnote">${esc(row.detail)}</span></td>
      <td>${money(row.current)}</td>
      <td>${money(row.competitor)}</td>
      <td>${money(row.target)}</td>
      <td>${row.profit == null ? "—" : money(row.profit) + " (" + row.margin + "%)"}</td>
      <td>${row.url ? `<a href="${esc(row.url)}" target="_blank" rel="noopener">${esc(row.store)}</a>` : esc(row.store || "—")}</td>
      <td>${esc(row.checkedAt || "—")}</td>
      <td>${esc(row.confidence)}</td>
      <td>${esc(state.decisions[row.sku] || row.status)}${row.block ? " · " + esc(row.block) : ""}</td>
      <td><label class="mktnote"><input type="checkbox" data-auto="${esc(row.sku)}" ${state.settings.productAuto[row.sku] ? "checked" : ""}> Auto</label></td>
    </tr>`).join("") || `<tr><td colspan="11">No verified match yet. Out-of-stock, incomplete, and uncertain quotes stay off this list.</td></tr>`}
    </tbody></table>
    <h3>Recent decisions</h3>
    <div class="olist">${state.ledger.slice(0, 12).map(item => `<div class="drow"><span class="grow"><b>${esc(item.sku)}</b><small>${esc(item.status)} ${item.price == null ? "" : "$" + item.price}</small></span>${item.status === "applied" ? `<button class="abtn" type="button" data-restore="${esc(item.key || "")}">Restore previous</button>` : ""}</div>`).join("") || "<p class='mktnote'>No price has been changed from this screen.</p>"}</div>`;
  $("marketRefresh").onclick = refreshQuotes;
  $("marketImport").onclick = importCsv;
  $("marketApprove").onclick = () => decideSelected("approved", rows);
  $("marketReject").onclick = () => decideSelected("rejected", rows);
  $("marketApply").onclick = () => applyApproved(rows);
  $("marketSaveSettings").onclick = saveSettings;
  const factButton = $("marketSaveFacts");
  if (factButton) factButton.onclick = saveFacts;
  const factSku = $("factSku");
  if (factSku) factSku.onchange = showFacts;
  root.querySelectorAll("[data-sku]").forEach(box => box.onchange = () => {
    if (box.checked) state.selected.add(box.dataset.sku); else state.selected.delete(box.dataset.sku);
  });
  root.querySelectorAll("[data-auto]").forEach(box => box.onchange = () => {
    state.settings.productAuto[box.dataset.auto] = box.checked;
  });
  root.querySelectorAll("[data-restore]").forEach(button => button.onclick = () => restore(button.dataset.restore));
  showFacts();
}

function readSettingsForm() {
  const margin = $("marketMargin").value.trim();
  const lbp = $("marketLbp").value.trim();
  state.settings.minMarginPct = margin === "" ? null : Number(margin);
  state.settings.lbpPerUsd = lbp === "" ? null : Number(lbp);
  state.settings.lbpRateVerified = $("marketLbpOk").checked;
  const allow = $("marketAuto").checked;
  state.settings.automationEnabled = allow;
  state.settings.writesEnabled = allow;
}

async function saveSettings() {
  readSettingsForm();
  const requested = state.settings.automationEnabled && state.settings.writesEnabled;
  if (!window.LIVE || !LIVE.sb) {
    state.settings.automationEnabled = false;
    state.settings.writesEnabled = false;
    state.note = "Database settings are unavailable, so scheduled updates stay off. Selling prices were not changed.";
    renderMarket();
    return;
  }
  const {error} = await LIVE.sb.from("market_settings").update({
    automation_enabled: requested,
    writes_enabled: requested,
    min_margin_pct: state.settings.minMarginPct,
    lbp_per_usd: state.settings.lbpPerUsd,
    lbp_rate_verified: state.settings.lbpRateVerified,
    updated_at: new Date().toISOString()
  }).eq("id", 1);
  if (error) {
    state.settings.automationEnabled = false;
    state.settings.writesEnabled = false;
    state.note = "The audit settings table is not installed, so scheduled updates stay off. " + error.message;
    renderMarket();
    return;
  }
  for (const [sku, on] of Object.entries(state.settings.productAuto)) {
    const saved = await LIVE.sb.from("market_product_flags").upsert({sku, auto_enabled: !!on, updated_at: new Date().toISOString()});
    if (saved.error) {
      state.settings.automationEnabled = false;
      state.settings.writesEnabled = false;
      state.note = "Product rules could not be saved, so scheduled updates stay off. " + saved.error.message;
      renderMarket();
      return;
    }
  }
  state.settings.automationEnabled = requested;
  state.settings.writesEnabled = requested;
  state.note = requested
    ? "Scheduled updates were saved for products marked Auto. They still do not run until that job is turned on."
    : "Rules saved. Scheduled automatic updates stay off. You can still apply an approved price.";
  renderMarket();
}

function factPayload(sku) {
  const warranty = $("factWarranty").value;
  const region = $("factRegion").value;
  const sim = $("factSim").value;
  const condition = $("factCondition").value;
  const verified = $("factVerified").checked;
  return {
    sku,
    warranty_years: warranty === "" ? null : Number(warranty),
    region: region || null,
    sim: sim || null,
    condition: condition || null,
    verified,
    verified_at: verified ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  };
}

function factsForSku(row) {
  if (!row) return null;
  return {
    verified: row.verified === true,
    warrantyYears: row.warranty_years == null ? null : Number(row.warranty_years),
    region: row.region || null,
    sim: row.sim || null,
    condition: row.condition || null
  };
}

function showFacts() {
  const sku = $("factSku") && $("factSku").value;
  const row = sku && state.facts[sku];
  if ($("factWarranty")) $("factWarranty").value = row && row.warrantyYears != null ? String(row.warrantyYears) : "";
  if ($("factRegion")) $("factRegion").value = row && row.region || "";
  if ($("factSim")) $("factSim").value = row && row.sim || "";
  if ($("factCondition")) $("factCondition").value = row && row.condition || "";
  if ($("factVerified")) $("factVerified").checked = !!(row && row.verified);
}

async function saveFacts() {
  const sku = $("factSku") && $("factSku").value;
  if (!sku) { state.note = "Choose a product before saving facts."; renderMarket(); return; }
  const body = factPayload(sku);
  if (!window.LIVE || !LIVE.sb) {
    state.note = "Facts were not stored. The audit table is unavailable, and no price was changed.";
    renderMarket();
    return;
  }
  const {error} = await LIVE.sb.from("market_sku_facts").upsert(body);
  if (error) {
    state.note = "Facts were not stored. " + error.message;
    renderMarket();
    return;
  }
  state.facts[sku] = factsForSku(body);
  state.note = body.verified
    ? "Verified facts saved for " + sku + ". Selling prices were not changed."
    : "Facts saved as unverified, so matching still ignores them. Selling prices were not changed.";
  renderMarket();
  if ($("factSku")) $("factSku").value = sku;
  showFacts();
}

function importCsv() {
  const rows = parseManualCsv($("marketCsv").value, new Date().toISOString());
  state.observations = rows;
  state.note = rows.length ? "Imported " + rows.length + " manager quotes. Prices on the store were not changed." : "No rows found.";
  renderMarket();
}

async function loadAudit() {
  if (!window.LIVE || !LIVE.sb) return;
  const settings = await LIVE.sb.from("market_settings").select("automation_enabled,writes_enabled,min_margin_pct,lbp_per_usd,lbp_rate_verified").eq("id", 1).maybeSingle();
  if (!settings.error && settings.data) {
    state.settings.automationEnabled = settings.data.automation_enabled === true;
    state.settings.writesEnabled = settings.data.writes_enabled === true;
    state.settings.minMarginPct = settings.data.min_margin_pct == null ? null : Number(settings.data.min_margin_pct);
    state.settings.lbpPerUsd = settings.data.lbp_per_usd == null ? null : Number(settings.data.lbp_per_usd);
    state.settings.lbpRateVerified = settings.data.lbp_rate_verified === true;
  }
  const flags = await LIVE.sb.from("market_product_flags").select("sku,auto_enabled");
  if (!flags.error && flags.data) {
    state.settings.productAuto = {};
    flags.data.forEach(row => { state.settings.productAuto[row.sku] = row.auto_enabled === true; });
  }
  const saved = await LIVE.sb.from("market_decisions").select("sku,status,target_price,previous_price,apply_key,created_at").order("created_at", {ascending: false}).limit(200);
  if (saved.error) {
    state.note = "Saved decisions could not be loaded. " + saved.error.message;
    renderMarket();
    return;
  }
  state.decisions = {};
  state.ledger = [];
  state.settings.appliedKeys = [];
  (saved.data || []).slice().reverse().forEach(row => {
    if (row.status === "approved" || row.status === "rejected") state.decisions[row.sku] = row.status;
    if (row.status === "applied" && row.apply_key) state.settings.appliedKeys.push(row.apply_key);
    if (row.status === "applied" || row.status === "restored") {
      state.ledger.unshift({
        sku: row.sku, status: row.status, price: row.target_price == null ? null : Number(row.target_price),
        previous: row.previous_price == null ? null : Number(row.previous_price), key: row.apply_key || ""
      });
    }
  });
  const facts = await LIVE.sb.from("market_sku_facts").select("sku,warranty_years,region,sim,condition,verified");
  if (!facts.error && facts.data) {
    state.facts = {};
    facts.data.forEach(row => { state.facts[row.sku] = factsForSku(row); });
  }
  const quotes = await LIVE.sb.from("market_observations").select("store,name,price,currency,url,available,checked_at,specs,status,error").order("checked_at", {ascending: false}).limit(1000);
  if (!quotes.error && quotes.data && quotes.data.length) {
    state.observations = quotes.data.map(observationFromRow);
  }
  state.note = "Loaded saved decisions. Scheduled automatic updates are " + (state.settings.automationEnabled ? "on" : "off") + ".";
  renderMarket();
}

function observationFromRow(row) {
  return {
    store: row.store, name: row.name, price: row.price == null ? null : Number(row.price), currency: row.currency,
    url: row.url, available: row.available === true, checkedAt: row.checked_at, specs: row.specs || {}, status: row.status, error: row.error || ""
  };
}

async function refreshQuotes() {
  state.note = "Asking the store database to collect public quotes. Selling prices are not part of that request.";
  renderMarket();
  if (!window.LIVE || !LIVE.sb) { state.note = "Refresh needs the store database. Use manager import until then."; renderMarket(); return; }
  const queries = [];
  const seen = new Set();
  catalog().forEach(item => {
    if (item.kind !== "phone" || seen.has(item.title)) return;
    seen.add(item.title);
    queries.push({text: item.title, brand: item.specs.brand || null});
  });
  const {data, error} = await LIVE.sb.functions.invoke("market-check", {body: {queries: queries.slice(0, 12)}});
  if (error) { state.note = "Quote refresh is not deployed yet. Use manager import. " + (error.message || ""); renderMarket(); return; }
  const {data: stored, error: readError} = await LIVE.sb.from("market_observations").select("store,name,price,currency,url,available,checked_at,specs,status,error").order("checked_at", {ascending: false}).limit(1000);
  if (readError) { state.note = readError.message; renderMarket(); return; }
  state.observations = (stored || []).map(observationFromRow);
  const checked = data && Array.isArray(data.checked) ? data.checked.length : 0;
  const skipped = data && Array.isArray(data.skipped) ? data.skipped.length : 0;
  state.note = "Loaded " + state.observations.length + " stored quotes" + (checked || skipped ? ". Checked " + checked + ", skipped " + skipped : "") + (data && data.errors && data.errors.length ? ". Some stores failed." : ".") + " Selling prices were not changed.";
  renderMarket();
}

async function decideSelected(status, rows) {
  const picked = rows.filter(row => state.selected.has(row.sku));
  if (!picked.length) { state.note = "Select a row first."; renderMarket(); return; }
  if (!window.LIVE || !LIVE.sb) { state.note = "Decisions stay empty until the audit table is available. Nothing was stored."; renderMarket(); return; }
  let saved = 0;
  for (const row of picked) {
    if (status === "approved" && (row.block || !(row.target > 0))) {
      state.note = "That row is not a verified price yet (" + (row.block || "no price") + "). It was not approved.";
      renderMarket();
      return;
    }
    const {error} = await LIVE.sb.rpc("market_decide", {
      p_sku: row.sku, p_status: status, p_target: row.target, p_previous: row.current,
      p_apply_key: null, p_proposal: row, p_mode: "manual"
    });
    if (error) { state.note = "The decision was not saved. " + error.message; renderMarket(); return; }
    state.decisions[row.sku] = status;
    state.ledger.unshift({sku: row.sku, status, price: row.target, previous: row.current, key: ""});
    saved++;
  }
  state.note = status === "approved"
    ? "Saved " + saved + " approval" + (saved === 1 ? "" : "s") + ". The store price is unchanged until you apply it."
    : "Saved " + saved + " rejection" + (saved === 1 ? "" : "s") + ".";
  renderMarket();
}

function readOffer(gate) {
  if (gate.kind === "phone") {
    const unit = (DB.units || []).find(item => item.id === gate.ref.unit);
    if (!unit) return null;
    return {price: unit.p, qty: unit.qty, color: unit.c, storage: unit.st, sim: unit.sim, cond: unit.cond};
  }
  if (gate.kind === "ph" && typeof phV === "function" && typeof PHmap !== "undefined") {
    const product = PHmap.get(gate.ref.id);
    if (!product) return null;
    const live = phV(product, gate.ref.vi);
    return {price: live.p, qty: live.q};
  }
  return null;
}

function stagePrice(gate) {
  if (gate.kind === "phone") {
    const unit = (DB.units || []).find(item => item.id === gate.ref.unit);
    if (!unit) return false;
    unit.p = gate.price;
    return true;
  }
  if (gate.kind === "ph" && typeof phSet === "function" && typeof PHmap !== "undefined") {
    const product = PHmap.get(gate.ref.id);
    if (!product) return false;
    phSet(product, gate.ref.vi, "p", gate.price);
    return true;
  }
  return false;
}

function storedKey(gate) {
  if (gate.kind === "phone") return "units";
  if (gate.kind === "ph") return "ph";
  return "";
}

function expectedIdentity(gate) {
  const local = readOffer(gate);
  if (!local) return null;
  if (gate.kind === "phone") return {color: local.color, storage: local.storage, sim: local.sim, cond: local.cond};
  return {catalogPrice: null};
}

async function fetchStored(key) {
  if (!window.LIVE || !LIVE.sb || !key) return {ok: false, reason: "no_readback"};
  const {data, error} = await LIVE.sb.from("store_state").select("key,data").eq("key", key).maybeSingle();
  if (error || !data || data.key !== key) return {ok: false, reason: "no_readback", message: error && error.message};
  return {ok: true, record: data};
}

function adoptFresh(gate, offer) {
  if (!offer || gate.kind !== "phone") return;
  const unit = (DB.units || []).find(item => item.id === gate.ref.unit);
  if (!unit) return;
  if (offer.color != null) unit.c = offer.color;
  if (offer.storage != null) unit.st = offer.storage;
  if (offer.sim != null) unit.sim = offer.sim;
  if (offer.cond != null) unit.cond = offer.cond;
  if (offer.qty != null) unit.qty = offer.qty;
}

async function revertPrice(gate, price) {
  const fresh = await fetchStored(storedKey(gate));
  if (!fresh.ok) return {ok: false, reason: "no_readback"};
  const seen = inspectStored(fresh.record, gate, null);
  if (!seen.ok) return seen;
  adoptFresh(gate, seen.offer);
  if (!stagePrice(Object.assign({}, gate, {price}))) return {ok: false, reason: "missing_sku"};
  if (typeof window.CX_STAFF_SAVE !== "function") return {ok: false, reason: "save_failed"};
  const saved = await window.CX_STAFF_SAVE();
  if (!saved) return {ok: false, reason: "save_failed"};
  const again = await fetchStored(storedKey(gate));
  if (!again.ok) return {ok: false, reason: "no_readback"};
  return confirmReadback(again.record, Object.assign({}, gate, {price}), expectedIdentity(gate));
}

async function confirmSavedPrice(gate, expected) {
  if (typeof window.CX_STAFF_SAVE !== "function") return {ok: false, reason: "save_failed"};
  const saved = await window.CX_STAFF_SAVE();
  if (!saved) return {ok: false, reason: "save_failed"};
  const fresh = await fetchStored(storedKey(gate));
  if (!fresh.ok) return {ok: false, reason: "no_readback"};
  return confirmReadback(fresh.record, gate, expected);
}

async function applyApproved(rows) {
  readSettingsForm();
  let changed = 0;
  state.quiet = true;
  try {
    for (const row of rows) {
      if (state.decisions[row.sku] !== "approved") continue;
      const gate = canApply(row, state.settings, "approved", "manual");
      if (!gate.ok) continue;
      if (!window.confirm("Update the selling price for " + row.title + " to $" + gate.price + "? Scheduled automatic updates stay off.")) continue;
      if (!window.LIVE || !LIVE.sb || typeof window.CX_STAFF_SAVE !== "function") {
        state.note = "Apply needs a confirmed staff save. No price was marked applied.";
        return;
      }
      const stored = await fetchStored(storedKey(gate));
      if (!stored.ok) {
        state.note = "The current database row could not be read, so no price was written and it was not marked applied.";
        return;
      }
      const expected = expectedIdentity(gate);
      const before = inspectStored(stored.record, gate, expected);
      if (!before.ok && before.reason === "variant_changed") {
        state.note = "The stored variant no longer matches this SKU, so no price was written and it was not marked applied.";
        return;
      }
      if (!before.ok) {
        state.note = "The current database row could not be read, so no price was written and it was not marked applied.";
        return;
      }
      const previousPrice = before.offer.price;
      if (!before.priceMatches) {
        if (!stagePrice(gate)) { state.note = "The product row was not found. No price was marked applied."; return; }
        const saved = await confirmSavedPrice(gate, expected);
        if (!saved.ok) {
          if (previousPrice != null) stagePrice(Object.assign({}, gate, {price: previousPrice}));
          if (saved.reason === "price_mismatch") await revertPrice(gate, previousPrice);
          state.note = saved.reason === "variant_changed"
            ? "The stored variant changed during the save, so no further write was made and it was not marked applied."
            : "The staff save did not succeed, so the price was put back and was not marked applied.";
          return;
        }
      }
      const {error} = await LIVE.sb.rpc("market_decide", {
        p_sku: row.sku, p_status: "applied", p_target: gate.price, p_previous: previousPrice,
        p_apply_key: gate.key, p_proposal: row, p_mode: "manual"
      });
      if (error && !/already applied|duplicate/i.test(error.message || "")) {
        state.note = "The price save succeeded, but the audit row was not stored. Apply again to record it without writing the price a second time. " + error.message;
        return;
      }
      if (!state.settings.appliedKeys.includes(gate.key)) state.settings.appliedKeys.push(gate.key);
      state.ledger.unshift({sku: row.sku, status: "applied", price: gate.price, previous: previousPrice, key: gate.key, ref: gate.ref, kind: gate.kind});
      changed++;
    }
    state.note = changed ? "Applied " + changed + " approved price" + (changed === 1 ? "" : "s") + ". Scheduled updates stay " + (state.settings.automationEnabled ? "on" : "off") + ". Stock and past orders were left as they were." : "Nothing was applied. Approve a verified row that is inside the margin and has not already been applied.";
  } finally {
    state.quiet = false;
    if (typeof renderStore === "function") renderStore();
    renderMarket();
  }
}

async function restore(key) {
  const entry = state.ledger.find(item => item.key === key && item.previous > 0);
  const gate = canRestore(entry);
  if (!gate.ok) { state.note = "No previous price is stored for that row."; renderMarket(); return; }
  if (!window.confirm("Put the previous price back for " + entry.sku + "?")) return;
  if (!window.LIVE || !LIVE.sb || typeof window.CX_STAFF_SAVE !== "function") {
    state.note = "Restore needs a confirmed staff save. No price was changed.";
    renderMarket();
    return;
  }
  const stored = await fetchStored(storedKey(gate));
  const expected = expectedIdentity(gate);
  const before = stored.ok ? inspectStored(stored.record, gate, expected) : {ok: false, reason: "no_readback"};
  if (!before.ok) {
    state.note = before.reason === "variant_changed"
      ? "The stored variant no longer matches this SKU, so no price was changed."
      : "The current database row could not be read, so no price was changed.";
    renderMarket();
    return;
  }
  const previousPrice = before.offer.price;
  if (!stagePrice(gate)) { state.note = "The product row was not found. No price was changed."; renderMarket(); return; }
  const saved = await confirmSavedPrice(gate, expected);
  if (!saved.ok) {
    if (previousPrice != null) stagePrice(Object.assign({}, gate, {price: previousPrice}));
    if (saved.reason === "price_mismatch") await revertPrice(gate, previousPrice);
    state.note = "The staff save did not succeed, so the price was put back and was not marked restored.";
    renderMarket();
    return;
  }
  const {error} = await LIVE.sb.rpc("market_decide", {
    p_sku: entry.sku, p_status: "restored", p_target: gate.price, p_previous: entry.price,
    p_apply_key: null, p_proposal: entry, p_mode: "manual"
  });
  if (error) { state.note = "The previous price was saved, but the audit row was not. " + error.message; renderMarket(); return; }
  state.ledger.unshift({sku: entry.sku, status: "restored", price: gate.price, previous: entry.price, key: ""});
  state.note = "Previous price restored. Stock was not changed.";
  if (typeof renderStore === "function") renderStore();
  renderMarket();
}

window.CX_MARKET_PARSE = parseSpecs;
PAGES.market = ["Market pricing", "Approve one verified price at a time. Scheduled automatic updates stay off."];
const previousRender = renderPage;
renderPage = function () {
  if (adm.page === "market") {
    const count = DB.orders.filter(order => order.status === "new").length;
    $("navOrders").textContent = count;
    $("navOrders").hidden = !count;
    if (!state.quiet) renderMarket();
    return;
  }
  previousRender();
};
