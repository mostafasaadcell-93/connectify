import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {readFileSync} from "node:fs";
import {PRODUCTION_HOST} from "./hosted-staging-check.mjs";
import {
  BLUE, COMMIT_PROBE, PHONE, PRODUCTION_REF, RECOVERY_TEXT, SILVER, STAGING_HOST, STAGING_ORIGIN, WRITE_OPT_IN,
  assertCommitProbe, assertPhone, assertPublishableKey, assertReadyTarget, readinessConfig, runReadiness
} from "./hosted-migration-readiness.mjs";

const root = "/workspace";
const password = "staging-password-value";
const anon = "sb_publishable_stagingtestkey";
const email = "ready-staff@staging.example";

function jwt(role) {
  const header = Buffer.from(JSON.stringify({alg: "none", typ: "JWT"})).toString("base64url");
  const body = Buffer.from(JSON.stringify({role})).toString("base64url");
  return header + "." + body + ".sig";
}

function env(overrides = {}) {
  return Object.assign({
    STAGING_SUPABASE_URL: STAGING_ORIGIN,
    STAGING_ANON_KEY: anon,
    STAGING_STAFF_EMAIL: email,
    STAGING_STAFF_PASSWORD: password
  }, overrides);
}

function json(status, body) {
  return {status, async text() { return body == null ? "" : JSON.stringify(body); }};
}

