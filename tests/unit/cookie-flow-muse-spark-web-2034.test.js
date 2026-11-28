/**
 * #2034: Muse Spark Web capture and import, proved on the real registry descriptor.
 *
 * Real: provider registry, extension capture module, dashboard paste parsers, pairing and import
 * routes, provider routes, an isolated SQLite database, credential selection, handleChat, the
 * executor and the proxy routing code. Mocked: the management guard, the `chrome` namespace, the
 * physical transport behind the proxy router, the browser pool and the WebSocket. Every credential
 * is synthetic. No live sign-in, provider, browser or proxy is involved, so nothing here shows that
 * Meta accepts these requests. The executor under test is ported from OmniRoute (MIT),
 * open-sse/executors/muse-spark-web.ts.
 *
 * Not parity: the browser step of the token refresh does not receive the connection proxy. See
 * internal/docs/port-reports/cookie-flows/muse-spark-web-2034.md. No assertion here accepts that.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { parsePairing, prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { PAIRING_HEADER } from "../../extensions/provider-cookie-capture/providers.js";
import { buildImportCandidates, candidatesAreAmbiguous, parseCookieHeaderValue, parseCurlCommand, parseHarDocument } from "../../src/shared/utils/cookieImportParser.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const guard = vi.hoisted(() => ({
  canAccessManagementApi: vi.fn(), canManageAccessConfig: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => guard);
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-muse-machine-id" }));

const PROVIDER = "muse-spark-web";
const ORIGIN = "https://www.meta.ai";
const GRAPHQL = `${ORIGIN}/api/graphql`;
const DASHBOARD = "https://dashboard.example";
const PROXY_A = "http://proxy-a.invalid:8001";
const PROXY_B = "http://proxy-b.invalid:8002";
// Synthetic only. Token-safe characters, because the fake page derives its access token from the cookie.
const COOKIE_A = "synthetic-muse-session-a";
const COOKIE_B = "synthetic-muse-session-b";
const COOKIE_NEW = "synthetic-muse-session-renewed";
const DECOY = "synthetic-muse-decoy";
const SECRETS = [COOKIE_A, COOKIE_B, COOKIE_NEW, DECOY];

let root;
let db;
let routes;
let handleChat;
let contractOf;
let pairings;
let direct;
let proxied;
let upstream;
let browser;
let sockets;
let logs;
let restores;
let usageWrites;

class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.frames = 0;
    sockets.push(this);
    queueMicrotask(() => this.onopen());
  }
  send() {
    this.frames += 1;
    if (this.frames !== 2) return;
    queueMicrotask(() => {
      this.onmessage({ data: JSON.stringify({ type: "full", response: { sections: [{ view_model: { primitive: { text: "synthetic reply" } } }] } }) });
      this.onclose({ code: 1000 });
    });
  }
  on() {}
  close() {}
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-muse-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "DURINDOOR_WEB_LOGIN_ORIGIN",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  for (const fn of Object.values(guard)) fn.mockReset().mockReturnValue(true);

  // Closed by default: anything that skips the connection proxy is recorded and fails.
  direct = vi.fn(async () => { throw new Error("closed mock: unproxied request"); });
  vi.stubGlobal("fetch", direct);

  db = await import("@/lib/db/index.js");
  routes = {
    pair: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
  };
  ({ getCookieImportContract: contractOf } = await import("../../src/lib/providers/cookieImport/contract.js"));
  pairings = await import("../../src/lib/providers/cookieImport/pairing.js");
  pairings.clearPairings();
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  // The chat response schedules usage persistence without awaiting it; teardown has to wait for it.
  usageWrites = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");

  proxied = [];
  upstream = () => Response.json({});
  const transport = await import("../../open-sse/utils/proxyFetch.js");
  const dispatchers = new Map([[PROXY_A, { proxy: PROXY_A }], [PROXY_B, { proxy: PROXY_B }]]);
  for (const [url, dispatcher] of dispatchers) transport.__setProxyDispatcherForTesting(url, dispatcher);
  const restoreTransport = transport.__setOriginalFetchForTesting(async (url, init) => {
    const route = [...dispatchers].find(([, dispatcher]) => dispatcher === init.dispatcher)?.[0] ?? null;
    proxied.push({ url: String(url), route, cookie: init.headers?.Cookie, body: init.body });
    return upstream(String(url), init);
  });

  browser = { acquired: [], cookies: [] };
  sockets = [];
  const muse = await import("../../open-sse/executors/muse-spark-web.js");
  muse.__setMuseSparkBrowserPoolForTesting({
    acquire: async (key) => {
      browser.acquired.push(key);
      const pooled = { value: "" };
      pooled.context = { addCookies: async (cookies) => { browser.cookies.push(...cookies); pooled.value = cookies[0].value; } };
      return pooled;
    },
    openPage: async (pooled) => ({
      route: async () => {}, routeWebSocket: async () => {}, goto: async () => {}, close: async () => {},
      url: () => `${ORIGIN}/`, content: async () => `"accessToken":"ecto1:access-${pooled.value}"`,
    }),
    release: async () => {},
  });
  const restoreSocket = muse.__setMuseSparkWebSocketForTesting(FakeSocket);
  restores = [
    restoreSocket, restoreTransport, () => transport.__clearProxyDispatchersForTesting(),
    () => muse.__setMuseSparkBrowserPoolForTesting(undefined), () => muse.__resetMuseSparkTokenCacheForTesting(),
    () => muse.__resetMuseSparkConversationCacheForTesting(),
  ];
}, 60_000);

afterEach(async () => {
  await Promise.allSettled(usageWrites.mock.results.map((result) => result.value));
  for (const restore of restores) restore();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

const json = (url, body, method = "POST", headers = {}) => new NextRequest(new URL(url, DASHBOARD), {
  method, headers: { "content-type": "application/json", origin: DASHBOARD, ...headers },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const params = (id) => ({ params: Promise.resolve({ id }) });
const logged = () => logs.flatMap((spy) => spy.mock.calls).map((call) => call.map((arg) => String(arg?.stack ?? JSON.stringify(arg) ?? arg)).join(" ")).join("\n");
const expectNoSecrets = (text, extra = []) => { for (const secret of [...SECRETS, ...extra]) expect(text).not.toContain(secret); };
const rows = () => db.getProviderConnections({ provider: PROVIDER });
const nothingSent = () => {
  expect(proxied).toEqual([]);
  expect(browser.acquired).toEqual([]);
  expect(sockets).toEqual([]);
  expect(direct.mock.calls.filter(([url]) => /meta\.ai|meta\.com/.test(String(url)))).toEqual([]);
};

async function pair(body, status = 201) {
  const res = await routes.pair.POST(json("/api/providers/cookie-import/pairing", { provider: PROVIDER, ...body }));
  expect(res.status).toBe(status);
  return (await res.json()).pairing;
}
async function submit(pairing, body) {
  const res = await routes.import.POST(json("/api/providers/cookie-import", { provider: PROVIDER, origin: ORIGIN, ...body }, "POST", { [PAIRING_HEADER]: pairing.token }));
  const text = await res.text();
  expectNoSecrets(text, [pairing.token]);
  return { status: res.status, body: JSON.parse(text) };
}

/** Read a paste as the dashboard dialog does: one parser per input kind, then the shared selection. */
function readPaste(kind, text) {
  const parse = { header: parseCookieHeaderValue, curl: parseCurlCommand, har: parseHarDocument }[kind];
  const parsed = parse(text);
  return parsed.ok ? buildImportCandidates({ kind, parsed }, contractOf(PROVIDER)) : parsed;
}
async function importValue(value, target) {
  const built = readPaste("header", `Cookie: ecto_1_sess=${value}`);
  const pairing = await pair(target);
  const identity = target.action === "create" ? { name: target.name } : { connectionId: target.connectionId };
  const result = await submit(pairing, { cookies: built.candidates[0].cookies, ...identity });
  expect(result.status).toBe(target.action === "create" ? 201 : 200);
  return db.getProviderConnectionById(result.body.connection.id);
}

