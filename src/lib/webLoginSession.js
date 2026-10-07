/** Server-side cookie capture on a dedicated, unprivileged login origin. */

import REGISTRY from "open-sse/providers/registry/index.js";
import { createHash } from "node:crypto";
import { isString } from "@/shared/utils/typeChecks";
import loginHostBoundary from "../../web-login-host-boundary.cjs";

export const SESSION_COOKIE = "dd_web_login";
export const SESSION_TTL_MS = 15 * 60 * 1000;
export const WEB_LOGIN_PREFIX = "/__web_login/";
export const PROXY_COOKIE = "dd_web_login_proxy";
const GRANT_TTL_MS = 60_000;

/** Resolve public scheme from operator configuration, never forwarded headers. */
export function requestOrigin(request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  for (const raw of [process.env.DURINDOOR_WEB_LOGIN_ORIGIN, process.env.BASE_URL, process.env.NEXT_PUBLIC_BASE_URL]) {
    try {
      const configured = new URL(raw);
      if (configured.host === host) return configured.origin;
    } catch { /* An absent or malformed configured origin is not trusted. */ }
  }
  const dashboard = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL;
  if (dashboard && !isIsolatedLoginRequest(request)) {
    try { return new URL(dashboard).origin; } catch { /* Fall back to transport origin. */ }
  }
  return new URL(`${url.protocol}//${host}`).origin;
}

export function isolatedOrigin(dashboardOrigin = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 20128}`) {
  return loginHostBoundary.configuredLoginOrigin(dashboardOrigin);
}

export function isIsolatedLoginRequest(request) {
  return loginHostBoundary.isLoginHost({ headers: { host: request.headers.get("host") || new URL(request.url).host } });
}

export function ownerBinding(request) {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const credential = request.headers.get("x-9r-cli-token") || request.headers.get("authorization") || request.headers.get("x-api-key") || cookies.auth_token || "local";
  return createHash("sha256").update(credential).digest("hex");
}

/** Each view receives its own one-time grant without invalidating other views. */
export function issueBootstrap(sess) {
  const now = Date.now();
  for (const [grant, expiresAt] of sess.grants) if (now >= expiresAt) sess.grants.delete(grant);
  const grant = crypto.randomUUID();
  sess.grants.set(grant, now + GRANT_TTL_MS);
  return `${sess.loginOrigin}${WEB_LOGIN_PREFIX}bootstrap?provider=${encodeURIComponent(sess.provider)}&grant=${grant}`;
}

export function consumeBootstrap(grant, provider, loginOrigin) {
  sweepExpired();
  for (const sess of sessions().values()) {
    const expiresAt = sess.grants.get(grant);
    if (!expiresAt) continue;
    if (sess.provider !== provider || (loginOrigin && sess.loginOrigin !== loginOrigin) || Date.now() >= expiresAt) return null;
    sess.grants.delete(grant);
    return sess;
  }
  return null;
}

export function proxySessionFromRequest(request) {
  const id = parseCookieHeader(request.headers.get("cookie"))[PROXY_COOKIE];
  sweepExpired();
  return [...sessions().values()].find((sess) => sess.proxyId === id && id) || null;
}

export function proxySessionCookie(sess) {
  const secure = sess.loginOrigin.startsWith("https:") ? "; Secure" : "";
  return `${PROXY_COOKIE}=${sess.proxyId}; Path=/; HttpOnly; SameSite=${secure ? "None" : "Lax"}; Max-Age=900${secure}`;
}

export function ownedSession(request) {
  const sess = sessionFromRequest(request);
  return sess && sess.owner === ownerBinding(request) && sess.dashboardOrigin === requestOrigin(request) ? sess : null;
}
const HOST_SEGMENT = "__host";
const PROBE_CACHE_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const WEB_LOGIN_CONFIGS = new Map(
  REGISTRY.filter((entry) => entry?.webLogin).map((entry) => [entry.id, entry.webLogin]),
);

/** Registry `webLogin` block for a provider id, or null. */
export function getWebLoginConfig(providerId) {
  return WEB_LOGIN_CONFIGS.get(String(providerId || "")) || null;
}

export function webLoginProviderIds() {
  return [...WEB_LOGIN_CONFIGS.keys()];
}

// ---------- server-side session store ----------
//
// proxy.js and the route handlers are separate bundles, so a module-level Map
// would not be shared between them. Both run in the same Node.js process
// (Next 16 proxy is Node-only), which makes a globalThis-keyed store shared.

const STORE_KEY = Symbol.for("durindoor.webLoginSessions");

function sessions() {
  if (!globalThis[STORE_KEY]) globalThis[STORE_KEY] = new Map();
  return globalThis[STORE_KEY];
}

function isExpired(sess, now = Date.now()) {
  return now - sess.createdAt >= SESSION_TTL_MS;
}

function sweepExpired() {
  const now = Date.now();
  for (const [id, sess] of sessions()) if (isExpired(sess, now)) sessions().delete(id);
}

export function beginSession(provider, options = {}) {
  const config = getWebLoginConfig(provider);
  if (!config) return null;
  sweepExpired();
  const sess = {
    id: crypto.randomUUID(),
    provider,
    origin: new URL(config.origin).origin,
    config,
    jar: new Map(), // "name|domain|path" -> { name, value, domain, path, hostOnly }
    jarVersion: 0,
    probe: null,
    grants: new Map(),
    proxyId: crypto.randomUUID(),
    createdAt: Date.now(),
    ...options,
  };
  sessions().set(sess.id, sess);
  return sess;
}

export function getSession(id) {
  if (!isString(id) || !id) return null;
  const sess = sessions().get(id);
  if (!sess) return null;
  if (isExpired(sess)) {
    sessions().delete(id);
    return null;
  }
  return sess;
}

export function destroySession(id) {
  if (isString(id) && id) sessions().delete(id);
}

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionIdFromRequest(request) {
  return request.cookies?.get?.(SESSION_COOKIE)?.value
    ?? parseCookieHeader(request.headers?.get?.("cookie"))[SESSION_COOKIE]
    ?? null;
}

export function sessionFromRequest(request) {
  return getSession(sessionIdFromRequest(request));
}

export function sessionCookie(sess) {
  const remaining = Math.max(0, Math.floor((sess.createdAt + SESSION_TTL_MS - Date.now()) / 1000));
  return `${SESSION_COOKIE}=${sess.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remaining}${sess.dashboardOrigin?.startsWith("https:") ? "; Secure" : ""}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------- cookie jar ----------