function fixture(options = {}) {
  const state = {
    units: JSON.parse(JSON.stringify([SILVER, BLUE])),
    revision: options.revision == null ? 4 : options.revision,
    ph: JSON.parse(JSON.stringify(PHONE)),
    phRevision: 2,
    orders: [
      {code: "C-STAGE-CONF", status: "confirmed", stock_applied: true},
      {code: "C-STAGE-NEW", status: "new", stock_applied: false}
    ],
    settings: [{automation_enabled: options.automation === true, writes_enabled: false}],
    config: [{enabled: options.scheduler === true}],
    decisions: [],
    seq: 0,
    calls: [],
    signInStatus: options.signInStatus || 200,
    staff: options.staff !== false,
    anonStaff: options.anonStaff === true,
    commit: options.commit || "ready",
    revisionColumn: options.revisionColumn !== false,
    commitStores: options.commitStores !== false,
    commitAudits: options.commitAudits !== false,
    staleStatus: options.staleStatus || 409,
    privVisible: options.privVisible === true
  };
  state.trace = [];
  state.fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    const authorization = init && init.headers ? init.headers.authorization || "" : "";
    const staffToken = authorization.endsWith("staff-token");
    state.calls.push(method + " " + parsed.pathname);
    state.trace.push({
      method,
      path: parsed.pathname,
      audience: staffToken ? "staff" : "anonymous",
      key: parsed.searchParams.get("key") || "",
      action: body && body.p_action ? body.p_action : ""
    });
    if (parsed.pathname === "/rest/v1/store_state" && method === "GET") {
      const key = parsed.searchParams.get("key");
      const select = parsed.searchParams.get("select") || "";
      if (select.includes("revision") && !state.revisionColumn) return json(400, {message: "column revision does not exist"});
      if (key === "eq.units") {
        const row = {key: "units"};
        if (select.includes("data")) row.data = JSON.parse(JSON.stringify(state.units));
        if (select.includes("revision")) row.revision = state.revision;
        return json(200, [row]);
      }
      if (key === "eq.ph") {
        const row = {key: "ph", data: JSON.parse(JSON.stringify(state.ph))};
        if (select.includes("revision")) row.revision = state.phRevision;
        return json(200, [row]);
      }
      if (key === "eq.priv") {
        if (staffToken || state.privVisible) return json(200, [{key: "priv"}]);
        return json(200, []);
      }
      if (key === "in.(units,ph)") {
        return json(200, [
          {key: "units", revision: state.revision},
          {key: "ph", revision: state.phRevision}
        ]);
      }
    }
    if (parsed.pathname === "/rest/v1/orders") return json(200, staffToken ? JSON.parse(JSON.stringify(state.orders)) : []);
    if (parsed.pathname === "/rest/v1/market_settings") return json(200, staffToken ? JSON.parse(JSON.stringify(state.settings)) : []);
    if (parsed.pathname === "/rest/v1/market_query_config") return json(200, staffToken ? JSON.parse(JSON.stringify(state.config)) : []);
    if (parsed.pathname === "/rest/v1/") {
      return json(403, {message: "Invalid API key. Only the service_role API key can be used for this endpoint."});
    }
    if (parsed.pathname === "/auth/v1/token") {
      if (state.signInStatus !== 200) return json(state.signInStatus, {error_description: body && body.password});
      return json(200, {access_token: "staff-token"});
    }
    if (parsed.pathname === "/rest/v1/rpc/is_staff") {
      if (!staffToken) return json(state.anonStaff ? 200 : 401, state.anonStaff ? true : {message: "not staff"});
      return json(200, state.staff === true);
    }
    if (parsed.pathname === "/rest/v1/market_decisions") {
      if (!staffToken) return json(200, []);
      const rows = state.decisions.slice().sort((a, b) => b.created_at - a.created_at);
      return json(200, rows);
    }
    if (!staffToken && (parsed.pathname === "/rest/v1/rpc/market_decide" || parsed.pathname === "/rest/v1/rpc/market_commit_price" || method === "PATCH")) {
      return json(401, {message: "permission denied"});
    }
    if (parsed.pathname === "/rest/v1/rpc/market_decide") {
      const id = nextId(state);
      state.decisions.push({
        id, sku: body.p_sku, status: body.p_status, target_price: body.p_target,
        previous_price: body.p_previous, apply_key: body.p_apply_key, created_at: state.seq
      });
      return json(200, id);
    }
    if (parsed.pathname === "/rest/v1/rpc/market_commit_price") {
      if (!staffToken || state.commit === "forbidden") {
        return json(401, {code: "42501", message: "permission denied for function market_commit_price"});
      }
      if (body && body.p_action === "probe") {
        if (state.commit === "missing") {
          return json(404, {code: "PGRST202", message: "Could not find the function public.market_commit_price in the schema cache"});
        }
        if (state.commit === "unexpected") return json(200, "00000000-0000-4000-8000-000000000099");
        if (state.commit === "stale") return json(400, {code: "P0001", message: "stale price"});
        if (state.commit === "docs") {
          return json(403, {message: "Invalid API key. Only the service_role API key can be used for this endpoint."});
        }
        return json(400, {code: "P0001", message: "manual only", details: null, hint: null});
      }
      if (state.commit === "missing") {
        return json(404, {code: "PGRST202", message: "Could not find the function public.market_commit_price in the schema cache"});
      }
      if (!state.commitStores) return json(200, nextId(state));
      if (body.p_action === "apply") {
        const existing = state.decisions.find(row => row.status === "applied" && row.apply_key === body.p_apply_key);
        if (existing) return json(200, existing.id);
        state.units.find(item => item.id === "u-stage-1").p = body.p_target;
        state.revision += 1;
        if (!state.commitAudits) return json(200, nextId(state));
        const id = nextId(state);
        state.decisions.push({
          id, sku: body.p_sku, status: "applied", target_price: body.p_target,
          previous_price: body.p_previous, apply_key: body.p_apply_key, created_at: state.seq
        });
        return json(200, id);
      }
      const existingRestore = state.decisions.slice().reverse().find(row => row.status === "restored" && Number(row.target_price) === 900);
      if (state.units.find(item => item.id === "u-stage-1").p === 900 && existingRestore) return json(200, existingRestore.id);
      state.units.find(item => item.id === "u-stage-1").p = body.p_target;
      state.revision += 1;
      if (!state.commitAudits) return json(200, nextId(state));
      const id = nextId(state);
      state.decisions.push({
        id, sku: body.p_sku, status: "restored", target_price: body.p_target,
        previous_price: body.p_previous, apply_key: null, created_at: state.seq
      });
      return json(200, id);
    }
    if (parsed.pathname === "/rest/v1/store_state" && method === "PATCH") {
      if (state.staleStatus >= 400) return json(state.staleStatus, {message: "stale store save"});
      return json(200, [{key: "units", data: state.units, revision: state.revision}]);
    }
    return json(500, {message: "unexpected " + method + " " + parsed.pathname});
  };
  return state;
}

function nextId(state) {
  state.seq += 1;
  return "00000000-0000-4000-8000-" + String(state.seq).padStart(12, "0");
}

