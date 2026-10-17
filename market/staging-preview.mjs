// Local read-only preview of the Market Pricing admin against the staging project.
// This process serves files on 127.0.0.1. It does not call Supabase.

import {createServer} from "node:http";
import {readFileSync, existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const STAGING_HOST = "akgilfixljswqljmedmg.supabase.co";
export const STAGING_ORIGIN = "https://akgilfixljswqljmedmg.supabase.co";
export const PRODUCTION_HOST = "yxkzjwcmmtiljakttyfh.supabase.co";

const KEY_RE = /^(?:sb_publishable_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const SECRET_NAME = /password|secret|service[_-]?role|sb_secret/i;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function fail(message) {
  const error = new Error(message);
  error.code = "STAGING_PREVIEW";
  return error;
}

function jwtRole(key) {
  if (!key.startsWith("eyJ")) return null;
  const part = key.split(".")[1];
  if (!part) return "unreadable";
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return json && json.role ? String(json.role) : "missing";
  } catch {
    return "unreadable";
  }
}

export function parseEnvFile(text) {
  const env = {};
  for (const line of String(text).replace(/^\uFEFF/, "").split(/\n/)) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[name] = value;
  }
  return env;
}

function skipWs(text, index) {
  let i = index;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") break;
    i++;
  }
  return i;
}

function isIdentChar(ch) {
  return !!ch && ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$");
}

function expectForward(text, index, token) {
  const i = skipWs(text, index);
  if (text.slice(i, i + token.length) !== token) return -1;
  if (isIdentChar(token[0]) && isIdentChar(text[i - 1])) return -1;
  if (isIdentChar(token[token.length - 1]) && isIdentChar(text[i + token.length])) return -1;
  return i + token.length;
}

function expectBackward(text, end, token) {
  let i = end;
  while (i > 0 && (text[i - 1] === " " || text[i - 1] === "\t" || text[i - 1] === "\n" || text[i - 1] === "\r")) i--;
  const start = i - token.length;
  if (start < 0 || text.slice(start, i) !== token) return -1;
  if (isIdentChar(token[0]) && isIdentChar(text[start - 1])) return -1;
  if (isIdentChar(token[token.length - 1]) && isIdentChar(text[i])) return -1;
  return start;
}

function matchForward(text, index, tokens) {
  let i = index;
  for (const token of tokens) {
    if (token === ";?") {
      const semi = expectForward(text, i, ";");
      if (semi >= 0) i = semi;
      continue;
    }
    const next = expectForward(text, i, token);
    if (next < 0) return -1;
    i = next;
  }
  return i;
}

function matchBackward(text, end, tokens) {
  let i = end;
  for (const token of tokens) {
    const start = expectBackward(text, i, token);
    if (start < 0) return -1;
    i = start;
  }
  return i;
}

function readQuotedString(text, index) {
  if (text[index] !== '"') return null;
  let value = "";
  for (let i = index + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" || ch === "\n" || ch === "\r") return null;
    if (ch === '"') return {value, end: i + 1};
    value += ch;
  }
  return null;
}

export function readProductionClient(html) {
  const source = String(html);
  const needle = "supabase.createClient(";
  const positions = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    positions.push(at);
    from = at + needle.length;
  }
  if (positions.length !== 1) {
    throw fail("Refusing to build a preview because the store page does not have exactly one Supabase client.");
  }
  const at = positions[0];
  const url = readQuotedString(source, skipWs(source, at + needle.length));
  if (!url) throw fail("Refusing to build a preview because the Supabase client could not be read.");
  const comma = expectForward(source, url.end, ",");
  if (comma < 0) throw fail("Refusing to build a preview because the Supabase client could not be read.");
  const key = readQuotedString(source, skipWs(source, comma));
  if (!key) throw fail("Refusing to build a preview because the Supabase client could not be read.");
  let host = "";
  try { host = new URL(url.value).hostname; } catch { host = ""; }
  if (host !== PRODUCTION_HOST) throw fail("Refusing to build a preview because index.html is not the production store page.");
  return {url: url.value, key: key.value, at, keyEnd: key.end, marker: source.slice(at, key.end)};
}

const CLIENT_PREFIX = ["return", "{", "try", "{", "=>", ")", "(", "(", "=", "sb", "const"];
const CLIENT_SUFFIX = [
  ",", "{", "auth", ":", "{",
  "persistSession", ":", "true", ",",
  "autoRefreshToken", ":", "true", ",",
  "storageKey", ":", '"connectify-auth"',
  "}", "}", ")",
  "}", "catch", "(", "e", ")", "{",
  "console", ".", "warn", "(", "e", ")", ";",
  "return", "null", ";?",
  "}", "}", ")", "(", ")", ";"
];

