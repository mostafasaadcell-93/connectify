import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import path from "path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {chromium} = createRequire(import.meta.url)("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");

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

function cssHasFade() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = html.slice(0, html.indexOf("</style>"));
  return /grayscale|pcard\.na[^{]*\{[^}]*opacity\s*:\s*0?\.[0-6]|phimg\{[^}]*opacity\s*:\s*0?\.[0-6]/.test(css.replace(/\s+/g, " "));
}

test("store CSS does not fade unavailable product photos", () => {
  assert.equal(cssHasFade(), false);
});

test("available and unavailable product photos share opacity and filter", async () => {
  const server = await startServer();
  let browser;
  try {
    const origin = `http://127.0.0.1:${server.address().port}/`;
    browser = await chromium.launch({
      headless: true,
      executablePath: "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    });
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const writes = [];
    await page.route("**/*supabase.co/**", route => {
      const method = route.request().method();
      if (method !== "GET" && method !== "HEAD") writes.push(method + " " + route.request().url().split("?")[0]);
      return route.abort();
    });
    await page.goto(origin, {waitUntil: "domcontentloaded", timeout: 30000});
    await page.waitForSelector("#catbar .cb");
    await page.evaluate(() => {
      const sp = document.getElementById("splash");
      if (sp) sp.remove();
    });

    const inspect = async () => page.evaluate(() => {
      const look = (sel, imgSel) => {
        const cards = [...document.querySelectorAll(sel)];
        const ok = cards.find(c => !c.classList.contains("na"));
        const na = cards.find(c => c.classList.contains("na"));
        const read = card => {
          if (!card) return null;
          const img = card.querySelector(imgSel);
          const btn = card.querySelector(".add, .add.view");
          if (!img) return {hasImg: false, btn: btn ? btn.textContent.trim() : ""};
          const s = getComputedStyle(img);
          return {
            hasImg: true,
            opacity: s.opacity,
            filter: s.filter,
            grayscale: s.filter.includes("grayscale") && !s.filter.includes("grayscale(0)"),
            btn: btn ? btn.textContent.trim() : "",
            btnView: !!(btn && btn.classList.contains("view"))
          };
        };
        return {ok: read(ok), na: read(na), nOk: cards.filter(c => !c.classList.contains("na")).length, nNa: cards.filter(c => c.classList.contains("na")).length};
      };
      menuGo("cases");
      shop.limit = 500;
      renderGrid();
      const accessories = look(".pcard.phc", ".phimg, .art img");
      menuGo("apple");
      shop.limit = 500;
      renderGrid();
      const phones = look(".pcard[data-id]", "img.mpic, .art svg");
      return {accessories, phones, grid: document.querySelectorAll("#grid .pcard").length};
    });

    const desktop = await inspect();
    assert.ok(desktop.accessories.nOk > 0 && desktop.accessories.nNa > 0, "need mixed accessory availability");
    assert.equal(desktop.accessories.ok.hasImg, true);
    assert.equal(desktop.accessories.na.hasImg, true);
    assert.equal(desktop.accessories.ok.opacity, desktop.accessories.na.opacity);
    assert.equal(desktop.accessories.ok.filter, desktop.accessories.na.filter);
    assert.equal(desktop.accessories.ok.grayscale, false);
    assert.equal(desktop.accessories.na.grayscale, false);
    assert.equal(desktop.accessories.ok.btnView, false);
    assert.equal(desktop.accessories.na.btnView, true);
    assert.ok(desktop.phones.nOk > 0 && desktop.phones.nNa > 0, "need mixed phone availability");
    assert.equal(desktop.phones.ok.opacity, desktop.phones.na.opacity);
    assert.equal(desktop.phones.ok.filter, desktop.phones.na.filter);
    assert.equal(desktop.phones.na.grayscale, false);
    assert.equal(desktop.phones.na.btnView, true);

    await page.setViewportSize({width: 390, height: 844});
    const mobile = await inspect();
    assert.equal(mobile.accessories.ok.opacity, mobile.accessories.na.opacity);
    assert.equal(mobile.accessories.ok.filter, mobile.accessories.na.filter);
    assert.equal(mobile.accessories.na.grayscale, false);
    assert.equal(mobile.accessories.ok.btnView, false);
    assert.equal(mobile.accessories.na.btnView, true);
    assert.equal(mobile.phones.ok.filter, mobile.phones.na.filter);
    assert.equal(mobile.phones.na.grayscale, false);
    assert.equal(writes.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
