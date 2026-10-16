import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {execSync} from "node:child_process";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const block = html.match(/\/\* CXREL_START[\s\S]*?\*\/([\s\S]*?)\/\* CXREL_END \*\//);
if (!block) throw new Error("CXREL block missing from index.html");
const cx = new Function(block[1] + `
  return {cxStrongCode,cxIsStrongCode,cxFingerprint,cxValidateOrder,cxValidateTrade,cxItems,cxOrderRow,cxAddressFallback,cxInsertWithFallback,cxDecideInsert,cxPendingDecision,cxNormalizeRestored,cxShouldAutoSend,cxLegacyUnsent,cxLegacyNotice,cxMayShowWA,cxOrderMessage,cxTradeMessage,cxDbOrder,cxCreateController};
`)();

const gateSrc = html.match(/function cxCheckoutGate\(livePage,dbLive,hasController\)\{[\s\S]*?\n\}/);
if (!gateSrc) throw new Error("cxCheckoutGate missing");
const cxCheckoutGate = new Function(gateSrc[0] + "\nreturn cxCheckoutGate;")();
const pageLiveSrc = html.match(/function cxPageIsLive\(\)\{[\s\S]*?\n\}/);
if (!pageLiveSrc) throw new Error("cxPageIsLive missing");
const cxPageIsLive = new Function(pageLiveSrc[0] + "\nreturn cxPageIsLive;")();

const fromRowSrc = html.match(/const fromRow=r=>\(\{[\s\S]*?\}\);/);
if (!fromRowSrc) throw new Error("fromRow missing");
const fromRow = new Function("return " + fromRowSrc[0].replace(/^const fromRow=/, ""))();

function memoryStorage() {
  const m = new Map();
  return {getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v))};
}
const delay = ms => new Promise(r => setTimeout(r, ms));

function harness(opts = {}) {
  const storage = opts.storage || memoryStorage();
  const cart = opts.cart || [{key: "phone:14pro", kind: "phone", id: "14pro", title: "iPhone 14 Pro", detail: "256GB, Space Black", price: 500, hex: "#111", unit: "u1"}];
  const form = opts.form || {name: "Karim", phone: "70123456", phoneRaw: "70 123 456", area: "Beirut", address: "Hamra street building 4"};
  const trade = opts.trade || {name: "Karim", phone: "70123456", phoneRaw: "70 123 456", modelId: "14pro", modelName: "iPhone 14 Pro", st: "256", cd: "good", bat: "90", detail: "256GB, Good, battery 90%", est: "$400 – $430"};
  const wa = [], toasts = [], buttons = [], confirmed = [], errors = [], inserts = [];
  let cleared = 0, tradeReset = 0;
  const notes = {}, actions = {};
  const userInsert = opts.insert || (async () => ({error: null}));
  const env = {
    storage,
    now: opts.now || (() => 1_700_000_000_000),
    timeoutMs: opts.timeoutMs ?? 40,
    money: n => "$" + n,
    waShow: "+961 71 062 768",
    insert: async row => {
      const copy = JSON.parse(JSON.stringify(row));
      inserts.push(copy);
      return userInsert(copy, inserts);
    },
    toast: m => toasts.push(m),
    confirm: opts.confirm || (() => true),
    getCart: () => cart.map(i => Object.assign({}, i)),
    setCart: items => {cart.length = 0; items.forEach(i => cart.push(i));},
    clearCart: () => {cart.length = 0; cleared++;},
    renderCart: () => {},
    getOrderForm: () => Object.assign({}, form),
    setOrderForm: f => Object.assign(form, f),
    getTradeForm: () => Object.assign({}, trade),
    setTradeForm: f => Object.assign(trade, f),
    openTrade: () => {},
    resetTrade: () => {tradeReset++;},
    showErrors: (type, errs) => errors.push({type, errs}),
    setOrderButton: busy => buttons.push({type: "order", busy: !!busy, label: busy ? "Saving order…" : "Place order"}),
    setTradeButton: busy => buttons.push({type: "tradein", busy: !!busy, label: busy ? "Saving request…" : "Send trade-in request"}),
    setNote: (type, text) => {notes[type] = text || "";},
    setActions: (type, on) => {actions[type] = !!on;},
    showWA: (msg, title, lead) => {
      if (opts.showWA) opts.showWA(msg, title, lead);
      wa.push({msg, title, lead});
    },
    onConfirmed: o => {
      if (opts.onConfirmed) opts.onConfirmed(o);
      confirmed.push(o);
    }
  };
  const ctrl = cx.cxCreateController(env);
  return {ctrl, cart, form, trade, wa, toasts, buttons, confirmed, errors, inserts, notes, actions, storage, get cleared() {return cleared;}, get tradeReset() {return tradeReset;}};
}

const savedTitle = /^Order .+ saved$/;
const tradeTitle = /^Trade-in .+ saved$/;

