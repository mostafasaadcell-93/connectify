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

test("footer names Mostafa and no longer carries the 3D credit", () => {
  const footer = html.slice(html.indexOf("<footer>"), html.indexOf("</footer>"));
  assert.match(footer, /Design concept prepared for Connectify by Mostafa/);
  assert.equal(footer.includes("Haidar"), false);
  assert.equal(footer.includes("MajdyModels"), false);
  assert.equal(footer.includes("CC BY"), false);
  assert.equal(footer.includes("sketchfab.com"), false);
  assert.match(footer, /Not a live store/);
  assert.match(footer, /Instagram @connectify\.lb/);
  assert.match(footer, /WhatsApp \+961 71 062 768/);
  assert.match(html, /models\/iphone16pm\.glb/);
  assert.match(html, /id="heroCredit" hidden/);
  assert.match(html, /href="https:\/\/sketchfab\.com\/MG990"/);
  assert.match(html, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
  const heroUI = html.slice(html.indexOf("function heroUI"), html.indexOf("let userWant"));
  assert.match(heroUI, /heroCredit/);
  assert.match(heroUI, /HERO_CREDITS\[key\]/);
});

test("the 3D credit appears only while the licensed hero is selected", async () => {
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
      await page.waitForFunction(() => document.querySelector(".hero.multi") && typeof heroPick === "function", null, {timeout: 60000});
      await page.evaluate(() => { const splash = document.querySelector("#splash"); if (splash) splash.remove(); });

      const footer = await page.locator("footer .concept").innerText();
      assert.match(footer, /Design concept prepared for Connectify by Mostafa/);
      assert.equal(footer.includes("Haidar"), false);
      assert.equal(footer.includes("Majdy"), false);
      assert.equal(await page.locator("#heroCredit").isVisible(), false);

      await page.locator('.hpick .sw[data-dev="pm16"]').click();
      await page.waitForFunction(() => document.querySelector(".hero").dataset.dev === "pm16" && !document.querySelector("#heroCredit").hidden);
      const credit = await page.locator("#heroCredit").innerText();
      assert.match(credit, /iPhone 16 Pro Max 3D model by MajdyModels, CC BY 4\.0/);
      assert.equal(await page.locator("#heroCredit").isVisible(), true);
      const box = await page.locator("#heroCredit").boundingBox();
      assert.ok(box && box.height > 0 && box.height < 80, "credit should stay a single quiet line");

      await page.locator('.hpick .sw[data-dev="pm18"]').click();
      await page.waitForFunction(() => document.querySelector(".hero").dataset.dev === "pm18" && document.querySelector("#heroCredit").hidden);
      assert.equal(await page.locator("#heroCredit").isVisible(), false);
      await page.close();
    }
    assert.deepEqual(writes, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