function locateProductionClient(html, known) {
  const start = matchBackward(html, known.at, CLIENT_PREFIX);
  const end = start < 0 ? -1 : matchForward(html, known.keyEnd, CLIENT_SUFFIX);
  if (start < 0 || end < 0) throw fail("Could not patch the store page (supabase client).");
  const statement = html.slice(start, end);
  if (statement.indexOf(known.url) !== statement.lastIndexOf(known.url) || statement.indexOf(known.key) !== statement.lastIndexOf(known.key)) {
    throw fail("Could not patch the store page (supabase client).");
  }
  return {start, end};
}

export function assertPreviewTarget(url, key, production = {}) {
  const problems = [];
  const rawUrl = String(url || "").trim();
  const rawKey = String(key || "").trim();
  let parsed = null;
  try { parsed = new URL(rawUrl); } catch { problems.push("STAGING_SUPABASE_URL must be https://akgilfixljswqljmedmg.supabase.co"); }
  if (rawUrl.includes(PRODUCTION_HOST) || rawUrl.includes("yxkzjwcmmtiljakttyfh")) problems.push("Refusing the production Supabase project.");
  if (parsed) {
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
      problems.push("STAGING_SUPABASE_URL must be exactly https://akgilfixljswqljmedmg.supabase.co");
    }
    if (parsed.hostname !== STAGING_HOST || parsed.origin !== STAGING_ORIGIN) {
      problems.push("STAGING_SUPABASE_URL must be exactly https://akgilfixljswqljmedmg.supabase.co");
    }
  }
  if (!rawKey) problems.push("The staging publishable or anon key is missing.");
  if (!KEY_RE.test(rawKey)) problems.push("The staging key must be the project's publishable key or its anon JWT.");
  if (rawKey.startsWith("sb_secret_") || rawKey.includes("service_role")) problems.push("Refusing a secret or service-role key.");
  if (production.key && rawKey === production.key) problems.push("Refusing the production publishable key.");
  if (rawKey.includes(PRODUCTION_HOST) || rawKey.includes("yxkzjwcmmtiljakttyfh")) problems.push("Refusing a key that names the production project.");
  const role = jwtRole(rawKey);
  if (role && role !== "anon") problems.push("A JWT for this preview must be the anon key.");
  if (problems.length) throw fail(problems.join(" "));
  return {url: STAGING_ORIGIN, host: STAGING_HOST, key: rawKey};
}

export function assertPreviewEnv(env, production = {}) {
  const source = env || {};
  for (const name of Object.keys(source)) {
    if (SECRET_NAME.test(name)) throw fail("Remove secrets from market/staging-preview.env. The preview accepts only the staging URL and the anon or publishable key.");
  }
  const key = source.STAGING_SUPABASE_PUBLISHABLE_KEY || source.STAGING_ANON_KEY || "";
  if (source.STAGING_SUPABASE_PUBLISHABLE_KEY && source.STAGING_ANON_KEY && source.STAGING_SUPABASE_PUBLISHABLE_KEY !== source.STAGING_ANON_KEY) {
    throw fail("STAGING_SUPABASE_PUBLISHABLE_KEY and STAGING_ANON_KEY disagree.");
  }
  return assertPreviewTarget(source.STAGING_SUPABASE_URL, key, production);
}

function replaceOnce(html, from, to, label) {
  const at = html.indexOf(from);
  if (at < 0 || html.indexOf(from, at + from.length) >= 0) {
    throw fail("Could not patch the store page (" + label + ").");
  }
  return html.slice(0, at) + to + html.slice(at + from.length);
}

