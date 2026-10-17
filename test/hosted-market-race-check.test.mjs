import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {once} from "node:events";
import {PRODUCTION_HOST} from "./hosted-staging-check.mjs";
import {
  STAGING_HOST, FIRST_TARGET, SECOND_TARGET, CONCURRENCY_NOTE,
  assertRaceTarget, assertAnonKey, assertStaffEmail, assertAllowedRequest, skuForRun, createRunId,
  exactCount, assertExpectedUnits, assertSyntheticOrders, assertFlagsOff, assertHttpPair,
  assertOneConsumption, assertFinalRows, assertRejected, describeOverlap, fingerprint, sellingPrices,
  redact, runHostedRace
} from "./hosted-market-race-check.mjs";

const root = "/workspace";
const password = "staging-password-value";
const anon = "sb_publishable_stagingtestkey";
const email = "race-staff@staging.example";
const runId = "hosted-race-testrun01";

function jwt(role) {
  const header = Buffer.from(JSON.stringify({alg: "none", typ: "JWT"})).toString("base64url");
  const body = Buffer.from(JSON.stringify({role})).toString("base64url");
  return header + "." + body + ".sig";
}

function baseEnv(url = "https://" + STAGING_HOST) {
  return {
    STAGING_SUPABASE_URL: url,
    STAGING_ANON_KEY: anon,
    STAGING_STAFF_EMAIL: email,
    STAGING_STAFF_PASSWORD: password
  };
}

test("the race target accepts only the hosted staging origin", () => {
  assert.equal(assertRaceTarget("https://akgilfixljswqljmedmg.supabase.co"), STAGING_HOST);
  assert.equal(assertRaceTarget(" https://akgilfixljswqljmedmg.supabase.co/ "), STAGING_HOST);
  for (const url of [
    "https://" + PRODUCTION_HOST,
    "https://YXKZJWCMMTILJAKTTYFH.supabase.co",
    "https://otherexampleproject.supabase.co",
    "http://" + STAGING_HOST,
    "https://user:supersecret@" + STAGING_HOST,
    "https://" + STAGING_HOST + "/rest/v1",
    "https://" + STAGING_HOST + "?next=1",
    "https://" + STAGING_HOST + "#fragment",
    "https://" + STAGING_HOST + ":8443",
    "https://" + STAGING_HOST + ".evil.example",
    "https://evil.example/?next=" + STAGING_HOST,
    "not a url"
  ]) {
    assert.throws(() => assertRaceTarget(url), error => !String(error.message).includes("supersecret"));
  }
});

test("the anon key guard rejects secrets without repeating them", () => {
  assert.equal(assertAnonKey(anon), anon);
  assert.equal(assertAnonKey(" " + jwt("anon") + " "), jwt("anon"));
  assert.throws(() => assertAnonKey(""), /missing staging anon key/);
  for (const key of ["sb_secret_stagingtestkey", "SB_SECRET_stagingtestkey", jwt("service_role"), jwt("supabase_admin"), jwt("authenticated"), "sb_publishable_yxkzjwcmmtiljakttyfh"]) {
    assert.throws(() => assertAnonKey(key), error => !error.message.includes(key) && !error.message.includes("service_role"));
  }
  assert.throws(() => assertStaffEmail("owner@example.com"), /staging/);
  assert.equal(assertStaffEmail(" Staff@Staging.example "), "Staff@Staging.example");
});

test("request and sku guards stay on the fake sku and the staging host", () => {
  assert.equal(skuForRun(runId), "unit:" + runId);
  assert.equal(skuForRun(createRunId()).startsWith("unit:hosted-race-"), true);
  assert.throws(() => skuForRun("u-stage-1"));
  assert.throws(() => skuForRun("../unit"));
  assert.doesNotThrow(() => assertAllowedRequest("https://" + STAGING_HOST + "/rest/v1/rpc/market_decide", "POST"));
  assert.throws(() => assertAllowedRequest("https://" + STAGING_HOST + "/rest/v1/store_state", "POST"));
  assert.throws(() => assertAllowedRequest("https://" + STAGING_HOST + "/rest/v1/orders?code=eq.C-STAGE-CONF", "PATCH"));
  assert.throws(() => assertAllowedRequest("https://" + PRODUCTION_HOST + "/rest/v1/rpc/market_decide", "POST"));
});

