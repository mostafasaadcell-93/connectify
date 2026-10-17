// Local scheduled-pricing dry run.
// The collector entrypoint is separate and is not imported here.
// This module does not open a socket or write anywhere.
import {simulatePrices} from "./engine.mjs";

export const PROPOSED_CADENCE_HOURS = 12;

export const DRY_RUN_CATEGORIES = [
  "eligible_for_manual_review",
  "insufficient_specifications",
  "stale_competitor_price",
  "no_reliable_match",
  "margin_or_cost_block",
  "unverified_currency",
  "unusual_price_change",
  "other_rejection"
];

const CATEGORY_LABELS = {
  eligible_for_manual_review: "Eligible for manual review",
  insufficient_specifications: "Insufficient specifications",
  stale_competitor_price: "Stale competitor price",
  no_reliable_match: "No reliable match",
  margin_or_cost_block: "Margin or purchase-cost block",
  unverified_currency: "Unverified currency",
  unusual_price_change: "Unusual price change",
  other_rejection: "Other rejection"
};

const COST_BLOCKS = new Set(["below_margin", "negative_profit", "missing_cost", "margin_not_configured"]);
const CREDENTIAL_KEYS = new Set([
  "service_role", "servicerole", "service_role_key", "supabase_service_role_key",
  "password", "anon_key", "anonkey", "apikey", "api_key", "access_token", "secret"
]);

function emptyCounts() {
  return Object.fromEntries(DRY_RUN_CATEGORIES.map(key => [key, 0]));
}

