import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {execSync} from "node:child_process";
import {createRequire} from "node:module";

const require = createRequire("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");
const {chromium} = require("playwright");
const root = "/workspace";
const html = fs.readFileSync(root + "/index.html", "utf8");

const units = [
  {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900, bat: 0, note: "staging-synthetic"},
  {id: "u-stage-2", m: "17promax", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, bat: 0, note: "staging-synthetic"}
];
const phone = { "stage-ph": { v: { "0": { p: 25, q: 4 } } } };
const priv = { u: { "u-stage-1": { cost: 700 }, "u-stage-2": { cost: 720 } } };

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const name = decodeURIComponent(url.pathname);
      const file = name === "/" ? root + "/index.html" : path.join(root, name);
      if (!file.startsWith(root + "/") && file !== root + "/index.html") { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const type = file.endsWith(".html") ? "text/html" : "text/javascript";
        res.writeHead(200, {"content-type": type});
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("the staff-save change does not rewrite checkout or WhatsApp", () => {
  const diff = execSync("git diff -U0 -- index.html market/admin.js", {encoding: "utf8"});
  for (const needle of ["function phoneActsHTML", "function applyStock", "availInquiry", "cxOrderMessage", "Ask for availability"]) {
    assert.equal(diff.split("\n").some(line => /^[+-]/.test(line) && line.includes(needle)), false, needle);
  }
  assert.match(html, /Ask for availability/);
  assert.match(html, /window\.cxOrderMessage/);
  assert.match(html, /async function push\(\)\{pushT=null;if\(!L\.staff\|\|busy\)\{if\(busy\)schedulePush\(\);return\}busy=true;/);
  assert.match(html, /\.eq\("key",row\.key\)\.eq\("revision",seen\)/);
  assert.match(html, /stale store save/);
  assert.match(html, /Load the latest inventory/);
});

test("two staff tabs cannot overwrite a newer inventory revision", async () => {
  const store = {
    units: {data: clone(units), revision: 1},
    ph: {data: clone(phone), revision: 1},
    priv: {data: clone(priv), revision: 1}
  };
  const writes = [];
  const server = await startServer();
  const browser = await chromium.launch({executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]});
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => sessionStorage.setItem("cx-splash", "1"));
    await context.route("**/*supabase.co/**", async route => {
      const req = route.request();
      const url = new URL(req.url());
      const headers = {
        "access-control-allow-origin": req.headers().origin || "*",
        "access-control-allow-headers": req.headers()["access-control-request-headers"] || "*",
        "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
        "content-type": "application/json"
      };
      if (req.method() === "OPTIONS") return route.fulfill({status: 204, headers, body: ""});
      if (!url.pathname.includes("/store_state")) {
        if (url.pathname.includes("/orders") && req.method() !== "GET" && req.method() !== "HEAD") writes.push("orders " + req.method());
        return route.fulfill({status: 200, headers, body: req.method() === "GET" ? "[]" : "{}"});
      }
      if (req.method() === "GET") {
        const rows = Object.entries(store).map(([key, row]) => ({key, data: row.data, revision: row.revision}));
        return route.fulfill({status: 200, headers, body: JSON.stringify(rows)});
      }
      if (req.method() === "POST") {
        writes.push("post " + (req.postData() || ""));
        return route.fulfill({status: 201, headers, body: "[]"});
      }
      if (req.method() !== "PATCH") return route.fulfill({status: 405, headers, body: JSON.stringify({message: "method"})});
      const key = String(url.searchParams.get("key") || "").replace(/^eq\./, "");
      const seen = Number(String(url.searchParams.get("revision") || "").replace(/^eq\./, ""));
      const body = JSON.parse(req.postData() || "{}");
      const current = store[key];
      writes.push("patch " + key + " seen=" + seen + " next=" + body.revision);
      if (!current || !url.searchParams.get("revision") || current.revision !== seen || Number(body.revision) !== seen + 1) {
        return route.fulfill({status: 409, headers, body: JSON.stringify({message: "stale store save", code: "P0001"})});
      }
      if (key === "priv") writes.push("priv changed");
      current.data = body.data;
      current.revision = seen + 1;
      return route.fulfill({status: 200, headers, body: JSON.stringify([{key, revision: current.revision}])});
    });

    const openTab = async () => {
      const page = await context.newPage({viewport: {width: 1280, height: 900}});
      await page.goto("http://127.0.0.1:" + server.address().port + "/", {waitUntil: "domcontentloaded"});
      await page.waitForFunction(() => window.LIVE && Array.isArray(DB.units) && DB.units.some(unit => unit.id === "u-stage-1" && unit.p === 900), null, {timeout: 60000});
      await page.evaluate(() => { LIVE.staff = true; });
      return page;
    };
    const tabA = await openTab();
    const tabB = await openTab();
    assert.equal(await tabA.evaluate(() => DB.units.find(unit => unit.id === "u-stage-1").qty), 2);
    assert.equal(await tabB.evaluate(() => DB.units.find(unit => unit.id === "u-stage-1").qty), 2);

    assert.equal(await tabA.evaluate(async () => {
      DB.units.find(unit => unit.id === "u-stage-1").p = 890;
      return CX_STAFF_SAVE();
    }), true);
    assert.equal(store.units.revision, 2);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").p, 890);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").qty, 2);

    assert.equal(await tabA.evaluate(async () => {
      DB.units.find(unit => unit.id === "u-stage-1").qty = 7;
      return CX_STAFF_SAVE();
    }), true);
    assert.equal(store.units.revision, 3);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").qty, 7);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").p, 890);

    const beforeStale = writes.length;
    const stale = await tabB.evaluate(async () => {
      const unit = DB.units.find(item => item.id === "u-stage-1");
      unit.p = 905;
      unit.qty = 4;
      const saved = await CX_STAFF_SAVE();
      return {saved, price: unit.p, qty: unit.qty, note: document.querySelector(".demo-strip").textContent};
    });
    assert.equal(stale.saved, false);
    assert.equal(stale.price, 905);
    assert.equal(stale.qty, 4);
    assert.match(stale.note, /out of date/);
    assert.match(stale.note, /unsaved edits are still on this device/);
    assert.equal(await tabB.locator("#loadLatestInventory").count(), 1);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").p, 890);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").qty, 7);
    assert.equal(store.units.revision, 3);
    assert.deepEqual(store.priv.data, priv);
    assert.equal(writes.slice(beforeStale).some(item => item.startsWith("orders ") || item === "priv changed" || item.startsWith("post ")), false);
    await tabB.waitForTimeout(500);
    assert.equal(writes.filter(item => item.startsWith("patch units")).length, 3);

    assert.equal(await tabB.evaluate(async () => CX_LOAD_LATEST()), true);
    assert.equal(await tabB.evaluate(() => {
      const unit = DB.units.find(item => item.id === "u-stage-1");
      return unit.p + ":" + unit.qty;
    }), "890:7");
    assert.equal(await tabB.evaluate(async () => {
      DB.units.find(unit => unit.id === "u-stage-1").qty = 5;
      return CX_STAFF_SAVE();
    }), true);
    assert.equal(store.units.revision, 4);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").p, 890);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").qty, 5);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-2").p, 910);

    assert.equal(await tabA.evaluate(async () => {
      DB.ph["stage-ph"].v["0"].p = 22;
      return CX_STAFF_SAVE();
    }), true);
    assert.equal(store.ph.revision, 2);
    assert.equal(store.ph.data["stage-ph"].v["0"].p, 22);
    assert.equal(store.ph.data["stage-ph"].v["0"].q, 4);
    const stalePhone = await tabB.evaluate(async () => {
      DB.ph["stage-ph"].v["0"].p = 19;
      const saved = await CX_STAFF_SAVE();
      return {saved, price: DB.ph["stage-ph"].v["0"].p};
    });
    assert.equal(stalePhone.saved, false);
    assert.equal(stalePhone.price, 19);
    assert.equal(store.ph.data["stage-ph"].v["0"].p, 22);
    assert.equal(await tabB.evaluate(async () => {
      await CX_LOAD_LATEST();
      DB.ph["stage-ph"].v["0"].p = 21;
      return CX_STAFF_SAVE();
    }), true);
    assert.equal(store.ph.revision, 3);
    assert.equal(store.ph.data["stage-ph"].v["0"].p, 21);
    assert.equal(store.ph.data["stage-ph"].v["0"].q, 4);
    assert.equal(store.units.data.find(unit => unit.id === "u-stage-1").p, 890);
    assert.deepEqual(store.priv.data, priv);
    assert.equal(writes.some(item => item.startsWith("orders ") || item === "priv changed"), false);
  } finally {
    await browser.close();
    server.close();
  }
});