test("pure assertions accept one consumption and reject a second applied row", () => {
  const sku = "unit:" + runId;
  const rows = [
    {id: "00000000-0000-4000-8000-000000000001", sku, status: "approved", target_price: "890.00", apply_key: null},
    {id: "00000000-0000-4000-8000-000000000002", sku, status: "applied", target_price: 890, apply_key: "race-a-" + runId}
  ];
  const pair = assertHttpPair([
    {status: 200, body: rows[1].id},
    {status: 400, body: {message: "not approved: approval already used"}}
  ]);
  assert.equal(pair.id, rows[1].id);
  const recorded = assertOneConsumption(rows, sku, FIRST_TARGET, ["race-a-" + runId, "race-b-" + runId]);
  assert.equal(recorded.winner, "race-a-" + runId);
  assert.equal(recorded.loser, "race-b-" + runId);
  assert.throws(() => assertHttpPair([{status: 200, body: rows[1].id}, {status: 200, body: rows[1].id}]));
  assert.throws(() => assertOneConsumption(rows.concat([{id: "00000000-0000-4000-8000-000000000003", sku, status: "applied", target_price: 890, apply_key: "race-b-" + runId}]), sku, FIRST_TARGET, ["race-a-" + runId, "race-b-" + runId]));
  assertFinalRows(rows.concat([
    {id: "00000000-0000-4000-8000-000000000004", sku, status: "approved", target_price: SECOND_TARGET, apply_key: null},
    {id: "00000000-0000-4000-8000-000000000005", sku, status: "applied", target_price: SECOND_TARGET, apply_key: "race-c-" + runId}
  ]), sku, "race-a-" + runId, "race-c-" + runId);
  assert.equal(assertRejected({status: 400, body: {message: "already applied"}}, /already applied/), "already applied");
  assert.throws(() => assertRejected({status: 200, body: "00000000-0000-4000-8000-000000000099"}, /not approved/));
  assert.equal(exactCount(206, "0-0/4"), 4);
  assert.equal(exactCount(200, "*/0"), 0);
  assert.throws(() => exactCount(401, "*/0"), error => error.code === "RLS_BLOCKED");
  const units = [
    {id: "u-stage-1", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900, note: "staging-synthetic"},
    {id: "u-stage-2", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, note: "staging-synthetic"}
  ];
  assertExpectedUnits(units);
  assert.throws(() => assertExpectedUnits(units.map(item => item.id === "u-stage-1" ? {...item, p: 901} : item)));
  assertSyntheticOrders([
    {code: "C-STAGE-CONF", status: "confirmed", stock_applied: true},
    {code: "C-STAGE-NEW", status: "new", stock_applied: false}
  ]);
  assertFlagsOff([{automation_enabled: false, writes_enabled: false}], [{enabled: false}]);
  assert.throws(() => assertFlagsOff([{automation_enabled: false, writes_enabled: true}], [{enabled: false}]));
  const overlap = describeOverlap([
    {label: "a", started: 10, finished: 12, status: 200, outcome: "accepted"},
    {label: "b", started: 15, finished: 18, status: 400, outcome: "consumed"}
  ], 8);
  assert.equal(overlap.httpCallsOverlapped, false);
  assert.equal(overlap.databaseRaceProven, false);
  assert.equal(overlap.note, CONCURRENCY_NOTE);
  assert.notEqual(fingerprint(units), fingerprint(units.map(item => item.id === "u-stage-1" ? {...item, p: 901} : item)));
  assert.equal(fingerprint(sellingPrices(units)), fingerprint([{id: "u-stage-1", p: 900, qty: 2}, {id: "u-stage-2", p: 910, qty: 1}]));
  assert.equal(redact("token " + password + " end", [password]).includes(password), false);
});

