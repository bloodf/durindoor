/**
 * #2034: MaxAI browser capture and import through to the stored-credential request.
 *
 * Real: the registry descriptor, the extension capture core, the dashboard parsers, the pairing,
 * import, provider and connection-test routes, isolated SQLite, account selection, handleChat and
 * the MaxAI executor. Mocked: the management guard decision, the `chrome` cookie API, the proxy
 * reachability check and outbound bytes (`proxyAwareFetch` and global fetch). Every credential and
 * signing value is synthetic.
 * Nothing here shows that the live MaxAI site sets these cookies or accepts these requests.
 *
 * The synthetic web-app bundle follows the shape parsed by OmniRoute (MIT),
 * open-sse/executors/maxai/constants.ts. X-Authorization is opened with the system `openssl`,
 * so the test carries no copy of the signer.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareCapture, runCapture, confirmationFor, MESSAGES } from "../../extensions/provider-cookie-capture/capture.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const network = vi.hoisted(() => ({ fetch: null, proxyChecks: [] }));

// The connection test's proxy reachability check dials out on its own, outside proxyAwareFetch.
vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: async ({ proxyUrl }) => { network.proxyChecks.push(proxyUrl); return { ok: true, status: 200 }; },
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: (...args) => network.fetch(...args),
}));
// Management authority only: a request is the operator when it carries the synthetic marker.
vi.mock("@/dashboardGuard", async (original) => {
  const isMarked = async (request) => request.headers.get("x-test-operator") === "yes";
  return { ...(await original()), canAccessManagementApi: isMarked, canManageAccessConfig: isMarked, isOperatorRequest: isMarked };
});

const DASHBOARD = "https://dashboard.example.invalid";
const ORIGIN = "https://www.maxai.co";
const CHAT_URL = "https://api.maxai.me/gpt/cwc/chat";
const CONFIG_URL = "https://api.maxai.me/models/get_config";
const NAMES = ["access_token", "device_id", "user_id"];
const TAB_ID = 7;
const APP_CHUNK = "/_next/static/chunks/pages/_app-0a1b2c.js";
const SIGNER_CHUNK = "/_next/static/chunks/4242-0a1b2c.js";
const SIGNING = { hmacKey: "1a".repeat(32), aesKey: "2b".repeat(32), appVersion: "webpage_9.8.7", ctxKey: "3c".repeat(20) };

const account = (tag) => ({
  access_token: `synthetic.maxai-access-${tag}.signature`,
  device_id: `synthetic-device-${tag}`,
  user_id: `synthetic-user-${tag}`,
});
const A = account("alpha");
const B = account("bravo");
const C = account("charlie");
const DECOY = account("decoy");
const NOISE = "synthetic-unapproved-cookie";
const secretsOf = (...accounts) => accounts.flatMap((entry) => Object.values(entry));
const headerOf = (entry) => NAMES.map((name) => `${name}=${entry[name]}`).join("; ");
const soon = () => Math.floor(Date.now() / 1000) + 3600;
const cookiesOf = (entry, extra = {}) =>
  NAMES.map((name) => ({ name, value: entry[name], domain: "www.maxai.co", secure: true, expirationDate: soon(), ...extra }));

let root;
let db;
let routes;
let parser;
let contractModule;
let handleChat;
let sent;
let upstream;
let outbound;
let logs;

const request = (url, { method = "POST", body, headers = {}, operator = true } = {}) =>
  new Request(`${DASHBOARD}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(operator ? { "x-test-operator": "yes" } : null), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });
const rows = () => db.getProviderConnections({ provider: "maxai" });
const row = (id) => db.getProviderConnectionById(id);

const expectNoSecrets = (value, secrets) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) expect(text).not.toContain(secret);
};

async function mintPairing(target, options) {
  return routes.pairing.POST(request("/api/providers/cookie-import/pairing", { body: { provider: "maxai", ...target }, ...options }));
}

async function pairingFor(target) {
  const response = await mintPairing(target);
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}

/** What the extension and the dashboard dialog send: the pairing secret is the only authority. */
const postImport = (pairing, body, headers = {}) =>
  routes.import.POST(request("/api/providers/cookie-import", {
    body, operator: false, headers: { [pairing.header]: pairing.token, ...headers },
  }));

