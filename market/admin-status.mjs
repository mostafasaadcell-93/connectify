export const AUDIT_LIMIT = 200;

const KNOWN = new Set(["approved", "rejected", "applied", "restored"]);

export function auditLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "applied") return "Applied";
  if (status === "restored") return "Restored";
  return "";
}

export function offerIdentityFromSku(sku) {
  const text = String(sku || "");
  if (text.startsWith("unit:") && text.length > 5) return {kind: "phone", ref: {unit: text.slice(5)}};
  const parts = text.split(":");
  if (parts.length === 3 && parts[0] === "ph" && parts[1] && /^\d+$/.test(parts[2])) {
    return {kind: "ph", ref: {id: parts[1], vi: Number(parts[2])}};
  }
  return {kind: "", ref: null};
}

function moneyNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function summarizeAudit(rows, limit = AUDIT_LIMIT) {
  const list = (Array.isArray(rows) ? rows : []).filter(row => row && row.sku && KNOWN.has(row.status));
  const truncated = Number.isFinite(limit) && list.length >= limit;
  const ordered = list.map((row, index) => ({row, index})).sort((a, b) => {
    const at = String(a.row.created_at || "");
    const bt = String(b.row.created_at || "");
    if (at < bt) return -1;
    if (at > bt) return 1;
    return a.index - b.index;
  });
  const decisions = {};
  const appliedKeys = [];
  const restoreKey = {};
  const ledger = [];
  const seen = new Set();
  for (const item of ordered) {
    const row = item.row;
    const price = moneyNumber(row.target_price);
    const previous = moneyNumber(row.previous_price);
    const key = row.apply_key || "";
    const identity = offerIdentityFromSku(row.sku);
    const stamp = String(row.created_at || "");
    const fingerprint = [row.sku, row.status, key, stamp, price, previous].join("|");
    decisions[row.sku] = row.status;
    if (row.status === "applied" && key && !appliedKeys.includes(key)) appliedKeys.push(key);
    restoreKey[row.sku] = row.status === "applied" && key && previous > 0 ? key : "";
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    ledger.push({
      sku: row.sku,
      status: row.status,
      price,
      previous,
      key,
      at: stamp,
      ref: row.ref || identity.ref,
      kind: row.kind || identity.kind
    });
  }
  ledger.reverse();
  return {decisions, appliedKeys, ledger, restoreKey: truncated ? {} : restoreKey, actionsOpen: !truncated, truncated};
}

export function priceGap(current, target) {
  const left = Number(current);
  const right = Number(target);
  if (!(left > 0) || !(right > 0)) return null;
  return Math.round((right - left) * 100) / 100;
}

export function verificationLabel(row) {
  if (row && row.confidence === "high" && Number(row.competitor) > 0) return "Verified";
  if (row && row.confidence === "review") return "Needs review";
  return "Not verified";
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function sanitizeDiagnostic(error) {
  let text = String(error || "").replace(/\s+/g, " ").trim().slice(0, 180);
  text = text.replace(/bearer\s+\S+/gi, "bearer [redacted]");
  text = text.replace(/(api[_-]?key|token|password|secret)\s*[=:]\s*\S+/gi, "$1=[redacted]");
  text = text.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]");
  text = text.replace(/sb_(secret|publishable)_\S+/gi, "[redacted]");
  return text;
}

export function explainCollectionError(error) {
  const text = String(error || "").toLowerCase();
  const detail = sanitizeDiagnostic(error);
  if (/401|403|429|\bblocked\b|forbidden|captcha/.test(text)) {
    return {message: "Competitor blocked automated access.", detail};
  }
  if (/404|no_catalog|no match|not found/.test(text)) {
    return {message: "No matching listing found.", detail};
  }
  if (/500|502|503|504|timeout|unavailable|network|econn|http 202|\bfailed\b|request cap/.test(text)) {
    return {message: "Competitor website temporarily unavailable.", detail};
  }
  return {message: "Price could not be verified.", detail};
}

export function collectionSummary(errors) {
  return Array.isArray(errors) && errors.length ? "Collection completed with partial results." : "Collection completed successfully.";
}
