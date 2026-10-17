import {
  DEFAULT_SETTINGS, parseManualCsv, parseSpecs, evaluate, canApply, canRestore, applyVerifiedFacts, inspectStored, confirmReadback, simulatePrices
} from "./engine.mjs";
import {
  ACTIVATIONS, LEGACY_FACT_COLUMNS, UPGRADED_FACT_COLUMNS, WARRANTY_PROVIDERS,
  factSaveNote, factWrite, factsFromRow, missingFactColumn
} from "./facts.mjs";
import {
  AUDIT_LIMIT, auditLabel, collectionSummary, explainCollectionError, priceGap, safeHttpUrl, summarizeAudit, verificationLabel
} from "./admin-status.mjs";

const state = {
  observations: [],
  history: [],
  ledger: [],
  decisions: {},
  restoreKey: {},
  facts: {},
  selected: new Set(),
  settings: Object.assign({}, DEFAULT_SETTINGS, {productAuto: {}, appliedKeys: []}),
  quiet: false,
  loaded: false,
  busy: false,
  auditTruncated: false,
  actionsOpen: true,
  factsUpgrade: null,
  collection: {errors: [], checked: [], skipped: [], requests: null, run: null},
  note: "Scheduled automatic updates are off. You can approve and apply one verified price at a time. Nothing changes until a fresh database read confirms that exact variant."
};

function adoptAudit(rows, limit) {
  const summary = summarizeAudit(rows, limit);
  state.decisions = summary.decisions;
  state.ledger = summary.ledger;
  state.restoreKey = summary.restoreKey;
  state.settings.appliedKeys = summary.appliedKeys;
  state.auditTruncated = summary.truncated;
  state.actionsOpen = summary.actionsOpen;
}

function money(n) { return n == null || n === "" ? "—" : "$" + n; }

function formatGap(current, target) {
  const gap = priceGap(current, target);
  if (gap == null) return "—";
  if (gap === 0) return "$0";
  return (gap > 0 ? "+" : "−") + "$" + Math.abs(gap);
}

function decisionText(sku) {
  return auditLabel(state.decisions[sku]) || "No decision";
}

function badge(kind, label) {
  const safe = ["approved", "rejected", "applied", "restored", "verified", "review", "blocked", "none"].includes(kind) ? kind : "none";
  return `<span class="mkbadge mk-${safe}">${esc(label)}</span>`;
}

function previewReadOnly() {
  return !!window.CX_STAGING_PREVIEW;
}