test("strong references are 20 characters, prefixed, and unique", () => {
  const ids = new Set();
  for (let i = 0; i < 300; i++) ids.add(cx.cxStrongCode(i % 2 ? "T" : "C"));
  assert.equal(ids.size, 300);
  for (const id of ids) {
    assert.equal(id.length, 20);
    assert.ok(id.length <= 20);
    assert.match(id, /^[CT]-[0-9a-f]{18}$/);
    assert.equal(cx.cxIsStrongCode(id), true);
  }
  assert.equal(cx.cxIsStrongCode("C-AB3KQ"), false);
  assert.equal(cx.cxIsStrongCode("C-1041"), false);
  assert.equal(cx.cxIsStrongCode("C-" + "A".repeat(18)), false);
  assert.match(block[1], /getRandomValues/);
});

test("1. successful checkout confirms once, opens WhatsApp, then clears the cart", async () => {
  const h = harness();
  const result = await h.ctrl.submit("order");
  assert.equal(result.status, "confirmed");
  assert.equal(cx.cxIsStrongCode(result.id), true);
  assert.equal(result.id.startsWith("C-"), true);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.inserts[0].code, result.id);
  assert.equal(h.inserts[0].type, "order");
  assert.equal(h.inserts[0].name, "Karim");
  assert.equal(h.inserts[0].phone, "70 123 456");
  assert.equal(h.inserts[0].area, "Beirut");
  assert.equal(h.inserts[0].address, "Hamra street building 4");
  assert.equal(h.inserts[0].pay, "Cash on delivery");
  assert.equal(h.wa.length, 1);
  assert.match(h.wa[0].title, savedTitle);
  assert.match(h.wa[0].title, new RegExp(result.id));
  assert.match(h.wa[0].msg, new RegExp("Hi Connectify! Order " + result.id));
  assert.match(h.wa[0].msg, /Hamra street building 4/);
  assert.match(h.wa[0].lead, /WhatsApp \(\+961 71 062 768\)/);
  assert.equal(h.cart.length, 0);
  assert.equal(h.cleared, 1);
  assert.equal(h.form.name, "Karim");
  assert.equal(h.confirmed.length, 1);
  assert.equal(h.confirmed[0].sent, 1);
  assert.equal(h.confirmed[0].checkout, 1);
  assert.equal(h.confirmed[0].status, "new");
  assert.equal(h.ctrl.slot("order"), null);
  assert.deepEqual(h.buttons.map(b => b.busy), [true, false]);
  assert.equal(h.buttons.at(-1).label, "Place order");
});

test("2. database rejection keeps the cart, the reference, and does not open WhatsApp", async () => {
  const h = harness({insert: async () => ({error: {code: "23514", message: "check violation"}})});
  const result = await h.ctrl.submit("order");
  assert.equal(result.status, "failed");
  assert.equal(h.wa.length, 0);
  assert.equal(h.cart.length, 1);
  assert.equal(h.cleared, 0);
  assert.equal(h.form.name, "Karim");
  assert.equal(h.form.address, "Hamra street building 4");
  assert.equal(h.confirmed.length, 0);
  assert.equal(h.ctrl.slot("order").id, result.id);
  assert.ok(h.toasts.some(t => t.includes(result.id) && t.includes("not saved")));
  assert.ok(h.toasts.every(t => !savedTitle.test(t)));
});

test("3. offline checkout is uncertain, keeps the cart, and reuses the reference", async () => {
  let n = 0;
  const h = harness({
    insert: async () => {
      n++;
      if (n === 1) throw new Error("Failed to fetch");
      return {error: null};
    }
  });
  const first = await h.ctrl.submit("order");
  assert.equal(first.status, "uncertain");
  assert.equal(h.wa.length, 0);
  assert.equal(h.cart.length, 1);
  assert.equal(h.ctrl.slot("order").uncertain, 1);
  assert.ok(h.toasts.some(t => t.includes("couldn't confirm") && t.includes(first.id)));
  const second = await h.ctrl.submit("order");
  assert.equal(second.status, "confirmed");
  assert.equal(second.id, first.id);
  assert.equal(h.inserts[0].code, h.inserts[1].code);
  assert.equal(h.wa.length, 1);
  assert.equal(h.cart.length, 0);
});

test("4. double-click, Enter, and repeated taps share one in-flight request", async () => {
  let release;
  const gate = new Promise(r => {release = r;});
  const h = harness({
    timeoutMs: 500,
    insert: () => gate.then(() => ({error: null}))
  });
  const first = h.ctrl.submit("order");
  const second = await h.ctrl.submit("order");
  const third = await h.ctrl.submit("order");
  assert.equal(second.status, "ignored");
  assert.equal(third.status, "ignored");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.inserts.length, 1);
  assert.equal(h.buttons.filter(b => b.busy).length, 1);
  release();
  const done = await first;
  assert.equal(done.status, "confirmed");
  assert.equal(h.inserts.length, 1);
  assert.equal(h.wa.length, 1);
  assert.equal(h.buttons.at(-1).busy, false);
  assert.equal(h.buttons.at(-1).label, "Place order");
});

