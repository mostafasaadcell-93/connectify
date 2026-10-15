/* Hosted staging check for Connectify PR #5.
   It refuses the production project. It uses the staging anon key and two staging users.
   It does not read a service-role key and it does not deploy anything. */

export const PRODUCTION_HOST = "yxkzjwcmmtiljakttyfh.supabase.co";

const UNITS = [
  {id: "u-stage-1", m: "17promax", c: "Silver", st: 256, cond: "new", sim: "psim", qty: 2, p: 900, bat: 0, note: "staging-synthetic"},
  {id: "u-stage-2", m: "17promax", c: "Deep Blue", st: 256, cond: "new", sim: "psim", qty: 1, p: 910, bat: 0, note: "staging-synthetic"}
];

export function assertStagingTarget(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("staging URL is not a URL"); }
  if (parsed.protocol !== "https:") throw new Error("staging URL must use https");
  if (parsed.host === PRODUCTION_HOST) throw new Error("refusing production Supabase project");
  if (!parsed.host.endsWith(".supabase.co") || parsed.host === "supabase.co") throw new Error("staging URL must be one supabase.co project");
  return parsed.host;
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error("missing " + name);
  return value;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return {status: response.status, body};
}

function messageOf(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  return body.message || body.error_description || body.error || JSON.stringify(body);
}

async function signIn(base, anon, email, password) {
  const result = await request(base + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {"apikey": anon, "content-type": "application/json"},
    body: JSON.stringify({email, password})
  });
  if (result.status !== 200 || !result.body || !result.body.access_token) {
    throw new Error("sign-in failed for " + email + " (" + result.status + ")");
  }
  return result.body.access_token;
}

function headers(anon, token, extra) {
  return Object.assign({"apikey": anon, "authorization": "Bearer " + (token || anon), "content-type": "application/json"}, extra || {});
}

async function rest(base, anon, token, method, path, body, extra) {
  return request(base + path, {method, headers: headers(anon, token, extra), body: body == null ? undefined : JSON.stringify(body)});
}

function unit(data, id) {
  return (Array.isArray(data) ? data : []).find(item => item && item.id === id) || null;
}

async function readUnits(base, anon, token) {
  const result = await rest(base, anon, token, "GET", "/rest/v1/store_state?key=eq.units&select=key,data");
  if (result.status !== 200 || !Array.isArray(result.body) || !result.body[0]) throw new Error("units read failed (" + result.status + ")");
  return result.body[0].data;
}

async function writeUnits(base, anon, token, data) {
  const result = await rest(base, anon, token, "POST", "/rest/v1/store_state?on_conflict=key", {
    key: "units", data, updated_at: new Date().toISOString()
  }, {"prefer": "resolution=merge-duplicates,return=representation"});
  if (result.status < 200 || result.status >= 300) throw new Error("units write failed: " + messageOf(result.body));
  return result;
}

async function rpc(base, anon, token, name, args) {
  return rest(base, anon, token, "POST", "/rest/v1/rpc/" + name, args);
}

