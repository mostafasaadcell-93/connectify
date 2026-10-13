import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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

test("menu counts include every visible listing and ignore stock", async () => {
  const server = await startServer();
  let browser;
  try {
  const origin = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  const page = await browser.newPage({viewport: {width: 1280, height: 800}});
  const writes = [];
  await page.route("**/*supabase.co/**", route => {
    const method = route.request().method();
    if (method !== "GET" && method !== "HEAD") writes.push(method + " " + route.request().url().split("?")[0]);
    return route.abort();
  });
  await page.goto(origin, {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForSelector("#catbar .cb");

  const readMenus = () => page.evaluate(() => {
    const badge = el => {
      if (!el) return "";
      const s = el.querySelector(":scope > span, span");
      return s ? s.textContent.trim() : "";
    };
    const desktop = [];
    document.querySelectorAll("#catbar [data-gi]").forEach(btn => {
      btn.click();
      document.querySelectorAll("#megaMenu .msec").forEach(sec => {
        const head = sec.querySelector(".mh");
        desktop.push({
          cat: head.dataset.cat,
          n: badge(head),
          label: head.childNodes[0] ? head.childNodes[0].textContent.trim() : head.textContent.trim(),
          subs: [...sec.querySelectorAll(".mm")].map(b => ({sub: b.dataset.sub, n: badge(b), label: b.textContent.trim()}))
        });
      });
    });
    const drawer = document.querySelector("#mDrawer");
    drawer.hidden = true;
    drawer.classList.remove("on");
    document.querySelector("#burgerBtn").click();
    const mobile = [...document.querySelectorAll("#mdBody .mdg")].map(group => {
      const summary = group.querySelector("summary");
      return {
        label: summary ? summary.childNodes[0].textContent.trim() : "",
        n: summary ? badge(summary) : "",
        secs: [...group.querySelectorAll(".mdsec")].map(sec => ({
          cat: sec.dataset.cat,
          n: badge(sec),
          label: sec.textContent.trim(),
          subs: [...sec.parentElement.querySelectorAll(`.mdi[data-cat="${sec.dataset.cat}"]:not(.mdsec)`)].map(b => ({sub: b.dataset.sub, n: badge(b), label: b.textContent.trim()}))
        }))
      };
    });
    const barCounts = [...document.querySelectorAll("#catbar .cb")].filter(b => /\(\d+\)|\d/.test(b.textContent) && b.querySelector("span")).length;
    document.querySelector("#burgerBtn").click();
    return {desktop, mobile, barCounts};
  });

  const expectOf = () => page.evaluate(() => {
    const phone = (cat, sub) => allModels().filter(m => inPhoneCat(m, cat, sub || "all")).length + phoneItems(cat, sub || "all").length;
    const inStockPhone = (cat, sub) => allModels().filter(m => inPhoneCat(m, cat, sub || "all") && status(m).k === "ok").length + phoneItems(cat, sub || "all").filter(x => x.ok).length;
    const goods = (cat, sub) => storeItems().filter(x => x.dept === cat && (!sub || x.sub === sub));
    const rows = [];
    const addPhone = cat => {
      rows.push({cat, sub: "", n: phone(cat), stock: inStockPhone(cat)});
      const subs = cat === "other" ? otherSeries() : cat === "samsung" ? SSERIES : SERIES;
      subs.filter(([v]) => v !== "all").forEach(([v]) => {
        if (allModels().some(m => inPhoneCat(m, cat, v)) || phoneItems(cat, v).length) rows.push({cat, sub: v, n: phone(cat, v), stock: inStockPhone(cat, v)});
      });
    };
    ["apple", "samsung", "other"].forEach(addPhone);
    const depts = ["ipad", ...PH.depts.map(d => d[0])];
    depts.forEach(cat => {
      const all = goods(cat);
      if (!all.length) return;
      rows.push({cat, sub: "", n: all.length, stock: all.filter(x => x.ok).length, variants: all.reduce((t, x) => t + (x.p ? x.p.vars.length : 1), 0)});
      [...new Set(all.map(x => x.sub).filter(s => s && s !== "Phones"))].forEach(sub => {
        const xs = goods(cat, sub);
        rows.push({cat, sub, n: xs.length, stock: xs.filter(x => x.ok).length, variants: xs.reduce((t, x) => t + (x.p ? x.p.vars.length : 1), 0)});
      });
    });
    const hidden = (window.PH_DEFAULT_HIDE || []).map(id => "ph" + id);
    return {
      rows,
      hiddenInStore: storeItems().filter(x => hidden.includes(x.id)).map(x => x.id),
      multi: storeItems().find(x => x.p && x.p.vars.length > 1) || null
    };
  });

  const menus = await readMenus();
  const expected = await expectOf();
  const desk = new Map();
  menus.desktop.forEach(sec => {
    desk.set(sec.cat + "|", sec.n);
    sec.subs.forEach(sub => desk.set(sec.cat + "|" + sub.sub, sub.n));
  });
  const mob = new Map();
  menus.mobile.forEach(group => group.secs.forEach(sec => {
    mob.set(sec.cat + "|", sec.n);
    sec.subs.forEach(sub => mob.set(sec.cat + "|" + sub.sub, sub.n));
  }));

  assert.equal(expected.hiddenInStore.length, 0);
  assert.ok(expected.multi && expected.multi.p.vars.length > 1);
  let sawUnavailable = false;
  let sawMixed = false;
  let sawVariants = false;
  for (const row of expected.rows) {
    const key = row.cat + "|" + row.sub;
    if (row.n === 0) {
      assert.equal(desk.has(key), false, "empty desktop " + key);
      assert.equal(mob.has(key), false, "empty mobile " + key);
      continue;
    }
    assert.equal(desk.has(key), true, "desktop missing " + key);
    assert.equal(mob.has(key), true, "mobile missing " + key);
    assert.equal(desk.get(key), "", "desktop count " + key);
    assert.equal(mob.get(key), "", "mobile count " + key);
    if (row.stock === 0) sawUnavailable = true;
    if (row.stock > 0 && row.n > row.stock) sawMixed = true;
    if (row.variants > row.n) sawVariants = true;
  }
  assert.equal(sawUnavailable, true);
  assert.equal(sawMixed, true);
  assert.equal(sawVariants, true);
  assert.equal(menus.barCounts, 0);
  const bare = text => !/\(\s*\d+\s*\)/.test(text);
  menus.desktop.forEach(sec => {
    assert.equal(bare(sec.label), true, sec.label);
    sec.subs.forEach(sub => assert.equal(bare(sub.label), true, sub.label));
  });
  menus.mobile.forEach(group => {
    assert.equal(group.n, "");
    assert.equal(bare(group.label), true, group.label);
    group.secs.forEach(sec => {
      assert.equal(bare(sec.label), true, sec.label);
      sec.subs.forEach(sub => assert.equal(bare(sub.label), true, sub.label));
    });
  });

  const grid = await page.evaluate(() => {
    const open = (cat, sub) => {menuGo(cat, sub || null); return parseInt($("countLine").textContent, 10);};
    const phone = (cat, sub) => allModels().filter(m => inPhoneCat(m, cat, sub || "all")).length + phoneItems(cat, sub || "all").length;
    const goods = (cat, sub) => storeItems().filter(x => x.dept === cat && (!sub || x.sub === sub)).length;
    const out = [];
    ["apple", "samsung", "other"].forEach(cat => out.push({cat, page: open(cat), n: phone(cat)}));
    const sub = otherSeries().find(([v]) => v !== "all");
    if (sub) out.push({cat: "other", sub: sub[0], page: open("other", sub[0]), n: phone("other", sub[0])});
    ["ipad", ...PH.depts.map(d => d[0])].forEach(cat => {
      if (!goods(cat)) return;
      out.push({cat, page: open(cat), n: goods(cat)});
      const sample = storeItems().find(x => x.dept === cat && x.sub && x.sub !== "Phones");
      if (sample) out.push({cat, sub: sample.sub, page: open(cat, sample.sub), n: goods(cat, sample.sub)});
    });
    return out;
  });
  grid.forEach(row => assert.equal(row.page, row.n, "grid " + row.cat + "/" + (row.sub || "all")));

  const iphone11 = await page.evaluate(() => {
    const ids = ["11", "11pro", "11promax"];
    const models = ids.map(id => allModels().find(m => m.id === id));
    DB.units.forEach(u => { if (ids.includes(u.m)) u.qty = 0; });
    window.menuRefresh();
    const badge = el => el && el.querySelector("span") ? el.querySelector("span").textContent.trim() : "";
    [...document.querySelectorAll("#catbar [data-gi]")].find(b => b.textContent.startsWith("Phones")).click();
    const desk = [...document.querySelectorAll("#megaMenu .mm")].find(b => b.dataset.cat === "apple" && b.dataset.sub === "11");
    const drawer = document.querySelector("#mDrawer");
    drawer.hidden = true;
    drawer.classList.remove("on");
    document.querySelector("#burgerBtn").click();
    const mobile = [...document.querySelectorAll("#mdBody .mdi")].find(b => b.dataset.cat === "apple" && b.dataset.sub === "11" && !b.classList.contains("mdsec"));
    menuGo("apple", "11");
    const listed = models.filter(Boolean).map(m => ({id: m.id, name: m.name, status: status(m).k}));
    const cards = [...document.querySelectorAll("#grid .card")].map(c => c.dataset.id);
    return {
      listed,
      desktop: desk ? desk.textContent.trim() : "",
      desktopBadge: badge(desk),
      mobile: mobile ? mobile.textContent.trim() : "",
      mobileBadge: badge(mobile),
      cards,
      page: parseInt($("countLine").textContent, 10)
    };
  });
  assert.deepEqual(iphone11.listed.map(m => m.id), ["11", "11pro", "11promax"]);
  assert.deepEqual(iphone11.listed.map(m => m.status === "ok"), [false, false, false]);
  assert.equal(iphone11.desktop, "iPhone 11");
  assert.equal(iphone11.mobile, "iPhone 11");
  assert.equal(iphone11.desktopBadge, "");
  assert.equal(iphone11.mobileBadge, "");
  assert.ok(iphone11.cards.includes("11") && iphone11.cards.includes("11pro") && iphone11.cards.includes("11promax"));
  assert.equal(iphone11.page, 3, "iPhone 11 series page");

  const owner = await page.evaluate(() => {
    window.menuRefresh();
    const before = {
      apple: allModels().filter(m => inPhoneCat(m, "apple", "all")).length,
      cases: storeItems().filter(x => x.dept === "cases").length
    };
    const availDept = ["audio", "wear", "power", "holders", "computing", "creator", "car", "home"].find(d => {
      const xs = storeItems().filter(x => x.dept === d);
      const stock = xs.filter(x => x.ok).length;
      return stock > 0 && stock < xs.length;
    });
    const availKeep = storeItems().filter(x => x.dept === availDept && x.ok).length;
    storeItems().filter(x => x.dept === availDept && !x.ok).forEach(x => {
      DB.ph[x.id] = Object.assign({}, DB.ph[x.id], {hide: true});
    });
    const model = allModels().find(m => inPhoneCat(m, "apple", "all") && status(m).k === "ok");
    DB.units.forEach(u => {if (u.m === model.id) u.qty = 0;});
    const afterStock = allModels().filter(m => m.id === model.id && status(m).k === "ok").length;
    const appleAfterStock = allModels().filter(m => inPhoneCat(m, "apple", "all")).length;
    const item = storeItems().find(x => x.dept === "cases" && x.p && x.p.vars.length > 1);
    const vars = item.p.vars.length;
    DB.ph[item.id] = Object.assign({}, DB.ph[item.id], {hide: true});
    const casesAfterHide = storeItems().filter(x => x.dept === "cases").length;
    const hiddenGone = !storeItems().some(x => x.id === item.id);
    (DB.gone = DB.gone || []).push(model.id);
    const appleAfterDelete = allModels().filter(m => inPhoneCat(m, "apple", "all")).length;
    const subItem = storeItems().find(x => x.dept === "gaming");
    const sub = subItem.sub;
    const subIds = PHI.filter(p => p.dept === "gaming" && p.sub === sub && !phHidden(p)).map(p => p.id);
    subIds.forEach(id => {
      const p = PHmap.get(id);
      const o = DB.ph[id] || (DB.ph[id] = {});
      o.v = o.v || {};
      p.vars.forEach((_, i) => {o.v[i] = Object.assign({}, o.v[i], {q: 0, ok: false});});
    });
    const soldOut = storeItems().filter(x => x.dept === "gaming" && x.sub === sub);
    window.menuRefresh();
    [...document.querySelectorAll("#catbar [data-gi]")].find(b => b.textContent.startsWith("Accessories")).click();
    const gaming = [...document.querySelectorAll("#megaMenu .mm")].find(b => b.dataset.cat === "gaming" && b.dataset.sub === sub);
    const drawer = document.querySelector("#mDrawer");
    drawer.hidden = true;
    drawer.classList.remove("on");
    document.querySelector("#burgerBtn").click();
    const gamingMobile = [...document.querySelectorAll("#mdBody .mdi")].find(b => b.dataset.cat === "gaming" && b.dataset.sub === sub && !b.classList.contains("mdsec"));
    const read = el => el ? (el.querySelector("span") ? el.querySelector("span").textContent.trim() : "") : null;
    const availHead = [...document.querySelectorAll("#megaMenu .mh")].find(b => b.dataset.cat === availDept);
    const availMobile = [...document.querySelectorAll("#mdBody .mdsec")].find(b => b.dataset.cat === availDept);
    menuGo(availDept);
    const availPage = parseInt($("countLine").textContent, 10);
    const availLeft = storeItems().filter(x => x.dept === availDept);
    menuGo("gaming", sub);
    return {
      before,
      model: model.id,
      stillListedAfterStock: afterStock === 0 && appleAfterStock === before.apple,
      vars,
      hiddenGone,
      casesDropped: casesAfterHide === before.cases - 1,
      appleDropped: appleAfterDelete === before.apple - 1,
      soldOutCount: soldOut.length,
      soldOutAvailable: soldOut.filter(x => x.ok).length,
      menu: read(gaming),
      mobile: read(gamingMobile),
      page: parseInt($("countLine").textContent, 10),
      availDept,
      availKeep,
      availLeft: availLeft.length,
      availAllInStock: availLeft.every(x => x.ok),
      availMenu: read(availHead),
      availMobile: read(availMobile),
      availPage
    };
  });

  assert.equal(owner.stillListedAfterStock, true);
  assert.ok(owner.vars > 1);
  assert.equal(owner.hiddenGone, true);
  assert.equal(owner.casesDropped, true);
  assert.equal(owner.appleDropped, true);
  assert.ok(owner.soldOutCount > 0);
  assert.equal(owner.soldOutAvailable, 0);
  assert.equal(owner.menu, "");
  assert.equal(owner.mobile, "");
  assert.equal(owner.page, owner.soldOutCount);
  assert.ok(owner.availKeep > 0);
  assert.equal(owner.availLeft, owner.availKeep);
  assert.equal(owner.availAllInStock, true);
  assert.equal(owner.availMenu, "");
  assert.equal(owner.availMobile, "");
  assert.equal(owner.availPage, owner.availKeep);
  const admin = await page.evaluate(() => {
    renderDash();
    renderCatalog();
    const dash = [...document.querySelectorAll("#aStats b")].map(b => b.textContent.trim());
    const catalog = [...document.querySelectorAll("#cStats b")].map(b => b.textContent.trim());
    const tabs = [...document.querySelectorAll("#cTabs .tn")].map(b => b.textContent.trim());
    return {dash, catalog, tabs};
  });
  assert.ok(admin.dash.length >= 4 && admin.dash.every(n => /^\d+$/.test(n)));
  assert.ok(admin.catalog.length >= 5 && admin.catalog.some(n => +n > 0));
  assert.ok(admin.tabs.length > 1 && admin.tabs.every(n => /^\d+$/.test(n)));
  assert.equal(writes.length, 0);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