function refusePreview(action) {
  if (!previewReadOnly()) return false;
  state.note = "Staging preview is read-only. " + action + " was not sent.";
  renderMarket();
  return true;
}

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
        condition: unit.cond, sim: unit.sim, color: String(unit.c || "").toLowerCase(),
        warrantyYears: unit.warrantyYears == null || unit.warrantyYears === "" ? null : Number(unit.warrantyYears),
        warrantyProvider: unit.warrantyProvider || null,
        region: unit.region || null,
        activation: unit.activation || null
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
  const rank = row => row.confidence === "high" && !row.block ? 0 : row.confidence === "high" ? 1 : row.confidence === "review" ? 2 : 3;
  const rows = result.proposals.filter(row => !query || (row.title + " " + row.detail).toLowerCase().includes(query)).sort((a, b) => rank(a) - rank(b)).slice(0, 80);
  const failures = (state.collection.errors || []).map(row => {
    const explained = explainCollectionError(row && (row.error || row.reason) || "");
    return {store: row && row.store || "Source", message: explained.message, detail: explained.detail};
  });
  const runError = state.collection.run && state.collection.run.error ? explainCollectionError(state.collection.run.error) : null;
  const accessorySkips = (state.collection.skipped || []).filter(row => row.reason === "accessory");
  const otherSkips = (state.collection.skipped || []).filter(row => row.reason !== "accessory");
  const locked = previewReadOnly();
  const held = locked || state.busy;
  const off = held ? " disabled" : "";
  const applyOff = held || !state.actionsOpen ? " disabled" : "";
  root.innerHTML = `<div class="stockbar">
      <button class="btn btn-main" type="button" id="marketRefresh"${off}>Refresh quotes</button>
      <button class="abtn" type="button" id="marketApprove"${off}>Approve selected</button>
      <button class="abtn" type="button" id="marketReject"${off}>Reject selected</button>
      <button class="abtn" type="button" id="marketApply"${applyOff}>Apply approved prices</button>
    </div>
    <p class="mktnote">${esc(state.note)}</p>
    ${locked ? `<p class="mktnote">Staging preview is read-only on ${esc(String(window.CX_STAGING_PREVIEW.host || "the staging project"))}. Stored competitor quotes, match explanations, justified proposals, and decision history stay visible. Refresh, approval, apply, restore, imports, and rule saves are not sent.</p>` : ""}
    <div class="stockbar">
      <label>Minimum margin % <input id="marketMargin" type="number" min="0" step="0.1" value="${state.settings.minMarginPct == null ? "" : esc(String(state.settings.minMarginPct))}"${off}></label>
      <label>Verified LBP per USD <input id="marketLbp" type="number" min="1" step="1" value="${state.settings.lbpPerUsd == null ? "" : esc(String(state.settings.lbpPerUsd))}"${off}></label>
      <label><input id="marketLbpOk" type="checkbox" ${state.settings.lbpRateVerified ? "checked" : ""}${off}> Rate was checked</label>
      <label><input id="marketAuto" type="checkbox" disabled> Coming later — disabled</label>
      <button class="abtn" type="button" id="marketSaveSettings"${off}>Save rules</button>
    </div>
    <div class="stockbar">
      <label>Product facts <select id="factSku">${catalog().filter(item => item.kind === "phone").map(item => `<option value="${esc(item.sku)}">${esc(item.title)} · ${esc(item.detail)}</option>`).join("")}</select></label>
      <label>Warranty <select id="factWarranty"><option value="">Unknown</option><option value="0">None</option><option value="1">1 year</option><option value="2">2 years</option></select></label>
      <label>Region <select id="factRegion"><option value="">Unknown</option><option value="uk">UK</option><option value="us">US</option><option value="hk">Hong Kong</option><option value="eu">EU</option><option value="ae">UAE</option><option value="japan">Japan</option><option value="china">China</option></select></label>
      <label>SIM <select id="factSim"><option value="">Unknown</option><option value="psim">Nano-SIM + eSIM</option><option value="esim">eSIM only</option><option value="dual">Dual physical</option></select></label>
      <label>Condition <select id="factCondition"><option value="">Unknown</option><option value="new">New</option><option value="open">Open box</option><option value="likenew">Like new</option><option value="used">Used</option><option value="refurb">Refurbished</option></select></label>
      <label>Warranty provider <select id="factProvider"><option value="">Unknown</option><option value="apple">Apple</option><option value="samsung">Samsung</option><option value="seller">Seller/store</option><option value="international">International</option><option value="local">Local</option></select></label>
      <label>Activation <select id="factActivation"><option value="">Unknown</option><option value="active">Activated</option><option value="inactive">Not activated</option></select></label>
      <label><input id="factVerified" type="checkbox"${off}> I verified these facts</label>
      <button class="abtn" type="button" id="marketSaveFacts"${off}>Save facts</button>
    </div>
    <p class="mktnote">Unknown facts stay blank. Warranty provider and activation are not guessed from the phone model. Saving them does not change a price, the stock list, or a competitor quote. Only facts you mark as verified fill gaps, and they never replace a value the inventory already states.</p>
    ${state.factsUpgrade === false ? `<p class="mktnote" id="factUpgradeNote">The verified-facts upgrade is not installed. Warranty provider and activation stay unknown until that upgrade is added. Existing warranty, region, SIM, and condition facts still save. Prices are not changed.</p>` : ""}
    <textarea id="marketCsv" rows="4" placeholder="store,name,price,currency,url,available,storage,condition,sim,color,warranty,region"${off}></textarea>
    <button class="abtn" type="button" id="marketImport"${off}>Import manager prices</button>
    <input id="marketQ" placeholder="Filter shown matches" value="${esc(kept)}">
    <div class="mkstatus">
      <p>Automatic pricing ${automationOn() ? "on" : "off"}</p>
      <p>Scheduler off</p>
      ${state.busy ? "<p>Working…</p>" : ""}
      ${state.auditTruncated ? "<p>Decision history is incomplete, so apply and restore stay off.</p>" : ""}
      ${state.collection.requests == null ? "" : `<p>${esc(String(state.collection.requests))} catalog requests</p>`}
      ${state.collection.errors && state.collection.errors.length ? `<p>${esc(collectionSummary(state.collection.errors))}</p>` : ""}
      ${failures.map(row => `<p>${esc(row.store)}: ${esc(row.message)}</p>`).join("")}
      ${accessorySkips.length ? `<p>Accessories left out of phone comparison: ${accessorySkips.reduce((sum, row) => sum + (Number(row.count) || 1), 0)}</p>` : ""}
      ${otherSkips.slice(0, 6).map(row => `<p>${esc(row.store || "Source")} skipped: ${esc(explainCollectionError(row.reason || "").message)}</p>`).join("")}
      ${state.collection.run ? `<p>Last run ${esc(state.collection.run.status || "")}${runError ? " · " + esc(runError.message) : ""}</p>` : ""}
    </div>
    ${failures.some(row => row.detail) || (runError && runError.detail) ? `<details class="mkdiag"><summary>Technical collection detail</summary>${failures.filter(row => row.detail).map(row => `<p>${esc(row.store)}: ${esc(row.detail)}</p>`).join("")}${runError && runError.detail ? `<p>Last run: ${esc(runError.detail)}</p>` : ""}</details>` : ""}
    <div class="mkwrap"><table class="mktable"><thead><tr><th></th><th>Product</th><th>Our price</th><th>Competitor</th><th>Recommended</th><th>Difference</th><th>Profit</th><th>Source</th><th>Checked</th><th>Verification</th><th>Decision</th><th></th></tr></thead><tbody>
    ${rows.map(row => {
      const recommended = row.confidence === "high" && !row.block && row.target > 0;
      const offerUrl = safeHttpUrl(row.url || "");
      const verified = row.competitor != null && row.confidence === "high";
      const decision = state.decisions[row.sku] || "";
      return `<tr>
      <td><input type="checkbox" data-sku="${esc(row.sku)}" ${state.selected.has(row.sku) ? "checked" : ""}></td>
      <td><b>${esc(row.title)}</b><br><span class="mktnote">${esc(row.detail)}</span></td>
      <td>${money(row.current)}</td>
      <td>${verified ? money(row.competitor) : "Not verified"}</td>
      <td>${recommended ? money(row.target) : "—"}</td>
      <td>${recommended ? formatGap(row.current, row.target) : "—"}</td>
      <td>${recommended && row.profit != null ? money(row.profit) + " (" + row.margin + "%)" : "—"}</td>
      <td>${offerUrl ? `<a class="mkurl" href="${esc(offerUrl)}" title="${esc(offerUrl)}" target="_blank" rel="noopener">${esc(row.store || "Listing")}</a>` : esc(verified ? (row.store || "—") : "No verified listing")}</td>
      <td>${esc(verified ? (row.checkedAt || "—") : "—")}</td>
      <td>${badge(Number(row.competitor) > 0 && row.confidence === "high" ? "verified" : (row.confidence === "review" ? "review" : "none"), verificationLabel(row))}</td>
      <td>${badge(decision, decisionText(row.sku))}${row.explanation ? "<br><span class='mktnote'>" + esc(row.explanation) + "</span>" : ""}${!recommended ? "<br><span class='mktnote'>Not ready for approval.</span>" : ""}</td>
      <td><label class="mktnote"><input type="checkbox" data-auto="${esc(row.sku)}" ${state.settings.productAuto[row.sku] ? "checked" : ""}${off}> Auto</label></td>
    </tr>`;
    }).join("") || `<tr><td colspan="12">No catalog rows to review.</td></tr>`}
    </tbody></table></div>
    ${simulationHtml()}
    <h3>Recent decisions</h3>
    <div class="olist">${state.ledger.slice(0, 12).map(item => {
      const restorable = state.actionsOpen && item.status === "applied" && item.key && state.restoreKey[item.sku] === item.key;
      return `<div class="drow"><span class="grow"><b>${esc(item.sku)}</b><small>${badge(item.status, auditLabel(item.status) || item.status)} ${item.price == null ? "" : "$" + item.price}</small></span>${restorable ? `<button class="abtn" type="button" data-restore="${esc(item.key)}"${applyOff}>Restore previous</button>` : ""}</div>`;
    }).join("") || "<p class='mktnote'>No pricing decisions yet.</p>"}</div>`;
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