const harEntry = (url, cookie, extra = []) => ({ request: { url, headers: [{ name: "Cookie", value: cookie }], cookies: extra } });
const har = (...entries) => JSON.stringify({ log: { entries } });

describe("Muse Spark Web real import contract", () => {
  it("derives one required cookie on the www origin and nothing else from the registry", async () => {
    const { default: registry } = await import("../../open-sse/providers/registry/index.js");
    const contract = contractOf(PROVIDER);
    expect(contract.config).toBe(registry.find((entry) => entry.id === PROVIDER).webLogin);
    expect(contract).toMatchObject({ authType: "cookie", origin: ORIGIN, host: "www.meta.ai", extensionCapture: true, cookieNames: ["ecto_1_sess"], cookiePrefixes: [] });
    for (const field of ["optionalCookies", "localStorageKeys", "hashedCookiePrefixes", "accountEmail", "credentialPattern"]) expect(contract).not.toHaveProperty(field);

    const pairing = await pair({ action: "create", name: "Muse" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: ["ecto_1_sess"], cookiePrefixes: [] });
    // `auth.meta.com` is a sign-in navigation host; it never becomes a credential origin.
    expect(contract.config.allowedHosts).toEqual(["auth.meta.com"]);
    expect(parsePairing(JSON.stringify({ pairing })).plan).toMatchObject({ providerOrigin: ORIGIN, cookieNames: ["ecto_1_sess"], cookiePrefixes: [], localStorageKeys: [], optionalCookies: [] });
  });

  it("lets a pairing neither widen the cookie allowlist nor move the origin", async () => {
    const pairing = await pair({ action: "create", name: "Muse" });
    const edit = (contract) => parsePairing(JSON.stringify({ pairing: { ...pairing, contract: { ...pairing.contract, ...contract } } }));
    expect(edit({ cookieNames: ["ecto_1_sess", "datr"], cookiePrefixes: ["ecto_1_sess."], optionalCookies: ["abra_sess"], localStorageKeys: ["token"] }).plan)
      .toMatchObject({ cookieNames: ["ecto_1_sess"], cookiePrefixes: [], optionalCookies: [], localStorageKeys: [] });
    expect(edit({ cookieNames: ["abra_sess"] })).toMatchObject({ ok: false, code: "invalid_pairing" });
    for (const origin of ["https://meta.ai", "https://auth.meta.com", "http://www.meta.ai"]) expect(edit({ origin }), origin).toMatchObject({ ok: false, code: "origin_mismatch" });
  });
});