function categoryOf(row) {
  const reason = String(row && row.reason || "");
  const block = String(row && row.block || "");
  if (row && row.eligible === true) return "eligible_for_manual_review";
  if (row && row.eligibility === "Insufficient product specifications") return "insufficient_specifications";
  if (row && row.eligibility === "Stale quote") return "stale_competitor_price";
  if (reason.includes("unsupported_currency") || reason.includes("unverified_exchange_rate")) return "unverified_currency";
  if (reason.startsWith("unusual_change") || block === "unusual_change" || reason.includes("sudden_change")) return "unusual_price_change";
  if ((row && row.eligibility === "Blocked by margin") || COST_BLOCKS.has(block) || COST_BLOCKS.has(reason.split(".")[0])) return "margin_or_cost_block";
  if (row && row.eligibility === "No reliable competitor match") return "no_reliable_match";
  return "other_rejection";
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function addHours(iso, hours) {
  return new Date(Date.parse(iso) + hours * 3600000).toISOString();
}

function credentialProblem(value, depth) {
  if (!value || typeof value !== "object" || depth > 6) return "";
  for (const key of Object.keys(value)) {
    if (CREDENTIAL_KEYS.has(key.toLowerCase().replace(/-/g, "_"))) return "credentials_not_allowed";
    const nested = credentialProblem(value[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

function failed(error) {
  return {
    ok: false,
    mode: "dry-run",
    error,
    written: false,
    pricesChanged: false,
    approved: false,
    automationEnabled: false,
    writesEnabled: false,
    schedulerEnabled: false,
    networkRequests: 0,
    databaseWrites: 0,
    rpcCalls: [],
    inventoryChanges: 0,
    checkoutChanges: 0,
    orderChanges: 0,
    cadenceHours: PROPOSED_CADENCE_HOURS,
    runAt: null,
    snapshotAt: null,
    skuCount: 0,
    eligibleForReview: 0,
    blocked: 0,
    reasonCounts: emptyCounts(),
    candidateUrls: [],
    proposals: [],
    excludedQuotes: [],
    providedObservations: []
  };
}

function validateClock(snapshot, executedAt) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return {ok: false, error: "missing_snapshot"};
  const credentials = credentialProblem(snapshot, 0);
  if (credentials) return {ok: false, error: credentials};
  const snapshotAt = timestamp(snapshot.snapshotAt);
  if (snapshot.snapshotAt == null || snapshot.snapshotAt === "") return {ok: false, error: "missing_snapshot_timestamp"};
  if (!snapshotAt) return {ok: false, error: "invalid_snapshot_timestamp"};
  const rawRun = executedAt == null ? snapshot.executedAt : executedAt;
  if (rawRun == null || rawRun === "") return {ok: false, error: "missing_execution_timestamp"};
  const runAt = timestamp(rawRun);
  if (!runAt) return {ok: false, error: "invalid_execution_timestamp"};
  if (Date.parse(runAt) < Date.parse(snapshotAt)) return {ok: false, error: "execution_before_snapshot"};
  return {ok: true, snapshotAt, runAt};
}

function evidenceFor(item, observations) {
  const matches = (observations || []).filter(obs => obs && obs.store === item.store && Number(obs.price) === Number(item.price));
  const chosen = matches.slice().sort((a, b) => String(a.checkedAt || "").localeCompare(String(b.checkedAt || "")))[0] || null;
  return {
    store: item.store,
    price: item.price,
    reason: item.reason,
    url: chosen && chosen.url || "",
    checkedAt: chosen && chosen.checkedAt || ""
  };
}

function summarize(snapshot, simulation, clock) {
  const observations = Array.isArray(snapshot.observations) ? snapshot.observations : [];
  const proposals = (simulation.rows || []).map(row => {
    const category = categoryOf(row);
    return {
      sku: row.sku,
      title: row.title,
      category,
      label: CATEGORY_LABELS[category],
      eligibility: row.eligibility,
      eligible: row.eligible === true,
      reason: row.reason || "",
      current: row.current,
      observed: row.observed,
      target: row.target,
      difference: row.difference,
      store: row.store || "",
      url: row.url || "",
      excluded: (row.excluded || []).map(item => evidenceFor(item, observations))
    };
  });
  const reasonCounts = emptyCounts();
  for (const row of proposals) reasonCounts[row.category] += 1;
  const excludedQuotes = proposals.flatMap(row => row.excluded.map(item => Object.assign({sku: row.sku}, item)))
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)) || String(a.store).localeCompare(String(b.store)) || String(a.reason).localeCompare(String(b.reason)));
  const candidateUrls = [...new Set(proposals.filter(row => row.eligible && row.url).map(row => row.url))].sort();
  const providedObservations = observations.map(obs => ({
    store: obs && obs.store || "",
    price: obs && obs.price != null ? obs.price : null,
    currency: obs && obs.currency || "",
    url: obs && obs.url || "",
    checkedAt: obs && obs.checkedAt || "",
    available: obs ? obs.available : null,
    status: obs && obs.status || ""
  })).sort((a, b) => String(a.store).localeCompare(String(b.store)) || String(a.url).localeCompare(String(b.url)) || String(a.checkedAt).localeCompare(String(b.checkedAt)));
  return {
    ok: true,
    mode: "dry-run",
    error: "",
    written: false,
    pricesChanged: false,
    approved: false,
    automationEnabled: false,
    writesEnabled: false,
    schedulerEnabled: false,
    networkRequests: 0,
    databaseWrites: 0,
    rpcCalls: [],
    inventoryChanges: 0,
    checkoutChanges: 0,
    orderChanges: 0,
    cadenceHours: PROPOSED_CADENCE_HOURS,
    runAt: clock.runAt,
    snapshotAt: clock.snapshotAt,
    skuCount: proposals.length,
    eligibleForReview: reasonCounts.eligible_for_manual_review,
    blocked: proposals.length - reasonCounts.eligible_for_manual_review,
    reasonCounts,
    candidateUrls,
    proposals,
    excludedQuotes,
    providedObservations
  };
}

export function dryRun(snapshot, options = {}) {
  const clock = validateClock(snapshot, options.executedAt);
  if (!clock.ok) return failed(clock.error);
  const source = structuredClone(snapshot);
  const simulation = simulatePrices({
    catalog: source.catalog || [],
    observations: source.observations || [],
    facts: source.facts || {},
    settings: source.settings || {},
    history: source.history || [],
    now: clock.runAt
  });
  return summarize(source, simulation, clock);
}

function validCadence(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 168;
}

function validRuns(value) {
  return Number.isInteger(value) && value >= 1 && value <= 24;
}

export function dryRunSequence(snapshot, options = {}) {
  const cadenceHours = options.cadenceHours == null ? PROPOSED_CADENCE_HOURS : options.cadenceHours;
  const runs = options.runs == null ? 2 : options.runs;
  if (!validCadence(cadenceHours)) return failed("invalid_cadence");
  if (!validRuns(runs)) return failed("invalid_run_count");
  const start = options.startAt == null ? snapshot && snapshot.executedAt : options.startAt;
  const first = dryRun(snapshot, {executedAt: start});
  if (!first.ok) return first;
  const sequence = [first];
  for (let index = 1; index < runs; index += 1) {
    sequence.push(dryRun(snapshot, {executedAt: addHours(start, index * cadenceHours)}));
  }
  return {
    ok: sequence.every(row => row.ok),
    mode: "dry-run-sequence",
    error: "",
    cadenceHours,
    written: false,
    pricesChanged: false,
    approved: false,
    automationEnabled: false,
    writesEnabled: false,
    schedulerEnabled: false,
    networkRequests: 0,
    databaseWrites: 0,
    rpcCalls: [],
    inventoryChanges: 0,
    checkoutChanges: 0,
    orderChanges: 0,
    runs: sequence
  };
}

export function formatDryRun(report) {
  const lines = [];
  const blocks = report && report.mode === "dry-run-sequence" ? report.runs : [report];
  lines.push("Connectify market pricing dry run");
  lines.push("Cadence: " + (report && report.cadenceHours) + " hours");
  lines.push("Writes: none. Network requests: 0. Scheduler installed: no.");
  for (const block of blocks || []) {
    if (!block) continue;
    lines.push("");
    if (!block.ok) {
      lines.push("Closed: " + block.error);
      continue;
    }
    lines.push("Snapshot: " + block.snapshotAt);
    lines.push("Run: " + block.runAt);
    lines.push("SKUs reviewed: " + block.skuCount);
    lines.push("Eligible for manual review: " + block.eligibleForReview);
    lines.push("Blocked: " + block.blocked);
    for (const key of DRY_RUN_CATEGORIES) lines.push(CATEGORY_LABELS[key] + ": " + block.reasonCounts[key]);
    for (const row of block.proposals) {
      const target = row.target == null ? "no target" : "target " + row.target;
      const difference = row.difference == null ? "" : " difference " + row.difference;
      lines.push(row.sku + " — " + row.label + " — " + target + difference + (row.url ? " — " + row.url : ""));
    }
    if (block.excludedQuotes.length) {
      lines.push("Excluded quotes:");
      for (const row of block.excludedQuotes) lines.push(row.sku + " — " + row.store + " $" + row.price + " (" + row.reason + ")");
    }
  }
  lines.push("");
  lines.push("No prices written. No database writes. No network requests.");
  return lines.join("\n");
}
