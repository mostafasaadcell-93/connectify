import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {
  STAGING_HOST, STAGING_ORIGIN, PRODUCTION_HOST, assertPreviewTarget, assertPreviewEnv, parseEnvFile,
  readProductionClient, renderPreviewPage, createPreviewServer
} from "../market/staging-preview.mjs";

const root = "/workspace";
const storePage = readFileSync(path.join(root, "index.html"));
const previewKey = "sb_publishable_previewtestonly";
const production = readProductionClient(storePage.toString("utf8"));

function jwt(role) {
  const header = Buffer.from(JSON.stringify({alg: "none", typ: "JWT"})).toString("base64url");
  const body = Buffer.from(JSON.stringify({role})).toString("base64url");
  return header + "." + body + ".sig";
}

function render() {
  return renderPreviewPage(storePage.toString("utf8"), {url: STAGING_ORIGIN, key: previewKey}, production);
}

test("the preview accepts only the staging origin and a non-secret key", () => {
  assert.deepEqual(assertPreviewTarget(STAGING_ORIGIN, previewKey, production), {url: STAGING_ORIGIN, host: STAGING_HOST, key: previewKey});
  assert.equal(assertPreviewTarget(" https://akgilfixljswqljmedmg.supabase.co ", jwt("anon"), production).host, STAGING_HOST);
  for (const url of [
    "https://" + PRODUCTION_HOST,
    "https://otherexampleproject.supabase.co",
    "http://" + STAGING_HOST,
    "https://user:pw@" + STAGING_HOST,
    "https://" + STAGING_HOST + "/rest/v1",
    "https://" + STAGING_HOST + ".evil.example",
    "https://evil.example/?next=" + STAGING_HOST
  ]) {
    assert.throws(() => assertPreviewTarget(url, previewKey, production), error => error.code === "STAGING_PREVIEW");
  }
  assert.throws(() => assertPreviewTarget(STAGING_ORIGIN, production.key, production));
  assert.throws(() => assertPreviewTarget(STAGING_ORIGIN, "sb_secret_previewtestonly", production));
  assert.throws(() => assertPreviewTarget(STAGING_ORIGIN, jwt("service_role"), production));
  assert.throws(() => assertPreviewTarget(STAGING_ORIGIN, jwt("supabase_admin"), production));
  assert.throws(() => assertPreviewTarget(STAGING_ORIGIN, "", production));
});

test("env parsing refuses passwords and service-role names without repeating their values", () => {
  const password = "staging-staff-password-value";
  assert.throws(() => assertPreviewEnv(parseEnvFile("STAGING_SUPABASE_URL=" + STAGING_ORIGIN + "\nSTAGING_STAFF_PASSWORD=" + password + "\n"), production), error => {
    assert.equal(error.message.includes(password), false);
    return error.code === "STAGING_PREVIEW";
  });
  assert.throws(() => assertPreviewEnv({
    STAGING_SUPABASE_URL: STAGING_ORIGIN,
    STAGING_SUPABASE_PUBLISHABLE_KEY: previewKey,
    SUPABASE_SERVICE_ROLE_KEY: jwt("service_role")
  }, production), error => {
    assert.equal(error.message.includes("service_role"), false);
    return true;
  });
});