function domainMatch(cookieDomain, host) {
  const d = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  const h = String(host || "").toLowerCase();
  return h === d || h.endsWith("." + d);
}

function cookieAppliesToHost(cookie, host) {
  return cookie.hostOnly ? cookie.domain === String(host).toLowerCase() : domainMatch(cookie.domain, host);
}

/** Parse one Set-Cookie value. Returns { cookie, expired } or null when it must be ignored. */
export function parseSetCookie(raw, requestUrl) {
  if (!raw) return null;
  const parts = raw.split(";");
  const nv = /^([^=]+)=([\s\S]*)$/.exec(parts[0].trim());
  if (!nv) return null;
  const url = new URL(requestUrl);
  const host = url.hostname.toLowerCase();
  const lastSlash = url.pathname.lastIndexOf("/");
  const cookie = {
    name: nv[1].trim(),
    value: (nv[2] || "").trim(),
    domain: host,
    path: lastSlash > 0 ? url.pathname.slice(0, lastSlash) : "/",
    hostOnly: true,
  };
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookie.name) || /[\r\n;]/.test(cookie.value)) return null;
  let expired = false;
  for (let i = 1; i < parts.length; i++) {
    const field = parts[i].trim();
    const eq = field.indexOf("=");
    const key = (eq >= 0 ? field.slice(0, eq) : field).trim().toLowerCase();
    const val = eq >= 0 ? field.slice(eq + 1).trim() : "";
    if (key === "domain" && val) {
      const domain = val.replace(/^\./, "").toLowerCase();
      // A Domain attribute outside the responding host is rejected, as a browser would.
      if (!domainMatch(domain, host)) return null;
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (key === "path" && val.startsWith("/")) {
      cookie.path = val;
    } else if (key === "expires") {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) cookie.expiresAt = t;
    } else if (key === "max-age" && /^-?\d+$/.test(val)) {
      cookie.maxAge = Number(val);
    }
  }
  if (cookie.maxAge !== undefined) cookie.expiresAt = Date.now() + cookie.maxAge * 1000;
  expired = cookie.expiresAt !== undefined && cookie.expiresAt <= Date.now();
  return { cookie, expired };
}

