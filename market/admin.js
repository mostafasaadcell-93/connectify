import {
  DEFAULT_SETTINGS, parseManualCsv, parseSpecs, evaluate, canApply, canRestore
} from "./engine.mjs";

const state = {
  observations: [],
  ledger: [],
  decisions: {},
  selected: new Set(),
  settings: Object.assign({}, DEFAULT_SETTINGS),
  writesReady: false,
  quiet: false,
  note: "Automatic price writes are off. Import or refresh quotes first. Nothing here changes a selling price until you authorize it and the audit table accepts the change."
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
  const result = state.observations.length ? evaluate(catalog(), state.observations, state.settings, state.observations) : {matches: [], proposals: []};
  const query = ($("marketQ") && $("marketQ").value || "").trim().toLowerCase();
  const rows = result.proposals.filter(row => row.confidence !== "none" && (!query || (row.title + " " + row.detail).toLowerCase().includes(query))).slice(0, 80);
  root.innerHTML = `<div class="stockbar">
      <button class="btn btn-main" type="button" id="marketRefresh">Refresh quotes</button>
      <button class="abtn" type="button" id="marketApprove">Approve selected</button>
      <button class="abtn" type="button" id="marketReject">Reject selected</button>
      <button class="abtn" type="button" id="marketApply" disabled>Apply approved prices</button>
    </div>
    <p class="mktnote">${esc(state.note)}</p>
    <div class="stockbar">
      <label>Minimum margin % <input id="marketMargin" type="number" min="0" step="0.1" value="${state.settings.minMarginPct == null ? "" : esc(String(state.settings.minMarginPct))}"></label>
      <label>Verified LBP per USD <input id="marketLbp" type="number" min="1" step="1" value="${state.settings.lbpPerUsd == null ? "" : esc(String(state.settings.lbpPerUsd))}"></label>
      <label><input id="marketLbpOk" type="checkbox" ${state.settings.lbpRateVerified ? "checked" : ""}> Rate was checked</label>
      <label><input id="marketAuto" type="checkbox" ${state.settings.automationEnabled && state.settings.writesEnabled ? "checked" : ""}> Allow automatic writes</label>
      <button class="abtn" type="button" id="marketSaveSettings">Save rules</button>
    </div>
    <textarea id="marketCsv" rows="4" placeholder="store,name,price,currency,url,available,storage,condition,sim,color,warranty,region"></textarea>
    <button class="abtn" type="button" id="marketImport">Import manager prices</button>
    <input id="marketQ" placeholder="Filter shown matches">
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
    <div class="olist">${state.ledger.slice(0, 12).map(item => `<div class="drow"><span class="grow"><b>${esc(item.sku)}</b><small>${esc(item.status)} ${item.price == null ? "" : "$" + item.price}</small></span><button class="abtn" type="button" data-restore="${esc(item.key || "")}">Restore previous</button></div>`).join("") || "<p class='mktnote'>No price has been changed from this screen.</p>"}</div>`;
  $("marketRefresh").onclick = refreshQuotes;
  $("marketImport").onclick = importCsv;
  $("marketApprove").onclick = () => decideSelected("approved", rows);
  $("marketReject").onclick = () => decideSelected("rejected", rows);
  $("marketApply").onclick = () => applyApproved(rows);
  $("marketSaveSettings").onclick = saveSettings;
  $("marketApply").disabled = !(state.writesReady && state.settings.automationEnabled && state.settings.writesEnabled);
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
  state.writesReady = false;
  if (!window.LIVE || !LIVE.sb) {
    state.settings.automationEnabled = false;
    state.settings.writesEnabled = false;
    state.note = "Database settings are unavailable, so automatic writes stay off. Selling prices were not changed.";
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
    state.note = "The audit settings table is not installed, so automatic writes stay off. " + error.message;
    renderMarket();
    return;
  }
  for (const [sku, on] of Object.entries(state.settings.productAuto)) {
    const saved = await LIVE.sb.from("market_product_flags").upsert({sku, auto_enabled: !!on, updated_at: new Date().toISOString()});
    if (saved.error) {
      state.settings.automationEnabled = false;
      state.settings.writesEnabled = false;
      state.note = "Product rules could not be saved, so automatic writes stay off. " + saved.error.message;
      renderMarket();
      return;
    }
  }
  state.writesReady = requested;
  state.settings.automationEnabled = requested;
  state.settings.writesEnabled = requested;
  state.note = requested
    ? "Rules saved. Approved products can be applied. Stock and past orders stay unchanged."
    : "Rules saved. Automatic writes stay off. Selling prices were not changed.";
  renderMarket();
}

function importCsv() {
  const rows = parseManualCsv($("marketCsv").value, new Date().toISOString());
  state.observations = rows;
  state.note = rows.length ? "Imported " + rows.length + " manager quotes. Prices on the store were not changed." : "No rows found.";
  renderMarket();
}

