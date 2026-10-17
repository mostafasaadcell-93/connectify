import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    throw new Error("Playwright is not installed for this project. From the project root run `npm install`, then `npx playwright install chromium` if you want Playwright's own browser. " + detail);
  }
}

async function launchBrowser(chromium) {
  if (!chromium || typeof chromium.launch !== "function") {
    throw new Error("Playwright loaded without a Chromium launcher. Reinstall playwright from the project root.");
  }
  const args = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
  const attempts = [
    () => chromium.launch({headless: true, args}),
    () => chromium.launch({headless: true, args, channel: "chrome"}),
    () => chromium.launch({headless: true, args, channel: "msedge"})
  ];
  const errors = [];
  for (const attempt of attempts) {
    try { return await attempt(); }
    catch (error) { errors.push(error && error.message ? error.message : String(error)); }
  }
  throw new Error("Playwright could not launch a browser. Install Google Chrome, Microsoft Edge, or run `npx playwright install chromium` from the project root.\n" + errors.join("\n"));
}

function projectFile(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); }
  catch { return null; }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^[/\\]+/, "");
  if (!relative || relative.includes("\0")) return null;
  const file = path.resolve(root, relative);
  const fromRoot = path.relative(root, file);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return null;
  return file;
}

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const file = projectFile(url.pathname);
      if (!file) { res.writeHead(403); res.end(); return; }
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
        window.__settingsUpdates = window.__settingsUpdates || [];
        window.__settingsUpdates.push(op.body);
        box.settings = Object.assign(box.settings, op.body);
        save(box);
        return {data: null, error: null};
      }
      if (op.table === "market_settings") return {data: box.settings, error: null};
      if (op.table === "market_product_flags") return {data: Object.entries(box.flags).map(([sku, auto_enabled]) => ({sku, auto_enabled})), error: null};
      if (op.table === "market_decisions") {
        const rows = box.decisions.slice().sort((a, b) => a.created_at < b.created_at ? 1 : -1);
        return {data: rows, error: null};
      }
      if (op.table === "market_observations") return {data: [], error: null};
      if (op.table === "market_runs") return {data: [], error: null};
      if (op.table === "market_sku_facts") return {data: [], error: null};
      if (op.table === "store_state") {
        const storedKey = op.eq && op.eq.key || "units";
        if (storedKey === "units") return {data: {key: "units", data: window.__dbUnits || [], revision: 4}, error: null};
        return {data: {key: storedKey, data: {}, revision: 2}, error: null};
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
    window.__rpcCalls = 0;
    window.LIVE.staff = true;
    window.LIVE.sb = {
      from: chain,
      functions: {invoke: async () => window.__collection || ({data: null, error: {message: "not deployed"}})},
      rpc: async (name, args) => {
        window.__rpcCalls += 1;
        if (window.CX_STAGING_PREVIEW) return {data: null, error: {message: "preview write"}};
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
            if (box.decisions.some(item => item.status === "applied" && item.apply_key === args.p_apply_key)) return {data: null, error: {message: "already applied"}};
            unit.p = target;
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
        if (status === "applied" || status === "restored") return {data: null, error: {message: "price changes use market_commit_price"}};
        box.decisions.push({sku: args.p_sku, status, target_price: args.p_target, previous_price: args.p_previous, apply_key: null, created_at: new Date().toISOString()});
        save(box);
        return {data: "ok", error: null};
      }
    };
    const unit = DB.units.find(item => item.m === "17promax" && item.c === "Silver" && item.st === 256 && item.cond === "new" && item.sim === "psim");
    DB.priv = DB.priv || {};
    DB.priv.u = DB.priv.u || {};
    DB.priv.u[unit.id] = {cost: 1400};
    window.__unitId = unit.id;
    if (!window.__dbUnits) window.__dbUnits = JSON.parse(JSON.stringify(DB.units));
    const live = window.__dbUnits.find(item => item.id === unit.id);
    unit.p = live.p;
    unit.qty = live.qty;
  });
}

const quote = "store,name,price,currency,url,available,storage,condition,sim,color,warranty,region\nNajem Starcall,iPhone 17 Pro Max,1515,USD,https://najemstarcall.com/product/iphone-17-pro-max,in_stock,256,new,psim,Silver,,\n";