function jarKey(cookie) {
  return `${cookie.name}|${cookie.domain}|${cookie.path}`;
}

export function absorbSetCookies(sess, res, requestUrl) {
  let changed = false;
  for (const raw of res.headers.getSetCookie?.() || []) {
    const parsed = parseSetCookie(raw, requestUrl);
    if (!parsed) continue;
    const key = jarKey(parsed.cookie);
    if (parsed.expired || !parsed.cookie.value) changed = sess.jar.delete(key) || changed;
    else {
      sess.jar.set(key, parsed.cookie);
      changed = true;
    }
  }
  if (changed) sess.jarVersion += 1;
}

export function cookieHeaderFor(sess, targetUrl) {
  const u = new URL(targetUrl);
  const path = u.pathname || "/";
  const out = [];
  for (const c of sess.jar.values()) {
    if (c.expiresAt !== undefined && c.expiresAt <= Date.now()) continue;
    if (!cookieAppliesToHost(c, u.hostname)) continue;
    if (path !== c.path && !path.startsWith(c.path.endsWith("/") ? c.path : c.path + "/")) continue;
    out.push(`${c.name}=${c.value}`);
  }
  return out.join("; ");
}

/** Cookies the provider origin receives, one per name (most specific domain wins). */
function originCookies(sess) {
  const host = new URL(sess.origin).hostname;
  const byName = new Map();
  for (const c of sess.jar.values()) {
    if (c.expiresAt !== undefined && c.expiresAt <= Date.now()) continue;
    if (!cookieAppliesToHost(c, host)) continue;
    const prev = byName.get(c.name);
    if (!prev || c.domain.length > prev.domain.length) byName.set(c.name, c);
  }
  return [...byName.values()];
}

export function capturedCookieNames(sess) {
  return originCookies(sess).map((c) => c.name).sort();
}

function cookiePrefixes(config) {
  return Array.isArray(config.cookiePrefixes) ? config.cookiePrefixes : [];
}