/** Fake chrome.* holding more cookies than the contract approves. It records every access. */
function fakeChrome({ tabUrl = `${ORIGIN}/`, session } = {}) {
  const jar = {
    ecto_1_sess: session === undefined ? { name: "ecto_1_sess", value: COOKIE_A, domain: ".meta.ai", secure: true } : session,
    ...Object.fromEntries(["ecto_1_sess.0", "abra_sess", "datr"].map((name) => [name, { name, value: DECOY, domain: ".meta.ai", secure: true }])),
  };
  const held = new Set();
  const calls = { reads: [], requested: [], removed: [] };
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const forbidden = async () => { throw new Error("Muse capture must not use this API"); };
  return {
    calls,
    chrome: {
      tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async () => ({ id: 7, url: tabUrl }) },
      permissions: {
        contains: async (query) => names(query).every((name) => held.has(name)),
        request: async (query) => { calls.requested.push(structuredClone(query)); names(query).forEach((name) => held.add(name)); return true; },
        remove: async (query) => { calls.removed.push(structuredClone(query)); names(query).forEach((name) => held.delete(name)); return true; },
      },
      cookies: {
        getAll: forbidden,
        getAllCookieStores: async () => [{ id: "other-profile", tabIds: [99] }, { id: "tab-store", tabIds: [7] }],
        get: async (query) => { calls.reads.push(query); return jar[query.name] ?? null; },
      },
      scripting: { executeScript: forbidden },
    },
  };
}

/** The extension's one POST goes into the real import route. */
function importFetch(sent) {
  return vi.fn(async (url, init) => {
    sent.push({ url, init });
    return routes.import.POST(new NextRequest(url, { method: init.method, headers: init.headers, body: init.body }));
  });
}
async function capture(target, chromeOptions) {
  const pairing = await pair(target);
  const harness = fakeChrome(chromeOptions);
  const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
  const sent = [];
  const fetch = importFetch(sent);
  const result = prepared.ok
    ? await runCapture({ chrome: harness.chrome, fetch, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) })
    : prepared;
  return { ...harness, pairing, result, sent, fetch };
}