function simulationHtml() {
  const report = simulatePrices({
    catalog: catalog(),
    observations: state.observations,
    settings: state.settings,
    facts: state.facts,
    history: state.observations,
    now: new Date().toISOString()
  });
  const ranked = report.rows.filter(row => row.eligibility !== "No reliable competitor match");
  const shown = (ranked.length ? ranked : report.rows).slice(0, 12);
  const body = shown.map(row => `<tr>
      <td><b>${esc(row.title)}</b><br><span class="mktnote">${esc(row.detail)}</span></td>
      <td>${money(row.current)}</td>
      <td>${row.store ? esc(row.store) : "—"}</td>
      <td>${row.observed == null ? "—" : money(row.observed)}</td>
      <td>${row.target == null ? "—" : money(row.target)}</td>
      <td>${row.difference == null ? "—" : (row.difference > 0 ? "+" : "−") + "$" + Math.abs(row.difference)}</td>
      <td>${row.margin == null ? "—" : row.margin + "%"}</td>
      <td>${esc(row.confidence)}</td>
      <td>${row.ageHours == null ? "—" : Math.round(row.ageHours) + "h"}</td>
      <td>${esc(row.eligibility)}</td>
      <td>${esc(row.reason)}</td>
    </tr>`).join("") || `<tr><td colspan="11">No simulated price changes.</td></tr>`;
  return `<h3>SIMULATION — NO PRICES CHANGED</h3>
    <p class="mktnote">Read-only preview of quotes that would be eligible for a later review. It does not approve, apply, restore, or write a price. Automatic pricing and the scheduler stay off.</p>
    <div class="mkwrap"><table class="mktable"><thead><tr><th>Product</th><th>Our price</th><th>Competitor</th><th>Observed</th><th>Target</th><th>Difference</th><th>Margin</th><th>Confidence</th><th>Age</th><th>Status</th><th>Reason</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function automationOn() {
  return state.settings.automationEnabled === true && state.settings.writesEnabled === true;
}

function readSettingsForm() {
  const margin = $("marketMargin").value.trim();
  const lbp = $("marketLbp").value.trim();
  state.settings.minMarginPct = margin === "" ? null : Number(margin);
  state.settings.lbpPerUsd = lbp === "" ? null : Number(lbp);
  state.settings.lbpRateVerified = $("marketLbpOk").checked;
}

async function saveSettings() {
  if (refusePreview("Saving rules")) return;
  readSettingsForm();
  state.settings.automationEnabled = false;
  state.settings.writesEnabled = false;
  if (!window.LIVE || !LIVE.sb) {
    state.note = "Database settings are unavailable, so scheduled updates stay off. Selling prices were not changed.";
    renderMarket();
    return;
  }
  const {error} = await LIVE.sb.from("market_settings").update({
    automation_enabled: false,
    writes_enabled: false,
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
  state.settings.automationEnabled = false;
  state.settings.writesEnabled = false;
  state.note = "Rules saved. Scheduled automatic updates stay off. You can still apply an approved price.";
  renderMarket();
}

function showFacts() {
  const sku = $("factSku") && $("factSku").value;
  const row = sku && state.facts[sku];
  if ($("factWarranty")) $("factWarranty").value = row && row.warrantyYears != null ? String(row.warrantyYears) : "";
  if ($("factRegion")) $("factRegion").value = row && row.region || "";
  if ($("factSim")) $("factSim").value = row && row.sim || "";
  if ($("factCondition")) $("factCondition").value = row && row.condition || "";
  if ($("factProvider")) $("factProvider").value = row && WARRANTY_PROVIDERS.includes(row.warrantyProvider) ? row.warrantyProvider : "";
  if ($("factActivation")) $("factActivation").value = row && ACTIVATIONS.includes(row.activation) ? row.activation : "";
  if ($("factVerified")) $("factVerified").checked = !!(row && row.verified);
}

async function probeFactUpgrade() {
  if (!window.LIVE || !LIVE.sb) return {error: {message: "audit table unavailable"}};
  const probe = await LIVE.sb.from("market_sku_facts").select(UPGRADED_FACT_COLUMNS).limit(1);
  if (missingFactColumn(probe.error)) {
    state.factsUpgrade = false;
    return {error: null};
  }
  if (!probe.error) state.factsUpgrade = true;
  return probe;
}

async function saveFacts() {
  if (refusePreview("Saving facts")) return;
  const sku = $("factSku") && $("factSku").value;
  if (!sku) { state.note = "Choose a product before saving facts."; renderMarket(); return; }
  if (!window.LIVE || !LIVE.sb) {
    state.note = "Facts were not stored. The audit table is unavailable, and no price was changed.";
    renderMarket();
    return;
  }
  if (state.factsUpgrade == null) {
    const probe = await probeFactUpgrade();
    if (probe.error) {
      state.note = "Facts were not stored. " + probe.error.message;
      renderMarket();
      return;
    }
  }
  const now = new Date().toISOString();
  const written = factWrite({
    sku,
    warrantyYears: $("factWarranty").value,
    region: $("factRegion").value,
    sim: $("factSim").value,
    condition: $("factCondition").value,
    warrantyProvider: $("factProvider").value,
    activation: $("factActivation").value,
    verified: $("factVerified").checked,
    verifiedAt: now,
    updatedAt: now
  }, state.factsUpgrade === true);
  if (!written.ok) {
    state.note = "Facts were not stored. Selling prices were not changed.";
    renderMarket();
    return;
  }
  const {error} = await LIVE.sb.from("market_sku_facts").upsert(written.body);
  if (missingFactColumn(error)) {
    state.factsUpgrade = false;
    state.note = "Facts were not stored. The verified-facts upgrade is not installed, so warranty provider and activation were not saved. Selling prices were not changed.";
    renderMarket();
    return;
  }
  if (error) {
    state.note = "Facts were not stored. " + error.message;
    renderMarket();
    return;
  }
  state.facts[sku] = factsFromRow(written.body);
  state.note = factSaveNote(written);
  renderMarket();
  if ($("factSku")) $("factSku").value = sku;
  showFacts();
}

function importCsv() {
  if (refusePreview("Quote import")) return;
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
  const saved = await LIVE.sb.from("market_decisions").select("sku,status,target_price,previous_price,apply_key,created_at").order("created_at", {ascending: false}).limit(AUDIT_LIMIT);
  if (saved.error) {
    state.note = "Saved decisions could not be loaded. " + saved.error.message;
    state.actionsOpen = false;
    renderMarket();
    return;
  }
  state.history = Array.isArray(saved.data) ? saved.data : [];
  adoptAudit(state.history, AUDIT_LIMIT);
  const runs = await LIVE.sb.from("market_runs").select("status,error,started_at,finished_at").order("started_at", {ascending: false}).limit(1);
  if (!runs.error && Array.isArray(runs.data) && runs.data[0]) state.collection.run = runs.data[0];
  let facts = await LIVE.sb.from("market_sku_facts").select(UPGRADED_FACT_COLUMNS);
  if (missingFactColumn(facts.error)) {
    state.factsUpgrade = false;
    facts = await LIVE.sb.from("market_sku_facts").select(LEGACY_FACT_COLUMNS);
  } else if (!facts.error) state.factsUpgrade = true;
  if (!facts.error && facts.data) {
    state.facts = {};
    facts.data.forEach(row => { state.facts[row.sku] = factsFromRow(row); });
  }
  const quotes = await LIVE.sb.from("market_observations").select("store,name,price,currency,url,available,checked_at,specs,status,error").order("checked_at", {ascending: false}).limit(1000);
  if (!quotes.error && quotes.data && quotes.data.length) {
    state.observations = quotes.data.map(observationFromRow);
  }
  state.note = previewReadOnly()
    ? "Loaded stored quotes and decision history. Staging preview did not send an approval or a price change."
    : "Loaded saved decisions. Scheduled automatic updates are " + (automationOn() ? "on" : "off") + ".";
  if (state.factsUpgrade === false) state.note += " The verified-facts upgrade is not installed.";
  renderMarket();
}

function observationFromRow(row) {
  return {
    store: row.store, name: row.name, price: row.price == null ? null : Number(row.price), currency: row.currency,
    url: row.url, available: row.available === true, checkedAt: row.checked_at, specs: row.specs || {}, status: row.status, error: row.error || ""
  };
}

async function refreshQuotes() {
  if (refusePreview("Quote refresh")) return;
  state.note = "Asking the store database to collect public quotes. Selling prices are not part of that request.";
  renderMarket();
  if (!window.LIVE || !LIVE.sb) { state.note = "Refresh needs the store database. Use manager import until then."; renderMarket(); return; }
  const queries = [];
  const seen = new Set();
  catalog().forEach(item => {
    if (item.kind !== "phone" || seen.has(item.title)) return;
    seen.add(item.title);
    queries.push({text: item.title, brand: item.specs.brand || null, kind: "phone"});
  });
  const {data, error} = await LIVE.sb.functions.invoke("market-check", {body: {queries: queries.slice(0, 12)}});
  if (error) { state.note = "Quote refresh is not deployed yet. Use manager import. " + (error.message || ""); renderMarket(); return; }
  const {data: stored, error: readError} = await LIVE.sb.from("market_observations").select("store,name,price,currency,url,available,checked_at,specs,status,error").order("checked_at", {ascending: false}).limit(1000);
  if (readError) { state.note = readError.message; renderMarket(); return; }
  state.observations = (stored || []).map(observationFromRow);
  state.collection.errors = data && Array.isArray(data.errors) ? data.errors : [];
  state.collection.checked = data && Array.isArray(data.checked) ? data.checked : [];
  state.collection.skipped = data && Array.isArray(data.skipped) ? data.skipped : [];
  state.collection.requests = data && data.requests != null ? data.requests : null;
  const checked = state.collection.checked.length;
  const skipped = state.collection.skipped.length;
  const summary = collectionSummary(state.collection.errors);
  const messages = [...new Set((state.collection.errors || []).map(row => explainCollectionError(row && row.error).message))];
  state.note = "Loaded " + state.observations.length + " stored quotes" + (checked || skipped ? ". Checked " + checked + ", skipped " + skipped : "") + ". " + summary + (messages.length ? " " + messages.join(" ") : "") + " Selling prices were not changed.";
  renderMarket();
}

function rememberDecision(entry) {
  state.history.push(entry);
  adoptAudit(state.history, state.auditTruncated ? AUDIT_LIMIT : state.history.length + 1);
}

async function decideSelected(status, rows) {
  if (refusePreview(status === "approved" ? "Approval" : "Rejection")) return;
  if (state.busy) return;
  const picked = rows.filter(row => state.selected.has(row.sku));
  if (!picked.length) { state.note = "Select a row first."; renderMarket(); return; }
  if (!window.LIVE || !LIVE.sb) { state.note = "Decisions stay empty until the audit table is available. Nothing was stored."; renderMarket(); return; }
  state.busy = true;
  state.note = "Working…";
  renderMarket();
  let saved = 0;
  try {
    for (const row of picked) {
      if (status === "approved" && (row.block || !(row.target > 0))) {
        state.note = "That row is not a verified price yet (" + (row.block || "no price") + "). It was not approved.";
        return;
      }
      const {error} = await LIVE.sb.rpc("market_decide", {
        p_sku: row.sku, p_status: status, p_target: row.target, p_previous: row.current,
        p_apply_key: null, p_proposal: row, p_mode: "manual"
      });
      if (error) { state.note = "The decision was not saved. " + error.message; return; }
      rememberDecision({
        sku: row.sku, status, target_price: row.target, previous_price: row.current,
        apply_key: null, created_at: new Date().toISOString(), ref: row.ref, kind: row.kind
      });
      saved++;
    }
    state.note = status === "approved"
      ? "Saved " + saved + " approval" + (saved === 1 ? "" : "s") + ". The store price is unchanged until you apply it."
      : "Saved " + saved + " rejection" + (saved === 1 ? "" : "s") + ".";
  } finally {
    state.busy = false;
    renderMarket();
  }
}

function storedKey(gate) {
  if (gate.kind === "phone") return "units";
  if (gate.kind === "ph") return "ph";
  return "";
}

function identityFromOffer(gate, offer) {
  if (!gate || !offer) return null;
  if (gate.kind === "phone") return {color: offer.color, storage: offer.storage, sim: offer.sim, cond: offer.cond};
  if (gate.kind === "ph" && gate.ref) return {id: gate.ref.id, variant: String(gate.ref.vi)};
  return null;
}

function adoptDatabase(gate, record) {
  if (!record || !gate) return;
  const key = storedKey(gate);
  if (key === "units" && Array.isArray(record.data)) DB.units = record.data;
  if (key === "ph" && record.data && typeof record.data === "object") DB.ph = record.data;
  if (window.CX_ADOPT_STORE) window.CX_ADOPT_STORE(key, key === "units" ? DB.units : DB.ph, record.revision);
}

async function fetchStored(key) {
  if (!window.LIVE || !LIVE.sb || !key) return {ok: false, reason: "no_readback"};
  const {data, error} = await LIVE.sb.from("store_state").select("key,data,revision").eq("key", key).maybeSingle();
  if (error || !data || data.key !== key) return {ok: false, reason: "no_readback", message: error && error.message};
  return {ok: true, record: data};
}

async function confirmCommitted(gate, expected, target) {
  const again = await fetchStored(storedKey(gate));
  if (!again.ok) return {ok: false, reason: "no_readback"};
  adoptDatabase(gate, again.record);
  return confirmReadback(again.record, Object.assign({}, gate, {price: target}), expected);
}

async function commitPrice(gate, action, target, previous, applyKey, identity, proposal) {
  return LIVE.sb.rpc("market_commit_price", {
    p_sku: gate.sku,
    p_action: action,
    p_target: target,
    p_previous: previous,
    p_apply_key: applyKey,
    p_identity: identity,
    p_proposal: proposal || {}
  });
}

async function applyApproved(rows) {
  if (refusePreview("Applying a price")) return;
  if (state.busy) return;
  if (!state.actionsOpen) {
    state.note = "Decision history is incomplete, so no price was applied.";
    renderMarket();
    return;
  }
  readSettingsForm();
  let changed = 0;
  state.busy = true;
  state.quiet = true;
  state.note = "Working…";
  try {
    for (const row of rows) {
      if (state.decisions[row.sku] !== "approved") continue;
      const gate = canApply(row, state.settings, "approved", "manual");
      if (!gate.ok) continue;
      if (!window.confirm("Update the selling price for " + row.title + " to $" + gate.price + "? Scheduled automatic updates stay off.")) continue;
      if (!window.LIVE || !LIVE.sb) {
        state.note = "Apply needs the store database. No price was marked applied.";
        return;
      }
      const stored = await fetchStored(storedKey(gate));
      if (!stored.ok) {
        state.note = "The current database row could not be read, so no price was written and it was not marked applied.";
        return;
      }
      const before = inspectStored(stored.record, gate, null);
      if (!before.ok) {
        state.note = before.reason === "variant_changed"
          ? "The stored variant no longer matches this SKU, so no price was written and it was not marked applied."
          : "The current database row could not be read, so no price was written and it was not marked applied.";
        return;
      }
      const previousPrice = before.offer.price;
      const identity = identityFromOffer(gate, before.offer);
      const {error} = await commitPrice(gate, "apply", gate.price, previousPrice, gate.key, identity, row);
      const duplicate = error && /already applied/i.test(error.message || "");
      if (error && !duplicate) {
        state.note = "The price was not changed and it was not marked applied. " + error.message;
        return;
      }
      const seen = await confirmCommitted(gate, identity, gate.price);
      if (!seen.ok) {
        state.note = duplicate
          ? "That price change was already recorded, and the stored price does not match it. No second write was made."
          : "The price change was committed, but a later read did not match it. No second write was made.";
        return;
      }
      const recorded = state.history.some(item => item.status === "applied" && item.apply_key === gate.key);
      if (!recorded) {
        rememberDecision({
          sku: row.sku, status: "applied", target_price: gate.price, previous_price: previousPrice,
          apply_key: gate.key, created_at: new Date().toISOString(), ref: gate.ref, kind: gate.kind
        });
      } else adoptAudit(state.history, state.auditTruncated ? AUDIT_LIMIT : state.history.length + 1);
      changed++;
    }
    state.note = changed ? "Applied " + changed + " approved price" + (changed === 1 ? "" : "s") + ". Scheduled updates stay " + (automationOn() ? "on" : "off") + ". Stock and past orders were left as they were." : "Nothing was applied. Approve a verified row that is inside the margin and has not already been applied.";
  } finally {
    state.busy = false;
    state.quiet = false;
    if (typeof renderStore === "function") renderStore();
    renderMarket();
  }
}

async function restore(key) {
  if (refusePreview("Restoring a price")) return;
  if (state.busy) return;
  if (!state.actionsOpen) {
    state.note = "Decision history is incomplete, so no price was restored.";
    renderMarket();
    return;
  }
  const entry = state.ledger.find(item => item.key === key && item.previous > 0 && state.restoreKey[item.sku] === key);
  const gate = canRestore(entry);
  if (!gate.ok) { state.note = "No previous price is stored for that row."; renderMarket(); return; }
  if (!window.confirm("Put the previous price back for " + entry.sku + "?")) return;
  if (!window.LIVE || !LIVE.sb) {
    state.note = "Restore needs the store database. No price was changed.";
    renderMarket();
    return;
  }
  state.busy = true;
  state.note = "Working…";
  renderMarket();
  try {
    const stored = await fetchStored(storedKey(gate));
    const before = stored.ok ? inspectStored(stored.record, gate, null) : {ok: false, reason: "no_readback"};
    if (!before.ok) {
      state.note = before.reason === "variant_changed"
        ? "The stored variant no longer matches this SKU, so no price was changed and it was not marked restored."
        : "The current database row could not be read, so no price was changed and it was not marked restored.";
      return;
    }
    const identity = identityFromOffer(gate, before.offer);
    const {error} = await commitPrice(gate, "restore", gate.price, before.offer.price, null, identity, entry);
    const duplicate = error && /already restored/i.test(error.message || "");
    if (error && !duplicate) {
      state.note = "The price was not changed and it was not marked restored. " + error.message;
      return;
    }
    const seen = await confirmCommitted(gate, identity, gate.price);
    if (!seen.ok) {
      state.note = duplicate
        ? "That restore was already recorded, and the stored price does not match it. No second write was made."
        : "The previous price was committed, but a later read did not match it. No second write was made.";
      return;
    }
    const recorded = state.history.some(item => item.sku === entry.sku && item.status === "restored" && item.created_at > (state.history.find(row => row.apply_key === key && row.status === "applied") || {}).created_at);
    if (!recorded) {
      rememberDecision({
        sku: entry.sku, status: "restored", target_price: gate.price, previous_price: entry.price,
        apply_key: null, created_at: new Date().toISOString(), ref: entry.ref, kind: entry.kind
      });
    }
    state.note = "Previous price restored. Stock was not changed.";
  } finally {
    state.busy = false;
    if (typeof renderStore === "function") renderStore();
    renderMarket();
  }
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