function fixture(mode = {}) {
  const units = [
    {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: mode.price || 900, bat: 0, note: "staging-synthetic"},
    {id: "u-stage-2", m: "17promax", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, bat: 0, note: "staging-synthetic"}
  ];
  const orders = [
    {code: "C-STAGE-CONF", status: "confirmed", stock_applied: true, items: [{id: "u-stage-1", p: 900, qty: 1}]},
    {code: "C-STAGE-NEW", status: "new", stock_applied: false, items: [{id: "u-stage-2", p: 910, qty: 1}]}
  ];
  const preserved = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sku: "unit:u-stage-1",
    status: "approved",
    target_price: 890,
    previous_price: 900,
    apply_key: null,
    created_at: "2020-01-01T00:00:00.000Z"
  };
  const decisions = [preserved];
  let tick = 0;
  let serial = 0;
  let signIns = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const waiting = [];
  let raceClosed = false;
  const calls = [];

  function nextId() {
    serial += 1;
    return "00000000-0000-4000-8000-" + String(serial).padStart(12, "0");
  }
  function nowIso() {
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick)).toISOString();
  }
  function jsonResponse(status, body, headers = {}) {
    return {
      status,
      async text() { return body == null ? "" : JSON.stringify(body); },
      headers: {get(name) { return headers[String(name).toLowerCase()] || null; }}
    };
  }
  function skuOf(value, op) {
    const prefix = op + ".";
    if (!value || !value.startsWith(prefix)) throw new Error("bad sku filter");
    return value.slice(prefix.length);
  }
  function insert(args) {
    const id = nextId();
    decisions.push({
      id,
      sku: args.p_sku,
      status: args.p_status,
      target_price: args.p_target,
      previous_price: args.p_previous,
      apply_key: args.p_status === "applied" ? args.p_apply_key : null,
      created_at: nowIso()
    });
    return id;
  }
  function commit(args) {
    if (args.p_status === "approved") return {status: 200, body: insert(args)};
    if (args.p_status !== "applied") return {status: 400, body: {message: "bad status"}};
    if (!(args.p_target > 0) || !args.p_apply_key || String(args.p_apply_key).length < 3) {
      return {status: 400, body: {message: "missing apply key"}};
    }
    if (decisions.some(row => row.status === "applied" && row.apply_key === args.p_apply_key)) {
      return {status: 400, body: {message: "already applied"}};
    }
    const latest = decisions.filter(row => row.sku === args.p_sku && (row.status === "approved" || row.status === "rejected")).at(-1);
    if (!latest || latest.status !== "approved" || Number(latest.target_price) !== Number(args.p_target)) {
      return {status: 400, body: {message: "not approved"}};
    }
    const used = decisions.some(row => row.sku === args.p_sku && (row.status === "applied" || row.status === "restored") && row.id !== latest.id && row.created_at >= latest.created_at);
    if (used) return {status: 400, body: {message: "not approved: approval already used"}};
    return {status: 200, body: insert(args)};
  }
  async function fetchImpl(url, options) {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    const who = options.headers.authorization === "Bearer staff-session-a" ? "a" : options.headers.authorization === "Bearer staff-session-b" ? "b" : "anon";
    calls.push({method: options.method, path: parsed.pathname, who, status: body && body.p_status, key: body && body.p_apply_key, sku: body && body.p_sku, mode: body && body.p_mode});
    if (parsed.hostname !== STAGING_HOST) throw new Error("fake server refused " + parsed.hostname);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (parsed.pathname === "/auth/v1/token") {
        signIns += 1;
        if (body.password !== password) return jsonResponse(400, {error: "invalid"});
        return jsonResponse(200, {access_token: signIns === 1 ? "staff-session-a" : "staff-session-b"});
      }
      if (parsed.pathname === "/rest/v1/rpc/is_staff") return jsonResponse(200, who === "a" || who === "b");
      if (parsed.pathname === "/rest/v1/store_state") return jsonResponse(200, [{key: "units", data: units}]);
      if (parsed.pathname === "/rest/v1/orders") return jsonResponse(200, orders);
      if (parsed.pathname === "/rest/v1/market_settings") {
        return jsonResponse(200, [{automation_enabled: false, writes_enabled: mode.writes === true}]);
      }
      if (parsed.pathname === "/rest/v1/market_query_config") return jsonResponse(200, [{enabled: mode.scheduler === true}]);
      if (parsed.pathname === "/rest/v1/market_decisions") {
        if (mode.rls) return jsonResponse(401, {message: "permission denied"});
        if (options.headers.prefer === "count=exact") {
          const sku = skuOf(parsed.searchParams.get("sku"), "neq");
          const count = decisions.filter(row => row.sku !== sku).length;
          return jsonResponse(206, [], {"content-range": "0-0/" + count});
        }
        const sku = skuOf(parsed.searchParams.get("sku"), "eq");
        return jsonResponse(200, decisions.filter(row => row.sku === sku));
      }
      if (parsed.pathname === "/rest/v1/rpc/market_decide") {
        if (body.p_sku !== "unit:" + runId || body.p_mode !== "manual") return jsonResponse(400, {message: "unexpected decide"});
        const race = body.p_status === "applied" && (String(body.p_apply_key).startsWith("race-a-") || String(body.p_apply_key).startsWith("race-b-"));
        if (race && !raceClosed) {
          return await new Promise(resolve => {
            waiting.push({args: body, resolve});
            if (waiting.length < 2) return;
            raceClosed = true;
            const batch = waiting.splice(0, 2);
            if (mode.double) {
              batch[0].resolve(jsonResponse(200, insert(batch[0].args)));
              batch[1].resolve(jsonResponse(200, insert(batch[1].args)));
              return;
            }
            const first = commit(batch[0].args);
            const second = commit(batch[1].args);
            batch[0].resolve(jsonResponse(first.status, first.body));
            batch[1].resolve(jsonResponse(second.status, second.body));
          });
        }
        const result = commit(body);
        return jsonResponse(result.status, result.body);
      }
      return jsonResponse(404, {message: "unexpected path"});
    } finally {
      inFlight -= 1;
    }
  }

  return {fetchImpl, calls, decisions, preserved, maxInFlight: () => maxInFlight};
}