describe("Muse Spark Web extension capture into the real import route", () => {
  it("reads only ecto_1_sess from the confirmed tab's store and saves it encrypted", async () => {
    const run = await capture({ action: "create", name: "Captured" });
    expect(run.result).toMatchObject({ ok: true, action: "create", cookieCount: 1, connection: { name: "Captured" } });
    expect(run.calls.reads).toEqual([{ url: `${ORIGIN}/`, name: "ecto_1_sess", storeId: "tab-store" }]);
    const grant = { permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] };
    expect(run.calls.requested).toEqual([grant]);
    expect(run.calls.removed).toEqual([grant]);
    expect(run.fetch).toHaveBeenCalledOnce();
    expect(run.sent[0]).toMatchObject({ url: `${DASHBOARD}/api/providers/cookie-import`, init: { credentials: "omit", redirect: "error" } });
    expect(JSON.parse(run.sent[0].init.body)).toEqual({ provider: PROVIDER, origin: ORIGIN, cookies: [{ name: "ecto_1_sess", value: COOKIE_A, domain: "meta.ai", secure: true }] });

    const [row] = await rows();
    expect(row).toMatchObject({ provider: PROVIDER, authType: "cookie", apiKey: `ecto_1_sess=${COOKIE_A}`, isActive: true });
    expect(row.providerSpecificData?.enableSessionDispatch).toBeUndefined();
    expect(JSON.stringify(global._dbAdapter.instance.all("SELECT * FROM providerConnections"))).not.toContain(COOKIE_A);
    const listed = await (await routes.providers.GET(json("/api/providers", null, "GET"))).text();
    expect(listed).toContain(row.id);
    expectNoSecrets(listed);
    expectNoSecrets(JSON.stringify(run.result) + logged(), [run.pairing.token]);
    nothingSent();
  });

  it.each(["https://meta.ai/", "https://auth.meta.com/login", "https://www.meta.ai.example/", "http://www.meta.ai/"])(
    "refuses the tab %s before any permission, cookie read or request", async (tabUrl) => {
      const run = await capture({ action: "create", name: "Muse" }, { tabUrl });
      expect(run.result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
      expect(run.calls).toEqual({ reads: [], requested: [], removed: [] });
      expect(run.fetch).not.toHaveBeenCalled();
      expect(await rows()).toEqual([]);
    });

  it.each([
    ["absent", null],
    ["on the sign-in host", { name: "ecto_1_sess", value: COOKIE_A, domain: "auth.meta.com", secure: true }],
    ["not secure", { name: "ecto_1_sess", value: COOKIE_A, domain: ".meta.ai", secure: false }],
    ["empty", { name: "ecto_1_sess", value: "", domain: ".meta.ai", secure: true }],
  ])("sends nothing when the session cookie is %s", async (_label, session) => {
    const run = await capture({ action: "create", name: "Muse" }, { session });
    expect(run.result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(run.fetch).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
    expectNoSecrets(JSON.stringify(run.result) + logged());
  });

  it("keeps the stored session when the captured replacement has expired", async () => {
    const saved = await importValue(COOKIE_A, { action: "create", name: "Muse" });
    const session = { name: "ecto_1_sess", value: COOKIE_NEW, domain: ".meta.ai", secure: true, expirationDate: 1 };
    const run = await capture({ action: "update", connectionId: saved.id }, { session });
    expect(run.result).toMatchObject({ ok: false, code: "rejected" });
    expect(run.fetch).toHaveBeenCalledOnce();
    expect(await db.getProviderConnectionById(saved.id)).toEqual(saved);
    expectNoSecrets(JSON.stringify(run.result) + logged(), [run.pairing.token]);
  });
});

describe("Muse Spark Web dashboard paste import", () => {
  // Padding and percent-escapes must survive byte for byte.
  const value = `${COOKIE_A}%3Aversion==`;
  const noisy = `datr=${DECOY}; ecto_1_sess=${value}; abra_sess=${DECOY}`;

  it.each([
    // The trailing `ecto1:` fragment is the second credential OmniRoute's current hint asks for; it is dropped.
    ["Cookie header", "header", `Cookie: ${noisy}; ecto1:${DECOY}`],
    ["cURL -H", "curl", `curl '${GRAPHQL}' \\\n  -H 'accept: */*' \\\n  -H 'cookie: ${noisy}' --data-raw '{}'`],
    ["cURL -b", "curl", `curl -b '${noisy}' '${ORIGIN}/'`],
    ["HAR", "har", har(
      harEntry("https://meta.ai/", `ecto_1_sess=${DECOY}`),
      harEntry("https://auth.meta.com/", `ecto_1_sess=${DECOY}`),
      harEntry(GRAPHQL, noisy),
    )],
  ])("imports a %s paste as the single approved cookie", async (_label, kind, text) => {
    const built = readPaste(kind, text);
    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0]).toMatchObject({ origin: ORIGIN, cookies: [{ name: "ecto_1_sess", value }] });
    const pairing = await pair({ action: "create", name: "Pasted" });
    expect((await submit(pairing, { name: "Pasted", cookies: built.candidates[0].cookies })).status).toBe(201);
    expect((await rows()).map((row) => row.apiKey)).toEqual([`ecto_1_sess=${value}`]);
    expectNoSecrets(logged(), [pairing.token]);
    nothingSent();
  });

  it.each([
    ["a bare cookie value", "header", COOKIE_A, /No cookie name=value pair/],
    ["localStorage JSON", "har", JSON.stringify({ ecto_1_sess: COOKIE_A }), /no request entries/],
    ["numbered chunks", "header", `ecto_1_sess.0=${COOKIE_A}; ecto_1_sess.1=${COOKIE_B}`, /no ecto_1_sess cookie/],
    ["only the legacy abra_sess name", "header", `abra_sess=${COOKIE_A}`, /no ecto_1_sess cookie/],
    ["cURL to the apex origin", "curl", `curl 'https://meta.ai/' -H 'Cookie: ecto_1_sess=${COOKIE_A}'`, /origin is not approved/],
    ["cURL to the sign-in host", "curl", `curl 'https://auth.meta.com/' -H 'Cookie: ecto_1_sess=${COOKIE_A}'`, /origin is not approved/],
    ["cURL over plain HTTP", "curl", `curl 'http://www.meta.ai/' -H 'Cookie: ecto_1_sess=${COOKIE_A}'`, /origin is not approved/],
    ["a cURL cookie-jar file", "curl", `curl -b cookies.txt '${ORIGIN}/'`, /no Cookie header/],
    ["a HAR without a www.meta.ai request", "har", har(harEntry("https://meta.ai/", `ecto_1_sess=${COOKIE_A}`)), /no request to https:\/\/www\.meta\.ai/],
  ])("refuses %s without echoing it", (_label, kind, text, message) => {
    const built = readPaste(kind, text);
    expect(built).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    expectNoSecrets(built.error);
  });

  it("requires a choice when one HAR holds two Muse sessions", () => {
    const built = readPaste("har", har(harEntry(GRAPHQL, `ecto_1_sess=${COOKIE_A}`), harEntry(GRAPHQL, `ecto_1_sess=${COOKIE_B}`)));
    expect(built.candidates.map((candidate) => candidate.cookies[0].value)).toEqual([COOKIE_A, COOKIE_B]);
    expect(candidatesAreAmbiguous(built.candidates)).toBe(true);
  });

  const good = { name: "ecto_1_sess", value: COOKIE_A };
  it.each([
    ["the apex origin", { origin: "https://meta.ai" }],
    ["the sign-in origin", { origin: "https://auth.meta.com" }],
    ["a sign-in host cookie domain", { cookies: [{ ...good, domain: "auth.meta.com" }] }],
    ["an extra cookie", { cookies: [good, { name: "datr", value: DECOY }] }],
    ["a chunk name", { cookies: [{ name: "ecto_1_sess.0", value: COOKIE_A }] }],
    ["an expired cookie", { cookies: [{ ...good, expirationDate: 1 }] }],
    ["an insecure cookie", { cookies: [{ ...good, secure: false }] }],
    ["a localStorage value", { localStorage: { ecto_1_sess: COOKIE_A } }],
    ["a request-supplied account email", { accountEmail: "synthetic@example.invalid" }],
  ])("has the server refuse %s and spend the pairing", async (_label, change) => {
    const pairing = await pair({ action: "create", name: "Muse" });
    const body = { name: "Muse", cookies: [good] };
    expect((await submit(pairing, { ...body, ...change })).status).toBe(400);
    expect((await submit(pairing, body)).status).toBe(401);
    expect(await rows()).toEqual([]);
    expectNoSecrets(logged(), [pairing.token]);
    nothingSent();
  });
});

