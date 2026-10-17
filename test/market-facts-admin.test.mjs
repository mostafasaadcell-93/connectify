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
    throw new Error("Playwright is not installed for this project. From the project root run `npm install`. " + (error && error.message ? error.message : String(error)));
  }
}

async function launchBrowser(chromium) {
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
  throw new Error("Playwright could not launch a browser.\n" + errors.join("\n"));
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
    const schema = () => localStorage.getItem("cx-fact-schema") || "legacy";
    const run = op => {
      const box = load();
      if (op.table === "market_settings") return {data: box.settings, error: null};
      if (op.table === "market_product_flags") return {data: [], error: null};
      if (op.table === "market_decisions") return {data: [], error: null};
      if (op.table === "market_observations" || op.table === "market_runs") return {data: [], error: null};
      if (op.table === "market_sku_facts" && op.action === "upsert") {
        if (schema() !== "upgraded" && (Object.hasOwn(op.body, "warranty_provider") || Object.hasOwn(op.body, "activation"))) {
          return {data: null, error: {code: "PGRST204", message: "Could not find the 'warranty_provider' column of 'market_sku_facts' in the schema cache"}};
        }
        box.facts[op.body.sku] = op.body;
        save(box);
        window.__factWrites = window.__factWrites || [];
        window.__factWrites.push(op.body);
        return {data: null, error: null};
      }
      if (op.table === "market_sku_facts") {
        if (schema() !== "upgraded" && String(op.columns || "").includes("warranty_provider")) {
          return {data: null, error: {code: "PGRST204", message: "Could not find the 'warranty_provider' column of 'market_sku_facts' in the schema cache"}};
        }
        return {data: Object.values(box.facts || {}), error: null};
      }
      if (op.table === "store_state") {
        const storedKey = op.eq && op.eq.key || "units";
        if (storedKey === "units") return {data: {key: "units", data: window.__dbUnits || [], revision: 4}, error: null};
        return {data: {key: storedKey, data: {}, revision: 2}, error: null};
      }
      return {data: null, error: {message: "unknown table"}};
    };
    const chain = table => {
      const op = {table, action: "select", columns: "", body: null};
      const api = {
        select(columns) { op.columns = columns || ""; return api; },
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
      rpc: async () => ({data: null, error: {message: "staff only"}})
    };
    const unit = DB.units.find(item => item.m === "17promax" && item.c === "Silver" && item.st === 256 && item.cond === "new" && item.sim === "psim");
    delete unit.warrantyProvider;
    delete unit.activation;
    unit.warrantyYears = null;
    unit.region = null;
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

test("verified facts survive refresh, and a missing upgrade does not pretend to save", async () => {
  const server = await startServer();
  const port = server.address().port;
  const {chromium} = loadPlaywright();
  const browser = await launchBrowser(chromium);
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    page.on("dialog", dialog => dialog.accept());
    await page.addInitScript(() => sessionStorage.setItem("cx-splash", "1"));
    await page.route("**/*supabase.co/**", route => route.abort());
    const url = "http://127.0.0.1:" + port + "/?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim";
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.LIVE && document.querySelector(".pvprice"));
    await page.evaluate(() => localStorage.setItem("cx-fact-schema", "legacy"));
    const before = await page.evaluate(() => {
      const unit = DB.units.find(item => item.id === window.__unitId || (item.m === "17promax" && item.c === "Silver" && item.st === 256));
      return {price: unit.p, qty: unit.qty, orders: JSON.stringify(DB.orders)};
    });
    await install(page);
    await page.evaluate(() => { setAdmin(true); go("market"); });
    await page.waitForSelector("#factUpgradeNote");
    assert.match(await page.locator("#factUpgradeNote").innerText(), /verified-facts upgrade is not installed/);
    await page.locator("#factWarranty").selectOption("1");
    await page.locator("#factRegion").selectOption("us");
    await page.locator("#factSim").selectOption("psim");
    await page.locator("#factCondition").selectOption("new");
    await page.locator("#factProvider").selectOption("apple");
    await page.locator("#factActivation").selectOption("inactive");
    await page.locator("#factVerified").check();
    await page.locator("#marketSaveFacts").click();
    await page.waitForFunction(() => document.body.innerText.includes("were not saved"));
    const legacy = await page.evaluate(() => {
      const box = JSON.parse(localStorage.getItem("cx-market-audit-staging"));
      const row = Object.values(box.facts)[0];
      return {
        row,
        note: document.body.innerText,
        auto: document.querySelector("#marketAuto").disabled,
        status: document.querySelector(".mkstatus").innerText
      };
    });
    assert.equal(legacy.row.warranty_years, 1);
    assert.equal(legacy.row.region, "us");
    assert.equal(Object.hasOwn(legacy.row, "warranty_provider"), false);
    assert.equal(Object.hasOwn(legacy.row, "activation"), false);
    assert.match(legacy.note, /verified-facts upgrade is not installed/);
    assert.equal(legacy.note.includes("Verified facts saved"), false);
    assert.equal(legacy.auto, true);
    assert.equal(legacy.status.includes("Automatic pricing on"), false);
    assert.match(legacy.status, /Scheduler off/);

    await page.evaluate(() => localStorage.setItem("cx-fact-schema", "upgraded"));
    await page.reload({waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length);
    await install(page);
    await page.evaluate(() => { setAdmin(true); go("market"); });
    await page.waitForSelector("#factProvider");
    assert.equal(await page.locator("#factUpgradeNote").count(), 0);
    assert.equal(await page.locator("#factWarranty").inputValue(), "1");
    assert.equal(await page.locator("#factProvider").inputValue(), "");
    await page.locator("#factProvider").selectOption("apple");
    await page.locator("#factActivation").selectOption("inactive");
    await page.locator("#factVerified").check();
    await page.locator("#marketSaveFacts").click();
    await page.waitForFunction(() => document.body.innerText.includes("Verified facts saved"));
    await page.reload({waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.LIVE && typeof DB !== "undefined" && DB.units && DB.units.length);
    await install(page);
    await page.evaluate(() => { setAdmin(true); go("market"); });
    await page.waitForFunction(() => document.querySelector("#factProvider") && document.querySelector("#factProvider").value === "apple");
    assert.equal(await page.locator("#factActivation").inputValue(), "inactive");
    assert.equal(await page.locator("#factVerified").isChecked(), true);
    await page.setViewportSize({width: 390, height: 844});
    const layout = await page.evaluate(() => {
      const provider = document.querySelector("#factProvider");
      const activation = document.querySelector("#factActivation");
      const bar = provider.closest(".stockbar");
      const rect = provider.getBoundingClientRect();
      return {
        width: rect.width > 40,
        inside: rect.left >= 0 && rect.right <= window.innerWidth + 1,
        wraps: bar.scrollWidth <= bar.clientWidth + 1,
        activation: activation.getBoundingClientRect().right <= window.innerWidth + 1
      };
    });
    assert.deepEqual(layout, {width: true, inside: true, wraps: true, activation: true});
    const after = await page.evaluate(start => {
      const unit = DB.units.find(item => item.id === window.__unitId);
      return {price: unit.p === start.price, qty: unit.qty === start.qty, orders: JSON.stringify(DB.orders) === start.orders};
    }, before);
    assert.deepEqual(after, {price: true, qty: true, orders: true});
  } finally {
    await browser.close();
    server.close();
  }
});