function wrote(state) {
  return state.trace.some(call => {
    if (call.method === "PATCH") return true;
    if (call.path === "/rest/v1/rpc/market_decide") return true;
    return call.path === "/rest/v1/rpc/market_commit_price" && call.action !== "probe";
  });
}

const STAFF_ONLY = new Set([
  "/rest/v1/orders",
  "/rest/v1/market_settings",
  "/rest/v1/market_query_config",
  "/rest/v1/market_decisions",
  "/rest/v1/rpc/market_commit_price",
  "/rest/v1/rpc/market_decide"
]);

function assertStaffReadsAfterAuthentication(trace) {
  const signIn = trace.findIndex(call => call.method === "POST" && call.path === "/auth/v1/token");
  const probe = trace.findIndex(call => call.method === "POST" && call.path === "/rest/v1/rpc/is_staff" && call.audience === "staff");
  assert.equal(signIn >= 0, true);
  assert.equal(probe > signIn, true);
  trace.forEach((call, index) => {
    if (!STAFF_ONLY.has(call.path)) return;
    assert.equal(call.audience, "staff", call.method + " " + call.path);
    assert.equal(index > probe, true, call.path);
  });
  const anonymousStaff = trace.filter(call => call.path === "/rest/v1/rpc/is_staff" && call.audience === "anonymous");
  const privateReads = trace.filter(call => call.path === "/rest/v1/store_state" && call.key === "eq.priv");
  assert.equal(anonymousStaff.length >= 1, true);
  assert.equal(privateReads.length >= 1, true);
  assert.equal(anonymousStaff.every(call => call.audience === "anonymous"), true);
  assert.equal(privateReads.every(call => call.audience === "anonymous"), true);
  assert.equal(trace.some((call, index) => index > probe && call.audience === "anonymous" && call.path === "/rest/v1/rpc/is_staff"), true);
}

test("synthetic phone matches the object-shaped seed variant", () => {
  assert.deepEqual(PHONE, {"stage-ph": {v: {"0": {p: 25, q: 4}}}});
  assert.doesNotThrow(() => assertPhone(JSON.parse(JSON.stringify(PHONE))));
  const rejected = [
    {"stage-ph": {v: [{p: 25, q: 4}]}},
    {"stage-ph": {v: {"0": {p: 26, q: 4}}}},
    {"stage-ph": {v: {"0": {p: 25, q: 3}}}},
    {"stage-ph": {v: {"0": {p: "25", q: "4"}}}},
    {"stage-ph": {v: {}}},
    {"stage-ph": {v: {"1": {p: 25, q: 4}}}},
    {"stage-ph": {v: {"0": {p: 25, q: 4}, "1": {p: 1, q: 1}}}},
    {"stage-ph": {v: {"0": {p: 25, q: 4, note: "extra"}}}},
    {"stage-ph": {name: "phone", v: {"0": {p: 25, q: 4}}}},
    {"other-ph": {v: {"0": {p: 25, q: 4}}}},
    {"stage-ph": {v: {"0": {p: 25, q: 4}}}, extra: {}},
    null,
    [{"p": 25, "q": 4}]
  ];
  for (const item of rejected) {
    assert.throws(() => assertPhone(item), /synthetic phone fixture is missing/);
  }
});

test("an unexpected phone shape stops the read-only preflight before staff sign-in", async () => {
  const server = fixture();
  server.ph = {"stage-ph": {v: [{p: 25, q: 4}]}};
  await assert.rejects(() => runReadiness({env: env(), fetchImpl: server.fetchImpl}), /pass synthetic fixtures; fail synthetic phone: synthetic phone fixture is missing; pass anonymous private costs; pass anonymous staff permission/);
  assert.equal(server.calls.some(call => call.includes("/auth/v1/token")), false);
  assert.equal(server.trace.some(call => STAFF_ONLY.has(call.path)), false);
  assert.equal(wrote(server), false);

  const priced = fixture();
  priced.ph["stage-ph"].v["0"].p = 26;
  await assert.rejects(() => runReadiness({env: env(), fetchImpl: priced.fetchImpl}), /fail synthetic phone/);
  assert.equal(priced.calls.some(call => call.includes("/auth/v1/token")), false);
});