describe("Muse Spark Web authority and update ownership", () => {
  it("issues only to an operator, same origin, with no account email", async () => {
    guard.isOperatorRequest.mockReturnValue(false);
    await pair({ action: "create", name: "Muse" }, 403);
    guard.isOperatorRequest.mockReturnValue(true);
    guard.hasExactRequestOrigin.mockReturnValue(false);
    await pair({ action: "create", name: "Muse" }, 403);
    guard.hasExactRequestOrigin.mockReturnValue(true);
    await pair({ action: "create", name: "Muse", accountEmail: "synthetic@example.invalid" }, 400);
    expect(pairings.pendingPairingCount()).toBe(0);
  });

  it("updates only the bound Muse account and keeps its settings", async () => {
    const a = await importValue(COOKIE_A, { action: "create", name: "Account A" });
    const b = await importValue(COOKIE_B, { action: "create", name: "Account B" });
    const other = await db.createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Other", apiKey: `sso=${DECOY}`, isActive: true });
    await pair({ action: "update", connectionId: other.id }, 409);
    await pair({ provider: "grok-web", action: "update", connectionId: a.id }, 409);

    const cookies = [{ name: "ecto_1_sess", value: COOKIE_NEW }];
    const redirected = await pair({ action: "update", connectionId: a.id });
    expect((await submit(redirected, { connectionId: b.id, cookies })).status).toBe(409);
    expect((await submit(redirected, { connectionId: a.id, cookies })).status).toBe(401);
    expect([await db.getProviderConnectionById(a.id), await db.getProviderConnectionById(b.id)]).toMatchObject([{ apiKey: a.apiKey }, { apiKey: b.apiKey }]);

    await db.updateProviderConnection(a.id, { providerSpecificData: { ...a.providerSpecificData, enableSessionDispatch: true, connectionProxyEnabled: true, connectionProxyUrl: PROXY_A } });
    const siblingBefore = await db.getProviderConnectionById(b.id);
    const run = await capture({ action: "update", connectionId: a.id }, { session: { name: "ecto_1_sess", value: COOKIE_NEW, domain: "www.meta.ai", secure: true } });
    expect(run.result).toMatchObject({ ok: true, action: "update", connection: { id: a.id } });
    expect(await db.getProviderConnectionById(a.id)).toMatchObject({
      name: "Account A", apiKey: `ecto_1_sess=${COOKIE_NEW}`, testStatus: "active",
      providerSpecificData: { enableSessionDispatch: true, connectionProxyEnabled: true, connectionProxyUrl: PROXY_A },
    });
    expect(await db.getProviderConnectionById(b.id)).toEqual(siblingBefore);
    expect((await db.getProviderConnectionById(other.id)).apiKey).toBe(`sso=${DECOY}`);
    expect(await rows()).toHaveLength(2);
    expectNoSecrets(JSON.stringify(run.result) + logged(), [run.pairing.token, redirected.token]);
  });
});