function guardSource() {
  return `/*CX_PREVIEW_GUARD_START*/
function cxPreviewJwtRole(key){
  if(String(key).indexOf("eyJ")!==0)return null;
  const part=String(key).split(".")[1]||"";
  const padded=part+"=".repeat((4-part.length%4)%4);
  try{const json=JSON.parse(atob(padded.replace(/-/g,"+").replace(/_/g,"/")));return json&&json.role?String(json.role):"missing"}catch(e){return "unreadable"}
}
function cxPreviewGuard(raw, key){
  const u=new URL(raw);
  if(u.protocol!=="https:"||u.hostname!==${JSON.stringify(STAGING_HOST)}||u.origin!==${JSON.stringify(STAGING_ORIGIN)}||u.username||u.password||u.search||u.hash||(u.pathname&&u.pathname!=="/"))throw new Error("staging preview refused this host");
  if(!key||String(key).indexOf("sb_secret_")===0||String(key).indexOf("service_role")>=0||(String(key).indexOf("sb_publishable_")!==0&&String(key).indexOf("eyJ")!==0))throw new Error("staging preview refused this key");
  const role=cxPreviewJwtRole(key);
  if(role&&role!=="anon")throw new Error("staging preview refused this key");
  return u.origin;
}
function cxPreviewReadOnly(client){
  const deny=name=>{const error={message:"Staging preview is read-only ("+name+").",code:"CX_PREVIEW_READONLY"};const result=Promise.resolve({data:null,error});const api={eq(){return api},match(){return api},then(resolve,reject){return result.then(resolve,reject)},catch(reject){return result.catch(reject)}};return()=>api};
  const guardQuery=query=>new Proxy(query,{get(target,prop){if(prop==="insert"||prop==="update"||prop==="upsert"||prop==="delete")return deny(String(prop));const value=target[prop];return typeof value==="function"?value.bind(target):value}});
  return {from(table){return guardQuery(client.from(table))},rpc:deny("rpc"),functions:{invoke:deny("functions.invoke")},storage:{from(bucket){const box=client.storage.from(bucket);return new Proxy(box,{get(target,prop){if(prop==="upload"||prop==="update"||prop==="remove")return deny("storage."+String(prop));const value=target[prop];return typeof value==="function"?value.bind(target):value}})}},auth:{getSession:(...a)=>client.auth.getSession(...a),getUser:(...a)=>client.auth.getUser(...a),signInWithPassword:(...a)=>client.auth.signInWithPassword(...a),signOut:(...a)=>client.auth.signOut(...a),onAuthStateChange:(...a)=>client.auth.onAuthStateChange(...a),refreshSession:(...a)=>client.auth.refreshSession(...a),updateUser:deny("auth.updateUser")}};
}
function cxPreviewOpenMarket(){if(!window.CX_STAGING_PREVIEW||!window.LIVE||!LIVE.staff||typeof go!="function")return;if(typeof PAGES=="undefined"||!PAGES.market){setTimeout(cxPreviewOpenMarket,50);return}if(typeof adm!="undefined"&&adm.page==="market")return;go("market")}
/*CX_PREVIEW_GUARD_END*/`;
}