test("bad hosts, keys, and write flags are refused before network activity", async () => {
  const cases = [
    env({STAGING_SUPABASE_URL: "https://" + PRODUCTION_HOST}),
    env({STAGING_SUPABASE_URL: "https://" + PRODUCTION_REF + ".supabase.co/rest/v1/"}),
    env({STAGING_SUPABASE_URL: "https://otherproject.supabase.co"}),
    env({STAGING_SUPABASE_URL: "http://" + STAGING_HOST}),
    env({STAGING_ANON_KEY: jwt("service_role")}),
    env({STAGING_ANON_KEY: "sb_secret_staging"}),
    env({STAGING_STAFF_EMAIL: "owner@example.com"}),
    env({STAGING_STAFF_PASSWORD: ""}),
    env({STAGING_SYNTHETIC_WRITE_CHECK: "yes"})
  ];
  for (const item of cases) {
    let calls = 0;
    await assert.rejects(() => runReadiness({
      env: item,
      fetchImpl() { calls += 1; throw new Error("network"); }
    }));
    assert.equal(calls, 0);
  }
  assert.equal(assertReadyTarget(STAGING_ORIGIN), STAGING_ORIGIN);
  assert.equal(assertPublishableKey(anon), anon);
  assert.equal(readinessConfig(env()).write, false);
  assert.equal(readinessConfig(env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN})).write, true);
  assert.doesNotThrow(() => assertCommitProbe({status: 400, body: {code: "P0001", message: "manual only"}}));
  const rejected = [
    [{status: 404, body: {code: "PGRST202", message: "Could not find the function public.market_commit_price in the schema cache"}}, /not installed/],
    [{status: 401, body: {code: "42501", message: "permission denied for function market_commit_price"}}, /not executable/],
    [{status: 403, body: {code: "42501", message: "permission denied for function market_commit_price"}}, /not executable/],
    [{status: 403, body: {message: "Invalid API key. Only the service_role API key can be used for this endpoint."}}, /not executable/],
    [{status: 403, body: {code: "P0001", message: "manual only"}}, /not executable/],
    [{status: 200, body: "00000000-0000-4000-8000-000000000099"}, /changed data/],
    [{status: 400, body: {code: "P0001", message: "stale price"}}, /not the pre-lock rejection/],
    [{status: 400, body: {code: "P0001", message: "already applied"}}, /not the pre-lock rejection/],
    [{status: 400, body: {message: "manual only"}}, /not the pre-lock rejection/],
    [{status: 200, body: {paths: {"/rpc/market_commit_price": {post: {}}}}}, /not the pre-lock rejection/],
    [{status: 500, body: null}, /not the pre-lock rejection/]
  ];
  for (const [result, pattern] of rejected) assert.throws(() => assertCommitProbe(result), pattern);
});

test("authorization failures are rejected before a price write", async () => {
  for (const options of [{signInStatus: 401}, {staff: false}, {anonStaff: true}]) {
    const server = fixture(options);
    await assert.rejects(() => runReadiness({env: env(), fetchImpl: server.fetchImpl}));
    assert.equal(wrote(server), false);
    assert.equal(server.calls.some(call => call.includes("market_commit_price")), false);
    assert.equal(server.trace.some(call => STAFF_ONLY.has(call.path)), false);
  }
  const server = fixture({signInStatus: 401});
  await assert.rejects(() => runReadiness({env: env(), fetchImpl: server.fetchImpl}), error => {
    assert.equal(String(error.message).includes(password), false);
    assert.match(error.message, /staff sign-in was rejected/);
    return true;
  });
});

test("staff authentication happens before every staff-only read", async () => {
  const ready = fixture();
  const result = await runReadiness({env: env(), fetchImpl: ready.fetchImpl});
  assert.equal(result.writes, false);
  assertStaffReadsAfterAuthentication(ready.trace);

  const missing = fixture({revisionColumn: false, commit: "missing"});
  await assert.rejects(() => runReadiness({
    env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
    fetchImpl: missing.fetchImpl
  }), /expected blocker before migrations 10 and 11 are installed[\s\S]*pass synthetic fixtures[\s\S]*pass staff permission[\s\S]*pass synthetic orders[\s\S]*pass disabled automation[\s\S]*fail revisions[\s\S]*fail migration compatibility[\s\S]*pass anonymous session stays anonymous/);
  assert.equal(wrote(missing), false);
  assertStaffReadsAfterAuthentication(missing.trace);
  assert.equal(missing.units.find(item => item.id === "u-stage-1").p, 900);
});

