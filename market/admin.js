import {
  DEFAULT_SETTINGS, parseManualCsv, parseSpecs, evaluate, canApply, canRestore
} from "./engine.mjs";

const state = {
  observations: [],
  ledger: [],
  decisions: {},
  selected: new Set(),
  settings: Object.assign({}, DEFAULT_SETTINGS, {productAuto: {}, appliedKeys: []}),
  quiet: false,
  loaded: false,
  note: "Scheduled automatic updates are off. You can approve and apply one verified price at a time. Nothing changes until the staff save succeeds."
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
  root.querySelectorAll("[data-sku]").forEach(box => box.onchange = () => {
    if (box.checked) state.selected.add(box.dataset.sku); else state.selected.delete(box.dataset.sku);
  });
  root.querySelectorAll("[data-auto]").forEach(box => box.onchange = () => {
    state.settings.productAuto[box.dataset.auto] = box.checked;
  });
  root.querySelectorAll("[data-restore]").forEach(button => button.onclick = () => restore(button.dataset.restore));
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
  state.note = "Loaded " + state.observations.length + " stored quotes" + (data && data.errors && data.errors.length ? ". Some stores failed." : ".") + " Selling prices were not changed.";
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

function stagePrice(gate, qty) {
  if (gate.kind === "phone") {
    const unit = (DB.units || []).find(item => item.id === gate.ref.unit);
    if (!unit) return false;
    unit.p = gate.price;
    if (qty != null) unit.qty = qty;
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

async function confirmPrice(gate, qty) {
  if (typeof window.CX_STAFF_SAVE !== "function") return false;
  const saved = await window.CX_STAFF_SAVE();
  const after = readOffer(gate);
  return !!(saved && after && Number(after.price) === Number(gate.price) && (qty == null || after.qty === qty));
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
      const before = readOffer(gate);
      if (!before) { state.note = "The product row was not found. No price was marked applied."; return; }
      const qty = before.qty;
      if (Number(before.price) !== Number(gate.price)) {
        if (!stagePrice(gate, qty)) { state.note = "The product row was not found. No price was marked applied."; return; }
        const ok = await confirmPrice(gate, qty);
        if (!ok) {
          stagePrice(Object.assign({}, gate, {price: before.price}), qty);
          if (typeof window.CX_STAFF_SAVE === "function") await window.CX_STAFF_SAVE();
          state.note = "The staff save did not succeed, so the price was put back and was not marked applied.";
          return;
        }
      }
      const {error} = await LIVE.sb.rpc("market_decide", {
        p_sku: row.sku, p_status: "applied", p_target: gate.price, p_previous: gate.previous,
        p_apply_key: gate.key, p_proposal: row, p_mode: "manual"
      });
      if (error && !/already applied|duplicate/i.test(error.message || "")) {
        state.note = "The price save succeeded, but the audit row was not stored. Apply again to record it without writing the price a second time. " + error.message;
        return;
      }
      if (!state.settings.appliedKeys.includes(gate.key)) state.settings.appliedKeys.push(gate.key);
      state.ledger.unshift({sku: row.sku, status: "applied", price: gate.price, previous: gate.previous, key: gate.key, ref: gate.ref, kind: gate.kind});
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
  const before = readOffer(gate);
  if (!before) { state.note = "The product row was not found. No price was changed."; renderMarket(); return; }
  const qty = before.qty;
  if (!stagePrice(gate, qty)) { state.note = "The product row was not found. No price was changed."; renderMarket(); return; }
  const ok = await confirmPrice(gate, qty);
  if (!ok) {
    stagePrice(Object.assign({}, gate, {price: before.price}), qty);
    await window.CX_STAFF_SAVE();
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
