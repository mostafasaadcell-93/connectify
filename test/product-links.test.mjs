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

test("order message is a receipt with one exact link under every item", () => {
  const diff = execSync("git diff -U0 main -- index.html", {encoding: "utf8"});
  for (const needle of ["cardPill", "applyStock"]) {
    assert.equal(diff.includes(needle), false, needle + " appeared in the product-link diff");
  }
  assert.equal((html.match(/waURL\(availInquiry\(/g) || []).length, 3);
  assert.equal((html.match(/waURL\(availText\(/g) || []).length, 0);
  assert.match(html, /const availText=parts=>`Hello Connectify! I'd like to ask about availability for: \$\{joinAsk\(parts\)\}\. Could you please confirm availability and price\?`;/);
  assert.match(html, /pullState\(\)\.then\(ok=>\{if\(ok\)rerender\(\);L\.ready=true;cxApplyProductLink\(\)\}\)\.catch\(\(\)=>\{L\.ready=true;cxApplyProductLink\(\)\}\)/);
  assert.equal(cx.cxMayShowWA("confirmed"), true);
  assert.equal(cx.cxMayShowWA("failed"), false);
  assert.equal(cx.cxMayShowWA("uncertain"), false);
  assert.equal(cx.cxShouldAutoSend(), false);

  const money = n => "$" + n;
  const pending = order();
  const built = cx.cxOrderMessage(pending, money, "+961 71 062 768");
  const msg = built.msg;
  assert.equal(built.title, "Order C-0123456789abcdef01 saved");
  assert.equal(built.lead, "Last step: send it to us on WhatsApp (+961 71 062 768). We reply with prices and real photos.");
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
  const expected = [
    "*CONNECTIFY — NEW ORDER*",
    "Order: C-0123456789abcdef01",
    "",
    "*CUSTOMER DETAILS*",
    "Name: Karim",
    "Area: Beirut",
    "Address: Hamra street building 4",
    "",
    "*ORDER ITEMS*",
    "",
    "*1. iPhone 17 Pro Max*",
    "256GB, Silver, New, Nano-SIM + eSIM",
    "Price: $1542",
    urls[0],
    "",
    "*2. iPhone 17 Pro Max*",
    "256GB, Deep Blue, New, Nano-SIM + eSIM",
    "Price: $1542",
    urls[1],
    "",
    "*3. Galaxy S26 Ultra*",
    "256GB, Black, New, Nano-SIM + eSIM",
    "Price: $1356",
    urls[2],
    "",
    "*4. Silicone Case*",
    "iPhone 16",
    "Price: $14.5",
    urls[3],
    "",
    "*5. Silicone Case*",
    "Galaxy S24 Ultra",
    "Price: $14.5",
    urls[4],
    "",
    "*6. Galaxy Tab A11*",
    "Gray, 8GB/128GB, New",
    "Price: $197",
    urls[5],
    "",
    "*7. Galaxy Tab A11*",
    "Silver, 8GB/128GB, New",
    "Price: $197",
    urls[6],
    "",
    "*8. Tempered Glass Screen Protector*",
    "iPhone 12 Pro Max",
    "Price: $7.5",
    urls[7],
    "",
    "*9. Samsung Adapter 25W*",
    "Black 25W",
    "Price: $17.5",
    urls[8],
    "",
    "*10. Karl Lagerfeld silicone cover*",
    "iPhone 16 Pro Max, pink or black",
    urls[9],
    "",
    "*ORDER SUMMARY*",
    "Subtotal: $4888 + delivery",
    "Delivery to Beirut, cash on delivery",
    "",
    "Can you confirm the prices and send me real photos?"
  ].join("\n");
  assert.equal(msg, expected);
  assert.equal(msg.split("\n").filter(line => line.startsWith("https://")).length, pending.cart.length);
  assert.equal(msg.includes("Qty:"), false);
  for (const url of urls) {
    assert.equal(msg.split("\n").includes(url), true, url);
    assert.equal(/\s/.test(url), false, url);
    assert.equal(url.includes("%25"), false, url);
    const params = new URL(url).searchParams;
    for (const key of params.keys()) assert.ok(["p", "id", "unit", "color", "st", "cond", "sim", "v"].includes(key), key);
  }
  assert.equal(msg.includes("70123456"), false);
  assert.equal(msg.includes("70 123 456"), false);
  const wa = new URL("https://wa.me/96171062768?text=" + encodeURIComponent(msg));
  assert.equal(wa.searchParams.get("text"), msg);
  assert.equal(wa.pathname, "/96171062768");

  const bare = cx.cxOrderMessage({
    id: "C-aaaaaaaaaaaaaaaaaa",
    cart: [{key: "phone:14pro", kind: "phone", id: "14pro", unit: "u1", title: "iPhone 14 Pro", detail: "256GB, Space Black", price: 500}],
    form: {name: "Karim", area: "Beirut", address: "Hamra street building 4"}
  }, money, "+961 71 062 768").msg;
  assert.match(bare, /\*CONNECTIFY — NEW ORDER\*\nOrder: C-aaaaaaaaaaaaaaaaaa/);
  assert.match(bare, /\*1\. iPhone 14 Pro\*\n256GB, Space Black\nPrice: \$500\nhttps:\/\/connectifystore\.vercel\.app\/\?p=phone&id=14pro&unit=u1\n/);
  assert.doesNotMatch(bare, /color=/);
  assert.equal((bare.match(/^\*\d+\. /gm) || []).length, 1);

  const trade = cx.cxTradeMessage({id: "T-aaaaaaaaaaaaaaaaaa", form: {modelName: "iPhone 14 Pro", detail: "256GB", est: "$400", name: "Karim"}}, "+961").msg;
  assert.match(trade, /Hi Connectify! Trade-in request T-aaaaaaaaaaaaaaaaaa/);
  assert.equal(trade.includes("Product link:"), false);
  assert.equal(cx.cxProductURL({kind: "nope", id: "x"}), "");
  assert.equal(cx.cxProductURL(null), "");

  assert.equal(cx.cxProductURL({key: "ph:cx12:0", title: "Apple Adapter 25W"}), "https://connectifystore.vercel.app/?p=ph&id=cx12&v=0");
  assert.equal(cx.cxProductURL({kind: "ph", id: "cx14", vi: 1}), "https://connectifystore.vercel.app/?p=ph&id=cx14&v=1");
  assert.equal(cx.cxProductURL({key: "ph:cx14:1"}), "https://connectifystore.vercel.app/?p=ph&id=cx14&v=1");
  const stored = cx.cxOrderMessage({
    id: "C-bbbbbbbbbbbbbbbbbb",
    items: [{kind: "ph", id: "cx12", vi: 0, title: "Apple Adapter 25W", detail: "White, 25W", price: 38}],
    form: {name: "Karim", area: "Beirut", address: "Hamra street building 4"}
  }, money, "+961 71 062 768").msg;
  assert.match(stored, /\*1\. Apple Adapter 25W\*\nWhite, 25W\nPrice: \$38\nhttps:\/\/connectifystore\.vercel\.app\/\?p=ph&id=cx12&v=0\n/);
  assert.match(stored, /Can you confirm the prices and send me real photos\?/);
  const sparse = cx.cxOrderMessage({
    id: "C-cccccccccccccccccc",
    cart: [{key: "acc:a18", kind: "acc", id: "a18", title: "Karl Lagerfeld silicone cover", detail: "", price: null}],
    form: {}
  }, money, "+961 71 062 768").msg;
  assert.equal(sparse.includes("*CUSTOMER DETAILS*"), false);
  assert.equal(sparse.includes("Name:"), false);
  assert.equal(sparse.includes("Address:"), false);
  assert.equal(sparse.includes("Delivery to"), false);
  assert.equal(sparse.includes("Subtotal:"), false);
  assert.equal(sparse.includes("Price:"), false);
  assert.match(sparse, /\*1\. Karl Lagerfeld silicone cover\*\nhttps:\/\/connectifystore\.vercel\.app\/\?p=acc&id=a18\n/);
  assert.match(sparse, /\*ORDER SUMMARY\*\nCash on delivery\n\nCan you confirm the prices and send me real photos\?/);
  const counted = cx.cxOrderMessage({
    id: "C-dddddddddddddddddd",
    cart: [
      {key: "ph:cx14:0", kind: "ph", id: "cx14", vi: 0, title: "Samsung Adapter 25W", detail: "White 25W", price: 10, qty: 3},
      {key: "ph:cx2:0", kind: "ph", id: "cx2", vi: 0, title: "Galaxy Tab A11", detail: "Gray", price: 5}
    ],
    form: {name: "Karim", area: "Beirut", address: "Hamra street building 4"}
  }, money, "+961 71 062 768").msg;
  assert.match(counted, /Qty: 3/);
  assert.equal(counted.includes("Qty: 5"), false);
  assert.match(counted, /Subtotal: \$15 \+ delivery/);
  assert.match(html, /window\.cxOrderMessage\(\{id,cart:snap/);
  assert.equal(html.includes("cart.map(i=>`• ${i.title}"), false);
});

test("a phone-width order receipt stays readable for phones, chargers, and a tablet", async () => {
  await boot;
  const context = await browser.newContext({viewport: {width: 390, height: 844}, locale: "en-US"});
  const page = await context.newPage();
  const orderPosts = [];
  await page.route("**/*supabase.co/**", route => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "POST" && url.includes("/rest/v1/orders")) {
      orderPosts.push(route.request().postData());
      return route.fulfill({status: 201, contentType: "application/json", body: "[]"});
    }
    return route.abort();
  });
  await page.goto(origin + "/", {waitUntil: "domcontentloaded", timeout: 60000});
  await page.waitForFunction(() => window.LIVE && LIVE.ready && typeof addPH === "function" && typeof CX_CHECKOUT === "function", null, {timeout: 60000});
  await page.evaluate(() => {
    openPhone("17promax", "Silver");
    document.querySelector("#pvAdd").click();
    addPH(PHmap.get("cx14"), 0);
    addPH(PHmap.get("cx14"), 1);
    addPH(PHmap.get("cx2"), 0);
    addPH(PHmap.get("cx11"), 0);
    openCart(true);
    document.querySelector("#oName").value = "Karim";
    document.querySelector("#oPhone").value = "70 123 456";
    const area = document.querySelector("#oArea");
    if (![...area.options].some(option => option.value === "Beirut")) area.innerHTML = '<option value="Beirut">Beirut</option>';
    area.value = "Beirut";
    document.querySelector("#oAddr").value = "Hamra street building 4";
  });
  await page.click("#checkout");
  await page.waitForFunction(() => document.querySelector("#waModal").classList.contains("on"), null, {timeout: 20000});
  const bubble = await page.evaluate(() => document.querySelector("#bubble").textContent);
  const layout = await page.evaluate(() => {
    const box = document.querySelector("#waModal .mbox");
    const text = document.querySelector("#bubble").textContent;
    return {
      whiteSpace: getComputedStyle(document.querySelector("#bubble")).whiteSpace,
      scrolls: getComputedStyle(box).overflowY,
      wider: box.getBoundingClientRect().width > window.innerWidth + 1,
      urls: text.split("\n").filter(line => line.startsWith("https://"))
    };
  });
  await page.locator("#waModal .mbox").screenshot({path: path.join(shots, "order-receipt-mobile.png")});
  assert.equal(layout.whiteSpace, "pre-line");
  assert.match(layout.scrolls, /auto|scroll/);
  assert.equal(layout.wider, false);
  assert.equal(layout.urls.length, 5);
  assert.ok(layout.urls.every(url => !/\s/.test(url) && !url.includes("%25")));
  assert.match(bubble, /\*CONNECTIFY — NEW ORDER\*/);
  assert.match(bubble, /\*1\. iPhone 17 Pro Max\*/);
  assert.match(bubble, /256GB, Silver/);
  assert.ok(layout.urls.some(url => url.includes("p=phone&id=17promax") && url.includes("color=Silver")));
  assert.ok(layout.urls.some(url => url.includes("id=cx14&v=0")));
  assert.ok(layout.urls.some(url => url.includes("id=cx14&v=1")));
  assert.ok(layout.urls.some(url => url.includes("id=cx2&v=0")));
  assert.ok(layout.urls.some(url => url.includes("id=cx11&v=0")));
  assert.match(bubble, /Name: Karim/);
  assert.match(bubble, /Area: Beirut/);
  assert.match(bubble, /Address: Hamra street building 4/);
  assert.match(bubble, /Subtotal: \$/);
  assert.match(bubble, /Delivery to Beirut, cash on delivery/);
  assert.match(bubble, /Can you confirm the prices and send me real photos\?/);
  assert.equal(bubble.includes("70123456"), false);
  assert.equal(orderPosts.length, 1);
  const posted = JSON.parse(orderPosts[0]);
  assert.equal(posted.name, "Karim");
  assert.equal(posted.area, "Beirut");
  assert.equal(posted.address, "Hamra street building 4");
  assert.equal(posted.pay, "Cash on delivery");
  assert.equal(posted.items.length, 5);
  const href = await page.evaluate(() => document.querySelector("#waGo").getAttribute("href"));
  assert.equal(new URL(href).searchParams.get("text"), bubble);
  await context.close();
});

async function openPage(urlPath, viewport = {width: 1280, height: 900}, prepare) {
  await boot;
  const context = await browser.newContext({viewport, locale: "en-US"});
  if (prepare) await prepare(context);
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

test("every orderable category gets its own link through checkout, including a charger", async () => {
  await boot;
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  const orderPosts = [];
  await page.route("**/*supabase.co/**", route => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "POST" && url.includes("/rest/v1/orders")) {
      orderPosts.push(route.request().postData());
      return route.fulfill({status: 201, contentType: "application/json", body: "[]"});
    }
    return route.abort();
  });
  await page.goto(origin + "/", {waitUntil: "domcontentloaded", timeout: 60000});
  await page.waitForFunction(() => window.LIVE && LIVE.ready && typeof addPH === "function" && typeof CX_CHECKOUT === "function" && typeof cxOrderMessage === "function", null, {timeout: 60000});
  const added = await page.evaluate(() => {
    const ids = ["cx12", "cx16", "cx20", "cx19", "cx11", "cx27", "cx24", "cx131", "cx130", "cx2", "cx54", "cx57", "cx25", "cx14"];
    ids.forEach(id => addPH(PHmap.get(id), 0));
    addPH(PHmap.get("cx14"), 1);
    addPH(PHmap.get("cx11"), 2);
    DB.newp = [{id: "nptestone", name: "Anker Charger", brand: "Anker", dept: "power", sub: "Chargers", desc: "30W USB-C", c: "2026-10-13", vars: [{t: "30W USB-C", p: 20, q: 2}]}];
    syncNewProducts();
    addPH(PHmap.get("nptestone"), 0);
    const shared = PHI.find(p => p.ph && !p.cx && phOK(p));
    if (shared) addPH(shared, 0);
    openPhone("17promax", "Silver");
    document.querySelector("#pvAdd").click();
    openPhone("s26ultra", "Black");
    document.querySelector("#pvAdd").click();
    return {
      shared: shared ? {id: shared.id, name: shared.name} : null,
      count: document.querySelectorAll("#items .line").length
    };
  });
  assert.ok(added.shared, "an in-stock shared-catalog product should be orderable");
  assert.ok(added.count >= 17, "cart lines " + added.count);
  await page.evaluate(() => {
    openCart(true);
    document.querySelector("#oName").value = "Karim";
    document.querySelector("#oPhone").value = "70 123 456";
    const area = document.querySelector("#oArea");
    if (![...area.options].some(o => o.value === "Beirut")) area.innerHTML = '<option value="Beirut">Beirut</option>';
    area.value = "Beirut";
    document.querySelector("#oAddr").value = "Hamra street building 4";
  });
  await page.click("#checkout");
  await page.waitForFunction(() => document.querySelector("#waModal").classList.contains("on"), null, {timeout: 20000});
  const bubble = await page.evaluate(() => document.querySelector("#bubble").textContent);
  await page.locator("#waModal .mbox").screenshot({path: path.join(shots, "order-receipt-many.png")});
  const lines = bubble.split("\n");
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\*\d+\. /.test(lines[i])) continue;
    const chunk = [lines[i]];
    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\*\d+\. /.test(lines[j]) || lines[j] === "*ORDER SUMMARY*") break;
      if (lines[j].startsWith("https://")) {
        assert.equal(url, "", "extra link in " + lines[i]);
        url = lines[j];
      } else if (lines[j] !== "") chunk.push(lines[j]);
    }
    assert.match(url, /^https:\/\/connectifystore\.vercel\.app\/\?/, "missing link under " + lines[i]);
    assert.equal(/\s/.test(url), false, url);
    assert.equal(url.includes("%25"), false, url);
    pairs.push({item: chunk.join("\n"), url});
  }
  assert.equal(pairs.length, (bubble.match(/^\*\d+\. /gm) || []).length);
  assert.ok(pairs.some(pair => pair.item.includes("Apple Adapter 25W") && pair.url.includes("id=cx12&v=0")));
  assert.ok(pairs.some(pair => pair.item.includes("Samsung Cable") && pair.url.includes("id=cx16")));
  assert.ok(pairs.some(pair => pair.item.includes("Lightning") && pair.url.includes("id=cx20&v=0")));
  assert.ok(pairs.some(pair => pair.item.includes("MagSafe") && pair.url.includes("id=cx19&v=0")));
  assert.ok(pairs.some(pair => pair.item.includes("Silicone Case") && pair.url.includes("id=cx11&v=0")));
  assert.ok(pairs.some(pair => pair.item.includes("Silicone Case") && pair.url.includes("id=cx11&v=2")));
  assert.ok(pairs.some(pair => pair.item.includes("Tempered Glass") && pair.url.includes("id=cx27")));
  assert.ok(pairs.some(pair => pair.item.includes("Power Bank") && pair.url.includes("id=cx24")));
  assert.ok(pairs.some(pair => pair.item.includes("Car Charger") && pair.url.includes("id=cx131")));
  assert.ok(pairs.some(pair => pair.item.includes("Desktop Stand") && pair.url.includes("id=cx130")));
  assert.ok(pairs.some(pair => pair.item.includes("Galaxy Tab A11") && pair.url.includes("id=cx2")));
  assert.ok(pairs.some(pair => pair.item.includes("iPad") && pair.url.includes("id=cx54")));
  assert.ok(pairs.some(pair => pair.item.includes("Galaxy A07") && pair.url.includes("id=cx57")));
  assert.ok(pairs.some(pair => pair.item.includes("Earpods") && pair.url.includes("id=cx25")));
  assert.ok(pairs.some(pair => pair.item.includes("Anker Charger") && pair.url.includes("id=nptestone&v=0")));
  assert.ok(pairs.some(pair => pair.item.includes("iPhone 17 Pro Max") && pair.url.includes("p=phone&id=17promax") && pair.url.includes("color=Silver")));
  assert.ok(pairs.some(pair => pair.item.includes("Galaxy S26 Ultra") && pair.url.includes("p=phone&id=s26ultra")));
  assert.ok(pairs.some(pair => pair.url.includes("v=0") && pair.item.includes("Samsung Adapter")) && pairs.some(pair => pair.url.includes("id=cx14&v=1")));
  if (added.shared) assert.ok(pairs.some(pair => pair.url.includes("id=" + added.shared.id)));
  assert.match(bubble, /\*CONNECTIFY — NEW ORDER\*\nOrder: C-/);
  assert.match(bubble, /\*CUSTOMER DETAILS\*/);
  assert.match(bubble, /Name: Karim/);
  assert.match(bubble, /Area: Beirut/);
  assert.match(bubble, /Address: Hamra street building 4/);
  assert.match(bubble, /\*ORDER SUMMARY\*/);
  assert.match(bubble, /Subtotal: \$/);
  assert.match(bubble, /Delivery to Beirut, cash on delivery/);
  assert.match(bubble, /Can you confirm the prices and send me real photos\?/);
  assert.equal(bubble.includes("70123456"), false);
  const href = await page.evaluate(() => document.querySelector("#waGo").getAttribute("href"));
  const wa = new URL(href);
  assert.equal(wa.hostname, "wa.me");
  assert.equal(wa.pathname, "/96171062768");
  assert.equal(wa.searchParams.get("text"), bubble);
  assert.equal(orderPosts.length, 1);
  const storeSnapshot = await page.evaluate(() => localStorage.getItem("connectify-demo-v7"));
  assert.match(storeSnapshot, /nptestone/);
  await context.close();

  for (const pair of pairs) {
    const local = pair.url.replace("https://connectifystore.vercel.app", origin);
    const session = await openPage(local.slice(origin.length), {width: 1280, height: 900}, pair.url.includes("id=nptestone") ? async context => {
      await context.addInitScript(snapshot => localStorage.setItem("connectify-demo-v7", snapshot), storeSnapshot);
    } : null);
    try {
      await session.page.waitForFunction(() => {
        const modal = document.querySelector("#pvModal");
        const title = document.querySelector("#pvTitle");
        return window.LIVE && LIVE.ready && modal && modal.classList.contains("on") && title && title.textContent;
      }, null, {timeout: 60000}).catch(error => {
        throw new Error(pair.item + "\n" + pair.url + "\n" + error.message);
      });
      const view = await session.page.evaluate(readProduct);
      const phone = await session.page.evaluate(readPhone);
      const title = view.title || phone.title;
      assert.ok(pair.item.includes(title), title + " not in " + pair.item);
      const params = new URL(pair.url).searchParams;
      if (params.get("p") === "phone") {
        assert.equal(phone.color, params.get("color"));
        assert.equal(phone.st, params.get("st"));
        assert.equal(phone.cond, params.get("cond"));
        assert.equal(phone.sim, params.get("sim"));
      } else if (view.chips.length) {
        for (const chip of view.chips) assert.ok(pair.item.includes(chip), chip + " not in " + pair.item);
      }
    } finally {
      await finish(session);
    }
  }

  const sold = await openPage("/?p=ph&id=cx208&v=0");
  try {
    await waitReady(sold.page, "Tecno Spark 20");
    const view = await sold.page.evaluate(readProduct);
    assert.match(view.ask, /Ask for availability/);
    assert.equal(view.price, "");
  } finally {
    await finish(sold);
  }
});