test("read-only preflight passes without a write and reports a missing migration", async () => {
  const ready = fixture();
  const result = await runReadiness({env: env(), fetchImpl: ready.fetchImpl});
  assert.equal(result.ok, true);
  assert.equal(result.writes, false);
  assert.equal(result.mode, "read-only");
  assert.equal(JSON.stringify(result).includes(password), false);
  assert.equal(JSON.stringify(result).includes(anon), false);
  assert.equal(wrote(ready), false);
  assert.equal(ready.units.find(item => item.id === "u-stage-1").p, 900);

  const missing = fixture({revisionColumn: false, commit: "missing"});
  await assert.rejects(() => runReadiness({env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}), fetchImpl: missing.fetchImpl}), /expected blocker before migrations 10 and 11 are installed[\s\S]*pass synthetic orders[\s\S]*fail migration compatibility/);
  assert.equal(wrote(missing), false);
  assert.equal(missing.units.find(item => item.id === "u-stage-1").p, 900);
});

test("a failed or unstored write cannot be reported as successful", async () => {
  const unstored = fixture({commitStores: false});
  await assert.rejects(() => runReadiness({
    env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
    fetchImpl: unstored.fetchImpl
  }), /was not stored[\s\S]*is not proof/);
  assert.equal(unstored.units.find(item => item.id === "u-stage-1").p, 900);
  assert.equal(unstored.revision, 4);

  const diverged = fixture({commitAudits: false});
  await assert.rejects(() => runReadiness({
    env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
    fetchImpl: diverged.fetchImpl
  }), /diverged/);
  assert.equal(diverged.units.find(item => item.id === "u-stage-1").p, 890);
  assert.equal(diverged.decisions.some(row => row.status === "applied"), false);

  const dirty = fixture();
  dirty.units.find(item => item.id === "u-stage-1").p = 890;
  await assert.rejects(() => runReadiness({
    env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
    fetchImpl: dirty.fetchImpl
  }), /synthetic inventory is not the expected fixture/);
  assert.equal(wrote(dirty), false);
});