test("5. a failed checkout retries with the same reference", async () => {
  let n = 0;
  const h = harness({
    insert: async () => {
      n++;
      if (n === 1) return {error: {code: "23514", message: "check"}};
      return {error: null};
    }
  });
  const first = await h.ctrl.submit("order");
  assert.equal(first.status, "failed");
  const second = await h.ctrl.submit("order");
  assert.equal(second.status, "confirmed");
  assert.equal(second.id, first.id);
  assert.equal(h.inserts[0].code, h.inserts[1].code);
  assert.equal(h.wa.length, 1);
  assert.match(h.wa[0].title, new RegExp(first.id));
});

test("6. unique conflicts: unrelated collision retargets, uncertain retry confirms, legacy codes stick", async () => {
  const h = harness({
    insert: async (_row, inserts) => {
      if (inserts.length === 1) return {error: {code: "23505", message: "duplicate key"}};
      return {error: null};
    }
  });
  const collided = await h.ctrl.submit("order");
  assert.equal(collided.status, "confirmed");
  assert.equal(h.inserts.length, 2);
  assert.notEqual(h.inserts[0].code, h.inserts[1].code);
  assert.equal(cx.cxIsStrongCode(h.inserts[0].code), true);
  assert.equal(h.inserts[1].code, collided.id);
  assert.equal(h.wa.length, 1);
  assert.match(h.wa[0].title, new RegExp(h.inserts[1].code));
  assert.ok(!h.wa[0].title.includes(h.inserts[0].code));
  const replaced = h.confirmed[0].id;
  assert.equal(replaced, h.inserts[1].code);

  const strong = cx.cxStrongCode("C");
  assert.equal(cx.cxDecideInsert({id: strong, uncertain: 1}, {error: {code: "23505"}}).status, "confirmed");
  assert.equal(cx.cxDecideInsert({id: strong, uncertain: 0, priorAttempt: 0}, {error: {code: "23505"}}).status, "conflict-retarget");
  assert.equal(cx.cxDecideInsert({id: strong, uncertain: 0, priorAttempt: 1}, {error: {code: "23505"}}).status, "conflict-stuck");
  assert.equal(cx.cxDecideInsert({id: "C-AB3KQ", uncertain: 1}, {error: {code: "23505"}}).status, "conflict-stuck");
  assert.equal(cx.cxMayShowWA("confirmed"), true);
  assert.equal(cx.cxMayShowWA("uncertain"), false);
  assert.equal(cx.cxMayShowWA("failed"), false);

  const legacyForm = {name: "Karim", phone: "70123456", phoneRaw: "70 123 456", area: "Beirut", address: "Hamra street building 4"};
  const legacyCart = [{key: "phone:14pro", kind: "phone", id: "14pro", title: "iPhone 14 Pro", detail: "256GB", price: 500, unit: "u1"}];
  const fp = cx.cxFingerprint({cart: legacyCart, form: legacyForm});
  const storage = memoryStorage();
  const now = 1_700_000_000_000;
  storage.setItem("connectify-pending-v1", JSON.stringify({order: {
    id: "C-AB3KQ", type: "order", fp, form: legacyForm, cart: legacyCart, items: cx.cxItems(legacyCart),
    name: "Karim", phone: "70 123 456", area: "Beirut", address: "Hamra street building 4", pay: "Cash on delivery",
    t: now, updated: now, attempted: 1, uncertain: 1, stuck: 0, state: "uncertain", flight: 1, replaced: []
  }}));
  const legacy = harness({
    storage, cart: legacyCart.map(i => Object.assign({}, i)), form: Object.assign({}, legacyForm),
    insert: async () => ({error: {code: "23505", message: "duplicate key"}})
  });
  const stuck = await legacy.ctrl.submit("order");
  assert.equal(stuck.status, "conflict-stuck");
  assert.equal(stuck.id, "C-AB3KQ");
  assert.equal(legacy.wa.length, 0);
  assert.equal(legacy.inserts.length, 1);
  assert.equal(legacy.inserts[0].code, "C-AB3KQ");
  assert.equal(legacy.cart.length, 1);
  const again = await legacy.ctrl.submit("order");
  assert.equal(again.status, "stuck");
  assert.equal(legacy.inserts.length, 1);
  assert.equal(legacy.wa.length, 0);
});

test("7. timeout after a server-side commit confirms the same reference once", async () => {
  const h = harness({
    timeoutMs: 30,
    insert: () => new Promise(resolve => setTimeout(() => resolve({error: null}), 70))
  });
  const pending = await h.ctrl.submit("order");
  assert.equal(pending.status, "uncertain");
  assert.equal(h.wa.length, 0);
  assert.equal(h.cart.length, 1);
  const id = pending.id;
  await delay(80);
  assert.equal(h.wa.length, 1);
  assert.match(h.wa[0].title, new RegExp(id));
  assert.equal(h.cart.length, 0);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.inserts[0].code, id);
  assert.equal(h.confirmed.length, 1);
  assert.equal(h.ctrl.slot("order"), null);
});