test("the rendered page keeps the production client out and installs a host guard", () => {
  const before = readFileSync(path.join(root, "index.html"));
  const html = render();
  assert.deepEqual(readFileSync(path.join(root, "index.html")), before);
  assert.equal(html.includes(PRODUCTION_HOST), false);
  assert.equal(html.includes(production.key), false);
  assert.equal(html.includes("connectify-auth"), false);
  assert.match(html, /window\.CX_STAGING_PREVIEW=\{host:"akgilfixljswqljmedmg\.supabase\.co",writes:false\}/);
  assert.match(html, /const cxPreviewOrigin=cxPreviewGuard\(/);
  assert.match(html, /supabase\.createClient\(cxPreviewOrigin,/);
  assert.doesNotMatch(html, /supabase\.createClient\("https:/);
  assert.match(html, /if\(window\.CX_STAGING_PREVIEW\)return false/);
  assert.match(html, /cxPreviewReadOnly\(client\)/);
  const source = readFileSync(path.join(root, "market/staging-preview.mjs"), "utf8");
  assert.doesNotMatch(source, /sb_publishable_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]{8,}/);
  assert.equal(source.includes(production.key), false);
});

test("the browser guard throws before a client can be created for any other host", () => {
  const html = render();
  const start = html.indexOf("/*CX_PREVIEW_GUARD_START*/");
  const end = html.indexOf("/*CX_PREVIEW_GUARD_END*/");
  const context = {
    URL, JSON, Promise, Proxy, setTimeout,
    atob: value => Buffer.from(value, "base64").toString("utf8"),
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  assert.equal(context.cxPreviewGuard(STAGING_ORIGIN, previewKey), STAGING_ORIGIN);
  assert.equal(context.cxPreviewGuard(STAGING_ORIGIN, jwt("anon")), STAGING_ORIGIN);
  assert.throws(() => context.cxPreviewGuard("https://" + PRODUCTION_HOST, previewKey), /refused this host/);
  assert.throws(() => context.cxPreviewGuard("https://otherexampleproject.supabase.co", previewKey), /refused this host/);
  assert.throws(() => context.cxPreviewGuard("https://" + STAGING_HOST + "/auth/v1", previewKey), /refused this host/);
  assert.throws(() => context.cxPreviewGuard(STAGING_ORIGIN, jwt("service_role")), /refused this key/);
  assert.throws(() => context.cxPreviewGuard(STAGING_ORIGIN, "sb_secret_previewtestonly"), /refused this key/);
  let created = 0;
  context.supabase = {createClient() { created += 1; return {from() { return {}; }, auth: {}, storage: {from() { return {}; }}}; }};
  assert.throws(() => vm.runInContext('supabase.createClient(cxPreviewGuard("https://' + PRODUCTION_HOST + '", ' + JSON.stringify(previewKey) + '), ' + JSON.stringify(previewKey) + ')', context));
  assert.equal(created, 0);
});

test("market writes return before the database client when the preview flag is set", () => {
  const admin = readFileSync(path.join(root, "market/admin.js"), "utf8");
  const names = ["saveSettings", "saveFacts", "refreshQuotes", "decideSelected", "applyApproved", "restore"];
  for (const name of names) {
    const start = admin.indexOf("async function " + name + "(");
    const next = admin.indexOf("\nasync function ", start + 10);
    const body = admin.slice(start, next);
    assert.ok(body.indexOf("refusePreview(") >= 0 && body.indexOf("refusePreview(") < body.indexOf("LIVE.sb"), name);
  }
  const imported = admin.slice(admin.indexOf("function importCsv("), admin.indexOf("async function loadAudit("));
  assert.ok(imported.indexOf("refusePreview(") < imported.indexOf("parseManualCsv("));
  assert.match(admin, /return !!window\.CX_STAGING_PREVIEW/);
  assert.doesNotMatch(admin, /CX_STAGING_PREVIEW\.writes/);
});

test("the local server binds to loopback and does not serve the env file", async () => {
  const html = render();
  const server = await createPreviewServer({html, root, port: 0, host: "127.0.0.1"});
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const page = await fetch("http://127.0.0.1:" + address.port + "/");
    const body = await page.text();
    assert.equal(body.includes(PRODUCTION_HOST), false);
    assert.equal(body.includes(previewKey), true);
    const hidden = await fetch("http://127.0.0.1:" + address.port + "/market/staging-preview.env");
    assert.equal(hidden.status, 404);
    const script = await fetch("http://127.0.0.1:" + address.port + "/market/admin.js");
    assert.equal(script.status, 200);
    assert.match(await script.text(), /refusePreview/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.throws(() => createPreviewServer({html, host: "0.0.0.0"}));
});

test("starting without an env file exits before listening and does not print a key", async () => {
  const missing = path.join(tmpdir(), "connectify-preview-missing-" + process.pid + ".env");
  const child = spawn(process.execPath, ["market/staging-preview.mjs"], {
    cwd: root,
    env: Object.assign({}, process.env, {STAGING_PREVIEW_ENV: missing, STAGING_PREVIEW_PORT: "0"})
  });
  let out = "";
  child.stdout.on("data", chunk => { out += chunk; });
  child.stderr.on("data", chunk => { out += chunk; });
  const code = await new Promise(resolve => child.on("exit", resolve));
  assert.equal(code, 1);
  assert.match(out, /akgilfixljswqljmedmg\.supabase\.co/);
  assert.doesNotMatch(out, /Staging preview ready/);
  assert.equal(out.includes(previewKey), false);
  assert.equal(out.includes(production.key), false);
});

test("a configured preview process prints the loopback address and not the key", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "connectify-preview-"));
  const envFile = path.join(dir, "preview.env");
  writeFileSync(envFile, "STAGING_SUPABASE_URL=" + STAGING_ORIGIN + "\nSTAGING_SUPABASE_PUBLISHABLE_KEY=" + previewKey + "\n");
  const child = spawn(process.execPath, ["market/staging-preview.mjs"], {
    cwd: root,
    env: Object.assign({}, process.env, {STAGING_PREVIEW_ENV: envFile, STAGING_PREVIEW_PORT: "0"})
  });
  let out = "";
  const ready = new Promise(resolve => {
    const take = chunk => {
      out += chunk;
      if (out.includes("Staging preview ready.")) resolve();
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
  });
  try {
    await ready;
    assert.match(out, /Listen: 127\.0\.0\.1:\d+/);
    assert.match(out, /Writes: off/);
    assert.equal(out.includes(previewKey), false);
    assert.equal(out.includes(production.key), false);
    assert.equal(out.includes(PRODUCTION_HOST), false);
    const port = Number(out.match(/Listen: 127\.0\.0\.1:(\d+)/)[1]);
    const page = await fetch("http://127.0.0.1:" + port + "/");
    assert.equal((await page.text()).includes(PRODUCTION_HOST), false);
  } finally {
    child.kill();
    rmSync(dir, {recursive: true, force: true});
  }
});

test("the preview page blocks price and approval calls and never requests production", async () => {
  const require = createRequire("/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js");
  const {chromium} = require("playwright");
  const html = render();
  const server = await createPreviewServer({html, root, port: 0});
  const port = server.address().port;
  const browser = await chromium.launch({executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]});
  const calls = [];
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    await page.addInitScript(() => sessionStorage.setItem("cx-splash", "1"));
    await page.route("**/*supabase.co/**", route => {
      const req = route.request();
      calls.push(req.method() + " " + req.url());
      return route.fulfill({status: 200, contentType: "application/json", body: "[]"});
    });
    await page.goto("http://127.0.0.1:" + port + "/#admin", {waitUntil: "domcontentloaded"});
    await page.waitForFunction(() => window.CX_STAGING_PREVIEW && window.CX_STAGING_PREVIEW.writes === false && window.LIVE && window.LIVE.sb);
    const blocked = await page.evaluate(async () => {
      window.LIVE.staff = true;
      const saved = await window.CX_STAFF_SAVE();
      const rpc = await window.LIVE.sb.rpc("market_decide", {p_sku: "unit:u-stage-1", p_status: "applied", p_target: 890, p_previous: 900, p_apply_key: "preview", p_proposal: {}, p_mode: "manual"});
      const upsert = await window.LIVE.sb.from("store_state").upsert({key: "units", data: []});
      const invoke = await window.LIVE.sb.functions.invoke("market-check", {body: {queries: []}});
      setAdmin(true);
      go("market");
      const refresh = document.querySelector("#marketRefresh");
      const apply = document.querySelector("#marketApply");
      return {
        saved, rpc: rpc.error && rpc.error.code, upsert: upsert.error && upsert.error.code, invoke: invoke.error && invoke.error.code,
        host: window.CX_STAGING_PREVIEW.host, refresh: !!(refresh && refresh.disabled), apply: !!(apply && apply.disabled),
        banner: document.body.innerText.includes("Staging preview is read-only")
      };
    });
    await new Promise(resolve => setTimeout(resolve, 900));
    assert.equal(blocked.saved, false);
    assert.equal(blocked.rpc, "CX_PREVIEW_READONLY");
    assert.equal(blocked.upsert, "CX_PREVIEW_READONLY");
    assert.equal(blocked.invoke, "CX_PREVIEW_READONLY");
    assert.equal(blocked.host, STAGING_HOST);
    assert.equal(blocked.refresh, true);
    assert.equal(blocked.apply, true);
    assert.equal(blocked.banner, true);
    assert.ok(calls.length > 0);
    for (const call of calls) {
      assert.equal(call.includes(PRODUCTION_HOST), false);
      assert.equal(call.startsWith("GET ") || call.startsWith("HEAD ") || call.startsWith("OPTIONS "), true, call);
      assert.match(call, /akgilfixljswqljmedmg\.supabase\.co/);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