test("a failed charger checkout keeps the cart and the retry reuses one reference with a link", async () => {
  await boot;
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  let fail = true;
  const codes = [];
  await page.route("**/*supabase.co/**", route => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === "POST" && url.includes("/rest/v1/orders")) {
      const body = JSON.parse(route.request().postData() || "{}");
      codes.push(body.code);
      if (fail) return route.fulfill({status: 400, contentType: "application/json", body: JSON.stringify({code: "23514", message: "check violation"})});
      return route.fulfill({status: 201, contentType: "application/json", body: "[]"});
    }
    return route.abort();
  });
  await page.goto(origin + "/", {waitUntil: "domcontentloaded", timeout: 60000});
  await page.waitForFunction(() => window.LIVE && LIVE.ready && typeof addPH === "function", null, {timeout: 60000});
  await page.evaluate(() => {
    addPH(PHmap.get("cx12"), 0);
    openCart(true);
    document.querySelector("#oName").value = "Karim";
    document.querySelector("#oPhone").value = "70 123 456";
    const area = document.querySelector("#oArea");
    if (![...area.options].some(o => o.value === "Beirut")) area.innerHTML = '<option value="Beirut">Beirut</option>';
    area.value = "Beirut";
    document.querySelector("#oAddr").value = "Hamra street building 4";
  });
  await page.click("#checkout");
  await page.waitForFunction(() => /not saved|couldn't confirm/i.test(document.querySelector("#toast").textContent || ""), null, {timeout: 20000});
  const afterFail = await page.evaluate(() => ({
    open: document.querySelector("#waModal").classList.contains("on"),
    lines: document.querySelectorAll("#items .line").length
  }));
  assert.equal(afterFail.open, false);
  assert.equal(afterFail.lines, 1);
  await page.reload({waitUntil: "domcontentloaded", timeout: 60000});
  await page.waitForFunction(() => {
    const note = document.querySelector("#pendNote");
    return window.LIVE && LIVE.ready && document.querySelectorAll("#items .line").length === 1 && note && !note.hidden && /C-/.test(note.textContent || "");
  }, null, {timeout: 60000});
  fail = false;
  await page.evaluate(() => openCart(true));
  await page.click("#checkout");
  await page.waitForFunction(() => document.querySelector("#waModal").classList.contains("on"), null, {timeout: 20000});
  const bubble = await page.evaluate(() => document.querySelector("#bubble").textContent);
  assert.match(bubble, /\*1\. Apple Adapter 25W\*\nWhite, 25W\nPrice: \$38\nhttps:\/\/connectifystore\.vercel\.app\/\?p=ph&id=cx12&v=0/);
  assert.equal(codes.length, 2);
  assert.equal(codes[0], codes[1]);
  assert.match(codes[0], /^C-[0-9a-f]{18}$/);
  await context.close();
});

