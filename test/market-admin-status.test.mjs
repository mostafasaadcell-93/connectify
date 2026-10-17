import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_LIMIT, auditLabel, collectionSummary, explainCollectionError, priceGap, safeHttpUrl, sanitizeDiagnostic, summarizeAudit, verificationLabel
} from "../market/admin-status.mjs";

function row(sku, status, when, extra = {}) {
  return Object.assign({sku, status, target_price: 890, previous_price: 900, apply_key: status === "applied" ? "unit:u-stage-1|890|https://example.test/p|890" : null, created_at: when}, extra);
}

test("audit status follows the newest saved decision", () => {
  const approved = summarizeAudit([row("unit:u-stage-1", "approved", "2026-01-01T00:00:00.000Z")]);
  assert.equal(approved.decisions["unit:u-stage-1"], "approved");
  assert.equal(auditLabel(approved.decisions["unit:u-stage-1"]), "Approved");
  assert.equal(approved.actionsOpen, true);
  assert.equal(approved.restoreKey["unit:u-stage-1"], "");

  const applied = summarizeAudit([
    row("unit:u-stage-1", "approved", "2026-01-01T00:00:00.000Z"),
    row("unit:u-stage-1", "applied", "2026-01-01T00:01:00.000Z")
  ]);
  assert.equal(applied.decisions["unit:u-stage-1"], "applied");
  assert.equal(auditLabel("applied"), "Applied");
  assert.equal(applied.restoreKey["unit:u-stage-1"], "unit:u-stage-1|890|https://example.test/p|890");
  assert.equal(applied.ledger.filter(item => item.sku === "unit:u-stage-1" && item.status === "applied").length, 1);

  const restored = summarizeAudit([
    row("unit:u-stage-1", "approved", "2026-01-01T00:00:00.000Z"),
    row("unit:u-stage-1", "applied", "2026-01-01T00:01:00.000Z"),
    row("unit:u-stage-1", "restored", "2026-01-01T00:02:00.000Z", {target_price: 900, previous_price: 890, apply_key: null})
  ]);
  assert.equal(restored.decisions["unit:u-stage-1"], "restored");
  assert.equal(auditLabel("restored"), "Restored");
  assert.equal(restored.restoreKey["unit:u-stage-1"], "");

  const again = summarizeAudit([
    row("unit:u-stage-1", "applied", "2026-01-01T00:01:00.000Z"),
    row("unit:u-stage-1", "restored", "2026-01-01T00:02:00.000Z", {apply_key: null}),
    row("unit:u-stage-1", "approved", "2026-01-01T00:03:00.000Z", {target_price: 870, apply_key: null})
  ]);
  assert.equal(again.decisions["unit:u-stage-1"], "approved");
  assert.equal(again.restoreKey["unit:u-stage-1"], "");
  assert.equal(again.ledger[0].status, "approved");
});

test("truncated audit history does not offer another apply or restore", () => {
  const rows = [];
  for (let i = 0; i < AUDIT_LIMIT; i++) {
    rows.push(row("unit:u-stage-1", i === AUDIT_LIMIT - 1 ? "approved" : "rejected", "2026-01-01T00:00:" + String(i).padStart(2, "0") + ".000Z", {apply_key: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()}));
  }
  const summary = summarizeAudit(rows, AUDIT_LIMIT);
  assert.equal(summary.truncated, true);
  assert.equal(summary.actionsOpen, false);
  assert.deepEqual(summary.restoreKey, {});
  assert.equal(summary.decisions["unit:u-stage-1"], "approved");
});

test("collector failures stay distinct from a verified price", () => {
  const blocked = explainCollectionError("unavailable HTTP 403 bearer secret-token");
  assert.equal(blocked.message, "Competitor blocked automated access.");
  assert.equal(blocked.detail.includes("secret-token"), false);
  assert.equal(explainCollectionError("HTTP 503").message, "Competitor website temporarily unavailable.");
  assert.equal(explainCollectionError("no_catalog").message, "No matching listing found.");
  assert.equal(explainCollectionError("needs_variant").message, "Price could not be verified.");
  assert.equal(collectionSummary([{error: "unavailable HTTP 403"}]), "Collection completed with partial results.");
  assert.equal(collectionSummary([]), "Collection completed successfully.");
  assert.equal(sanitizeDiagnostic("token=eyJabc.def.ghi").includes("eyJ"), false);
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("https://shop.example/iphone"), "https://shop.example/iphone");
  assert.equal(verificationLabel({confidence: "high", competitor: 890, block: "below_margin"}), "Verified");
  assert.equal(verificationLabel({confidence: "review", competitor: null, block: "no_verified_price"}), "Needs review");
  assert.equal(verificationLabel({confidence: "none", competitor: null, block: "no_verified_price"}), "Not verified");
  assert.equal(priceGap(900, 890), -10);
  assert.equal(priceGap(null, 890), null);
});