test("7b. retry after a lost response treats 23505 on the same strong code as confirmation", async () => {
  let n = 0;
  const h = harness({
    timeoutMs: 25,
    insert: () => {
      n++;
      if (n === 1) return new Promise(() => {});
      return Promise.resolve({error: {code: "23505", message: "duplicate key"}});
    }
  });
  const first = await h.ctrl.submit("order");
  assert.equal(first.status, "uncertain");
  assert.equal(h.wa.length, 0);
  const second = await h.ctrl.submit("order");
  assert.equal(second.status, "confirmed");
  assert.equal(second.recovered, true);
  assert.equal(second.id, first.id);
  assert.equal(h.inserts.length, 2);
  assert.equal(h.inserts[0].code, h.inserts[1].code);
  assert.equal(h.wa.length, 1);
  assert.equal(h.cart.length, 0);
});

test("8 and 9. refresh restores an unconfirmed cart and customer details without sending", async () => {
  const storage = memoryStorage();
  const first = harness({
    storage,
    insert: async () => ({error: {code: "23514", message: "check"}})
  });
  const failed = await first.ctrl.submit("order");
  assert.equal(failed.status, "failed");
  const saved = first.ctrl.slot("order");
  assert.equal(saved.form.name, "Karim");
  assert.equal(saved.form.address, "Hamra street building 4");
  assert.equal(saved.cart[0].title, "iPhone 14 Pro");

  const revived = harness({storage, cart: [], form: {name: "", phone: "", phoneRaw: "", area: "", address: ""}, insert: async () => {throw new Error("should not send");}});
  revived.ctrl.restore();
  assert.equal(revived.inserts.length, 0);
  assert.equal(revived.wa.length, 0);
  assert.equal(revived.cart.length, 1);
  assert.equal(revived.cart[0].title, "iPhone 14 Pro");
  assert.equal(revived.form.name, "Karim");
  assert.equal(revived.form.phoneRaw, "70 123 456");
  assert.equal(revived.form.area, "Beirut");
  assert.equal(revived.form.address, "Hamra street building 4");
  assert.equal(revived.ctrl.slot("order").id, failed.id);
  assert.match(revived.toasts.at(-1), /Nothing was sent again yet/);

  const saving = memoryStorage();
  const id = cx.cxStrongCode("C");
  const form = {name: "Maya", phone: "71111222", phoneRaw: "71 111 222", area: "Saida", address: "Old souk 2"};
  const cart = [{key: "acc:1", kind: "acc", id: "a1", title: "Case", detail: "Black", price: 15}];
  const fp = cx.cxFingerprint({cart, form});
  const now = 1_700_000_000_000;
  saving.setItem("connectify-pending-v1", JSON.stringify({order: {
    id, type: "order", fp, form, cart, items: cx.cxItems(cart), name: form.name, phone: form.phoneRaw,
    area: form.area, address: form.address, pay: "Cash on delivery", t: now, updated: now,
    attempted: 0, uncertain: 0, stuck: 0, state: "saving", flight: 1, replaced: []
  }}));
  const mid = harness({storage: saving, cart: [], form: {name: "", phone: "", phoneRaw: "", area: "", address: ""}, now: () => now, insert: async () => {throw new Error("should not send");}});
  mid.ctrl.restore();
  assert.equal(mid.inserts.length, 0);
  assert.equal(mid.ctrl.slot("order").state, "uncertain");
  assert.equal(mid.ctrl.slot("order").id, id);
  assert.equal(mid.form.name, "Maya");
  assert.equal(mid.cart[0].title, "Case");
});

test("editing the cart does not overwrite a pending checkout", async () => {
  const h = harness({insert: async () => ({error: {code: "23514", message: "check"}})});
  const failed = await h.ctrl.submit("order");
  h.cart.push({key: "acc:2", kind: "acc", id: "a2", title: "Cable", detail: "USB-C", price: 10});
  h.form.name = "Someone else";
  const blocked = await h.ctrl.submit("order");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.id, failed.id);
  assert.equal(h.inserts.length, 1);
  assert.equal(h.wa.length, 0);
  assert.equal(h.ctrl.slot("order").id, failed.id);
  assert.equal(h.ctrl.slot("order").form.name, "Karim");
  assert.equal(h.ctrl.slot("order").cart.length, 1);
  h.ctrl.useSaved("order");
  assert.equal(h.form.name, "Karim");
  assert.equal(h.cart.length, 1);
  assert.equal(h.cart[0].title, "iPhone 14 Pro");
});