async function readAsk(page) {
  return page.evaluate(() => {
    const link = document.querySelector("#pvAsk");
    const add = document.querySelector("#pvAdd");
    if (!link) return {label: "", text: "", product: "", href: "", add: add ? add.textContent : "", cart: cart.length};
    const href = link.getAttribute("href") || "";
    const text = new URL(href).searchParams.get("text") || "";
    const product = (text.split("Product link: ")[1] || "").trim();
    return {label: link.textContent, text, product, href, add: add ? add.textContent : "", cart: cart.length};
  });
}

function assertAsk(ask, product) {
  assert.match(ask.label, /Ask for availability/);
  assert.equal(ask.add, "");
  assert.equal(ask.cart, 0);
  assert.match(ask.href, /^https:\/\/wa\.me\/96171062768\?text=/);
  assert.match(ask.text, /^Hello Connectify! I'd like to ask about availability for: .+\. Could you please confirm availability and price\?\n\nProduct link: https:\/\/connectifystore\.vercel\.app\/\?/);
  assert.equal(ask.text.includes("%0A") || ask.text.includes("%3A") || ask.text.includes("https%3A"), false);
  assert.equal(ask.product, product);
  assert.equal(new URL(ask.product).origin, "https://connectifystore.vercel.app");
  const params = new URL(ask.product).searchParams;
  for (const key of params.keys()) assert.ok(["p", "id", "unit", "color", "st", "cond", "sim", "v"].includes(key), key);
}

test("ask for availability carries the same product link as an order", async () => {
  const phone = "https://connectifystore.vercel.app/?p=phone&id=17promax&color=Silver&st=1024&cond=new&sim=psim";
  const sold = await openPage("/?p=phone&id=17promax&color=Silver&st=1024&cond=new&sim=psim");
  try {
    await waitReady(sold.page, "iPhone 17 Pro Max");
    const ask = await readAsk(sold.page);
    assertAsk(ask, phone);
    assert.match(ask.text, /iPhone 17 Pro Max, Silver, 1TB, New, Nano-SIM \+ eSIM/);
    await sold.page.click('#pvBody [data-k="cond"][data-v="used"]');
    const used = await readAsk(sold.page);
    assertAsk(used, "https://connectifystore.vercel.app/?p=phone&id=17promax&color=Silver&st=1024&cond=used&sim=psim");
    assert.match(used.text, /Silver, 1TB, Used, Nano-SIM \+ eSIM/);
    assertNoOrderWrites(sold);
  } finally {
    await finish(sold);
  }

  const fresh = await openPage(phone.replace("https://connectifystore.vercel.app", ""), {width: 390, height: 844});
  try {
    await waitReady(fresh.page, "iPhone 17 Pro Max");
    const view = await fresh.page.evaluate(readPhone);
    assert.equal(view.color, "Silver");
    assert.equal(view.st, "1024");
    assert.equal(view.cond, "new");
    assert.equal(view.sim, "psim");
    assert.match(view.ask, /Ask for availability/);
    await fresh.page.reload({waitUntil: "domcontentloaded", timeout: 60000});
    await waitReady(fresh.page, "iPhone 17 Pro Max");
    const again = await fresh.page.evaluate(readPhone);
    assert.equal(again.color, "Silver");
    assert.equal(again.st, "1024");
    assert.ok(fresh.page.viewportSize().width <= 390);
    assertNoOrderWrites(fresh);
  } finally {
    await finish(fresh);
  }

  const available = await openPage("/?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim");
  try {
    await waitReady(available.page, "iPhone 17 Pro Max");
    const view = await available.page.evaluate(readPhone);
    assert.match(view.add, /Add to cart/);
    assert.equal(view.ask, "");
    const order = await available.page.evaluate(() => cxOrderMessage({
      id: "C-0123456789abcdef01",
      cart: [{key: "17promax|Silver|256|new|psim", kind: "phone", id: "17promax", unit: "u12", title: "iPhone 17 Pro Max", detail: "256GB, Silver, New, Nano-SIM + eSIM", price: 1542}],
      form: {name: "Karim", area: "Beirut", address: "Hamra street building 4"}
    }, money, WA_SHOW).msg);
    assert.match(order, /\*CONNECTIFY — NEW ORDER\*\nOrder: C-0123456789abcdef01/);
    assert.match(order, /^https:\/\/connectifystore\.vercel\.app\/\?p=phone&id=17promax&unit=u12&color=Silver&st=256&cond=new&sim=psim$/m);
    assert.equal(order.includes("ask about availability"), false);
    assertNoOrderWrites(available);
  } finally {
    await finish(available);
  }

  const blue = await openPage("/?p=phone&id=17promax&color=Deep%20Blue&st=1024&cond=new&sim=psim");
  try {
    await waitReady(blue.page, "iPhone 17 Pro Max");
    const ask = await readAsk(blue.page);
    assertAsk(ask, "https://connectifystore.vercel.app/?p=phone&id=17promax&color=Deep%20Blue&st=1024&cond=new&sim=psim");
    assert.match(ask.text, /Deep Blue, 1TB/);
    assert.equal(ask.text.includes("Deep%20Blue, 1TB"), false);
    assertNoOrderWrites(blue);
  } finally {
    await finish(blue);
  }

  const cases = [
    ["/?p=ph&id=cx2&v=1", "Galaxy Tab A11", "https://connectifystore.vercel.app/?p=ph&id=cx2&v=1", "Silver, 8GB/128GB, New"],
    ["/?p=ph&id=cx66&v=1", "MagSafe Case", "https://connectifystore.vercel.app/?p=ph&id=cx66&v=1", "Galaxy S26 Ultra"]
  ];
  for (const [urlPath, title, product, chip] of cases) {
    const session = await openPage(urlPath);
    try {
      await waitReady(session.page, title);
      const ask = await readAsk(session.page);
      assertAsk(ask, product);
      assert.match(ask.text, new RegExp(chip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assertNoOrderWrites(session);
    } finally {
      await finish(session);
    }
  }

  const charger = await openPage("/");
  try {
    await charger.page.waitForFunction(() => window.LIVE && LIVE.ready === true, null, {timeout: 60000});
    await charger.page.evaluate(() => {
      const splash = document.querySelector("#splash");
      if (splash) splash.remove();
      const item = PHmap.get("cx12");
      item.vars[0].q = 0;
      item.vars[0].ok = false;
      setShopCat("power");
      shop.limit = 200;
      renderGrid();
    });
    await charger.page.click('[data-ph="cx12"]');
    await waitReady(charger.page, "Apple Adapter 25W");
    const ask = await readAsk(charger.page);
    assertAsk(ask, "https://connectifystore.vercel.app/?p=ph&id=cx12&v=0");
    assert.match(ask.text, /Apple Adapter 25W/);
    assert.match(ask.text, /White, 25W/);
    assertNoOrderWrites(charger);
  } finally {
    await finish(charger);
  }

  const accessory = await openPage("/");
  try {
    await accessory.page.waitForFunction(() => window.LIVE && LIVE.ready === true, null, {timeout: 60000});
    await accessory.page.evaluate(() => {
      const splash = document.querySelector("#splash");
      if (splash) splash.remove();
      setShopCat("cases");
      shop.limit = 200;
      renderGrid();
    });
    await accessory.page.click('[data-ph="cx66"]');
    await waitReady(accessory.page, "MagSafe Case");
    await accessory.page.click('#pvBody [data-po][data-v="Galaxy S26 Ultra"]');
    await accessory.page.waitForFunction(() => {
      const link = document.querySelector("#pvAsk");
      return link && new URL(link.href).searchParams.get("text").includes("id=cx66&v=1");
    });
    const ask = await readAsk(accessory.page);
    assertAsk(ask, "https://connectifystore.vercel.app/?p=ph&id=cx66&v=1");
    assert.match(ask.text, /Galaxy S26 Ultra/);
    await accessory.page.evaluate(() => {
      DB.accs = DB.accs || [];
      DB.accs.push({id: "a22", cat: "cover", name: "Disney licensed covers", spec: "Mickey and Friends collection", cond: "new", qty: 0, photos: [], fits: [], note: "Genuine Disney authorization", art: "case", c: "#F3ECDF"});
      openAcc("a22");
    });
    await accessory.page.waitForFunction(() => {
      const heading = document.querySelector("#pvTitle");
      return heading && heading.textContent === "Disney licensed covers" && document.querySelector("#pvAsk");
    });
    const legacy = await readAsk(accessory.page);
    assertAsk(legacy, "https://connectifystore.vercel.app/?p=acc&id=a22");
    assert.match(legacy.text, /Disney licensed covers/);
    assertNoOrderWrites(accessory);
  } finally {
    await finish(accessory);
  }
});