export async function main() {
  const base = env("STAGING_SUPABASE_URL").replace(/\/$/, "");
  const anon = env("STAGING_ANON_KEY");
  const staffEmail = env("STAGING_STAFF_EMAIL");
  const viewerEmail = env("STAGING_VIEWER_EMAIL");
  assertStagingTarget(base);
  if (!staffEmail.toLowerCase().includes("staging") || !viewerEmail.toLowerCase().includes("staging")) {
    throw new Error("both staging emails must contain staging");
  }
  const passed = [];
  const check = (name) => passed.push(name);

  const anonUnits = await readUnits(base, anon, null);
  const silver = unit(anonUnits, "u-stage-1");
  if (!silver || Number(silver.p) !== 900 || silver.c !== "Silver" || Number(silver.st) !== 256) throw new Error("anonymous read did not see the synthetic silver unit");
  check("anon reads synthetic units");

  const priv = await rest(base, anon, null, "GET", "/rest/v1/store_state?key=eq.priv&select=key");
  if (priv.status !== 200 || (Array.isArray(priv.body) && priv.body.length)) throw new Error("anonymous client can see private costs");
  check("anon cannot read priv");

  const anonDecide = await rpc(base, anon, null, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "approved", p_target: 890, p_previous: 900, p_apply_key: null, p_proposal: {}, p_mode: "manual"
  });
  if (anonDecide.status < 400) throw new Error("anonymous market_decide was allowed");
  check("anon cannot decide");

  const anonWrite = await rest(base, anon, null, "PATCH", "/rest/v1/store_state?key=eq.units", {data: [], updated_at: new Date().toISOString()}, {"prefer": "return=representation"});
  const afterAnon = await readUnits(base, anon, null);
  if (Number(unit(afterAnon, "u-stage-1").p) !== 900 || (Array.isArray(anonWrite.body) && anonWrite.body.length)) throw new Error("anonymous write changed units");
  check("anon cannot change units");

  const viewer = await signIn(base, anon, viewerEmail, env("STAGING_VIEWER_PASSWORD"));
  const viewerStaff = await rpc(base, anon, viewer, "is_staff", {});
  if (viewerStaff.body === true) throw new Error("viewer is staff");
  const viewerDecide = await rpc(base, anon, viewer, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "approved", p_target: 890, p_previous: 900, p_apply_key: null, p_proposal: {}, p_mode: "manual"
  });
  if (viewerDecide.status < 400 || !String(messageOf(viewerDecide.body)).includes("staff only")) throw new Error("viewer decide returned " + messageOf(viewerDecide.body));
  check("viewer is rejected");

  const staff = await signIn(base, anon, staffEmail, env("STAGING_STAFF_PASSWORD"));
  const staffFlag = await rpc(base, anon, staff, "is_staff", {});
  if (staffFlag.body !== true) throw new Error("staff is_staff was not true");
  check("staff is_staff");

  const direct = await rest(base, anon, staff, "POST", "/rest/v1/market_decisions", {sku: "unit:u-stage-1", status: "approved"});
  if (direct.status < 400 && !(Array.isArray(direct.body) && direct.body.length === 0)) throw new Error("direct decision insert was allowed");
  check("direct decision insert blocked");

  const early = await rpc(base, anon, staff, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "applied", p_target: 890, p_previous: 900, p_apply_key: "stage-early", p_proposal: {}, p_mode: "manual"
  });
  if (!String(messageOf(early.body)).includes("not approved")) throw new Error("apply without approval returned " + messageOf(early.body));
  const automatic = await rpc(base, anon, staff, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "applied", p_target: 890, p_previous: 900, p_apply_key: "stage-auto", p_proposal: {}, p_mode: "automatic"
  });
  if (!String(messageOf(automatic.body)).includes("automation disabled")) throw new Error("automatic apply returned " + messageOf(automatic.body));
  const enable = await rest(base, anon, staff, "PATCH", "/rest/v1/market_query_config?id=eq.1", {enabled: true}, {"prefer": "return=representation"});
  if (!String(messageOf(enable.body)).includes("scheduler disabled")) throw new Error("scheduler enable returned " + messageOf(enable.body));
  check("automatic apply and scheduler stay off");

  const approved = await rpc(base, anon, staff, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "approved", p_target: 890, p_previous: 900, p_apply_key: null, p_proposal: {sku: "unit:u-stage-1"}, p_mode: "manual"
  });
  if (approved.status >= 400) throw new Error("approval failed: " + messageOf(approved.body));
  const seen = await rest(base, anon, staff, "GET", "/rest/v1/market_decisions?sku=eq.unit:u-stage-1&status=eq.approved&select=status,target_price");
  if (!Array.isArray(seen.body) || !seen.body.length) throw new Error("approval did not persist");
  check("approval persists");

  const before = await readUnits(base, anon, staff);
  const staleQty = unit(before, "u-stage-1").qty;
  const concurrent = before.map(item => item.id === "u-stage-1" ? Object.assign({}, item, {qty: 7}) : item);
  await writeUnits(base, anon, staff, concurrent);
  const fresh = await readUnits(base, anon, staff);
  const current = unit(fresh, "u-stage-1");
  if (current.c !== "Silver" || Number(current.st) !== 256 || current.sim !== "psim" || current.cond !== "new") throw new Error("variant changed before the price write");
  if (Number(current.qty) === Number(staleQty)) throw new Error("concurrent quantity edit was not visible");
  const priced = fresh.map(item => item.id === "u-stage-1" ? Object.assign({}, item, {p: 890}) : item);
  await writeUnits(base, anon, staff, priced);
  const saved = unit(await readUnits(base, anon, staff), "u-stage-1");
  if (Number(saved.p) !== 890 || Number(saved.qty) !== 7 || saved.c !== "Silver" || Number(saved.st) !== 256) throw new Error("read-back did not confirm the price and the concurrent quantity");
  const other = unit(await readUnits(base, anon, staff), "u-stage-2");
  if (Number(other.p) !== 910 || Number(other.qty) !== 1) throw new Error("the other variant changed");
  check("fresh read-back kept the concurrent quantity");

  const applied = await rpc(base, anon, staff, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "applied", p_target: 890, p_previous: 900, p_apply_key: "stage-apply-890", p_proposal: {}, p_mode: "manual"
  });
  if (applied.status >= 400) throw new Error("apply audit failed: " + messageOf(applied.body));
  const duplicate = await rpc(base, anon, staff, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "applied", p_target: 890, p_previous: 900, p_apply_key: "stage-apply-890", p_proposal: {}, p_mode: "manual"
  });
  if (!String(messageOf(duplicate.body)).includes("already applied")) throw new Error("duplicate apply returned " + messageOf(duplicate.body));
  check("retry does not apply twice");

  const quote = await rest(base, anon, staff, "POST", "/rest/v1/market_observations", {
    store: "Staging Fixture", name: "iPhone 17 Pro Max 256GB Silver", price: 850, currency: "USD",
    url: "https://example.invalid/staging", available: true, specs: {}, status: "ok"
  }, {"prefer": "return=minimal"});
  if (quote.status >= 400) throw new Error("observation insert failed: " + messageOf(quote.body));
  if (Number(unit(await readUnits(base, anon, staff), "u-stage-1").p) !== 890) throw new Error("observation insert changed the selling price");
  check("observation insert does not change the selling price");

  await writeUnits(base, anon, staff, UNITS);
  const restored = unit(await readUnits(base, anon, staff), "u-stage-1");
  if (Number(restored.p) !== 900 || Number(restored.qty) !== 2 || restored.c !== "Silver") throw new Error("rollback read-back failed");
  const otherAfter = unit(await readUnits(base, anon, staff), "u-stage-2");
  if (Number(otherAfter.p) !== 910) throw new Error("rollback changed the other variant");
  const restoreAudit = await rpc(base, anon, staff, "market_decide", {
    p_sku: "unit:u-stage-1", p_status: "restored", p_target: 900, p_previous: 890, p_apply_key: null, p_proposal: {}, p_mode: "manual"
  });
  if (restoreAudit.status >= 400) throw new Error("restore audit failed: " + messageOf(restoreAudit.body));
  const order = await rest(base, anon, staff, "GET", "/rest/v1/orders?code=eq.C-STAGE-CONF&select=status,stock_applied,items");
  const row = Array.isArray(order.body) ? order.body[0] : null;
  if (!row || row.status !== "confirmed" || row.stock_applied !== true) throw new Error("confirmed order changed");
  const settings = await rest(base, anon, staff, "GET", "/rest/v1/market_settings?id=eq.1&select=automation_enabled,writes_enabled");
  const config = await rest(base, anon, staff, "GET", "/rest/v1/market_query_config?id=eq.1&select=enabled");
  if (!settings.body[0] || settings.body[0].automation_enabled !== false || settings.body[0].writes_enabled !== false || config.body[0].enabled !== false) {
    throw new Error("automation or scheduler was left on");
  }
  check("rollback restored the synthetic price and left the order alone");

  console.log(JSON.stringify({ok: true, host: new URL(base).host, passed}, null, 2));
}

import {pathToFileURL} from "node:url";

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch(error => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
}
