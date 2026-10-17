import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";

const require = createRequire("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");
const {chromium} = require("playwright");

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const name = decodeURIComponent(url.pathname);
      const file = name === "/" ? "/workspace/index.html" : path.join("/workspace", name);
      if (!file.startsWith("/workspace/")) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const type = file.endsWith(".html") ? "text/html" : (file.endsWith(".js") || file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream");
        res.writeHead(200, {"content-type": type});
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function install(page) {
  await page.evaluate(() => {
    const key = "cx-market-audit-staging";
    const load = () => JSON.parse(localStorage.getItem(key) || JSON.stringify({
      settings: {automation_enabled: false, writes_enabled: false, min_margin_pct: null, lbp_per_usd: null, lbp_rate_verified: false},
      flags: {}, decisions: [], facts: {}
    }));
    const save = box => localStorage.setItem(key, JSON.stringify(box));
    const run = op => {
      const box = load();
      if (op.table === "market_settings" && op.action === "update") {
        box.settings = Object.assign(box.settings, op.body);
        save(box);
        return {data: null, error: null};
      }
      if (op.table === "market_settings") return {data: box.settings, error: null};
      if (op.table === "market_product_flags" && op.action === "upsert") {
        box.flags[op.body.sku] = op.body.auto_enabled === true;
        save(box);
        return {data: null, error: null};
      }
      if (op.table === "market_product_flags") return {data: Object.entries(box.flags).map(([sku, auto_enabled]) => ({sku, auto_enabled})), error: null};
      if (op.table === "market_decisions") {
        const rows = box.decisions.slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1);
        return {data: rows, error: null};
      }
      if (op.table === "market_observations") return {data: [], error: null};
      if (op.table === "market_sku_facts" && op.action === "upsert") {
        box.facts = box.facts || {};
        box.facts[op.body.sku] = op.body;
        save(box);
        return {data: null, error: null};
      }
      if (op.table === "market_sku_facts") return {data: Object.values(box.facts || {}), error: null};
      if (op.table === "store_state") {
        const key = op.eq && op.eq.key || "units";
        if (key === "units") return {data: {key: "units", data: window.__dbUnits || []}, error: null};
        return {data: {key, data: {}}, error: null};
      }
      return {data: null, error: {message: "unknown table"}};
    };
    const chain = table => {
      const op = {table, action: "select", body: null};
      const api = {
        select() { return api; },
        update(body) { op.action = "update"; op.body = body; return api; },
        upsert(body) { op.action = "upsert"; op.body = body; return api; },
        eq(column, value) { op.eq = Object.assign({}, op.eq, {[column]: value}); return api; },
        order() { return api; },
        limit() { return api; },
        maybeSingle() { return api; },
        then(resolve, reject) { return Promise.resolve(run(op)).then(resolve, reject); }
      };
      return api;
    };
    window.LIVE.staff = true;
    window.LIVE.sb = {
      from: chain,
      functions: {invoke: async () => ({data: null, error: {message: "not deployed"}})},
      rpc: async (name, args) => {
        if (!window.LIVE.staff) return {data: null, error: {message: "staff only"}};
        const box = load();
        if (name === "market_commit_price") {
          if (window.__failCommit) {
            window.__failCommit = false;
            return {data: null, error: {message: "stale price"}};
          }
          const sku = args.p_sku;
          const target = args.p_target == null ? null : Number(args.p_target);
          const previous = args.p_previous == null ? null : Number(args.p_previous);
          const unit = (window.__dbUnits || []).find(item => sku === "unit:" + item.id);
          if (!unit || Number(unit.p) !== previous) return {data: null, error: {message: "stale price"}};
          if (args.p_action === "apply") {
            if (box.decisions.some(row => row.status === "applied" && row.apply_key === args.p_apply_key)) return {data: null, error: {message: "already applied"}};
            let latest = null;
            box.decisions.forEach(row => {
              if (row.sku === sku && (row.status === "approved" || row.status === "rejected")) latest = row;
            });
            if (!latest || latest.status !== "approved" || Number(latest.target_price) !== target) return {data: null, error: {message: "not approved"}};
            const latestAt = box.decisions.indexOf(latest);
            if (box.decisions.slice(latestAt + 1).some(row => row.sku === sku && (row.status === "applied" || row.status === "restored"))) {
              return {data: null, error: {message: "not approved: approval already used"}};
            }
            const qty = unit.qty;
            unit.p = target;
            if (unit.qty !== qty) return {data: null, error: {message: "stock changed"}};
            box.decisions.push({sku, status: "applied", target_price: target, previous_price: previous, apply_key: args.p_apply_key, created_at: new Date().toISOString()});
            save(box);
            return {data: "applied-id", error: null};
          }
          if (args.p_action === "restore") {
            unit.p = target;
            box.decisions.push({sku, status: "restored", target_price: target, previous_price: previous, apply_key: null, created_at: new Date().toISOString()});
            save(box);
            return {data: "restored-id", error: null};
          }
          return {data: null, error: {message: "manual only"}};
        }
        const status = args.p_status;
        const sku = args.p_sku;
        const target = args.p_target == null ? null : Number(args.p_target);
        if (status === "applied" || status === "restored") return {data: null, error: {message: "price changes use market_commit_price"}};
        if (!["approved", "rejected"].includes(status)) return {data: null, error: {message: "bad status"}};
        box.decisions.push({sku, status, target_price: target, previous_price: args.p_previous == null ? null : Number(args.p_previous), apply_key: null, created_at: new Date().toISOString()});
        save(box);
        return {data: "ok", error: null};
      }
    };
    const unit = DB.units.find(item => item.m === "17promax" && item.c === "Silver" && item.st === 256 && item.cond === "new" && item.sim === "psim");
    DB.priv = DB.priv || {};
    DB.priv.u = DB.priv.u || {};
    DB.priv.u[unit.id] = {cost: 1400};
    window.__unitId = unit.id;
    window.__dbUnits = JSON.parse(JSON.stringify(DB.units));
    window.__staffSaves = 0;
    window.CX_STAFF_SAVE = async () => {
      window.__staffSaves += 1;
      return false;
    };
  });
}