/** The operator's opt-in and connection settings go through the real update route. */
async function configure(id, body) {
  const res = await routes.provider.PUT(json(`/api/providers/${id}`, body, "PUT"), params(id));
  expect(res.status).toBe(200);
  expectNoSecrets(await res.text());
}
const optIn = (id, proxy, priority) => configure(id, {
  priority, connectionProxyEnabled: true, connectionProxyUrl: proxy, providerSpecificData: { enableSessionDispatch: true },
});
async function chat() {
  const res = await handleChat(json("/v1/chat/completions", { model: "ms-web/muse-spark", stream: false, messages: [{ role: "user", content: "hello" }] }));
  const text = await res.text();
  expectNoSecrets(text);
  return { status: res.status, text };
}
/** All traffic of one turn: three proxied GraphQL calls, one browser cookie, one proxied WebSocket. */
function expectTurn(value, proxy, turn = 0) {
  const calls = proxied.slice(turn * 3, turn * 3 + 3);
  expect(calls.map(({ url, route, cookie }) => ({ url, route, cookie }))).toEqual(Array(3).fill({ url: GRAPHQL, route: proxy, cookie: `ecto_1_sess=${value}` }));
  expect(browser.cookies[turn]).toEqual({ name: "ecto_1_sess", value, domain: "www.meta.ai", path: "/", secure: true });
  const socket = sockets[turn];
  expect(new URL(socket.url).host).toBe("gateway.meta.ai");
  expect(new URL(socket.url).searchParams.get("Authorization")).toBe(`ecto1:access-${value}`);
  expect(socket.options.agent.proxy.href).toBe(`${proxy}/`);
  expect(socket.options.headers).not.toHaveProperty("Cookie");
  expect(socket.options.followRedirects).toBe(false);
}

