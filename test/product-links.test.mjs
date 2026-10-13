import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {execSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const block = html.match(/\/\* CXREL_START[\s\S]*?\*\/([\s\S]*?)\/\* CXREL_END \*\//);
if (!block) throw new Error("CXREL block missing from index.html");
const cx = new Function(block[1] + `
  return {cxProductURL, cxOrderMessage, cxTradeMessage, cxMayShowWA, cxShouldAutoSend};
`)();

const {chromium} = createRequire(import.meta.url)("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");
const shots = path.join("/opt/cursor/artifacts", "product-links");
fs.mkdirSync(shots, {recursive: true});

const PHONE = "https://connectifystore.vercel.app/?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim";
const PHONE_BLUE = "https://connectifystore.vercel.app/?p=phone&id=17promax&unit=u13&color=Deep%20Blue&st=256&cond=new&sim=psim";
const CASE_A = "https://connectifystore.vercel.app/?p=ph&id=cx11&v=0";
const CASE_B = "https://connectifystore.vercel.app/?p=ph&id=cx11&v=2";
const TABLET = "https://connectifystore.vercel.app/?p=ph&id=cx2&v=0";
const TABLET_OUT = "https://connectifystore.vercel.app/?p=ph&id=cx2&v=1";

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

let server;
let origin;
let browser;
const boot = (async () => {
  server = await startServer();
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
})();

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function order() {
  return {
    id: "C-0123456789abcdef01",
    cart: [
      {key: "17promax|Silver|256|new|psim", kind: "phone", id: "17promax", unit: "u12", title: "iPhone 17 Pro Max", detail: "256GB, Silver, New, Nano-SIM + eSIM", price: 1542},
      {key: "17promax|Deep Blue|256|new|psim", kind: "phone", id: "17promax", unit: "u13", title: "iPhone 17 Pro Max", detail: "256GB, Deep Blue, New, Nano-SIM + eSIM", price: 1542},
      {key: "s26ultra|Black|256|new|psim", kind: "phone", id: "s26ultra", unit: "u10", title: "Galaxy S26 Ultra", detail: "256GB, Black, New, Nano-SIM + eSIM", price: 1356},
      {key: "ph:cx11:0", kind: "ph", id: "cx11", vi: 0, title: "Silicone Case", detail: "iPhone 16", price: 14.5},
      {key: "ph:cx11:2", kind: "ph", id: "cx11", vi: 2, title: "Silicone Case", detail: "Galaxy S24 Ultra", price: 14.5},
      {key: "ph:cx2:0", kind: "ph", id: "cx2", vi: 0, title: "Galaxy Tab A11", detail: "Gray, 8GB/128GB, New", price: 197},
      {key: "ph:cx2:1", kind: "ph", id: "cx2", vi: 1, title: "Galaxy Tab A11", detail: "Silver, 8GB/128GB, New", price: 197},
      {key: "ph:cx27:2", kind: "ph", id: "cx27", vi: 2, title: "Tempered Glass Screen Protector", detail: "iPhone 12 Pro Max", price: 7.5},
      {key: "ph:cx14:1", kind: "ph", id: "cx14", vi: 1, title: "Samsung Adapter 25W", detail: "Black 25W", price: 17.5},
      {key: "acc:a18", kind: "acc", id: "a18", title: "Karl Lagerfeld silicone cover", detail: "iPhone 16 Pro Max, pink or black", price: null}
    ],
    form: {name: "Karim", phone: "70123456", phoneRaw: "70 123 456", area: "Beirut", address: "Hamra street building 4"}
  };
}

test("order message keeps the existing wording and adds one link under every item", () => {
  const diff = execSync("git diff -U0 main -- index.html", {encoding: "utf8"});
  for (const needle of ["cardPill", "phoneActsHTML", "applyStock", "Ask for availability", "availText"]) {
    assert.equal(diff.includes(needle), false, needle + " appeared in the product-link diff");
  }
  assert.match(html, /const availText=parts=>`Hello Connectify! I'd like to ask about availability for: \$\{joinAsk\(parts\)\}\. Could you please confirm availability and price\?`;/);
  assert.match(html, /pullState\(\)\.then\(ok=>\{if\(ok\)rerender\(\);L\.ready=true;cxApplyProductLink\(\)\}\)\.catch\(\(\)=>\{L\.ready=true;cxApplyProductLink\(\)\}\)/);
  assert.equal(cx.cxMayShowWA("confirmed"), true);
  assert.equal(cx.cxMayShowWA("failed"), false);
  assert.equal(cx.cxMayShowWA("uncertain"), false);
  assert.equal(cx.cxShouldAutoSend(), false);

  const money = n => "$" + n;
  const pending = order();
  const msg = cx.cxOrderMessage(pending, money, "+961 71 062 768").msg;
  const urls = [
    PHONE,
    PHONE_BLUE,
    "https://connectifystore.vercel.app/?p=phone&id=s26ultra&unit=u10&color=Black&st=256&cond=new&sim=psim",
    CASE_A,
    CASE_B,
    TABLET,
    TABLET_OUT,
    "https://connectifystore.vercel.app/?p=ph&id=cx27&v=2",
    "https://connectifystore.vercel.app/?p=ph&id=cx14&v=1",
    "https://connectifystore.vercel.app/?p=acc&id=a18"
  ];
  const lines = [
    "Hi Connectify! Order C-0123456789abcdef01",
    "• iPhone 17 Pro Max, 256GB, Silver, New, Nano-SIM + eSIM ($1542)\n\nProduct link: " + PHONE,
    "• iPhone 17 Pro Max, 256GB, Deep Blue, New, Nano-SIM + eSIM ($1542)\n\nProduct link: " + PHONE_BLUE,
    "• Galaxy S26 Ultra, 256GB, Black, New, Nano-SIM + eSIM ($1356)",
    "• Silicone Case, iPhone 16 ($14.5)\n\nProduct link: " + CASE_A,
    "• Silicone Case, Galaxy S24 Ultra ($14.5)\n\nProduct link: " + CASE_B,
    "• Galaxy Tab A11, Gray, 8GB/128GB, New ($197)\n\nProduct link: " + TABLET,
    "• Galaxy Tab A11, Silver, 8GB/128GB, New ($197)\n\nProduct link: " + TABLET_OUT,
    "• Tempered Glass Screen Protector, iPhone 12 Pro Max ($7.5)",
    "• Samsung Adapter 25W, Black 25W ($17.5)",
    "• Karl Lagerfeld silicone cover, iPhone 16 Pro Max, pink or black\n\nProduct link: " + urls.at(-1),
    "Subtotal: $4888 + delivery",
    "Delivery to Beirut, cash on delivery",
    "Address: Hamra street building 4",
    "Name: Karim",
    "Can you confirm the prices and send me real photos?"
  ];
  let at = 0;
  for (const line of lines) {
    const i = msg.indexOf(line, at);
    assert.ok(i >= at, "missing or out of order: " + line + "\n\n" + msg);
    at = i + line.length;
  }
  assert.equal((msg.match(/Product link: /g) || []).length, pending.cart.length);
  for (const url of urls) {
    assert.equal(msg.includes(url), true, url);
    assert.equal(/\s/.test(url), false, url);
    const params = new URL(url).searchParams;
    for (const key of params.keys()) assert.ok(["p", "id", "unit", "color", "st", "cond", "sim", "v"].includes(key), key);
  }
  assert.equal(msg.includes("70123456"), false);
  assert.equal(msg.includes("70 123 456"), false);
  const wa = new URL("https://wa.me/96171062768?text=" + encodeURIComponent(msg));
  assert.equal(wa.searchParams.get("text"), msg);

  const bare = cx.cxOrderMessage({
    id: "C-aaaaaaaaaaaaaaaaaa",
    cart: [{key: "phone:14pro", kind: "phone", id: "14pro", unit: "u1", title: "iPhone 14 Pro", detail: "256GB, Space Black", price: 500}],
    form: {name: "Karim", area: "Beirut", address: "Hamra street building 4"}
  }, money, "+961 71 062 768").msg;
  assert.match(bare, /Hi Connectify! Order C-aaaaaaaaaaaaaaaaaa/);
  assert.match(bare, /• iPhone 14 Pro, 256GB, Space Black \(\$500\)/);
  assert.match(bare, /Product link: https:\/\/connectifystore\.vercel\.app\/\?p=phone&id=14pro&unit=u1\n/);
  assert.doesNotMatch(bare, /color=/);

  const trade = cx.cxTradeMessage({id: "T-aaaaaaaaaaaaaaaaaa", form: {modelName: "iPhone 14 Pro", detail: "256GB", est: "$400", name: "Karim"}}, "+961").msg;
  assert.match(trade, /Hi Connectify! Trade-in request T-aaaaaaaaaaaaaaaaaa/);
  assert.equal(trade.includes("Product link:"), false);
  assert.equal(cx.cxProductURL({kind: "nope", id: "x"}), "");
  assert.equal(cx.cxProductURL(null), "");
});

async function openPage(urlPath, viewport = {width: 1280, height: 900}) {
  await boot;
  const context = await browser.newContext({viewport, locale: "en-US"});
  const page = await context.newPage();
  const writes = [];
  await page.route("**/*supabase.co/**", route => {
    const method = route.request().method();
    if (method !== "GET" && method !== "HEAD") writes.push(method + " " + route.request().url());
    return route.abort();
  });
  await page.goto(origin + urlPath, {waitUntil: "domcontentloaded", timeout: 60000});
  return {context, page, writes};
}

function assertNoOrderWrites(session) {
  const orders = session.writes.filter(line => !line.includes("/rest/v1/events"));
  assert.deepEqual(orders, []);
}
async function finish(session) {
  await session.context.close();
}

async function shot(page, name) {
  await page.evaluate(() => {
    const splash = document.querySelector("#splash");
    if (splash) splash.remove();
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
  });
  await page.screenshot({path: path.join(shots, name), fullPage: false});
}

async function waitReady(page, title) {
  await page.waitForFunction(expected => {
    const modal = document.querySelector("#pvModal");
    const heading = document.querySelector("#pvTitle");
    return window.LIVE && LIVE.ready === true && modal && modal.classList.contains("on") && heading && heading.textContent === expected;
  }, title, {timeout: 60000});
}

function readPhone() {
  const pressed = key => {
    const button = document.querySelector('#pvBody [data-k="' + key + '"][aria-pressed="true"]');
    return button ? button.dataset.v : "";
  };
  const price = document.querySelector("#pvBody .pvprice");
  const img = document.querySelector("#pvImg");
  return {
    title: document.querySelector("#pvTitle").textContent,
    color: pressed("color"),
    st: pressed("st"),
    cond: pressed("cond"),
    sim: pressed("sim"),
    price: price ? price.innerText : "",
    ask: document.querySelector("#pvAsk") ? document.querySelector("#pvAsk").textContent : "",
    add: document.querySelector("#pvAdd") ? document.querySelector("#pvAdd").textContent : "",
    specs: !!document.querySelector("#pvBody .specs"),
    photo: !!(img && img.getAttribute("src")),
    open: document.querySelector("#pvModal").classList.contains("on")
  };
}

function readProduct() {
  const price = document.querySelector("#pvBody .pvprice");
  const img = document.querySelector("#pvImg");
  const desc = document.querySelector("#pvBody .pdesc");
  return {
    title: document.querySelector("#pvTitle").textContent,
    chips: [...document.querySelectorAll('#pvBody [data-po][aria-pressed="true"]')].map(button => button.dataset.v),
    price: price ? price.innerText : "",
    ask: document.querySelector("#pvAsk") ? document.querySelector("#pvAsk").textContent : "",
    add: document.querySelector("#pvAdd") ? document.querySelector("#pvAdd").textContent : "",
    desc: desc ? desc.textContent : "",
    photo: !!(img && img.getAttribute("src")),
    open: document.querySelector("#pvModal").classList.contains("on")
  };
}

test("fresh phone link opens the ordered iPhone configuration", async () => {
  const session = await openPage("/?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim");
  try {
    await waitReady(session.page, "iPhone 17 Pro Max");
    const view = await session.page.evaluate(readPhone);
    assert.equal(view.color, "Silver");
    assert.equal(view.st, "256");
    assert.equal(view.cond, "new");
    assert.equal(view.sim, "psim");
    assert.match(view.price, /\$1542/);
    assert.match(view.add, /Add to cart/);
    assert.equal(view.ask, "");
    assert.equal(view.specs, true);
    assert.equal(view.photo, true);
    await shot(session.page, "iphone-17-promax-silver.png");
    assertNoOrderWrites(session);
  } finally {
    await finish(session);
  }
});

test("accessory, tablet, samsung, charger, and screen protector links open the selected variant", async () => {
  const cases = [
    ["/?p=ph&id=cx11&v=0", "Silicone Case", "iPhone 16", /\$14\.50/, true],
    ["/?p=ph&id=cx11&v=2", "Silicone Case", "Galaxy S24 Ultra", /\$14\.50/, true],
    ["/?p=ph&id=cx2&v=0", "Galaxy Tab A11", "Gray, 8GB/128GB, New", /\$197/, true],
    ["/?p=ph&id=cx2&v=1", "Galaxy Tab A11", "Silver, 8GB/128GB, New", null, false],
    ["/?p=ph&id=cx14&v=1", "Samsung Adapter 25W", "Black 25W", /\$/, true],
    ["/?p=ph&id=cx27&v=2", "Tempered Glass Screen Protector", "iPhone 12 Pro Max", /\$/, true],
    ["/?p=ph&id=cx1&v=0", "Galaxy A54", null, null, false]
  ];
  for (const [urlPath, title, chip, price, inStock] of cases) {
    const session = await openPage(urlPath);
    try {
      await waitReady(session.page, title);
      const view = await session.page.evaluate(readProduct);
      if (chip) assert.deepEqual(view.chips, [chip], title + " " + urlPath);
      else assert.match(view.desc, /Black 256 12 Ram/);
      assert.equal(view.photo, true, title);
      assert.ok(view.desc.length > 10, title);
      if (inStock) {
        assert.match(view.price, price, title);
        assert.match(view.add, /Add to cart/, title);
        assert.equal(view.ask, "", title);
      } else {
        assert.equal(view.price, "", title);
        assert.match(view.ask, /Ask for availability/, title);
        assert.equal(view.add, "", title);
      }
      if (urlPath.includes("cx11&v=0")) await shot(session.page, "silicone-case.png");
      if (urlPath.includes("cx2&v=0")) await shot(session.page, "galaxy-tab.png");
      if (urlPath.includes("cx2&v=1")) await shot(session.page, "galaxy-tab-unavailable.png");
      assertNoOrderWrites(session);
    } finally {
      await finish(session);
    }
  }

  const samsung = await openPage("/?p=phone&id=s26ultra&color=Black&st=256&cond=new&sim=psim");
  try {
    await waitReady(samsung.page, "Galaxy S26 Ultra");
    const view = await samsung.page.evaluate(readPhone);
    assert.equal(view.color, "Black");
    assert.equal(view.st, "256");
    assert.equal(view.cond, "new");
    assert.equal(view.sim, "psim");
    assert.match(view.price, /\$1356/);
    assert.equal(view.photo, true);
    assertNoOrderWrites(samsung);
  } finally {
    await finish(samsung);
  }
});

test("accessory link opens on a phone-sized screen", async () => {
  const session = await openPage("/?p=ph&id=cx11&v=0", {width: 390, height: 844});
  try {
    await waitReady(session.page, "Silicone Case");
    const box = await session.page.evaluate(() => {
      const modal = document.querySelector("#pvModal");
      const rect = modal.getBoundingClientRect();
      const chip = document.querySelector('#pvBody [data-po][aria-pressed="true"]');
      return {width: rect.width, height: rect.height, chip: chip ? chip.dataset.v : "", viewport: window.innerWidth};
    });
    assert.equal(box.chip, "iPhone 16");
    assert.ok(box.viewport <= 390);
    assert.ok(box.width > 200 && box.height > 200);
    await shot(session.page, "silicone-case-mobile.png");
    assertNoOrderWrites(session);
  } finally {
    await finish(session);
  }
});

test("a phone that is no longer in stock still opens the ordered configuration", async () => {
  const sold = await openPage("/?p=phone&id=17promax&color=Silver&st=1024&cond=new&sim=psim");
  try {
    await waitReady(sold.page, "iPhone 17 Pro Max");
    const view = await sold.page.evaluate(readPhone);
    assert.equal(view.color, "Silver");
    assert.equal(view.st, "1024");
    assert.equal(view.cond, "new");
    assert.equal(view.sim, "psim");
    assert.equal(view.price, "");
    assert.match(view.ask, /Ask for availability/);
    assert.equal(view.specs, true);
    assertNoOrderWrites(sold);
  } finally {
    await finish(sold);
  }

  const session = await openPage("/?p=phone&id=17promax&unit=u13&color=Silver&st=256&cond=new&sim=psim");
  try {
    await waitReady(session.page, "iPhone 17 Pro Max");
    const before = await session.page.evaluate(readPhone);
    assert.equal(before.color, "Silver");
    assert.match(before.price, /\$1542/);
    await session.page.evaluate(() => {
      DB.units.forEach(unit => {
        if (unit.m === "17promax" && unit.c === "Silver" && unit.st === 256) unit.qty = 0;
      });
      save();
    });
    await session.page.goto(session.page.url(), {waitUntil: "domcontentloaded", timeout: 60000});
    await waitReady(session.page, "iPhone 17 Pro Max");
    const view = await session.page.evaluate(readPhone);
    assert.equal(view.color, "Silver");
    assert.equal(view.st, "256");
    assert.equal(view.cond, "new");
    assert.equal(view.sim, "psim");
    assert.equal(view.price, "");
    assert.match(view.ask, /Ask for availability/);
    await shot(session.page, "iphone-unavailable.png");
    assertNoOrderWrites(session);
  } finally {
    await finish(session);
  }
});

test("an unknown product id leaves the catalog closed and explains that", async () => {
  for (const urlPath of ["/?p=phone&id=does-not-exist", "/?p=ph&id=cx-missing", "/?p=acc&id=not-a-real-accessory", "/?p=phone"]) {
    const session = await openPage(urlPath);
    try {
      await session.page.waitForFunction(() => {
        const toast = document.querySelector("#toast");
        return window.LIVE && LIVE.ready === true && toast && /no longer in the catalog/.test(toast.textContent);
      }, null, {timeout: 60000});
      const open = await session.page.evaluate(() => document.querySelector("#pvModal").classList.contains("on"));
      assert.equal(open, false, urlPath);
      if (urlPath.includes("does-not-exist")) await shot(session.page, "invalid-product.png");
      assertNoOrderWrites(session);
    } finally {
      await finish(session);
    }
  }
});

test("the homepage and the admin hash do not open a product", async () => {
  const home = await openPage("/");
  try {
    await home.page.waitForFunction(() => window.LIVE && LIVE.ready === true, null, {timeout: 60000});
    assert.equal(await home.page.evaluate(() => document.querySelector("#pvModal").classList.contains("on")), false);
    assert.equal(await home.page.evaluate(() => document.querySelector("#toast").classList.contains("on")), false);
    assertNoOrderWrites(home);
  } finally {
    await finish(home);
  }
  const admin = await openPage("/?p=phone&id=17promax&color=Silver&st=256&cond=new&sim=psim#admin");
  try {
    await admin.page.waitForFunction(() => window.LIVE && LIVE.ready === true, null, {timeout: 60000});
    assert.equal(await admin.page.evaluate(() => document.querySelector("#pvModal").classList.contains("on")), false);
    assertNoOrderWrites(admin);
  } finally {
    await finish(admin);
  }
});