/** Chunk index when `name` is `<prefix><N>` for a prefix that belongs to `base`. */
function chunkIndex(config, base, name) {
  for (const prefix of cookiePrefixes(config)) {
    if (!prefix.startsWith(base) || !name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    if (/^\d+$/.test(rest)) return Number(rest);
  }
  return null;
}

export function hasRequiredCookies(sess) {
  const { config } = sess;
  const names = capturedCookieNames(sess);
  if (config.cookieNames === "*") return names.length > 0;
  const required = Array.isArray(config.cookieNames) ? config.cookieNames : [];
  if (!required.length) return false;
  return required.every((base) => {
    const chunks = names.map((name) => chunkIndex(config, base, name)).filter((index) => index !== null).sort((a, b) => a - b);
    return chunks.length ? chunks.every((index, position) => index === position) : names.includes(base);
  });
}

/**
 * Cookie header stored on the connection. Required cookies come first; a
 * chunked cookie is sent as its `.0`, `.1`, ... parts in index order and a
 * stale unchunked copy is dropped (docs/providers/web-cookie.mdx "Chunked
 * session cookies"). Other origin cookies such as cf_clearance follow.
 */
export function composeCookieHeader(sess) {
  const { config } = sess;
  const cookies = originCookies(sess);
  if (config.cookieNames === "*") return cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const required = Array.isArray(config.cookieNames) ? config.cookieNames : [];
  const used = new Set();
  const head = [];
  for (const base of required) {
    const chunks = cookies
      .map((c) => ({ c, index: chunkIndex(config, base, c.name) }))
      .filter((entry) => entry.index !== null)
      .sort((a, b) => a.index - b.index);
    const single = cookies.find((c) => c.name === base);
    if (single) used.add(single.name);
    for (const { c } of chunks) used.add(c.name);
    if (chunks.length) head.push(...chunks.map(({ c }) => `${c.name}=${c.value}`));
    else if (single) head.push(`${single.name}=${single.value}`);
  }
  const rest = cookies.filter((c) => !used.has(c.name)).map((c) => `${c.name}=${c.value}`);
  return [...head, ...rest].join("; ");
}

/**
 * Ready = every required cookie captured. For full-header providers
 * (`cookieNames: "*"`) the jar must be non-empty AND the readyProbe must
 * answer an okStatus with the jar's cookies. Probe results are cached until
 * the jar changes or PROBE_CACHE_MS passes, so 2s polling stays cheap.
 */
export async function checkReady(sess, fetchImpl = fetch) {
  if (!hasRequiredCookies(sess)) return false;
  if (sess.config.cookieNames !== "*") return true;
  const probe = sess.config.readyProbe;
  if (!probe?.url) return false;
  const cached = sess.probe;
  if (cached && cached.version === sess.jarVersion && Date.now() - cached.at < PROBE_CACHE_MS) return cached.ok;
  let ok = false;
  try {
    const res = await fetchImpl(probe.url, {
      method: probe.method || "GET",
      headers: { Cookie: cookieHeaderFor(sess, probe.url), "User-Agent": BROWSER_UA, Accept: "application/json,text/html,*/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    absorbSetCookies(sess, res, probe.url);
    const okStatus = Array.isArray(probe.okStatus) && probe.okStatus.length ? probe.okStatus : [200];
    ok = okStatus.includes(res.status);
  } catch {
    ok = false;
  }
  sess.probe = { version: sess.jarVersion, at: Date.now(), ok };
  return ok;
}

// ---------- URL space: /__web_login/<provider>/... <-> upstream ----------


export function proxyBase(sess) {
  return `${WEB_LOGIN_PREFIX}${sess.provider}`;
}

function originHost(sess) {
  return new URL(sess.origin).host;
}

function extraHosts(sess) {
  return (Array.isArray(sess.config.allowedHosts) ? sess.config.allowedHosts : [])
    .map((h) => String(h).toLowerCase())
    .filter((h) => h && h !== originHost(sess));
}

/** Proxy path prefix that serves `host`, or null when the host is not part of this login. */
export function hostBase(sess, host) {
  const h = String(host || "").toLowerCase();
  if (h === originHost(sess)) return proxyBase(sess);
  if (extraHosts(sess).includes(h)) return `${proxyBase(sess)}/${HOST_SEGMENT}/${h}`;
  return null;
}

/** Only provider-scoped paths and registry-approved hosts are upstream targets. */
export function upstreamUrlFor(sess, pathname, search = "") {
  const base = proxyBase(sess);
  if (pathname === base || pathname.startsWith(base + "/")) {
    const rest = pathname.slice(base.length) || "/";
    const hostPrefix = `/${HOST_SEGMENT}/`;
    if (rest.startsWith(hostPrefix)) {
      const tail = rest.slice(hostPrefix.length);
      const slash = tail.indexOf("/");
      const host = (slash < 0 ? tail : tail.slice(0, slash)).toLowerCase();
      if (!extraHosts(sess).includes(host)) return null;
      return `https://${host}${slash < 0 ? "/" : tail.slice(slash)}${search}`;
    }
    return `${sess.origin}${rest}${search}`;
  }
  return null;
}

/** Same-origin proxy path for an absolute upstream URL, or null for foreign hosts. */
export function proxyPathFor(sess, absoluteUrl) {
  let u;
  try { u = new URL(absoluteUrl); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const base = hostBase(sess, u.host);
  if (!base) return null;
  return `${base}${u.pathname}${u.search}${u.hash}`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function proxiedHosts(sess) {
  return [originHost(sess), ...extraHosts(sess)];
}

/** Rewrite absolute upstream URLs (plain, JSON-escaped, URL-encoded) to the proxy. */
export function rewriteToProxy(text, sess, appOrigin) {
  if (!text) return text;
  let out = String(text);
  for (const host of proxiedHosts(sess)) {
    const target = `${appOrigin}${hostBase(sess, host)}`;
    const h = escapeRegExp(host);
    const end = "(?![\\w.-])";
    out = out.replace(new RegExp(`(?:https?:)?//${h}${end}`, "gi"), target);
    out = out.replace(new RegExp(`(?:https?:)?\\\\/\\\\/${h}${end}`, "gi"), target.replaceAll("/", "\\/"));
    out = out.replace(new RegExp(`(?:https?%3A)?%2F%2F${h}${end}`, "gi"), encodeURIComponent(target));
  }
  return out;
}

/** Reverse of rewriteToProxy for request URLs, Referer and bodies sent upstream. */
export function rewriteToUpstream(text, sess, appOrigin) {
  if (!text) return text;
  let out = String(text);
  // Extra hosts first: their prefix is longer than (and contains) the origin's.
  for (const host of [...extraHosts(sess), originHost(sess)]) {
    const from = `${appOrigin}${hostBase(sess, host)}`;
    const to = `https://${host}`;
    out = out.split(from).join(to);
    out = out.split(from.replaceAll("/", "\\/")).join(to.replaceAll("/", "\\/"));
    out = out.split(encodeURIComponent(from)).join(encodeURIComponent(to));
  }
  return out;
}

/** Rewrite an upstream redirect target into the proxy space (foreign hosts pass through). */
export function rewriteLocation(sess, location, upstreamUrl) {
  if (!location) return location;
  let abs;
  try { abs = new URL(location, upstreamUrl).toString(); } catch { return location; }
  return proxyPathFor(sess, abs) ?? abs;
}

// ---------- header policy ----------

/** Browser request headers never forwarded to the provider. */
export const STRIP_REQUEST_HEADERS = new Set([
  "host", "cookie", "connection", "content-length", "transfer-encoding",
  "keep-alive", "upgrade", "expect", "proxy-connection", "te", "trailer",
  "accept-encoding", "origin", "referer", "forwarded", "x-real-ip",
  // Credentials for DurinDoor itself must never reach a third-party upstream.
  "authorization", "proxy-authorization", "x-api-key", "x-goog-api-key",
]);
const STRIP_REQUEST_PREFIXES = ["x-9r-", "x-forwarded-", "x-middleware-"];

/** Upstream response headers dropped before the browser sees the page. */
export const STRIP_UPSTREAM_HEADERS = new Set([
  "content-security-policy", "content-security-policy-report-only",
  "x-frame-options", "strict-transport-security",
  // Absorbed into the server-side jar instead.
  "set-cookie", "set-cookie2",
  // Rewritten into the proxy space.
  "location",
  "x-matched-path", "rsc",
  // Would wipe or pin the dashboard origin's own storage and policies.
  "clear-site-data", "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy", "report-to", "reporting-endpoints", "nel", "alt-svc",
  // fetch already decoded the body; length changes after rewriting.
  "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
]);

// Next interprets proxy response headers as routing and request-override
// instructions before returning a body. A provider is never a framework peer.
const STRIP_UPSTREAM_PREFIXES = ["x-middleware-", "x-nextjs-", "x-invoke-", "x-now-", "x-action-", "next-"];

function forwardedRequestHeaders(request) {
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const key = k.toLowerCase();
    if (STRIP_REQUEST_HEADERS.has(key)) continue;
    if (STRIP_REQUEST_PREFIXES.some((p) => key.startsWith(p))) continue;
    headers.set(k, v);
  }
  // The page is framed by the modal; present it as a top-level navigation.
  if (headers.get("sec-fetch-dest") === "iframe") headers.set("sec-fetch-dest", "document");
  if (!headers.has("user-agent")) headers.set("user-agent", BROWSER_UA);
  return headers;
}

/** Convert an isolated-origin Referer back to its provider URL. */
function upstreamReferer(sess, referer, appOrigin) {
  if (!referer) return null;
  let u;
  try { u = new URL(referer); } catch { return null; }
  if (u.origin !== appOrigin) return null;
  return upstreamUrlFor(sess, u.pathname, u.search) ?? `${sess.origin}/`;
}

// ---------- page instrumentation ----------

/** Route browser network calls through provider-scoped paths; block service workers. */
export function bootstrapScript(sess, documentBase) {
  const hosts = {};
  for (const host of proxiedHosts(sess)) hosts[host] = hostBase(sess, host);
  const cfg = JSON.stringify({ doc: documentBase, root: WEB_LOGIN_PREFIX, hosts }).replace(/</g, "\\u003c");
  return `<script>(function(){var C=${cfg};
// Keep the provider-scoped path: unscoped paths never reach application routes.
function rw(u){try{var x=new URL(String(u),location.href);if(x.origin===location.origin){if(x.pathname.indexOf(C.root)===0)return null;return C.doc+x.pathname+x.search+x.hash;}var b=C.hosts[x.host];if(b)return b+x.pathname+x.search+x.hash;}catch(e){}return null;}
var F=window.fetch;if(F){window.fetch=function(i,o){try{var s=i instanceof Request?i.url:i;var r=rw(s);if(r!==null)i=i instanceof Request?new Request(r,i):r;}catch(e){}return F.call(this,i,o);};}
var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var r=rw(u);if(r!==null)arguments[1]=r;return O.apply(this,arguments);};
if(navigator.sendBeacon){var SB=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){var r=rw(u);return SB(r===null?u:r,d);};}
if(window.EventSource){var ES=window.EventSource;window.EventSource=function(u,o){var r=rw(u);return new ES(r===null?u:r,o);};window.EventSource.prototype=ES.prototype;}
try{if(window.ServiceWorkerContainer){ServiceWorkerContainer.prototype.register=function(){return Promise.reject(new Error("Service workers are disabled during DurinDoor web login"));};}}catch(e){}
})();</script>`;
}

function injectBootstrap(html, script) {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + script + html.slice(head.index + head[0].length);
  return script + html;
}

function rewriteRootUrl(value, documentBase) {
  return value.replace(/^\/(?!\/|__web_login\/)/, `${documentBase}/`);
}

/** Rewrite CSS URL tokens, not comments or ordinary string literals. */
function rewriteCssUrls(text, documentBase) {
  return text.replace(/\/\*[\s\S]*?\*\/|@import\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\burl\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)]*)\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi, (token) => {
    if (!/^(?:url\(|@import\s)/i.test(token)) return token;
    return token.replace(/^((?:url\(\s*|@import\s+)["']?)\/(?!\/|__web_login\/)/i, `$1${documentBase}/`);
  });
}

/** Srcset URL tokens may contain commas (notably data URLs); descriptors do not. */
function rewriteSrcset(text, documentBase) {
  let position = 0;
  let result = "";
  while (position < text.length) {
    const start = position;
    while (position < text.length && /[\t\n\f\r ,]/.test(text[position])) position++;
    const urlStart = position;
    while (position < text.length && !/[\t\n\f\r ]/.test(text[position])) position++;
    const url = text.slice(urlStart, position);
    result += text.slice(start, urlStart) + rewriteRootUrl(url, documentBase);
    if (url.endsWith(",")) continue;
    const comma = text.indexOf(",", position);
    const end = comma < 0 ? text.length : comma;
    result += text.slice(position, end);
    position = end;
  }
  return result;
}

/** Rewrite URL attributes without interpreting strings inside other attributes. */
function rewriteTagUrls(tag, documentBase) {
  return tag.replace(/\s+([^\s"'<>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g, (attribute, name, value) => {
    if (value === undefined) return attribute;
    const quote = /^["']/.test(value) ? value[0] : "";
    const content = quote ? value.slice(1, -1) : value;
    let rewritten = content;
    if (/^(?:src|href|xlink:href|action|formaction|poster)$/i.test(name) ||
      (/^data$/i.test(name) && /^<object(?=[\s/>])/i.test(tag))) rewritten = rewriteRootUrl(content, documentBase);
    else if (/^(?:srcset|imagesrcset)$/i.test(name)) rewritten = rewriteSrcset(content, documentBase);
    else if (/^style$/i.test(name)) rewritten = rewriteCssUrls(content, documentBase);
    return attribute.slice(0, -value.length) + quote + rewritten + quote;
  });
}

/** HTML URL contexts only; script, JSON and other raw-text bodies remain intact. */
function rewriteHtmlUrls(text, documentBase) {
  return text.replace(/<!--[\s\S]*?-->|(<(script|style|textarea|title)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/\2\s*>|$)|<[a-z][^\s/>]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (token, opening, name, body, closing) => {
    if (token.startsWith("<!--")) return token;
    if (!opening) return rewriteTagUrls(token, documentBase);
    return rewriteTagUrls(opening, documentBase) +
      (name.toLowerCase() === "style" ? rewriteCssUrls(body, documentBase) : body) + closing;
  });
}

const TEXT_TYPE_RE = /text\/|javascript|json|xml|ecmascript/i;

export async function buildBrowserResponse(sess, res, appOrigin, upstreamUrl) {
  const headers = new Headers();
  for (const [k, v] of res.headers) {
    const key = k.toLowerCase();
    if (STRIP_UPSTREAM_HEADERS.has(key) || STRIP_UPSTREAM_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    headers.append(k, v);
  }
  const location = res.headers.get("location");
  if (location) headers.set("Location", new URL(rewriteLocation(sess, location, upstreamUrl), appOrigin).toString());
  // Provider pages must never persist in a browser or intermediary cache.
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");

  const contentType = res.headers.get("content-type") || "";
  if (!res.body || !TEXT_TYPE_RE.test(contentType)) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  const documentBase = hostBase(sess, new URL(upstreamUrl).host) || proxyBase(sess);
  let body = rewriteToProxy(await res.text(), sess, appOrigin);
  if (/text\/html/i.test(contentType)) {
    body = injectBootstrap(rewriteHtmlUrls(body, documentBase), bootstrapScript(sess, documentBase));
  } else if (/text\/css/i.test(contentType)) {
    body = rewriteCssUrls(body, documentBase);
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Forward one browser request to the provider and translate the response.
 * Upstream cookies come only from the jar; browser cookies (the dashboard's
 * auth_token among them) are never sent upstream.
 */
export async function proxyWebLoginRequest(sess, request, upstreamUrl, appOrigin, fetchImpl = fetch) {
  const target = rewriteToUpstream(upstreamUrl, sess, appOrigin);
  const headers = forwardedRequestHeaders(request);
  const referer = upstreamReferer(sess, request.headers.get("referer"), appOrigin);
  if (referer) headers.set("Referer", rewriteToUpstream(referer, sess, appOrigin));
  if (request.headers.get("origin")) headers.set("Origin", new URL(referer || target).origin);
  const cookie = cookieHeaderFor(sess, target);
  if (cookie) headers.set("Cookie", cookie);

  const method = request.method || "GET";
  const init = { method, headers, redirect: "manual", signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) };
  if (method !== "GET" && method !== "HEAD") {
    let body = Buffer.from(await request.arrayBuffer());
    const contentType = headers.get("content-type") || "";
    if (body.length && /urlencoded|json|text/i.test(contentType)) {
      body = Buffer.from(rewriteToUpstream(body.toString("utf8"), sess, appOrigin), "utf8");
    }
    init.body = body;
  }

  const res = await fetchImpl(target, init);
  absorbSetCookies(sess, res, target);
  return buildBrowserResponse(sess, res, appOrigin, target);
}

export const __test__ = { forwardedRequestHeaders, injectBootstrap, sessions };