test("an old unattempted checkout is kept, restored, and not auto-sent", () => {
  const now = 1_700_000_000_000;
  const form = {name: "Karim", phone: "70123456", phoneRaw: "70 123 456", area: "Beirut", address: "Hamra street building 4"};
  const cart = [{key: "phone:14pro", kind: "phone", id: "14pro", title: "iPhone 14 Pro", detail: "256GB", price: 500}];
  const fp = cx.cxFingerprint({cart, form});
  const id = cx.cxStrongCode("C");
  const storage = memoryStorage();
  storage.setItem("connectify-pending-v1", JSON.stringify({order: {
    id, type: "order", fp, form, cart, t: now - 3 * 86400000, updated: now - 3 * 86400000,
    attempted: 0, uncertain: 0, state: "draft"
  }}));
  const h = harness({storage, cart: [], form: {name: "", phone: "", phoneRaw: "", area: "", address: ""}, now: () => now, insert: async () => {throw new Error("should not send");}});
  h.ctrl.restore();
  assert.equal(h.ctrl.slot("order").id, id);
  assert.equal(h.ctrl.slot("order").form.name, "Karim");
  assert.equal(h.ctrl.slot("order").cart[0].title, "iPhone 14 Pro");
  assert.equal(h.cart.length, 1);
  assert.equal(h.cart[0].title, "iPhone 14 Pro");
  assert.equal(h.form.name, "Karim");
  assert.equal(h.form.address, "Hamra street building 4");
  assert.equal(h.inserts.length, 0);
  assert.equal(h.wa.length, 0);
  assert.match(h.notes.order, /saved on this device/);
  assert.match(h.toasts.at(-1), /Nothing was sent again yet/);
  assert.equal(cx.cxPendingDecision(h.ctrl.slot("order"), fp).action, "reuse");
  assert.equal(cx.cxShouldAutoSend(), false);
  assert.equal(cx.cxShouldAutoSend({t: now - 1000, id: "C-AB3KQ"}, now), false);
  assert.equal(cx.cxShouldAutoSend({t: now - 31 * 60 * 1000, id: "C-OLD"}, now), false);
  const oldOrder = {id: "C-OLD", t: now - 3 * 86400000, name: "Rami", phone: "70 000 101", items: [{title: "iPhone"}], sent: 0};
  const recent = {id: "C-NEW", t: now - 1000, name: "Maya", phone: "71 111 222", items: [{title: "Case"}]};
  const snapshot = JSON.parse(JSON.stringify([oldOrder, recent, {id: "C-1041", demo: 1}, {id: "C-DONE", sent: 1}, {id: "C-REMOTE", remote: 1}]));
  const before = JSON.parse(JSON.stringify(snapshot));
  const note = cx.cxLegacyNotice(snapshot);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(note.ids, ["C-OLD", "C-NEW"]);
  assert.match(note.text, /not sent again/);
  assert.match(note.text, /C-OLD/);
  assert.match(note.text, /C-NEW/);
  assert.equal(note.text.includes("C-1041"), false);
  assert.equal(cx.cxLegacyUnsent(oldOrder), true);
  assert.equal(cx.cxLegacyUnsent({id: "C-DONE", sent: 1}), false);
});

test("a confirmed order is not submitted again after refresh", async () => {
  const storage = memoryStorage();
  const h = harness({storage});
  const done = await h.ctrl.submit("order");
  assert.equal(done.status, "confirmed");
  const next = harness({storage, cart: [], form: {name: "", phone: "", phoneRaw: "", area: "", address: ""}, insert: async () => {throw new Error("should not send");}});
  next.ctrl.restore();
  assert.equal(next.inserts.length, 0);
  assert.equal(next.wa.length, 0);
  assert.equal(next.cart.length, 0);
  assert.equal(next.ctrl.slot("order"), null);
});

test("discard of an attempted checkout requires confirmation and does not invent a second reference until discarded", async () => {
  let allowed = false;
  const h = harness({
    confirm: () => allowed,
    insert: async () => ({error: {code: "23514", message: "check"}})
  });
  const failed = await h.ctrl.submit("order");
  const kept = h.ctrl.discard("order");
  assert.equal(kept.status, "kept");
  assert.equal(h.ctrl.slot("order").id, failed.id);
  allowed = true;
  const dropped = h.ctrl.discard("order");
  assert.equal(dropped.status, "discarded");
  assert.equal(h.ctrl.slot("order"), null);
});

test("10. trade-in success and failure", async () => {
  const ok = harness();
  const saved = await ok.ctrl.submit("tradein");
  assert.equal(saved.status, "confirmed");
  assert.equal(saved.id.startsWith("T-"), true);
  assert.equal(cx.cxIsStrongCode(saved.id), true);
  assert.equal(ok.inserts.length, 1);
  assert.equal(ok.inserts[0].type, "tradein");
  assert.equal(ok.inserts[0].trade.title, "iPhone 14 Pro");
  assert.equal(ok.inserts[0].trade.detail, "256GB, Good, battery 90%");
  assert.equal(ok.wa.length, 1);
  assert.match(ok.wa[0].title, tradeTitle);
  assert.match(ok.wa[0].msg, /Hi Connectify! Trade-in request/);
  assert.equal(ok.tradeReset, 1);
  assert.equal(ok.confirmed[0].type, "tradein");
  assert.equal(ok.confirmed[0].sent, 1);

  const bad = harness({insert: async () => {throw new Error("offline");}});
  const failed = await bad.ctrl.submit("tradein");
  assert.equal(failed.status, "uncertain");
  assert.equal(bad.wa.length, 0);
  assert.equal(bad.tradeReset, 0);
  assert.equal(bad.trade.name, "Karim");
  assert.equal(bad.ctrl.slot("tradein").id, failed.id);
  assert.ok(bad.toasts.every(t => !tradeTitle.test(t)));
  const retry = harness({storage: bad.storage, insert: async () => ({error: null})});
  retry.trade.name = bad.trade.name;
  Object.assign(retry.trade, bad.ctrl.slot("tradein").form);
  const again = await retry.ctrl.submit("tradein");
  assert.equal(again.status, "confirmed");
  assert.equal(again.id, failed.id);
});