export function renderPreviewPage(html, target, production) {
  const source = String(html);
  const known = readProductionClient(source);
  if (production && (production.url !== known.url || production.key !== known.key)) {
    throw fail("Refusing to build a preview because index.html is not the production store page.");
  }
  const allowed = assertPreviewTarget(target.url, target.key, known);
  if (!source.includes(PRODUCTION_HOST) || source.indexOf(PRODUCTION_HOST) !== source.lastIndexOf(PRODUCTION_HOST)) {
    throw fail("Refusing to build a preview because the production project id is not present exactly once.");
  }
  const clientTo = `${guardSource()}
window.CX_STAGING_PREVIEW={host:${JSON.stringify(STAGING_HOST)},writes:false};
const sb=(()=>{try{
  const cxPreviewOrigin=cxPreviewGuard(${JSON.stringify(allowed.url)}, ${JSON.stringify(allowed.key)});
  const client=supabase.createClient(cxPreviewOrigin, ${JSON.stringify(allowed.key)},
  {auth:{persistSession:true,autoRefreshToken:true,storageKey:"connectify-staging-preview"}});
  return cxPreviewReadOnly(client);
}catch(e){console.warn(e);return null}})();`;
  const located = locateProductionClient(source, known);
  let out = source.slice(0, located.start) + clientTo + source.slice(located.end);
  out = replaceOnce(out, "async function push(){pushT=null;if(!L.staff||busy){if(busy)schedulePush();return}busy=true;",
    "async function push(){pushT=null;if(window.CX_STAGING_PREVIEW)return false;if(!L.staff||busy){if(busy)schedulePush();return}busy=true;", "push");
  out = replaceOnce(out, ':"Live: changes save to the store\'s database and show to customers right away."',
    ':"Staging preview: read-only. This page cannot save prices, stock, orders, or approvals."', "status line");
  out = replaceOnce(out, 'toast("Signed in")};', 'toast("Signed in");cxPreviewOpenMarket()};', "sign-in");
  out = replaceOnce(out, "checkStaff().then(s=>{if(s)refreshStaff().then(()=>{if(ADMIN_ON)showAdmin();if(window.reviewsRefresh)reviewsRefresh()})});",
    "checkStaff().then(s=>{if(s)refreshStaff().then(()=>{if(ADMIN_ON){showAdmin();cxPreviewOpenMarket()}if(window.reviewsRefresh)reviewsRefresh()})});", "session");
  const hosts = out.match(/[a-z0-9-]+\.supabase\.co/g) || [];
  const clientCalls = [...out.matchAll(/supabase\.createClient\s*\(/g)];
  if (out.includes(PRODUCTION_HOST) || out.includes(known.key) || out.includes("connectify-auth") || hosts.some(host => host !== STAGING_HOST) || new Set(hosts).size !== 1) {
    throw fail("Refusing to write the preview because the production client was still present.");
  }
  if (clientCalls.length !== 1 || !/supabase\.createClient\(\s*cxPreviewOrigin\s*,/.test(out.slice(clientCalls[0].index, clientCalls[0].index + 60))) {
    throw fail("Refusing to write the preview because the staging client was not the only Supabase client.");
  }
  if (!out.includes(STAGING_HOST) || !out.includes("cxPreviewGuard(") || !out.includes("if(window.CX_STAGING_PREVIEW)return false")) {
    throw fail("Refusing to write the preview because the staging guard was not installed.");
  }
  return out;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".webmanifest": "application/manifest+json"
};

function safeFile(root, pathname) {
  let decoded = "";
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const full = path.resolve(root, "." + decoded);
  const base = path.basename(full);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (base === "staging-preview.env" || base.endsWith(".env") || base.includes(".env") || full.includes(`${path.sep}.staging-preview${path.sep}`)) return null;
  return full;
}

export function createPreviewServer({html, root = repoRoot, port = 0, host = "127.0.0.1"} = {}) {
  if (host !== "127.0.0.1") throw fail("Staging preview listens on 127.0.0.1 only.");
  if (!html || html.includes(PRODUCTION_HOST)) throw fail("Refusing to serve a page that names the production project.");
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"});
      res.end(html);
      return;
    }
    const file = safeFile(root, url.pathname);
    if (!file) { res.writeHead(404); res.end(); return; }
    try {
      const body = readFileSync(file);
      res.writeHead(200, {"content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store"});
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function readEnvFile(file) {
  if (!existsSync(file)) {
    throw fail("Copy market/staging-preview.env.example to market/staging-preview.env and set the staging URL and publishable key. This preview does not connect until that file exists, and it refuses every host except akgilfixljswqljmedmg.supabase.co.");
  }
  const buf = readFileSync(file);
  if (buf.includes(0)) throw fail("Save market/staging-preview.env as UTF-8 and do not put a password in it.");
  return parseEnvFile(buf.toString("utf8"));
}

export async function startPreview(options = {}) {
  const envFile = options.envFile || process.env.STAGING_PREVIEW_ENV || path.join(here, "staging-preview.env");
  const htmlFile = options.htmlFile || path.join(repoRoot, "index.html");
  const before = readFileSync(htmlFile);
  const production = readProductionClient(before.toString("utf8"));
  const target = assertPreviewEnv(readEnvFile(envFile), production);
  const html = renderPreviewPage(before.toString("utf8"), target, production);
  if (!before.equals(readFileSync(htmlFile))) throw fail("Refusing to continue because index.html changed while the preview was built.");
  const port = options.port == null ? Number(process.env.STAGING_PREVIEW_PORT || 4173) : options.port;
  const server = await createPreviewServer({html, root: repoRoot, port, host: "127.0.0.1"});
  const address = server.address();
  return {server, port: address.port, host: address.address, target};
}

function printReady(info) {
  process.stdout.write([
    "Staging preview ready.",
    "Listen: 127.0.0.1:" + info.port,
    "Database host: " + STAGING_HOST,
    "Writes: off",
    "Open: http://127.0.0.1:" + info.port + "/#admin",
    "Sign in with the existing staging staff user. Market pricing opens after sign-in.",
    "This process does not connect to Supabase. The browser connects only to " + STAGING_HOST + ".",
    ""
  ].join("\n"));
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  startPreview().then(printReady).catch(error => {
    process.stderr.write(String(error && error.message || "Staging preview refused to start.") + "\n");
    process.exitCode = 1;
  });
}