test("manual approval persists, confirms the staff save, and can roll back without touching another variant", async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch({executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]});
  const context = await browser.newContext();
  try {
  const writes = [];
  async function guard(page) {
    await page.addInitScript(() => sessionStorage.setItem("cx-splash", "1"));
    await page.route("**/*supabase.co/**", route => {
      const req = route.request();
      if (req.method() !== "GET" && req.url().includes("store_state")) writes.push(req.method() + " " + req.url());
      return route.abort();
    });
  }
  const page = await context.newPage({viewport: {width: 1440, height: 1100}});
  page.on("dialog", dialog => dialog.accept());
  await guard(page);
  const url = "http://127.0.0.1:" + port + "/?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim";
  await page.goto(url, {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => window.LIVE && document.querySelector(".pvprice") && document.querySelector(".pvprice").textContent.includes("1542"));
  await install(page);
  const before = await page.evaluate(() => {
    const unit = DB.units.find(item => item.id === window.__unitId);
    const other = DB.units.find(item => item.m === "17promax" && item.st === 512);
    return {qty: unit.qty, color: unit.c, st: unit.st, sim: unit.sim, cond: unit.cond, other: other ? other.p : null, orders: JSON.stringify(DB.orders)};
  });
  await page.evaluate(() => { setAdmin(true); go("market"); });
  await page.waitForSelector("#marketCsv");
  const refused = await page.evaluate(async () => {
    const staff = window.LIVE.staff;
    window.LIVE.staff = false;
    const result = await window.LIVE.sb.rpc("market_decide", {p_sku: "unit:x", p_status: "approved", p_target: 10, p_previous: 12, p_apply_key: null, p_proposal: {}, p_mode: "manual"});
    window.LIVE.staff = staff;
    return result.error && result.error.message;
  });
  assert.equal(refused, "staff only");
  await page.locator("#marketCsv").fill("store,name,price,currency,url,available,storage,condition,sim,color,warranty,region\nNajem Starcall,iPhone 17 Pro Max,1515,USD,https://najemstarcall.com/product/iphone-17-pro-max,in_stock,256,new,psim,Silver,,\n");
  await page.locator("#marketImport").click();
  await page.locator("#marketMargin").fill("2");
  await page.locator("#marketSaveSettings").click();
  await page.waitForFunction(() => document.body.innerText.includes("Scheduled automatic updates stay off"));
  assert.equal(await page.locator("#marketAuto").isChecked(), false);
  await page.locator(".mktable input[data-sku]").first().check();
  await page.locator("#marketApprove").click();
  await page.waitForFunction(() => document.body.innerText.includes("The store price is unchanged until you apply it."));
  await page.evaluate(() => { window.__failCommit = true; });
  await page.locator("#marketApply").click();
  await page.waitForFunction(() => document.body.innerText.includes("was not marked applied"));
  const failed = await page.evaluate(() => {
    const unit = DB.units.find(item => item.id === window.__unitId);
    const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
    return {price: unit.p, applied: box.decisions.some(row => row.status === "applied"), auto: box.settings.automation_enabled, saves: window.__staffSaves};
  });
  assert.equal(failed.price, 1542);
  assert.equal(failed.applied, false);
  assert.equal(failed.auto, false);
  assert.equal(failed.saves, 0);
  const page2 = await context.newPage({viewport: {width: 390, height: 844}});
  await guard(page2);
  await page2.goto(url, {waitUntil: "domcontentloaded"});
  await page2.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length, null, {timeout: 60000});
  await install(page2);
  await page2.evaluate(() => { setAdmin(true); go("market"); });
  await page2.waitForFunction(() => document.body.innerText.includes("Approved"));
  assert.equal(await page2.locator("#marketAuto").isChecked(), false);
  await page.locator("#marketApply").click();
  await page.waitForFunction(() => document.body.innerText.includes("Applied 1 approved price"));
  await page.locator("#marketApply").click();
  await page.waitForTimeout(300);
  const second = await page.evaluate(() => {
    const unit = DB.units.find(item => item.id === window.__unitId);
    const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
    return {price: unit.p, appliedRows: box.decisions.filter(row => row.status === "applied").length};
  });
  assert.equal(second.price, 1511.97);
  assert.equal(second.appliedRows, 1);
  await page.evaluate(() => setAdmin(false));
  await page.waitForFunction(() => document.querySelector(".pvprice") && document.querySelector(".pvprice").textContent.includes("1511.97"));
  const applied = await page.evaluate(beforeOrders => {
    const unit = DB.units.find(item => item.id === window.__unitId);
    const other = DB.units.find(item => item.m === "17promax" && item.st === 512);
    const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
    return {
      price: unit.p, qty: unit.qty, color: unit.c, st: unit.st, sim: unit.sim, cond: unit.cond,
      other: other ? other.p : null, orders: JSON.stringify(DB.orders) === beforeOrders,
      appliedRows: box.decisions.filter(row => row.status === "applied").length,
      auto: box.settings.automation_enabled,
      saves: window.__staffSaves
    };
  }, before.orders);
  assert.equal(applied.price, 1511.97);
  assert.equal(applied.saves, 0);
  assert.equal(applied.qty, before.qty);
  assert.equal(applied.color, before.color);
  assert.equal(applied.st, before.st);
  assert.equal(applied.sim, before.sim);
  assert.equal(applied.cond, before.cond);
  assert.equal(applied.other, before.other);
  assert.equal(applied.orders, true);
  assert.equal(applied.appliedRows, 1);
  assert.equal(applied.auto, false);
  await page.evaluate(() => { setAdmin(true); go("market"); });
  await page.waitForSelector("[data-restore]");
  await page.locator("[data-restore]").click();
  await page.waitForFunction(() => document.body.innerText.includes("Previous price restored"));
  await page.evaluate(() => setAdmin(false));
  await page.waitForFunction(() => document.querySelector(".pvprice") && document.querySelector(".pvprice").textContent.includes("1542"));
  const restored = await page.evaluate(() => {
    const unit = DB.units.find(item => item.id === window.__unitId);
    const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
    return {price: unit.p, qty: unit.qty, restored: box.decisions.some(row => row.status === "restored")};
  });
  assert.equal(restored.price, 1542);
  assert.equal(restored.qty, before.qty);
  assert.equal(restored.restored, true);
  assert.equal(writes.length, 0);
  await page2.reload({waitUntil: "domcontentloaded"});
  await page2.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length, null, {timeout: 60000});
  await install(page2);
  await page2.evaluate(() => { setAdmin(true); go("market"); });
  await page2.waitForFunction(() => document.body.innerText.includes("Restored"));
  assert.equal(writes.length, 0);
  } finally {
    await browser.close();
    server.close();
  }
});