test("opt-in write checks verify apply, retry, stale rejection, and restore from stored rows", async () => {
  const server = fixture();
  const result = await runReadiness({
    env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
    fetchImpl: server.fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.writes, true);
  assert.equal(result.outcome.applyVerifiedByRead, true);
  assert.equal(result.outcome.restoreVerifiedByRead, true);
  assert.equal(result.outcome.idempotentRetryVerified, true);
  assert.equal(result.outcome.staleSaveRejected, true);
  assert.equal(server.units.find(item => item.id === "u-stage-1").p, 900);
  assert.equal(server.units.find(item => item.id === "u-stage-1").qty, 2);
  assert.equal(server.units.find(item => item.id === "u-stage-2").p, 910);
  assert.equal(server.revision, 6);
  assert.equal(server.decisions.filter(row => row.status === "applied").length, 1);
  assert.equal(server.decisions.filter(row => row.status === "restored").length, 1);
  assert.equal(server.orders[0].status, "confirmed");
  assert.equal(server.calls.some(call => call.startsWith("DELETE")), false);
  const commits = server.trace.filter(call => call.path === "/rest/v1/rpc/market_commit_price");
  assert.equal(commits.filter(call => call.action === "probe").length, 1);
  assert.equal(commits.filter(call => call.action === "apply" || call.action === "restore").length, 4);

  const accepted = fixture({staleStatus: 200});
  await assert.rejects(() => runReadiness({
    env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
    fetchImpl: accepted.fetchImpl
  }), /stale save was not rejected/);
  assert.equal(accepted.units.find(item => item.id === "u-stage-1").p, 900);
  assert.match(RECOVERY_TEXT, /Do not DELETE from market_decisions/);
  assert.match(RECOVERY_TEXT, /Do not rerun the synthetic seed/);
  assert.match(RECOVERY_TEXT, /market_commit_price/);
});

test("previous hosted scripts refuse to run directly", async () => {
  for (const file of ["test/hosted-staging-check.mjs", "test/hosted-market-race-check.mjs"]) {
    const child = spawn(process.execPath, [file], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        STAGING_SUPABASE_URL: STAGING_ORIGIN,
        STAGING_ANON_KEY: anon,
        STAGING_STAFF_EMAIL: email,
        STAGING_STAFF_PASSWORD: password,
        STAGING_VIEWER_EMAIL: "viewer@staging.example",
        STAGING_VIEWER_PASSWORD: password
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /refusing to run/);
    assert.match(stderr, /made no hosted request/);
    assert.equal(stderr.includes(password), false);
    assert.equal(stderr.includes(anon), false);
  }
  const source = readFileSync(root + "/test/hosted-market-race-check.mjs", "utf8");
  const main = source.slice(source.indexOf("async function main()"), source.indexOf("const entry"));
  assert.equal(main.includes("runHostedRace"), false);
  const hosted = readFileSync(root + "/test/hosted-staging-check.mjs", "utf8");
  const hostedMain = hosted.slice(hosted.indexOf("export async function main()"), hosted.indexOf("export async function main()") + 280);
  assert.match(hostedMain, /throw new Error\("refusing to run/);
  assert.equal(hostedMain.includes("fetch("), false);
});

test("the readiness CLI refuses production before a request", async () => {
  const child = spawn(process.execPath, ["test/hosted-migration-readiness.mjs"], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      STAGING_SUPABASE_URL: "https://" + PRODUCTION_HOST,
      STAGING_ANON_KEY: anon,
      STAGING_STAFF_EMAIL: email,
      STAGING_STAFF_PASSWORD: password
    }
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.match(stderr, /refusing production/);
  assert.equal(stderr.includes(password), false);
  const readiness = readFileSync(root + "/test/hosted-migration-readiness.mjs", "utf8");
  assert.equal(readiness.includes("\"DELETE\""), false);
  assert.equal(readiness.includes("STAGING_SERVICE_ROLE"), false);
  assert.equal(readiness.includes("application/openapi+json"), false);
  assert.equal(readiness.includes("market_observations"), false);
});

test("a documentation 403 does not prove or replace the price-function probe", async () => {
  const ready = fixture();
  const result = await runReadiness({env: env(), fetchImpl: ready.fetchImpl});
  assert.equal(result.ok, true);
  assert.equal(result.writes, false);
  assert.equal(ready.calls.includes("GET /rest/v1/"), false);
  const probe = ready.trace.filter(call => call.action === "probe");
  assert.equal(probe.length, 1);
  assert.equal(probe[0].audience, "staff");
  assert.equal(probe[0].path, "/rest/v1/rpc/market_commit_price");
  assert.deepEqual(COMMIT_PROBE, {
    p_sku: null, p_action: "probe", p_target: null, p_previous: null,
    p_apply_key: null, p_identity: null, p_proposal: null
  });
  assert.equal(ready.units.find(item => item.id === "u-stage-1").p, 900);
  assert.equal(wrote(ready), false);

  for (const commit of ["missing", "forbidden", "unexpected", "stale", "docs"]) {
    const server = fixture({commit});
    await assert.rejects(() => runReadiness({
      env: env({STAGING_SYNTHETIC_WRITE_CHECK: WRITE_OPT_IN}),
      fetchImpl: server.fetchImpl
    }));
    assert.equal(wrote(server), false);
    assert.equal(server.units.find(item => item.id === "u-stage-1").p, 900);
    assert.equal(server.decisions.length, 0);
    assert.equal(server.calls.includes("GET /rest/v1/"), false);
  }

  const absent = fixture({commit: "missing"});
  await assert.rejects(() => runReadiness({env: env(), fetchImpl: absent.fetchImpl}), /expected blocker before migrations 10 and 11 are installed[\s\S]*fail migration compatibility: market_commit_price is not installed/);
  const denied = fixture({commit: "forbidden"});
  await assert.rejects(() => runReadiness({env: env(), fetchImpl: denied.fetchImpl}), error => {
    assert.match(error.message, /market_commit_price is not executable by staging staff/);
    assert.equal(error.message.includes("expected blocker"), false);
    return true;
  });
  const stale = fixture({commit: "stale"});
  await assert.rejects(() => runReadiness({env: env(), fetchImpl: stale.fetchImpl}), error => {
    assert.match(error.message, /probe was not the pre-lock rejection/);
    assert.equal(error.message.includes("expected blocker"), false);
    return true;
  });
});