test("market admin status, collector copy, and preview writes stay accurate", async () => {
  const server = await startServer();
  const port = server.address().port;
  const {chromium} = loadPlaywright();
  const browser = await launchBrowser(chromium);
  const context = await browser.newContext();
  try {
    const page = await context.newPage({viewport: {width: 1440, height: 1100}});
    page.on("dialog", dialog => dialog.accept());
    await page.addInitScript(() => sessionStorage.setItem("cx-splash", "1"));
    await page.route("**/*supabase.co/**", route => route.abort());
    const url = "http://127.0.0.1:" + port + "/?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim";
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.LIVE && document.querySelector(".pvprice"));
    const before = await page.evaluate(() => ({
      orders: JSON.stringify(DB.orders),
      other: DB.units.find(item => item.m === "17promax" && item.st === 512).p,
      qty: DB.units.find(item => item.m === "17promax" && item.c === "Silver" && item.st === 256 && item.cond === "new" && item.sim === "psim").qty
    }));
    await install(page);
    await page.evaluate(() => { setAdmin(true); go("market"); });
    await page.waitForSelector("#marketCsv");
    await page.locator("#marketCsv").fill(quote);
    await page.locator("#marketImport").click();
    await page.locator("#marketMargin").fill("2");
    await page.evaluate(() => {
      const key = "cx-market-audit-staging";
      const box = JSON.parse(localStorage.getItem(key) || JSON.stringify({
        settings: {automation_enabled: false, writes_enabled: false, min_margin_pct: null, lbp_per_usd: null, lbp_rate_verified: false},
        flags: {}, decisions: [], facts: {}
      }));
      box.settings.automation_enabled = true;
      box.settings.writes_enabled = true;
      localStorage.setItem(key, JSON.stringify(box));
      const input = document.querySelector("#marketAuto");
      input.disabled = false;
      input.checked = true;
      window.__settingsUpdates = [];
    });
    await page.locator("#marketSaveSettings").click();
    await page.waitForFunction(() => document.body.innerText.includes("Rules saved. Scheduled automatic updates stay off."));
    const rules = await page.evaluate(() => {
      const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
      const input = document.querySelector("#marketAuto");
      return {
        automation: box.settings.automation_enabled,
        writes: box.settings.writes_enabled,
        margin: box.settings.min_margin_pct,
        disabled: input.disabled,
        checked: input.checked,
        label: input.parentElement.textContent,
        status: document.querySelector(".mkstatus").innerText,
        updates: window.__settingsUpdates || []
      };
    });
    assert.equal(rules.automation, false);
    assert.equal(rules.writes, false);
    assert.equal(rules.margin, 2);
    assert.equal(rules.disabled, true);
    assert.equal(rules.checked, false);
    assert.match(rules.label, /Coming later — disabled/);
    assert.equal(rules.status.includes("Automatic pricing on"), false);
    assert.match(rules.status, /Automatic pricing off/);
    assert.equal(rules.updates.length > 0, true);
    for (const body of rules.updates) {
      assert.equal(body.automation_enabled, false);
      assert.equal(body.writes_enabled, false);
    }
    await page.locator("#factWarranty").selectOption("1");
    await page.locator("#factVerified").check();
    await page.locator("#marketSaveFacts").click();
    await page.waitForFunction(() => document.body.innerText.includes("Verified facts saved"));
    const facts = await page.evaluate(() => {
      const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
      return {automation: box.settings.automation_enabled, writes: box.settings.writes_enabled, on: document.querySelector(".mkstatus").innerText.includes("Automatic pricing on")};
    });
    assert.equal(facts.automation, false);
    assert.equal(facts.writes, false);
    assert.equal(facts.on, false);
    await page.locator(".mktable input[data-sku]").first().check();
    await page.locator("#marketApprove").click();
    await page.waitForFunction(() => document.body.innerText.includes("The store price is unchanged until you apply it."));
    assert.equal(await page.locator(".mk-approved").count() > 0, true);
    assert.equal(await page.locator(".mk-applied").count(), 0);

    await page.evaluate(() => { window.__failCommit = true; });
    await page.locator("#marketApply").click();
    await page.waitForFunction(() => document.body.innerText.includes("was not marked applied"));
    assert.equal(await page.locator(".mk-applied").count(), 0);
    const failed = await page.evaluate(() => {
      const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
      return box.decisions.some(row => row.status === "applied");
    });
    assert.equal(failed, false);

    await page.evaluate(() => {
      const input = document.querySelector("#marketAuto");
      input.disabled = false;
      input.checked = true;
    });
    await page.locator("#marketApply").click();
    await page.waitForFunction(() => document.body.innerText.includes("Applied 1 approved price"));
    await page.waitForFunction(() => document.body.innerText.includes("Scheduled updates stay off"));
    const afterApply = await page.evaluate(() => {
      const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
      return {automation: box.settings.automation_enabled, writes: box.settings.writes_enabled, on: document.body.innerText.includes("Automatic pricing on")};
    });
    assert.equal(afterApply.automation, false);
    assert.equal(afterApply.writes, false);
    assert.equal(afterApply.on, false);
    assert.equal(await page.locator(".mk-applied").count() > 0, true);
    assert.equal(await page.locator("[data-restore]").count(), 1);
    await page.locator("#marketApply").click();
    await page.waitForTimeout(300);
    const once = await page.evaluate(() => {
      const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
      return box.decisions.filter(row => row.status === "applied").length;
    });
    assert.equal(once, 1);

    const refreshed = await context.newPage({viewport: {width: 1440, height: 900}});
    refreshed.on("dialog", dialog => dialog.accept());
    await refreshed.addInitScript(() => sessionStorage.setItem("cx-splash", "1"));
    await refreshed.route("**/*supabase.co/**", route => route.abort());
    await refreshed.goto(url, {waitUntil: "domcontentloaded"});
    await refreshed.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length);
    await install(refreshed);
    await refreshed.evaluate(() => { setAdmin(true); go("market"); });
    await refreshed.waitForFunction(() => document.body.innerText.includes("Applied"));
    assert.equal(await refreshed.locator(".mk-applied").count() > 0, true);

    await page.locator("[data-restore]").click();
    await page.waitForFunction(() => document.body.innerText.includes("Previous price restored"));
    assert.equal(await page.locator(".mk-restored").count() > 0, true);
    assert.equal(await page.locator("[data-restore]").count(), 0);
    await page.locator("#marketApply").click();
    await page.waitForTimeout(200);
    const restoredRows = await page.evaluate(() => JSON.parse(localStorage.getItem("cx-market-audit-staging")).decisions.filter(row => row.status === "restored").length);
    assert.equal(restoredRows, 1);

    await refreshed.reload({waitUntil: "domcontentloaded"});
    await refreshed.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length);
    await install(refreshed);
    await refreshed.evaluate(() => { setAdmin(true); go("market"); });
    await refreshed.waitForFunction(() => document.body.innerText.includes("Restored"));

    await page.locator("#marketCsv").fill(quote.replace(",1515,", ",1600,"));
    await page.locator("#marketImport").click();
    await page.locator(".mktable input[data-sku]").first().check();
    await page.locator("#marketApprove").click();
    await page.waitForFunction(() => document.body.innerText.includes("The store price is unchanged until you apply it."));
    assert.equal(await page.locator(".mk-approved").count() > 0, true);

    const longUrl = "https://najemstarcall.com/" + "iphone-17-pro-max-".repeat(12);
    await page.evaluate(nextUrl => {
      window.__collection = {data: {
        errors: [{store: "Najem Starcall", error: "unavailable HTTP 403 bearer secret-token"}],
        checked: [{store: "Other"}],
        skipped: [],
        requests: 2
      }, error: null};
      window.__rpcCalls = 0;
      const box = document.querySelector("#marketCsv");
      box.value = "store,name,price,currency,url,available,storage,condition,sim,color\n<script>bad</script>,iPhone 17 Pro Max,1600,USD," + nextUrl + ",out_of_stock,256,new,psim,Silver";
    }, longUrl);
    await page.locator("#marketImport").click();
    assert.equal(await page.locator(".mktable script").count(), 0);
    assert.equal(await page.locator("td", {hasText: "Not verified"}).count() > 0, true);
    assert.equal(await page.locator("text=Not ready for approval.").count() > 0, true);
    await page.locator("#marketRefresh").click();
    await page.waitForFunction(() => document.body.innerText.includes("Competitor blocked automated access."));
    await page.waitForFunction(() => document.body.innerText.includes("Collection completed with partial results."));
    const raw = await page.locator(".mkstatus").innerText();
    assert.equal(raw.includes("unavailable HTTP 403"), false);
    assert.equal(raw.includes("secret-token"), false);
    assert.equal(await page.locator(".mkdiag").innerText().then(text => text.includes("secret-token")), false);

    await page.locator("#marketCsv").fill("store,name,price,currency,url,available,storage,condition,sim,color\nNajem Starcall,iPhone 17 Pro Max,1600,USD," + longUrl + ",in_stock,256,new,psim,Silver");
    await page.locator("#marketImport").click();
    await page.waitForSelector(".mkurl");
    await page.setViewportSize({width: 390, height: 844});
    const layout = await page.evaluate(() => {
      const wrap = document.querySelector(".mkwrap");
      const link = document.querySelector(".mkurl");
      const style = link ? getComputedStyle(link) : null;
      return {
        scrolls: !!(wrap && wrap.scrollWidth > wrap.clientWidth),
        ellipsis: style ? style.textOverflow : "",
        nowrap: style ? style.whiteSpace : ""
      };
    });
    assert.equal(layout.scrolls, true);
    assert.equal(layout.ellipsis, "ellipsis");
    assert.equal(layout.nowrap, "nowrap");

    const after = await page.evaluate(start => {
      const unit = DB.units.find(item => item.id === window.__unitId);
      const other = DB.units.find(item => item.m === "17promax" && item.st === 512);
      return {orders: JSON.stringify(DB.orders) === start.orders, qty: unit.qty === start.qty, other: other.p === start.other};
    }, before);
    assert.deepEqual(after, {orders: true, qty: true, other: true});

    await page.evaluate(() => {
      const key = "cx-market-audit-staging";
      const box = JSON.parse(localStorage.getItem(key));
      const rows = [];
      for (let i = 0; i < 200; i++) {
        rows.push({
          sku: "unit:" + window.__unitId,
          status: "applied",
          target_price: 1500,
          previous_price: 1542,
          apply_key: "unit:" + window.__unitId + "|1500|https://example.test/listing|1500",
          created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()
        });
      }
      box.decisions = rows;
      localStorage.setItem(key, JSON.stringify(box));
    });
    await page.reload({waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length);
    await install(page);
    await page.evaluate(() => { setAdmin(true); go("market"); });
    await page.waitForFunction(() => document.body.innerText.includes("Decision history is incomplete"));
    assert.equal(await page.locator("#marketApply").isDisabled(), true);
    assert.equal(await page.locator("[data-restore]").count(), 0);
    const blocked = await page.evaluate(() => {
      const price = window.__dbUnits.find(item => item.id === window.__unitId).p;
      const before = window.__rpcCalls;
      const apply = document.querySelector("#marketApply");
      apply.disabled = false;
      apply.click();
      return {calls: window.__rpcCalls - before, price, next: window.__dbUnits.find(item => item.id === window.__unitId).p};
    });
    assert.equal(blocked.calls, 0);
    assert.equal(blocked.next, blocked.price);
    await page.waitForFunction(() => document.body.innerText.includes("no price was applied"));

    const preview = await context.newPage({viewport: {width: 1280, height: 900}});
    await preview.addInitScript(() => {
      sessionStorage.setItem("cx-splash", "1");
      window.CX_STAGING_PREVIEW = {host: "akgilfixljswqljmedmg.supabase.co", writes: false};
    });
    await preview.route("**/*supabase.co/**", route => route.abort());
    await preview.goto(url, {waitUntil: "domcontentloaded"});
    await preview.waitForFunction(() => window.LIVE && typeof DB !== "undefined");
    await install(preview);
    await preview.evaluate(() => { setAdmin(true); go("market"); });
    await preview.waitForFunction(() => document.body.innerText.includes("Staging preview is read-only"));
    const locked = await preview.evaluate(() => ["#marketRefresh", "#marketApprove", "#marketReject", "#marketApply", "#marketSaveSettings", "#marketImport"].every(id => document.querySelector(id).disabled));
    assert.equal(locked, true);
    const calls = await preview.evaluate(() => {
      const beforeCalls = window.__rpcCalls;
      document.querySelector("#marketApply").disabled = false;
      document.querySelector("#marketApprove").disabled = false;
      document.querySelector("#marketRefresh").disabled = false;
      document.querySelector("#marketApply").click();
      document.querySelector("#marketApprove").click();
      document.querySelector("#marketRefresh").click();
      return window.__rpcCalls - beforeCalls;
    });
    assert.equal(calls, 0);
    assert.match(await preview.locator(".mktnote").first().innerText(), /was not sent/);
  } finally {
    await browser.close();
    server.close();
  }
});