test("11. admin order mapping still reads code, items, address, and trade", async () => {
  const h = harness();
  await h.ctrl.submit("order");
  const db = h.confirmed[0];
  const row = cx.cxOrderRow({
    id: db.id, type: db.type, name: db.name, phone: db.phone, area: db.area, pay: db.pay,
    items: db.items, trade: null, address: db.address
  });
  const mapped = fromRow({
    id: 42, code: row.code, type: row.type, created_at: "2026-10-12T12:00:00.000Z",
    name: row.name, phone: row.phone, area: row.area, pay: row.pay, status: "new",
    items: row.items, trade: null, address: row.address, stock_applied: false
  });
  assert.equal(mapped.id, db.id);
  assert.equal(mapped.dbid, 42);
  assert.equal(mapped.remote, 1);
  assert.equal(mapped.name, "Karim");
  assert.equal(mapped.phone, "70 123 456");
  assert.equal(mapped.area, "Beirut");
  assert.equal(mapped.address, "Hamra street building 4");
  assert.equal(mapped.pay, "Cash on delivery");
  assert.equal(mapped.status, "new");
  assert.equal(mapped.stockApplied, 0);
  assert.equal(mapped.items[0].title, "iPhone 14 Pro");
  assert.equal(mapped.items[0].price, 500);
  const tradeRow = fromRow({
    id: 7, code: "T-abcdef0123456789ab", type: "tradein", created_at: "2026-10-12T12:00:00.000Z",
    name: "Karim", phone: "70 123 456", area: null, pay: null, status: "new", items: [],
    trade: {id: "14pro", title: "iPhone 14 Pro", detail: "256GB", est: "$400", address: "Hamra"},
    address: null, stock_applied: false
  });
  assert.equal(tradeRow.type, "tradein");
  assert.equal(tradeRow.address, "Hamra");
  assert.equal(tradeRow.trade.title, "iPhone 14 Pro");
});

test("12. WhatsApp opens only after a verified success", async () => {
  const h = harness({insert: async () => ({error: {code: "23514", message: "no"}})});
  await h.ctrl.submit("order");
  assert.equal(h.wa.length, 0);
  h.cart.push({key: "x", kind: "acc", id: "x", title: "Extra", detail: "X", price: 1});
  await h.ctrl.submit("order");
  assert.equal(h.wa.length, 0);
  const empty = harness({cart: []});
  const invalid = await empty.ctrl.submit("order");
  assert.equal(invalid.status, "invalid");
  assert.equal(empty.wa.length, 0);
  assert.equal(empty.inserts.length, 0);
  assert.ok(empty.toasts.includes("Your cart is empty") || empty.toasts.includes("A few details are missing"));
});

test("address fallback moves delivery text into trade when the column is missing", async () => {
  const calls = [];
  const result = await cx.cxInsertWithFallback(async row => {
    calls.push(JSON.parse(JSON.stringify(row)));
    if (row.address) return {error: {message: "Could not find the address column of orders"}};
    return {error: null};
  }, {code: "C-0123456789abcdef01", type: "order", name: "Karim", phone: "70 123 456", area: "Beirut", pay: "Cash on delivery", items: [], trade: null, address: "Hamra street building 4"});
  assert.equal(result.error, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].address, undefined);
  assert.equal(calls[1].trade.address, "Hamra street building 4");
});

test("13. Task B availability behavior is untouched", () => {
  assert.match(html, /const cardPill=s=>s\.k=="soon"\?pill\(s\):""/);
  assert.match(html, /Ask for availability/);
  assert.match(html, /function applyStock\(o,dir\)/);
  const diff = execSync("git diff -U0 main -- index.html", {encoding: "utf8"});
  for (const needle of ["cardPill", "applyStock"]) {
    assert.equal(diff.includes(needle), false, needle + " appeared in the checkout diff");
  }
});

