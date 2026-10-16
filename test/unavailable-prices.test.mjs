import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {execSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {chromium} = createRequire(import.meta.url)("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");
const PRICE_TEXT = /\$|price on whatsapp|reference price|ask for price|ask on whatsapp|ask for price|out of stock|^\s*—\s*$/i;

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = path.resolve(root, "." + pathname);
    if (pathname === "/" || pathname === "/index.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(fs.readFileSync(path.join(root, "index.html")));
      return;
    }
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(404);
      res.end("no");
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("no");
        return;
      }
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("unavailable products and variants show no price, in-stock products still do", async () => {
  const diff = execSync("git diff -U0 main -- index.html", {encoding: "utf8"});
  for (const needle of ["cardPill", "applyStock", "CX_UPRICE", "store_state"]) {
    assert.equal(diff.includes(needle), false, needle + " appeared in the price-display diff");
  }

  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  const writes = [];
  try {
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    await page.route("**/*supabase.co/**", route => {
      const method = route.request().method();
      if (method !== "GET" && method !== "HEAD") writes.push(method + " " + route.request().url().split("?")[0]);
      return route.abort();
    });
    await page.goto(origin, {waitUntil: "domcontentloaded", timeout: 60000});
    await page.waitForFunction(() => typeof openPhone === "function" && DB && DB.live, null, {timeout: 60000});
    await page.evaluate(() => { const splash = document.querySelector("#splash"); if (splash) splash.remove(); });

    const readPhone = () => page.evaluate(() => {
      const price = document.querySelector("#pvBody .pvprice");
      const verdict = document.querySelector("#pvBody .verdict");
      const ask = document.querySelector("#pvAsk");
      const add = document.querySelector("#pvAdd");
      const box = el => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {w: r.width, h: r.height, hidden: s.display === "none" || s.visibility === "hidden"};
      };
      return {
        title: document.querySelector("#pvTitle") && document.querySelector("#pvTitle").textContent,
        price: price ? price.innerText : "",
        verdict: verdict ? verdict.innerText : "",
        ask: ask ? ask.textContent : "",
        askBox: box(ask),
        add: add ? add.textContent : "",
        specs: !!document.querySelector("#pvBody .specs"),
        photo: !!document.querySelector("#pvStage")
      };
    });

    const showPhone = async (id, color) => {
      await page.evaluate(({id, color}) => openPhone(id, color), {id, color});
      await page.waitForSelector("#pvTitle");
    };

    await showPhone("11", null);
    let view = await readPhone();
    assert.equal(view.title, "iPhone 11");
    assert.equal(view.price, "");
    assert.doesNotMatch(view.verdict, PRICE_TEXT);
    assert.match(view.ask, /Ask for availability/);
    assert.ok(view.askBox && view.askBox.h > 20 && !view.askBox.hidden);
    assert.equal(view.add, "");
    assert.ok(view.specs);
    await page.click('#pvBody [data-k="st"][data-v="128"]');
    view = await readPhone();
    assert.equal(view.price, "");
    assert.doesNotMatch(view.verdict, PRICE_TEXT);
    assert.match(view.ask, /Ask for availability/);

    await showPhone("17promax", "Silver");
    view = await readPhone();
    assert.match(view.price, /\$1542/);
    assert.match(view.add, /Add to cart/);
    assert.equal(view.ask, "");
    await page.click('#pvBody [data-k="st"][data-v="1024"]');
    view = await readPhone();
    assert.equal(view.title, "iPhone 17 Pro Max");
    assert.equal(view.price, "");
    assert.doesNotMatch(view.verdict, PRICE_TEXT);
    assert.match(view.ask, /Ask for availability/);
    assert.ok(view.askBox.h > 20 && !view.askBox.hidden);
    assert.equal(view.add, "");
    assert.ok(view.specs);
    await page.click('#pvBody [data-k="st"][data-v="256"]');
    await page.click('#pvBody [data-k="cond"][data-v="new"]');
    await page.click('#pvBody [data-k="sim"][data-v="psim"]');
    view = await readPhone();
    assert.match(view.price, /\$1542/);
    assert.match(view.add, /Add to cart/);

    const cards = await page.evaluate(() => {
      shop.cat = "apple"; shop.series = "all"; shop.q = "iPhone 11"; shop.limit = 30; renderGrid();
      const soldOut = document.querySelector('.card[data-id="11"]');
      shop.q = "17 Pro Max"; renderGrid();
      const stocked = document.querySelector('.card[data-id="17promax"]');
      const text = el => el ? el.innerText.replace(/\s+/g, " ").trim() : "";
      return {
        soldOut: text(soldOut),
        soldOutPrice: soldOut && soldOut.querySelector(".from") ? soldOut.querySelector(".from").innerText : "",
        soldOutName: soldOut && soldOut.querySelector("h3") ? soldOut.querySelector("h3").textContent : "",
        stocked: text(stocked),
        stockedFrom: stocked && stocked.querySelector(".from") ? stocked.querySelector(".from").innerText : ""
      };
    });
    assert.equal(cards.soldOutName, "iPhone 11");
    assert.doesNotMatch(cards.soldOutPrice, /\$/);
    assert.match(cards.soldOut, /View options/);
    assert.match(cards.soldOut, /GB/);
    assert.match(cards.stockedFrom, /\$/);
    assert.match(cards.stocked, /View options/);

    const catalog = await page.evaluate(() => {
      const shown = p => !phHidden(p);
      const out = PHI.find(p => shown(p) && !phOK(p) && (phPrice(p).p > 0 || phOff(p) > 0));
      const inn = PHI.find(p => shown(p) && phOK(p) && phPrice(p).p > 0);
      const mixed = PHI.find(p => shown(p) && phVars(p).some(v => v.ok && v.p > 0) && phVars(p).some(v => !v.ok && v.p > 0));
      shop.cat = "all"; shop.series = "all"; shop.limit = 80;
      const cardOf = id => {
        shop.q = "";
        const p = PHmap.get(id);
        shop.q = p.name;
        renderGrid();
        const card = document.querySelector(`.card[data-ph="${id}"]`);
        return card ? {text: card.innerText.replace(/\s+/g, " ").trim(), price: !!card.querySelector(".pp"), off: !!card.querySelector(".offb"), name: card.querySelector("h3").textContent} : null;
      };
      return {
        outId: out && out.id, outName: out && out.name, outCard: out ? cardOf(out.id) : null,
        inId: inn && inn.id, inName: inn && inn.name, inCard: inn ? cardOf(inn.id) : null,
        mixedId: mixed && mixed.id
      };
    });
    assert.ok(catalog.outCard, "expected an unavailable catalog card");
    assert.equal(catalog.outCard.price, false);
    assert.equal(catalog.outCard.off, false);
    assert.equal(catalog.outCard.name, catalog.outName);
    assert.match(catalog.outCard.text, /View/);
    assert.doesNotMatch(catalog.outCard.text, PRICE_TEXT);
    assert.ok(catalog.inCard);
    assert.equal(catalog.inCard.price, true);
    assert.match(catalog.inCard.text, /\$/);

    await page.evaluate(id => openPH(id), catalog.outId);
    await page.waitForSelector("#pvAsk");
    view = await readPhone();
    assert.equal(view.title, catalog.outName);
    assert.equal(view.price, "");
    assert.match(view.ask, /Ask for availability/);
    assert.ok(view.askBox.h > 20 && !view.askBox.hidden);
    assert.equal(view.add, "");

    if (catalog.mixedId) {
      await page.evaluate(id => openPH(id), catalog.mixedId);
      await page.waitForSelector("#pvAdd");
      view = await readPhone();
      assert.match(view.price, /\$/);
      assert.match(view.add, /Add to cart/);
      const switched = await page.evaluate(() => {
        const na = document.querySelector("#pvBody [data-po].na");
        if (!na) return "none";
        na.click();
        return "clicked";
      });
      if (switched === "clicked") {
        view = await readPhone();
        if (view.ask) {
          assert.equal(view.price, "");
          assert.match(view.ask, /Ask for availability/);
          assert.equal(view.add, "");
        } else {
          assert.match(view.price, /\$/);
          assert.match(view.add, /Add to cart/);
        }
      }
    }

    const search = await page.evaluate(() => {
      const input = document.querySelector("#heroQ");
      const read = q => {
        input.value = q;
        input.dispatchEvent(new Event("input", {bubbles: true}));
        return [...document.querySelectorAll("#heroRes .hsi")].map(el => ({
          name: el.querySelector("b") && el.querySelector("b").textContent,
          price: el.querySelector(".hspr") ? el.querySelector(".hspr").textContent : ""
        }));
      };
      const phones = read("iPhone 11");
      const stocked = read("17 Pro Max");
      const outName = PHI.find(p => !phHidden(p) && !phOK(p) && phPrice(p).p > 0);
      const inName = PHI.find(p => phOK(p) && phPrice(p).p > 0);
      const outRows = outName ? read(outName.name).filter(r => r.name === outName.name) : [];
      const inRows = inName ? read(inName.name).filter(r => r.name === inName.name) : [];
      input.value = "";
      input.dispatchEvent(new Event("input", {bubbles: true}));
      return {phones, stocked, outRows, inRows, outName: outName && outName.name, inName: inName && inName.name};
    });
    const eleven = search.phones.filter(r => r.name === "iPhone 11" || r.name === "iPhone 11 Pro" || r.name === "iPhone 11 Pro Max");
    assert.ok(eleven.length >= 1);
    for (const row of eleven) assert.equal(row.price, "");
    const proMax = search.stocked.find(r => r.name === "iPhone 17 Pro Max");
    assert.ok(proMax);
    assert.match(proMax.price, /\$/);
    assert.ok(search.outRows.length);
    for (const row of search.outRows) assert.equal(row.price, "");
    assert.ok(search.inRows.length);
    assert.match(search.inRows[0].price, /\$/);

    await page.setViewportSize({width: 390, height: 844});
    await showPhone("11", null);
    view = await readPhone();
    assert.equal(view.price, "");
    assert.match(view.ask, /Ask for availability/);
    assert.ok(view.askBox.h > 20 && !view.askBox.hidden);
    await showPhone("17promax", "Deep Blue");
    view = await readPhone();
    assert.match(view.price, /\$1542/);
    assert.match(view.add, /Add to cart/);
    await page.click('#pvBody [data-k="st"][data-v="2048"]');
    view = await readPhone();
    assert.equal(view.price, "");
    assert.doesNotMatch(view.verdict, PRICE_TEXT);
    assert.match(view.ask, /Ask for availability/);
    assert.ok(view.askBox.h > 20 && !view.askBox.hidden);
    assert.equal(view.add, "");

    assert.deepEqual(writes, []);
  } finally {
    await browser.close();
    server.close();
  }
});
