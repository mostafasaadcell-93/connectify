import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const {chromium} = createRequire(import.meta.url)("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = path.resolve(root, "." + pathname);
    if (pathname === "/" || pathname === "/index.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(html);
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

test("the customer shop has no in-stock-only filter", () => {
  assert.equal(html.includes("In stock only"), false);
  assert.equal(html.includes("onlyStock"), false);
  assert.equal(html.includes("shop.only"), false);
  assert.match(html, /id="aFilter"/);
  assert.match(html, /id="cFilter"/);
  assert.match(html, /id="bIn"/);
  assert.match(html, /aria-label="In stock"/);
});

test("every shop category lists unavailable products and keeps search, brand, and sort", async () => {
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  const writes = [];
  try {
    const origin = `http://127.0.0.1:${server.address().port}/`;
    for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
      const page = await browser.newPage({viewport});
      await page.route("**/*supabase.co/**", route => {
        const method = route.request().method();
        if (method !== "GET" && method !== "HEAD") writes.push(method);
        return route.abort();
      });
      await page.goto(origin, {waitUntil: "domcontentloaded", timeout: 60000});
      await page.waitForFunction(() => typeof setShopCat === "function" && DB && DB.live, null, {timeout: 60000});
      await page.evaluate(() => { const splash = document.querySelector("#splash"); if (splash) splash.remove(); });

      const cats = await page.evaluate(() => [...document.querySelectorAll("#tabs button")].filter(b => !b.hidden).map(b => b.dataset.v));
      assert.ok(cats.includes("apple") && cats.includes("ipad") && cats.includes("audio") && cats.includes("cases"));

      const report = await page.evaluate(async cats => {
        const out = [];
        for (const cat of cats) {
          setShopCat(cat);
          shop.q = "";
          shop.limit = 5000;
          renderGrid();
          const shopEl = document.querySelector("#shop");
          const cards = [...document.querySelectorAll("#grid .card")];
          const tools = document.querySelector("#acctools");
          out.push({
            cat,
            toggle: !!document.querySelector("#onlyStock, .instock"),
            label: shopEl.innerText.includes("In stock only"),
            count: document.querySelector("#countLine").textContent,
            cards: cards.length,
            na: cards.filter(c => c.classList.contains("na")).length,
            priced: cards.filter(c => /\$/.test(c.innerText)).length,
            unpricedNa: cards.filter(c => c.classList.contains("na") && !/\$/.test(c.innerText)).length,
            brand: !!document.querySelector("#brandSel"),
            sort: !!document.querySelector("#sortSel"),
            toolsHidden: tools.hidden,
            series: document.querySelectorAll("#series button").length
          });
        }
        shop.cat = "apple";
        shop.q = "iPhone 11";
        shop.limit = 30;
        renderGrid();
        const eleven = [...document.querySelectorAll("#grid .card")].map(c => ({
          id: c.dataset.id,
          na: c.classList.contains("na"),
          text: c.innerText
        })).filter(c => c.id === "11" || c.id === "11pro" || c.id === "11promax");
        return {out, eleven};
      }, cats);

      for (const row of report.out) {
        assert.equal(row.toggle, false, viewport.width + " " + row.cat);
        assert.equal(row.label, false, viewport.width + " " + row.cat);
        assert.match(row.count, /\d+/, row.cat);
        assert.ok(row.cards > 0, viewport.width + " " + row.cat + " listed nothing");
        assert.equal(row.brand, true, row.cat);
        assert.equal(row.sort, true, row.cat);
        if (["apple", "samsung", "other"].includes(row.cat)) assert.equal(row.toolsHidden, true, row.cat);
        else assert.equal(row.toolsHidden, false, row.cat);
      }
      const apple = report.out.find(r => r.cat === "apple");
      assert.ok(apple.na > 0, "unavailable iPhones were filtered out");
      assert.ok(apple.priced > 0, "in-stock iPhones lost their prices");
      assert.equal(apple.unpricedNa, apple.na);
      assert.ok(report.eleven.length >= 3);
      for (const card of report.eleven) {
        assert.equal(card.na, true);
        assert.doesNotMatch(card.text, /\$/);
      }

      await page.evaluate(() => openPhone("11"));
      await page.waitForSelector("#pvAsk");
      const soldOut = await page.evaluate(() => ({
        price: !!document.querySelector("#pvBody .pvprice"),
        ask: document.querySelector("#pvAsk").textContent,
        add: !!document.querySelector("#pvAdd"),
        title: document.querySelector("#pvTitle").textContent
      }));
      assert.equal(soldOut.title, "iPhone 11");
      assert.equal(soldOut.price, false);
      assert.match(soldOut.ask, /Ask for availability/);
      assert.equal(soldOut.add, false);

      await page.evaluate(() => openPhone("17promax", "Silver"));
      await page.waitForSelector("#pvAdd");
      const stocked = await page.evaluate(() => ({
        price: document.querySelector("#pvBody .pvprice").innerText,
        add: document.querySelector("#pvAdd").textContent,
        ask: !!document.querySelector("#pvAsk")
      }));
      assert.match(stocked.price, /\$1542/);
      assert.match(stocked.add, /Add to cart/);
      assert.equal(stocked.ask, false);
      await page.close();
    }
    assert.deepEqual(writes, []);
  } finally {
    await browser.close();
    server.close();
  }
});