function envOf() {
  return baseEnv();
}

test("two hosted sessions can consume one fake approval only once", async () => {
  const secrets = [];
  const server = fixture();
  const summary = await runHostedRace({env: envOf(), fetchImpl: server.fetchImpl, runId, secrets});
  assert.equal(summary.ok, true);
  assert.equal(summary.host, STAGING_HOST);
  assert.equal(summary.sku, "unit:" + runId);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.concurrency.databaseRaceProven, false);
  assert.equal(summary.concurrency.httpCallsOverlapped, true);
  assert.equal(summary.concurrency.note, CONCURRENCY_NOTE);
  assert.equal(summary.preservedOtherDecisions.before, 1);
  assert.equal(summary.preservedOtherDecisions.after, 1);
  assert.equal(summary.auditRowsLeftInPlace, true);
  assert.equal(summary.integrity.sellingPrices, "unchanged");
  assert.equal(summary.reuseRejected, true);
  const printed = JSON.stringify(summary);
  assert.equal(printed.includes(password), false);
  assert.equal(printed.includes(anon), false);
  assert.equal(printed.includes("staff-session-a"), false);
  assert.equal(secrets.includes(password), true);
  const race = server.calls.filter(call => call.status === "applied" && (String(call.key).startsWith("race-a-") || String(call.key).startsWith("race-b-"))).slice(0, 2);
  assert.deepEqual(race.map(call => call.who).sort(), ["a", "b"]);
  assert.equal(new Set(race.map(call => call.key)).size, 2);
  assert.equal(server.calls.filter(call => call.path === "/auth/v1/token").length, 2);
  assert.equal(server.calls.every(call => call.method === "GET" || call.method === "POST"), true);
  assert.equal(server.calls.some(call => call.sku && call.sku !== "unit:" + runId), false);
  assert.equal(server.maxInFlight() >= 2, true);
  const fakeRows = server.decisions.filter(row => row.sku === "unit:" + runId);
  assert.equal(fakeRows.filter(row => row.status === "applied").length, 2);
  assert.equal(fakeRows.filter(row => row.status === "approved").length, 2);
  assert.deepEqual(server.decisions[0], server.preserved);
});