describe("Muse Spark Web imported credential consumption", () => {
  it("stays guarded after import until the operator opts that account in", async () => {
    await importValue(COOKIE_A, { action: "create", name: "Muse" });
    const result = await chat();
    expect(result.status).toBe(501);
    expect(result.text).toMatch(/not ported yet/);
    nothingSent();
  });

  it("sends the chosen account's stored cookie through its own proxy", async () => {
    const sibling = await importValue(COOKIE_B, { action: "create", name: "Sibling" });
    const chosen = await importValue(COOKIE_A, { action: "create", name: "Chosen" });
    await optIn(sibling.id, PROXY_B, 2);
    await optIn(chosen.id, PROXY_A, 1);
    const siblingBefore = await db.getProviderConnectionById(sibling.id);
    const result = await chat();
    expect(result.status).toBe(200);
    expect(result.text).toContain("synthetic reply");
    expect(proxied).toHaveLength(3);
    expect(sockets).toHaveLength(1);
    expectTurn(COOKIE_A, PROXY_A);
    expect(JSON.stringify([proxied, browser, sockets.map((socket) => socket.url)])).not.toContain(COOKIE_B);
    expect(direct.mock.calls.filter(([url]) => /meta\.ai/.test(String(url)))).toEqual([]);
    expect((await db.getProviderConnectionById(sibling.id)).apiKey).toBe(siblingBefore.apiKey);
    expectNoSecrets(logged());
  });

  // The registry hint offers a bare value. The import dialog refuses it; the manual Add form stores it as typed.
  // Post-fix (#2034): "=" used only as trailing padding is part of a bare value, not a cookie name.
  it("names a manually added bare value, including one with trailing = padding", async () => {
    const add = async (name, apiKey) => {
      const res = await routes.providers.POST(json("/api/providers", { provider: PROVIDER, name, apiKey }));
      expect(res.status).toBe(201);
      return (await res.json()).connection;
    };
    const padded = await add("Padded", `${COOKIE_B}==`);
    await optIn(padded.id, PROXY_B, 1);
    // The shared fake page derives its token from the cookie; this one strips the padding it cannot carry.
    const muse = await import("../../open-sse/executors/muse-spark-web.js");
    muse.__setMuseSparkBrowserPoolForTesting({
      acquire: async (key) => {
        browser.acquired.push(key);
        const pooled = { value: "" };
        pooled.context = { addCookies: async (cookies) => { browser.cookies.push(...cookies); pooled.value = cookies[0].value; } };
        return pooled;
      },
      openPage: async (pooled) => ({
        route: async () => {}, routeWebSocket: async () => {}, goto: async () => {}, close: async () => {},
        url: () => `${ORIGIN}/`, content: async () => `"accessToken":"ecto1:access-${pooled.value.replace(/=+$/, "")}"`,
      }),
      release: async () => {},
    });
    expect((await chat()).status).toBe(200);
    expect(proxied.map(({ url, route, cookie }) => ({ url, route, cookie }))).toEqual(Array(3).fill({ url: GRAPHQL, route: PROXY_B, cookie: `ecto_1_sess=${COOKIE_B}==` }));
    expect(browser.cookies).toEqual([{ name: "ecto_1_sess", value: `${COOKIE_B}==`, domain: "www.meta.ai", path: "/", secure: true }]);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].options.agent.proxy.href).toBe(`${PROXY_B}/`);
    expect(direct.mock.calls.filter(([url]) => /meta\.ai|meta\.com/.test(String(url)))).toEqual([]);
    expect((await db.getProviderConnectionById(padded.id)).apiKey).toBe(`${COOKIE_B}==`);
    proxied.length = 0;
    browser.acquired.length = 0;
    browser.cookies.length = 0;
    sockets.length = 0;

    await db.deleteProviderConnection(padded.id);
    const bare = await add("Bare", COOKIE_A);
    await optIn(bare.id, PROXY_A, 1);
    expect((await chat()).status).toBe(200);
    expectTurn(COOKIE_A, PROXY_A);
    expect((await db.getProviderConnectionById(bare.id)).apiKey).toBe(COOKIE_A);
    expectNoSecrets(logged());
  });

  it("uses a re-imported cookie and a new access token on the next turn", async () => {
    const saved = await importValue(COOKIE_A, { action: "create", name: "Muse" });
    await optIn(saved.id, PROXY_A, 1);
    expect((await chat()).status).toBe(200);
    await importValue(COOKIE_NEW, { action: "update", connectionId: saved.id });
    expect((await chat()).status).toBe(200);
    expectTurn(COOKIE_A, PROXY_A, 0);
    expectTurn(COOKIE_NEW, PROXY_A, 1);
    expect(new Set(browser.acquired).size).toBe(2);
    expectNoSecrets(logged());
  });

  // Post-fix (#2034): the rotation is written back through the dispatcher's guarded callback.
  it("uses a rotated cookie for the turn and writes it to the stored credential", async () => {
    const saved = await importValue(COOKIE_A, { action: "create", name: "Muse" });
    await optIn(saved.id, PROXY_A, 1);
    upstream = () => proxied.length === 1
      ? new Response("{}", { headers: { "set-cookie": `ecto_1_sess=${COOKIE_NEW}; Path=/; Secure` } })
      : Response.json({});
    expect((await chat()).status).toBe(200);
    expect(proxied.map((call) => call.cookie)).toEqual([COOKIE_A, COOKIE_NEW, COOKIE_NEW].map((v) => `ecto_1_sess=${v}`));
    expect(browser.cookies.map((cookie) => cookie.value)).toEqual([COOKIE_NEW]);
    // Post-fix: the stored credential now holds the rotated value, in the stored header shape.
    expect((await db.getProviderConnectionById(saved.id)).apiKey).toBe(`ecto_1_sess=${COOKIE_NEW}`);
    expect((await chat()).status).toBe(200);
    expect(proxied.slice(3).map((call) => call.cookie)).toEqual(Array(3).fill(`ecto_1_sess=${COOKIE_NEW}`));
    expectNoSecrets(logged());
  });

  it("reports an expired runtime session without opening the browser or WebSocket", async () => {
    const saved = await importValue(COOKIE_A, { action: "create", name: "Muse" });
    await optIn(saved.id, PROXY_A, 1);
    upstream = () => new Response("", { status: 302, headers: { location: "https://auth.meta.com/" } });
    const result = await chat();
    expect(result.status).toBe(401);
    expect(result.text).toMatch(/re-import/);
    expect(proxied.map((call) => call.route)).toEqual([PROXY_A]);
    expect(browser.acquired).toEqual([]);
    expect(sockets).toEqual([]);
    expectNoSecrets(logged());
  });

  it("does not fall back to direct egress when a strict proxy fails the bootstrap", async () => {
    const saved = await importValue(COOKIE_A, { action: "create", name: "Muse" });
    const pool = await db.createProxyPool({ name: "Strict", proxyUrl: PROXY_A, strictProxy: true, isActive: true });
    await configure(saved.id, { proxyPoolId: pool.id, providerSpecificData: { enableSessionDispatch: true } });
    upstream = () => { throw new Error("synthetic proxy failure"); };
    const result = await chat();
    expect(result.status).toBe(502);
    expect(proxied.map((call) => call.route)).toEqual([PROXY_A]);
    expect(direct.mock.calls.filter(([url]) => /meta\.ai/.test(String(url)))).toEqual([]);
    expect(browser.acquired).toEqual([]);
    expect(sockets).toEqual([]);
    expectNoSecrets(logged());
  });
});