test("14. desktop and mobile share one checkout control and one handler", () => {
  assert.equal((html.match(/id="checkout"/g) || []).length, 1);
  assert.match(html, /if\(cxRunLive\("order"\)\)return;/);
  assert.match(html, /if\(cxRunLive\("trade"\)\)return;/);
  assert.match(html, /window\.CX_LIVE_PAGE=1/);
  assert.match(html, /#checkout:disabled/);
  assert.doesNotMatch(block[1], /innerWidth|matchMedia|userAgent/);
  assert.doesNotMatch(html, /@media[^{]*\{[^}]*#checkout/);
  assert.doesNotMatch(html, /o\.id=nextCode/);
  assert.match(html, /nextCode=pre=>cxStrongCode/);
  const sendBody = html.slice(html.indexOf("function sendOrders"), html.indexOf("/* ---------- what customers look at"));
  assert.doesNotMatch(sendBody, /sb\.from\("orders"\)\.insert/);
  assert.match(sendBody, /cxLegacyHold/);
  assert.match(sendBody, /Dismiss — keep them on this device/);
  assert.doesNotMatch(sendBody, /toast\(note/);
  const guard = html.indexOf('if(cxRunLive("order"))return;');
  const legacyClear = html.indexOf("cart.length=0;renderCart();renderGrid();openCart(false)");
  assert.ok(guard > 0 && legacyClear > guard);
  assert.equal(cxCheckoutGate(false, false, true), "controller");
  assert.equal(cxCheckoutGate(true, false, false), "unavailable");
  assert.equal(cxCheckoutGate(false, true, false), "unavailable");
  assert.equal(cxCheckoutGate(false, false, false), "demo");
});

test("live init failure does not use the local success flow", () => {
  assert.match(html, /Checkout is temporarily unavailable/);
  assert.match(html, /Trade-in is temporarily unavailable/);
  const orderHandler = html.slice(html.indexOf('onSubmit("dfoot"'), html.indexOf('onSubmit("tReq"'));
  assert.match(orderHandler, /if\(cxRunLive\("order"\)\)return;/);
  assert.match(orderHandler, /window\.cxOrderMessage\(\{id,cart:snap/);
  assert.match(orderHandler, /showWA\(built\.msg,built\.title,built\.lead\)/);
  assert.doesNotMatch(orderHandler, /cart\.map\(i=>`• /);
  const tradeHandler = html.slice(html.indexOf('onSubmit("tReq"'), html.indexOf("/* ================= store details"));
  assert.match(tradeHandler, /if\(cxRunLive\("trade"\)\)return;/);
  assert.match(tradeHandler, /Trade-in \$\{id\} saved/);
});

test("a reference is stored before the request, and a later 23505 does not mint another code", async () => {
  const h = harness({
    insert: async () => {
      const bag = JSON.parse(h.storage.getItem("connectify-pending-v1"));
      assert.equal(bag.order.armed, 1);
      assert.ok(bag.order.attemptCount >= 1);
      assert.equal(bag.order.id.length, 20);
      return {error: null};
    }
  });
  const saved = await h.ctrl.submit("order");
  assert.equal(saved.status, "confirmed");
  assert.equal(h.inserts[0].code, saved.id);

  const form = {name: "Karim", phone: "70123456", phoneRaw: "70 123 456", area: "Beirut", address: "Hamra street building 4"};
  const cart = [{key: "phone:14pro", kind: "phone", id: "14pro", title: "iPhone 14 Pro", detail: "256GB, Space Black", price: 500, hex: "#111", unit: "u1"}];
  const id = cx.cxStrongCode("C");
  const fp = cx.cxFingerprint({cart, form});
  const now = 1_700_000_000_000;
  const storage = memoryStorage();
  storage.setItem("connectify-pending-v1", JSON.stringify({order: {
    id, type: "order", fp, form, cart, items: cx.cxItems(cart), name: form.name, phone: form.phoneRaw,
    area: form.area, address: form.address, pay: "Cash on delivery", t: now, updated: now,
    attempted: 1, uncertain: 0, armed: 1, attemptCount: 1, priorAttempt: 0, stuck: 0, state: "failed", flight: 1, replaced: []
  }}));
  const prior = harness({
    storage, now: () => now,
    insert: async () => ({error: {code: "23505", message: "duplicate key"}})
  });
  const stuck = await prior.ctrl.submit("order");
  assert.equal(stuck.status, "conflict-stuck");
  assert.equal(stuck.id, id);
  assert.equal(prior.inserts.length, 1);
  assert.equal(prior.inserts[0].code, id);
  assert.equal(prior.wa.length, 0);
  assert.equal(prior.cart.length, 1);
  assert.equal(prior.ctrl.slot("order").id, id);
});

test("a checkout that cannot be stored locally is not sent", async () => {
  const storage = memoryStorage();
  storage.getItem = () => null;
  const h = harness({
    storage,
    insert: async () => {throw new Error("should not send");}
  });
  const result = await h.ctrl.submit("order");
  assert.equal(result.status, "failed");
  assert.equal(result.persist, true);
  assert.equal(h.inserts.length, 0);
  assert.equal(h.wa.length, 0);
  assert.equal(h.cart.length, 1);
  assert.equal(h.form.name, "Karim");
  assert.match(h.toasts.at(-1), /Nothing was sent/);
});

test("a live-script parse failure still fails closed, and an unmarked page stays a demo", () => {
  const marker = "<script>window.CX_LIVE_PAGE=1</script>";
  const liveOpen = '<script data-cx-live="1">';
  const markerAt = html.indexOf(marker);
  const liveAt = html.indexOf(liveOpen);
  assert.ok(markerAt > 0 && liveAt > markerAt + marker.length);
  assert.equal(html.indexOf(marker), html.lastIndexOf(marker));
  const liveBody = html.slice(liveAt, html.indexOf("</script>", liveAt));
  assert.ok(liveBody.startsWith(liveOpen));
  assert.match(liveBody, /window\.CX_LIVE_PAGE=1/);
  const liveSource = liveBody.slice(liveOpen.length);
  assert.doesNotThrow(() => new Function(liveSource));
  const broken = liveSource.replace("window.CX_LIVE_PAGE=1", "<<<not-javascript");
  assert.throws(() => new Function(broken), SyntaxError);
  assert.doesNotThrow(() => new Function(marker.replace(/^<script>/, "").replace(/<\/script>$/, "")));

  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  try {
    globalThis.window = {};
    globalThis.document = {querySelector: (sel) => sel === "script[data-cx-live]" ? {getAttribute: () => "1"} : null};
    assert.equal(cxPageIsLive(), true);
    assert.equal(cxCheckoutGate(cxPageIsLive(), false, false), "unavailable");

    globalThis.window = {};
    globalThis.document = {querySelector: () => null};
    assert.equal(cxPageIsLive(), false);
    assert.equal(cxCheckoutGate(cxPageIsLive(), false, false), "demo");

    globalThis.window = {CX_LIVE_PAGE: 1};
    globalThis.document = {querySelector: () => null};
    assert.equal(cxCheckoutGate(cxPageIsLive(), false, false), "unavailable");
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevDocument === undefined) delete globalThis.document;
    else globalThis.document = prevDocument;
  }
});

test("a local failure after a confirmed insert does not downgrade it or create a second order", async () => {
  const storage = memoryStorage();
  let waDown = true;
  const waFail = harness({
    storage,
    showWA: () => { if (waDown) throw new Error("whatsapp failed"); }
  });
  const saved = await waFail.ctrl.submit("order");
  assert.equal(saved.status, "confirmed");
  assert.equal(waFail.inserts.length, 1);
  assert.equal(waFail.wa.length, 0);
  assert.equal(waFail.cart.length, 1);
  assert.equal(waFail.confirmed.length, 1);
  assert.ok(waFail.toasts.every(t => !/couldn't confirm/i.test(t)));
  assert.equal(waFail.ctrl.slot("order").id, saved.id);
  assert.equal(waFail.ctrl.slot("order").state, "confirmed");
  waDown = false;
  const empty = {name: "", phone: "", phoneRaw: "", area: "", address: ""};
  const revived = harness({
    storage,
    cart: [],
    form: empty,
    insert: async () => { throw new Error("second order"); }
  });
  revived.ctrl.restore();
  assert.equal(revived.inserts.length, 0);
  assert.equal(revived.wa.length, 1);
  assert.match(revived.wa[0].title, new RegExp(saved.id));
  assert.equal(revived.confirmed.length, 0);

  let bookkeepingDown = true;
  const book = harness({
    onConfirmed: () => { if (bookkeepingDown) throw new Error("local order list failed"); }
  });
  const booked = await book.ctrl.submit("order");
  assert.equal(booked.status, "confirmed");
  assert.equal(book.inserts.length, 1);
  assert.equal(book.wa.length, 1);
  assert.equal(book.confirmed.length, 0);
  assert.equal(book.cart.length, 0);
  bookkeepingDown = false;
  const bookedAgain = await book.ctrl.submit("order");
  assert.equal(bookedAgain.status, "confirmed");
  assert.equal(bookedAgain.id, booked.id);
  assert.equal(book.inserts.length, 1);
  assert.equal(book.wa.length, 1);
  assert.equal(book.confirmed.length, 1);

  let inserted = false;
  const flaky = memoryStorage();
  const origSet = flaky.setItem.bind(flaky);
  flaky.setItem = (key, value) => {
    if (inserted && key === "connectify-pending-v1") throw new Error("post-insert storage failed");
    return origSet(key, value);
  };
  const stored = harness({
    storage: flaky,
    insert: async () => { inserted = true; return {error: null}; }
  });
  const kept = await stored.ctrl.submit("order");
  assert.equal(kept.status, "confirmed");
  assert.equal(stored.inserts.length, 1);
  assert.equal(stored.wa.length, 1);
  assert.ok(stored.toasts.every(t => !/couldn't confirm/i.test(t)));
  const keptAgain = await stored.ctrl.submit("order");
  assert.equal(keptAgain.status, "confirmed");
  assert.equal(keptAgain.id, kept.id);
  assert.equal(stored.inserts.length, 1);
  assert.equal(stored.wa.length, 1);
});