async function importCookies(target, cookies) {
  const pairing = await pairingFor(target);
  const body = { provider: "maxai", origin: ORIGIN, cookies, ...(target.action === "update" ? { connectionId: target.connectionId } : null) };
  const response = await postImport(pairing, body);
  return { status: response.status, body: await response.json() };
}

/** Fake browser: two cookie stores, only the first owns the tab. Anything but exact-name reads throws. */
function makeChrome(jar, { tabUrl = `${ORIGIN}/app/` } = {}) {
  const calls = { get: [], request: [], remove: [] };
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const forbidden = (api) => () => { throw new Error(`MaxAI capture must not use ${api}`); };
  const chrome = {
    tabs: {
      query: async () => [{ id: TAB_ID, url: tabUrl }],
      get: async (id) => ({ id, url: tabUrl }),
    },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: async (query) => { calls.request.push(structuredClone(query)); names(query).forEach((name) => held.add(name)); return true; },
      remove: async (query) => { calls.remove.push(structuredClone(query)); names(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "store-other", tabIds: [99] }, { id: "store-tab", tabIds: [TAB_ID] }],
      get: async (query) => {
        calls.get.push({ ...query });
        const host = new URL(query.url).hostname;
        return jar.find((cookie) => {
          const domain = cookie.domain.replace(/^\./, "");
          return cookie.storeId === query.storeId && cookie.name === query.name && (host === domain || host.endsWith(`.${domain}`));
        }) ?? null;
      },
      getAll: forbidden("cookies.getAll"),
    },
    scripting: { executeScript: forbidden("scripting") },
  };
  return { chrome, calls };
}

const inStore = (storeId, cookies) => cookies.map((cookie) => ({ ...cookie, storeId }));