async function refreshQuotes() {
  state.note = "Asking the store database to collect public quotes. Selling prices are not part of that request.";
  renderMarket();
  if (!window.LIVE || !LIVE.sb) { state.note = "Refresh needs the store database. Use manager import until then."; renderMarket(); return; }
  const {data, error} = await LIVE.sb.functions.invoke("market-check");
  if (error) { state.note = "Quote refresh is not deployed yet. Use manager import. " + (error.message || ""); renderMarket(); return; }
  const {data: stored, error: readError} = await LIVE.sb.from("market_observations").select("store,name,price,currency,url,available,checked_at,specs,status,error").order("checked_at", {ascending: false}).limit(300);
  if (readError) { state.note = readError.message; renderMarket(); return; }
  state.observations = (stored || []).map(row => ({
    store: row.store, name: row.name, price: row.price == null ? null : Number(row.price), currency: row.currency,
    url: row.url, available: row.available === true, checkedAt: row.checked_at, specs: row.specs || {}, status: row.status, error: row.error || ""
  }));
  state.note = "Loaded " + state.observations.length + " stored quotes" + (data && data.errors && data.errors.length ? ". Some stores failed." : ".") + " Selling prices were not changed.";
  renderMarket();
}

function decideSelected(status, rows) {
  rows.filter(row => state.selected.has(row.sku)).forEach(row => { state.decisions[row.sku] = status; });
  state.note = status === "approved" ? "Selected recommendations were approved. They are not on the store until apply is authorized." : "Selected recommendations were rejected.";
  renderMarket();
}

async function applyApproved(rows) {
  if (!state.writesReady) { state.note = "Apply stays off until the audit table has saved automatic writes. No price was changed."; renderMarket(); return; }
  readSettingsForm();
  let changed = 0;
  state.quiet = true;
  try {
    for (const row of rows) {
      if (state.decisions[row.sku] !== "approved") continue;
      const gate = canApply(row, state.settings, "approved");
      if (!gate.ok) continue;
      if (!window.LIVE || !LIVE.sb) { state.note = "Apply needs the audit table. No price was changed."; return; }
      const {error} = await LIVE.sb.rpc("market_decide", {
        p_sku: row.sku, p_status: "applied", p_target: gate.price, p_previous: gate.previous, p_apply_key: gate.key, p_proposal: row
      });
      if (error) { state.note = "The database refused the price change. " + error.message; return; }
      if (!writePrice(gate)) { state.note = "The audit row was stored, but the product row was not found. Stock was not changed."; return; }
      state.settings.appliedKeys.push(gate.key);
      state.ledger.unshift({sku: row.sku, status: "applied", price: gate.price, previous: gate.previous, key: gate.key, ref: gate.ref, kind: gate.kind});
      changed++;
    }
    state.note = changed ? "Applied " + changed + " authorized price" + (changed === 1 ? "" : "s") + ". Stock and past orders were left as they were." : "Nothing was applied. A row must be approved, inside the margin, and not already applied.";
  } finally {
    state.quiet = false;
    renderMarket();
  }
}

function writePrice(gate) {
  if (gate.kind === "phone") {
    const unit = (DB.units || []).find(item => item.id === gate.ref.unit);
    if (!unit) return false;
    const qty = unit.qty;
    unit.p = gate.price;
    unit.qty = qty;
    commit("Market price saved");
    return true;
  }
  if (gate.kind === "ph" && typeof phSet === "function" && typeof PHmap !== "undefined") {
    const product = PHmap.get(gate.ref.id);
    if (!product) return false;
    phSet(product, gate.ref.vi, "p", gate.price);
    commit("Market price saved");
    return true;
  }
  return false;
}

async function restore(key) {
  const entry = state.ledger.find(item => item.key === key && item.previous > 0);
  const gate = canRestore(entry, state.settings);
  if (!gate.ok) { state.note = "Restore stays off until price writes are authorized. " + gate.reason; renderMarket(); return; }
  if (!window.confirm("Put the previous price back for " + entry.sku + "?")) return;
  if (!window.LIVE || !LIVE.sb) { state.note = "Restore needs the audit table. No price was changed."; renderMarket(); return; }
  const {error} = await LIVE.sb.rpc("market_decide", {p_sku: entry.sku, p_status: "restored", p_target: gate.price, p_previous: entry.price, p_apply_key: null, p_proposal: entry});
  if (error) { state.note = error.message; renderMarket(); return; }
  writePrice(gate);
  state.note = "Previous price restored. Stock was not changed.";
  renderMarket();
}

window.CX_MARKET_PARSE = parseSpecs;
PAGES.market = ["Market pricing", "Lebanese competitor quotes. Automatic price writes stay off until you authorize them."];
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