test("a second successful apply fails the check before another approval", async () => {
  const server = fixture({double: true});
  await assert.rejects(() => runHostedRace({env: envOf(), fetchImpl: server.fetchImpl, runId}), /exactly one successful apply|one approval and one applied/);
  assert.equal(server.decisions.filter(row => row.sku === "unit:" + runId && row.status === "approved").length, 1);
  assert.equal(server.calls.some(call => call.sku && call.sku !== "unit:" + runId), false);
  assert.deepEqual(server.decisions[0], server.preserved);
});

test("flags, inventory, and blocked decision reads stop before market_decide", async () => {
  for (const mode of [{writes: true}, {scheduler: true}, {price: 901}, {rls: true}]) {
    const server = fixture(mode);
    await assert.rejects(() => runHostedRace({env: envOf(), fetchImpl: server.fetchImpl, runId}));
    assert.equal(server.calls.some(call => call.path === "/rest/v1/rpc/market_decide"), false);
  }
});

test("safety guards do not call the network", async () => {
  const cases = [
    baseEnv("https://" + PRODUCTION_HOST),
    {...baseEnv(), STAGING_ANON_KEY: jwt("service_role")},
    {...baseEnv(), STAGING_STAFF_EMAIL: "owner@example.com"}
  ];
  for (const env of cases) {
    let calls = 0;
    await assert.rejects(() => runHostedRace({
      env,
      fetchImpl() { calls += 1; throw new Error("network"); }
    }));
    assert.equal(calls, 0);
  }
});

test("the script source has no storefront or service-role write path", () => {
  const source = readFileSync(root + "/test/hosted-market-race-check.mjs", "utf8");
  assert.equal(source.includes("hosted-staging-check.mjs"), true);
  assert.equal(source.includes('"PATCH"'), false);
  assert.equal(source.includes('"DELETE"'), false);
  assert.equal(source.includes('"PUT"'), false);
  assert.equal(source.includes("SERVICE_ROLE"), false);
  assert.equal(source.includes("p_sku: \"unit:"), false);
  assert.equal(source.includes("market_observations"), false);
  assert.equal(source.includes("key=eq.priv"), false);
  assert.equal(source.includes("POST /rest/v1/store_state"), false);
  assert.equal(source.includes("POST /rest/v1/orders"), false);
  const hosted = readFileSync(root + "/test/hosted-staging-check.mjs", "utf8");
  assert.equal(hosted.includes("export function assertStagingTarget"), true);
});

test("running the file without staging variables exits before a request", async () => {
  const child = spawn(process.execPath, ["test/hosted-market-race-check.mjs"], {
    cwd: root,
    env: {PATH: process.env.PATH, HOME: process.env.HOME}
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /missing STAGING_SUPABASE_URL/);
});

test("running the file against production exits before a request", async () => {
  const child = spawn(process.execPath, ["test/hosted-market-race-check.mjs"], {
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
  assert.equal(stderr.includes(anon), false);
});