/** Run the shipped capture core against the real import route. */
async function capture(pairing, jar, options) {
  const browser = makeChrome(jar, options);
  const posts = [];
  const bridge = async (url, init) => {
    posts.push({ url, init });
    return routes.import.POST(new Request(url, init));
  };
  const prepared = await prepareCapture({ chrome: browser.chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { result: prepared, posts, calls: browser.calls };
  const result = await runCapture({ chrome: browser.chrome, fetch: bridge, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  return { result, posts, calls: browser.calls, plan: prepared.plan };
}

/** Synthetic MaxAI web app and API. Any other URL fails the test. */
function maxaiNetwork({ chatStatus = () => 200, probeStatus = () => 200 } = {}) {
  return async (url, init) => {
    if (url === `${ORIGIN}/app/`) return new Response(`<script src="${APP_CHUNK}"></script><script src="${SIGNER_CHUNK}"></script>`);
    if (url === `${ORIGIN}${APP_CHUNK}`) {
      return new Response(`x.d({Mn:function(){return hk},Rl:function(){return ak}});var hk="${SIGNING.hmacKey}",ak="${SIGNING.aesKey}",v="${SIGNING.appVersion}";`);
    }
    if (url === `${ORIGIN}${SIGNER_CHUNK}`) return new Response(`n=(0,r.nj)("582d52616e646f6d");p={"${SIGNING.ctxKey}":{a:c}}`);
    const bearer = String(init?.headers?.Authorization ?? "");
    if (url === CONFIG_URL) return new Response("{}", { status: probeStatus(bearer) });
    if (url === CHAT_URL) {
      const status = chatStatus(bearer);
      if (status !== 200) return new Response("session expired", { status });
      return new Response(`data: ${JSON.stringify({ text: "synthetic answer" })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`unmocked MaxAI request: ${url}`);
  };
}

const apiCalls = (url) => sent.filter((call) => call.url === url);
const webAppCalls = () => sent.filter((call) => call.url.startsWith(ORIGIN));

/** Open the CryptoJS "Salted__" envelope with OpenSSL itself. */
const openSignature = (headers) => JSON.parse(execFileSync(
  "openssl",
  ["enc", "-d", "-aes-256-cbc", "-md", "md5", "-base64", "-A", "-pass", `pass:${SIGNING.aesKey}`],
  { input: headers["X-Authorization"], stdio: ["pipe", "pipe", "ignore"] },
).toString("utf8"));

/** The operator's routing choice for one account: its proxy and its place in the selection order. */
async function configureAccount(id, proxyUrl, priority) {
  const response = await routes.provider.PUT(request(`/api/providers/${id}`, {
    method: "PUT", body: { priority, connectionProxyEnabled: true, connectionProxyUrl: proxyUrl },
  }), params(id));
  expect(response.status).toBe(200);
}

const sendChat = () => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "maxai/gpt-5.6", stream: false, messages: [{ role: "user", content: "hello maxai" }] }),
}));

const usageAccounts = async () => (await db.getUsageHistory({ provider: "maxai" })).map((entry) => entry.connectionId).sort();

/** A successful chat records usage after it answers; wait for that row before moving on. */
async function chat() {
  const before = (await usageAccounts()).length;
  const response = await sendChat();
  if (response.ok) await vi.waitFor(async () => expect(await usageAccounts()).toHaveLength(before + 1));
  return response;
}

// The first case transforms every route and the gateway cold, which outlasts the default hook limit.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-maxai-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "BASE_URL", "NEXT_PUBLIC_BASE_URL"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules(); // also drops the executor's cached signing constants
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    vi.spyOn(console, level).mockImplementation((...args) => { logs.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg) ?? String(arg))).join(" ")); });
  }
  sent = [];
  network.proxyChecks.length = 0;
  upstream = maxaiNetwork();
  network.fetch = async (url, init, proxyOptions) => {
    sent.push({ url: String(url), init, proxyOptions });
    return upstream(String(url), init);
  };
  db = await import("@/lib/db/index.js");
  parser = await import("../../src/shared/utils/cookieImportParser.js");
  contractModule = await import("../../src/lib/providers/cookieImport/contract.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  // Stubbed after the imports so nothing can reach a socket through the global.
  outbound = vi.fn(() => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);
});

afterEach(async () => {
  expect(outbound).not.toHaveBeenCalled();
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MaxAI extension capture against the registry descriptor", () => {
  it("reads three exact cookies from the tab's store and saves one encrypted, redacted cookie connection", async () => {
    const pairing = await pairingFor({ action: "create", name: "Synthetic MaxAI" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: NAMES, cookiePrefixes: [] });

    const jar = [
      // Another browser session holds the same names, listed first.
      ...inStore("store-other", cookiesOf(DECOY)),
      // A parent-domain cookie is how a site-wide session cookie appears.
      ...inStore("store-tab", cookiesOf(A, { domain: ".maxai.co" })),
      ...inStore("store-tab", [
        { name: "cf_clearance", value: NOISE, domain: ".maxai.co", secure: true },
        { name: "refresh_token", value: `${NOISE}-refresh`, domain: "www.maxai.co", secure: true },
      ]),
    ];
    const { result, posts, calls, plan } = await capture(pairing, jar);

    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 3, connection: { name: "Synthetic MaxAI" } });
    expect(calls.get).toEqual(NAMES.map((name) => ({ url: `${ORIGIN}/`, name, storeId: "store-tab" })));
    const grant = { permissions: ["cookies"], origins: ["https://www.maxai.co/*", "https://dashboard.example.invalid/*"] };
    expect(calls.request).toEqual([grant]);
    expect(calls.remove).toEqual([grant]);
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(`${DASHBOARD}/api/providers/cookie-import`);
    const submitted = JSON.parse(posts[0].init.body);
    expect(Object.keys(submitted).sort()).toEqual(["cookies", "origin", "provider"]);
    expect(submitted.cookies.map((cookie) => [cookie.name, cookie.value])).toEqual(NAMES.map((name) => [name, A[name]]));
    expectNoSecrets(posts[0].init.body, [...secretsOf(DECOY), NOISE]);
    expectNoSecrets(result, [...secretsOf(A), pairing.token]);
    expect(plan.token).toBe("");

    const [stored] = await rows();
    expect(stored).toMatchObject({ id: result.connection.id, provider: "maxai", authType: "cookie", apiKey: headerOf(A) });
    // The import adds no providerSpecificData credential that could compete with the cookie header.
    expect(Object.keys(stored.providerSpecificData).filter((key) => /maxai|token|device|user/i.test(key))).toEqual([]);
    const atRest = global._dbAdapter.instance.all("SELECT * FROM providerConnections");
    expectNoSecrets(atRest, secretsOf(A));

    const list = await routes.providers.GET(request("/api/providers", { method: "GET" }));
    const detail = await routes.provider.GET(request(`/api/providers/${stored.id}`, { method: "GET" }), params(stored.id));
    for (const response of [list, detail]) {
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("Synthetic MaxAI");
      expectNoSecrets(text, secretsOf(A));
    }
    expect(sent).toEqual([]); // capture and import never call the provider
    expectNoSecrets(logs.join("\n"), [...secretsOf(A, DECOY), pairing.token, NOISE]);
  });

  it.each(["https://maxai.co/app/", "https://api.maxai.me/", "https://www.maxai.me/app/", "https://www.maxai.co.attacker.invalid/", "http://www.maxai.co/app/"])(
    "reads nothing when the active tab is %s",
    async (tabUrl) => {
      const pairing = await pairingFor({ action: "create", name: "Wrong tab" });
      const { result, posts, calls } = await capture(pairing, inStore("store-tab", cookiesOf(A)), { tabUrl });
      expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
      expect([calls.get, calls.request, posts]).toEqual([[], [], []]);
      expect(await rows()).toEqual([]);
    },
  );

  it.each([
    ["maxai.me-scoped cookies, which the www.maxai.co read cannot see", () => cookiesOf(A, { domain: ".maxai.me" }), "no_cookies"],
    ["a missing user_id", () => cookiesOf(A).slice(0, 2), "rejected"],
    ["only a chunked access_token", () => [{ ...cookiesOf(A)[0], name: "access_token.0" }, ...cookiesOf(A).slice(1)], "rejected"],
    ["an expired access_token", () => cookiesOf(A).map((cookie, i) => (i ? cookie : { ...cookie, expirationDate: 1 })), "rejected"],
    ["an insecure device_id", () => cookiesOf(A).map((cookie, i) => (i === 1 ? { ...cookie, secure: false } : cookie)), "rejected"],
  ])("saves nothing for %s", async (_label, jar, code) => {
    const pairing = await pairingFor({ action: "create", name: "Incomplete" });
    const { result } = await capture(pairing, inStore("store-tab", jar()));
    expect(result).toEqual({ ok: false, code, message: MESSAGES[code] });
    expect(await rows()).toEqual([]);
    expect(sent).toEqual([]);
    expectNoSecrets(logs.join("\n"), secretsOf(A));
  });

  it("refuses a pairing that drops a required name and ignores one that asks for localStorage", async () => {
    const pairing = await pairingFor({ action: "create", name: "Tampered" });
    const narrowed = await capture({ ...pairing, contract: { ...pairing.contract, cookieNames: NAMES.slice(0, 2) } }, []);
    expect(narrowed.result).toMatchObject({ ok: false, code: "invalid_pairing" });
    expect([narrowed.calls.get, narrowed.posts]).toEqual([[], []]);

    // The fake throws on any scripting call, so success proves no page storage was read.
    const widened = { ...pairing, contract: { ...pairing.contract, localStorageKeys: ["access_token"] } };
    const { result, calls } = await capture(widened, inStore("store-tab", cookiesOf(A)));
    expect(result).toMatchObject({ ok: true });
    expect(calls.request[0].permissions).toEqual(["cookies"]);
  });
});

describe("MaxAI import route boundary", () => {
  it.each([
    "https://maxai.co", "https://api.maxai.me", "https://www.maxai.me", "http://www.maxai.co", "https://www.maxai.co/", "https://www.maxai.co:8443",
  ])("rejects origin %s", async (origin) => {
    const pairing = await pairingFor({ action: "create", name: "Wrong origin" });
    const response = await postImport(pairing, { provider: "maxai", origin, cookies: cookiesOf(A) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Origin is not approved for this provider" });
    expect(await rows()).toEqual([]);
  });

  // The descriptor lists maxai.me under `domains`; the import contract does not read that list.
  it.each(["maxai.me", ".maxai.me", "api.maxai.me", "chat.maxai.co"])("rejects cookie domain %s", async (domain) => {
    expect(contractModule.getCookieImportContract("maxai").config.domains).toEqual(["maxai.co", "maxai.me"]);
    const result = await importCookies({ action: "create", name: "Wrong domain" }, cookiesOf(A, { domain }));
    expect(result).toEqual({ status: 400, body: { error: "Cookie domain does not match the provider origin" } });
    expect(await rows()).toEqual([]);
  });

  it.each(NAMES)("rejects a missing or expired %s with fixed text", async (name) => {
    const missing = await importCookies({ action: "create", name: "Missing" }, cookiesOf(A).filter((cookie) => cookie.name !== name));
    expect(missing).toEqual({ status: 400, body: { error: "Required session cookie is missing or incomplete" } });
    const expired = await importCookies({ action: "create", name: "Expired" },
      cookiesOf(A).map((cookie) => (cookie.name === name ? { ...cookie, expirationDate: 1 } : cookie)));
    expect(expired).toEqual({ status: 400, body: { error: "Cookie is expired" } });
    expect(await rows()).toEqual([]);
    expectNoSecrets(logs.join("\n"), secretsOf(A));
  });

  it.each([
    ["an extra refresh_token cookie", { cookies: [...cookiesOf(A), { name: "refresh_token", value: NOISE }] }, "Cookie name is not approved for this provider"],
    ["a numbered chunk", { cookies: [...cookiesOf(A), { name: "access_token.0", value: NOISE }] }, "Cookie name is not approved for this provider"],
    ["a camelCase token name", { cookies: [{ name: "accessToken", value: NOISE }, ...cookiesOf(A).slice(1)] }, "Cookie name is not approved for this provider"],
    ["a localStorage value", { cookies: cookiesOf(A), localStorage: { device_id: NOISE } }, "This provider takes no localStorage value"],
  ])("rejects %s", async (_label, extra, error) => {
    const pairing = await pairingFor({ action: "create", name: "Extra input" });
    const response = await postImport(pairing, { provider: "maxai", origin: ORIGIN, ...extra });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await rows()).toEqual([]);
  });

  it("needs the operator to pair and the one-use secret to import", async () => {
    const denied = await mintPairing({ action: "create", name: "No authority" }, { operator: false, headers: { authorization: "Bearer synthetic-api-key" } });
    expect(denied.status).toBe(403);

    const body = { provider: "maxai", origin: ORIGIN, cookies: cookiesOf(A) };
    const unpaired = await routes.import.POST(request("/api/providers/cookie-import", { body, headers: { authorization: "Bearer synthetic-api-key" } }));
    expect(unpaired.status).toBe(401);

    const pairing = await pairingFor({ action: "create", name: "One use" });
    const oversized = await postImport(pairing, { ...body, padding: "x".repeat(33 * 1024) });
    expect(oversized.status).toBe(413);
    expect((await postImport(pairing, body)).status).toBe(201);
    const replay = await postImport(pairing, { ...body, cookies: cookiesOf(B) });
    expect(replay.status).toBe(401);
    expectNoSecrets(await replay.text(), [...secretsOf(B), pairing.token]);
    expect((await rows()).map((entry) => entry.apiKey)).toEqual([headerOf(A)]);
  });
});

describe("MaxAI dashboard paste and file import", () => {
  const pasted = (entry) => `cf_clearance=${NOISE}; ${headerOf(entry)}`;
  const curl = (url, cookie) => `curl '${url}' \\\n  -H 'cookie: ${cookie}' \\\n  -H 'accept: */*'`;
  const harEntry = (url, entry) => ({ request: { url, headers: [{ name: "Cookie", value: pasted(entry) }], cookies: [] } });
  const har = (...entries) => JSON.stringify({ log: { entries } });
  const candidates = (kind, parsed) => parser.buildImportCandidates({ kind, parsed }, contractModule.getCookieImportContract("maxai"));

  it.each([
    ["a Cookie header", "header", () => parser.parseCookieHeaderValue(`Cookie: ${pasted(A)}`)],
    ["a www.maxai.co cURL command", "curl", () => parser.parseCurlCommand(curl(`${ORIGIN}/app/`, pasted(A)))],
    ["a HAR file with a www.maxai.co request", "har", () => parser.parseHarDocument(har(harEntry("https://api.maxai.me/models/get_config", DECOY), harEntry(`${ORIGIN}/app/`, A)))],
  ])("imports %s as the three approved cookies", async (_label, kind, parse) => {
    const parsed = parse();
    expect(parsed.ok, parsed.error).toBe(true);
    const built = candidates(kind, parsed);
    expect(built.ok, built.error).toBe(true);
    expect(built.candidates).toHaveLength(1);
    // Same body as CookieImportModal.
    const result = await importCookies({ action: "create", name: `From ${kind}` }, built.candidates[0].cookies);
    expect(result.status).toBe(201);
    expectNoSecrets(result.body, secretsOf(A));
    expect((await rows()).map((entry) => entry.apiKey)).toEqual([headerOf(A)]);
  });

  it("refuses the API request a copied chat cURL or API-only HAR would carry, and a bearer-only cURL", () => {
    const apiCurl = parser.parseCurlCommand(curl(CHAT_URL, headerOf(A)));
    expect(apiCurl.ok).toBe(true);
    const refusals = [
      candidates("curl", apiCurl),
      candidates("har", parser.parseHarDocument(har(harEntry(CHAT_URL, A)))),
      parser.parseCurlCommand(`curl '${CHAT_URL}' -H 'authorization: Bearer ${A.access_token}'`),
    ];
    expect(refusals).toEqual([
      { ok: false, error: "The request origin is not approved for this provider." },
      { ok: false, error: `The HAR file has no request to ${ORIGIN}.` },
      { ok: false, error: "The cURL command has no Cookie header." },
    ]);
  });

  it("names only the missing cookie and asks the operator to choose between two HAR sessions", () => {
    const partial = candidates("header", parser.parseCookieHeaderValue(`access_token=${A.access_token}; user_id=${A.user_id}`));
    expect(partial).toEqual({ ok: false, error: "The input has no device_id cookie." });

    const two = candidates("har", parser.parseHarDocument(har(harEntry(`${ORIGIN}/app/`, A), harEntry(`${ORIGIN}/app/chat`, B))));
    expect(two.candidates).toHaveLength(2);
    expect(parser.candidatesAreAmbiguous(two.candidates)).toBe(true);
  });
});

describe("MaxAI stored credential consumption", () => {
  const PROXY_A = "http://proxy-alpha.invalid:8080";
  const PROXY_B = "http://proxy-bravo.invalid:8080";

  async function twoAccounts() {
    const ids = [];
    for (const [name, entry, proxy] of [["MaxAI alpha", A, PROXY_A], ["MaxAI bravo", B, PROXY_B]]) {
      const result = await importCookies({ action: "create", name }, cookiesOf(entry));
      expect(result.status).toBe(201);
      ids.push(result.body.connection.id);
    }
    await configureAccount(ids[0], PROXY_A, 1);
    await configureAccount(ids[1], PROXY_B, 2);
    return ids;
  }

  it("signs and sends chat as exactly the selected account through that account's proxy", async () => {
    const [idA, idB] = await twoAccounts();
    const before = Date.now();
    const first = await chat();
    expect(first.status).toBe(200);
    const answer = await first.text();
    expect(answer).toContain("synthetic answer");
    expectNoSecrets(answer, secretsOf(A, B));
    expect(await usageAccounts()).toEqual([idA]);

    // An import saves no signing constants, so the executor loads them from the public web app.
    expect(webAppCalls().map((call) => call.url)).toEqual([`${ORIGIN}/app/`, `${ORIGIN}${APP_CHUNK}`, `${ORIGIN}${SIGNER_CHUNK}`]);
    for (const call of webAppCalls()) {
      expect(call.init.headers).toBeUndefined();
      expect(call.init.body).toBeUndefined();
      expectNoSecrets(call.url, secretsOf(A, B));
    }
    expect(sent).toHaveLength(4);
    for (const call of sent) expect(call.proxyOptions).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: PROXY_A });

    const [call] = apiCalls(CHAT_URL);
    expect(call.init.method).toBe("POST");
    expect(call.init.headers.Authorization).toBe(`Bearer ${A.access_token}`);
    expect(Object.keys(call.init.headers).map((name) => name.toLowerCase())).not.toContain("cookie");
    expect(call.init.headers["X-App-Version"]).toBe(SIGNING.appVersion);
    const signature = openSignature(call.init.headers);
    expect(signature).toMatchObject({ d: A.device_id, "X-Client-Domain": "maxai.co", [SIGNING.ctxKey]: { a: "" } });
    expect(signature.p).toMatch(/^[0-9a-f]{64}$/);
    expect(signature.t).toBeGreaterThanOrEqual(before);
    expect(JSON.parse(call.init.body)).toMatchObject({ model_name: "gpt-5.6", message_content: [{ type: "text", text: "user: hello maxai" }] });
    expectNoSecrets(call.init.body, secretsOf(A, B));
    expectNoSecrets(JSON.stringify([call.init.headers, signature]), secretsOf(B));

    // Disabling the first account moves the next request, whole, to the second.
    const disabled = await routes.provider.PUT(request(`/api/providers/${idA}`, { method: "PUT", body: { isActive: false } }), params(idA));
    expect(disabled.status).toBe(200);
    sent.length = 0;
    expect((await chat()).status).toBe(200);
    expect(sent.map((entry) => entry.url)).toEqual([CHAT_URL]); // constants are cached, not per account
    expect(sent[0].proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_B });
    expect(sent[0].init.headers.Authorization).toBe(`Bearer ${B.access_token}`);
    expect(openSignature(sent[0].init.headers).d).toBe(B.device_id);
    expectNoSecrets(JSON.stringify(sent[0]), secretsOf(A));
    expect(await usageAccounts()).toEqual([idA, idB].sort());

    expect(logs.join("\n")).toContain("maxai"); // the capture does see gateway logging
    expectNoSecrets(logs.join("\n"), secretsOf(A, B));
  });

  it("replaces only the paired connection and signs with every replaced value", async () => {
    const [idA, idB] = await twoAccounts();
    const untouched = await row(idB);

    const sign = async () => {
      sent.length = 0;
      const now = vi.spyOn(Date, "now").mockReturnValue(1_795_000_000_000);
      try {
        expect((await chat()).status).toBe(200);
      } finally {
        now.mockRestore();
      }
      const { headers } = apiCalls(CHAT_URL)[0].init;
      return { bearer: headers.Authorization, ...openSignature(headers) };
    };
    const original = await sign();
    expect((await sign()).p).toBe(original.p);

    // Only user_id changes: the proof must change with it.
    const userOnly = await capture(await pairingFor({ action: "update", connectionId: idA }),
      inStore("store-tab", cookiesOf({ ...A, user_id: C.user_id })));
    expect(userOnly.result).toMatchObject({ ok: true, action: "update", connection: { id: idA, name: "MaxAI alpha" } });
    const afterUser = await sign();
    expect(afterUser).toMatchObject({ bearer: original.bearer, d: A.device_id });
    expect(afterUser.p).not.toBe(original.p);

    const replaced = await capture(await pairingFor({ action: "update", connectionId: idA }), inStore("store-tab", cookiesOf(C)));
    expect(replaced.result).toMatchObject({ ok: true, action: "update" });
    expectNoSecrets(replaced.result, secretsOf(A, B, C));
    const afterAll = await sign();
    expect(afterAll).toMatchObject({ bearer: `Bearer ${C.access_token}`, d: C.device_id, p: afterUser.p });
    expect(apiCalls(CHAT_URL)[0].proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_A });

    const stored = await rows();
    expect(stored.map((entry) => entry.id).sort()).toEqual([idA, idB].sort());
    expect(await row(idA)).toMatchObject({ name: "MaxAI alpha", apiKey: headerOf(C), providerSpecificData: { connectionProxyUrl: PROXY_A } });
    expect(await row(idB)).toEqual(untouched);
    expectNoSecrets(logs.join("\n"), secretsOf(A, B, C));
  });

  it("cannot redirect an update pairing to another connection or provider", async () => {
    const [idA, idB] = await twoAccounts();
    const before = [await row(idA), await row(idB)];
    const pairing = await pairingFor({ action: "update", connectionId: idA });
    const hijack = await postImport(pairing, { provider: "maxai", origin: ORIGIN, cookies: cookiesOf(C), connectionId: idB });
    expect(hijack.status).toBe(409);
    expectNoSecrets(await hijack.text(), secretsOf(A, B, C));
    expect([await row(idA), await row(idB)]).toEqual(before);

    const other = await db.createProviderConnection({ provider: "claude-web", authType: "cookie", name: "Other provider", apiKey: "sessionKey=synthetic-other" });
    const refused = await mintPairing({ action: "update", connectionId: other.id });
    expect(refused.status).toBe(409);
  });

  it.each([401, 418])("reports a rejected session (upstream %s) without echoing it and recovers on re-import", async (status) => {
    const created = await importCookies({ action: "create", name: "Expiring" }, cookiesOf(A));
    const { id } = created.body.connection;
    upstream = maxaiNetwork({ chatStatus: (bearer) => (bearer.endsWith(A.access_token) ? status : 200) });

    const failed = await chat();
    expect(failed.ok).toBe(false);
    expectNoSecrets(await failed.text(), secretsOf(A));
    expect((await row(id)).testStatus).not.toBe("active");

    expect((await importCookies({ action: "update", connectionId: id }, cookiesOf(C))).status).toBe(200);
    expect((await row(id)).testStatus).toBe("active");
    sent.length = 0;
    expect((await chat()).status).toBe(200);
    expect(apiCalls(CHAT_URL).map((call) => call.init.headers.Authorization)).toEqual([`Bearer ${C.access_token}`]);
    expectNoSecrets(logs.join("\n"), secretsOf(A, C));
  });

  it.each([[200, true], [401, false], [418, false]])("validates the stored session through the connection test route (HTTP %s)", async (status, valid) => {
    const [idA] = await twoAccounts();
    upstream = maxaiNetwork({ probeStatus: () => status });
    const response = await routes.test.POST(request(`/api/providers/${idA}/test`, { body: {} }), params(idA));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ valid });
    expectNoSecrets(text, secretsOf(A, B));

    expect(network.proxyChecks).toEqual([PROXY_A]);
    const [probe] = apiCalls(CONFIG_URL);
    expect(probe.init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(probe.init.headers.Authorization).toBe(`Bearer ${A.access_token}`);
    expect(openSignature(probe.init.headers).d).toBe(A.device_id);
    for (const call of sent) expect(call.proxyOptions).toMatchObject({ connectionProxyUrl: PROXY_A });
    expect(apiCalls(CHAT_URL)).toEqual([]);
    expectNoSecrets(logs.join("\n"), secretsOf(A, B));
  });

  it("fails closed without calling the API when the signing constants cannot be loaded", async () => {
    expect((await importCookies({ action: "create", name: "No constants" }, cookiesOf(A))).status).toBe(201);
    upstream = async (url) => {
      if (url === `${ORIGIN}/app/`) return new Response("<html>changed build</html>");
      throw new Error(`unmocked MaxAI request: ${url}`);
    };
    const response = await chat();
    expect(response.ok).toBe(false);
    expectNoSecrets(await response.text(), secretsOf(A));
    expect(sent.map((call) => call.url)).toEqual([`${ORIGIN}/app/`]);
    expectNoSecrets(logs.join("\n"), secretsOf(A));
  });
});
