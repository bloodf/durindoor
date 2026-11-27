/**
 * #2034: Grok Web web-cookie flow, capture or import through to the upstream request, offline.
 * Report: internal/docs/port-reports/cookie-flows/grok-web-2034.md
 *
 * Real: the grok-web registry entry, the extension's pairing parser, tab check, permission and
 * cookie selection code, the dashboard input parser, the pairing and import routes, an isolated
 * SQLite database, the provider and proxy-pool routes, handleChat, account selection, proxy
 * resolution, the grok-web executor and proxyAwareFetch.
 *
 * Mocked: the dashboard guard's four authority answers, the `chrome` namespace, the final
 * network call under proxyAwareFetch and the proxy dispatchers. Every credential is synthetic.
 * Nothing here shows that grok.com accepts these requests; there is no browser or live sign-in.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmationFor, prepareCapture, runCapture } from "../../extensions/provider-cookie-capture/capture.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const guard = vi.hoisted(() => ({
  canAccessManagementApi: vi.fn(),
  canManageAccessConfig: vi.fn(),
  isOperatorRequest: vi.fn(),
  hasExactRequestOrigin: vi.fn(),
}));
vi.mock("@/dashboardGuard", async (importOriginal) => ({ ...(await importOriginal()), ...guard }));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const DASHBOARD = "https://dashboard.example";
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;
const ORIGIN = "https://grok.com";
const CHAT_URL = `${ORIGIN}/rest/app-chat/conversations/new`;
const TAB_ID = 7;
const TAB_STORE = "store-of-the-tab";

// Distinct synthetic values, so any leak or cross-account use is attributable.
const SSO_A = "synthetic-grok-sso-account-a";
const SSO_B = "synthetic-grok-sso-account-b";
const SSO_NEW = "synthetic-grok-sso-account-a-renewed";
const OTHER_STORE_SSO = "synthetic-grok-sso-other-browser-profile";
const XAI_SSO = "synthetic-xai-accounts-sso";
const SSO_RW = "synthetic-grok-sso-rw";
const CLEARANCE = "synthetic-grok-clearance";
const SECRETS = [SSO_A, SSO_B, SSO_NEW, OTHER_STORE_SSO, XAI_SSO, SSO_RW, CLEARANCE];

let root;
let realFetch;
let db;
let routes;
let handleChat;
let proxyFetch;
let clearPairings;
let pendingPairingCount;
let registryEntry;
let uiContract;
let parser;
let network;
let logSpies;
let usageWrites;

const request = (url, body, { method = "POST", headers = {} } = {}) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json", origin: DASHBOARD, "x-9r-cli-token": "synthetic-operator", ...headers },
  ...(method === "GET" ? null : { body: JSON.stringify(body) }),
});
const params = (id) => ({ params: Promise.resolve({ id }) });
const rows = () => db.getProviderConnections({ provider: "grok-web" });
const row = (id) => db.getProviderConnectionById(id);

/** Every secret (cookie values plus any pairing token passed in) is absent from `value`. */
function expectNoSecrets(value, extra = []) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of [...SECRETS, ...extra]) expect(text).not.toContain(secret);
}
const loggedText = () => logSpies.flatMap((spy) => spy.mock.calls).map((args) => inspect(args, { depth: 8 })).join("\n");
const expectCleanLogs = (extra = []) => expectNoSecrets(loggedText(), extra);

const pairingCall = (body, options) => routes.pairing.POST(request(`${IMPORT_URL}/pairing`, body, options));
async function mintPairing(body) {
  const response = await pairingCall({ provider: "grok-web", ...body });
  const payload = await response.json();
  expect(response.status, payload.error).toBe(201);
  return payload.pairing;
}
/** The request the dashboard modal and the extension both send: no dashboard session, pairing header only. */
const importCall = (pairing, body) => routes.import.POST(new NextRequest(IMPORT_URL, {
  method: "POST",
  headers: { "content-type": "application/json", [pairing.header]: pairing.token },
  body: JSON.stringify(body),
}));
const sso = (value, extra = {}) => ({ name: "sso", value, domain: ".grok.com", secure: true, ...extra });

/** A signed-in browser: the tab's cookie store plus a second profile and unrelated cookies. */
function browser({ tabUrl = `${ORIGIN}/`, session = sso(SSO_A) } = {}) {
  const jars = {
    "other-profile": { sso: sso(OTHER_STORE_SSO) },
    [TAB_STORE]: {
      ...(session ? { sso: session } : null),
      "sso-rw": sso(SSO_RW, { name: "sso-rw" }),
      cf_clearance: sso(CLEARANCE, { name: "cf_clearance" }),
    },
  };
  const held = new Set();
  const reads = [];
  const granted = [];
  const removed = [];
  const wanted = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const forbidden = (api) => vi.fn(async () => { throw new Error(`${api} must not be used for grok-web`); });
  const chrome = {
    tabs: {
      query: async () => [{ id: TAB_ID, url: tabUrl }],
      get: async () => ({ id: TAB_ID, url: tabUrl }),
    },
    permissions: {
      contains: async (query) => wanted(query).every((name) => held.has(name)),
      request: async (query) => { granted.push(structuredClone(query)); wanted(query).forEach((name) => held.add(name)); return true; },
      remove: async (query) => { removed.push(structuredClone(query)); wanted(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "other-profile", tabIds: [999] }, { id: TAB_STORE, tabIds: [TAB_ID] }],
      get: async (details) => { reads.push({ ...details }); return jars[details.storeId]?.[details.name] ?? null; },
      getAll: forbidden("cookies.getAll"),
    },
    scripting: { executeScript: forbidden("scripting.executeScript") },
  };
  return { chrome, reads, granted, removed, held };
}

/** Paste the real pairing response into the real extension and confirm; its one POST hits the real import route. */
async function captureWithExtension(pairing, harness = browser()) {
  const sent = [];
  const answers = [];
  const bridge = vi.fn(async (url, init) => {
    sent.push({ url, init });
    const response = await routes.import.POST(new NextRequest(url, { method: init.method, headers: init.headers, body: init.body }));
    answers.push(await response.clone().text());
    return response;
  });
  const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { ...harness, prepared, sent, answers };
  const result = await runCapture({ chrome: harness.chrome, fetch: bridge, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  return { ...harness, prepared, result, sent, answers };
}

async function importedAccount(name, value) {
  const captured = await captureWithExtension(await mintPairing({ action: "create", name }), browser({ session: sso(value) }));
  expect(captured.result).toMatchObject({ ok: true, action: "create", cookieCount: 1, connection: { name } });
  return row(captured.result.connection.id);
}

/** Bind one account to its own strict proxy pool through the dashboard routes. */
async function bindProxy(connectionId, label) {
  const proxyUrl = `http://proxy-${label}.invalid:8080`;
  const created = await routes.proxyPools.POST(request(`${DASHBOARD}/api/proxy-pools`, { name: `pool-${label}`, proxyUrl, strictProxy: true }));
  expect(created.status).toBe(201);
  const { proxyPool } = await created.json();
  const bound = await routes.provider.PUT(request(`${DASHBOARD}/api/providers/${connectionId}`, { proxyPoolId: proxyPool.id }, { method: "PUT" }), params(connectionId));
  expect(bound.status).toBe(200);
  // No close(): proxyFetch treats such a test dispatcher as pinned and never evicts it.
  const dispatcher = { label };
  proxyFetch.__setProxyDispatcherForTesting(proxyUrl, dispatcher);
  return { proxyPoolId: proxyPool.id, dispatcher };
}

const setActive = async (id, isActive) => {
  const response = await routes.provider.PUT(request(`${DASHBOARD}/api/providers/${id}`, { isActive }, { method: "PUT" }), params(id));
  expect(response.status).toBe(200);
  expectNoSecrets(await response.text());
};

const reply = (text) => new Response(`${JSON.stringify({ result: { response: { modelResponse: { message: text } } } })}\n`);
const chat = () => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "gw/grok-4", messages: [{ role: "user", content: "synthetic prompt" }] }),
}));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-grok-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  for (const mock of Object.values(guard)) mock.mockReset();
  guard.canAccessManagementApi.mockResolvedValue(true);
  guard.canManageAccessConfig.mockResolvedValue(true);
  guard.isOperatorRequest.mockResolvedValue(true);
  guard.hasExactRequestOrigin.mockReturnValue(true);
  logSpies = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

  realFetch = globalThis.fetch;
  proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  // The last hop. Anything a test did not expect fails here instead of leaving the process.
  network = vi.fn(async () => { throw new Error("unmocked outbound request"); });
  proxyFetch.__setOriginalFetchForTesting(network);

  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    proxyPools: await import("../../src/app/api/proxy-pools/route.js"),
  };
  ({ clearPairings, pendingPairingCount } = await import("../../src/lib/providers/cookieImport/pairing.js"));
  clearPairings();
  registryEntry = (await import("../../open-sse/providers/registry/grok-web.js")).default;
  uiContract = (await import("../../src/shared/constants/providers.js")).WEB_COOKIE_PROVIDERS["grok-web"].cookieImport;
  parser = await import("../../src/shared/utils/cookieImportParser.js");
  // Chat responses schedule usage persistence without awaiting it; teardown waits for it.
  usageWrites = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60_000);

afterEach(async () => {
  clearPairings?.();
  proxyFetch.__clearProxyDispatchersForTesting();
  await Promise.all(usageWrites.mock.results.map((result) => result.value));
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("Grok Web extension capture against the real descriptor", () => {
  it("captures only the tab profile's sso and stores it as one redacted cookie account", async () => {
    const pairing = await mintPairing({ action: "create", name: "grok-captured" });
    // Today's allowlist, not a parity claim (report, gap 1).
    // Exact: no chunk prefixes, optional cookies, localStorage keys or accounts.x.ai widening.
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: ["sso"], cookiePrefixes: [] });
    expect(registryEntry.webLogin).toMatchObject({ origin: ORIGIN, cookieNames: ["sso"] });
    expect(registryEntry.cookieImport).toBeUndefined();
    expect(pairing.importUrl).toBe(IMPORT_URL);

    const captured = await captureWithExtension(pairing);

    expect(captured.prepared.plan).toMatchObject({
      providerOrigin: ORIGIN, cookieNames: ["sso"], cookiePrefixes: [], optionalCookies: [], localStorageKeys: [],
    });
    // One exact-name read in the tab's own store; no chunk probing, enumeration or page script.
    expect(captured.reads).toEqual([{ url: `${ORIGIN}/`, name: "sso", storeId: TAB_STORE }]);
    expect(captured.chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(captured.chrome.scripting.executeScript).not.toHaveBeenCalled();
    const grant = { permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] };
    expect(captured.granted).toEqual([grant]);
    expect(captured.removed).toEqual([grant]);
    expect([...captured.held]).toEqual([]);

    expect(captured.sent).toHaveLength(1);
    const [{ url, init }] = captured.sent;
    expect(url).toBe(IMPORT_URL);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
    expect(init.headers).toEqual({ "content-type": "application/json", [pairing.header]: pairing.token });
    expect(JSON.parse(init.body)).toEqual({
      provider: "grok-web", origin: ORIGIN, cookies: [{ name: "sso", value: SSO_A, domain: "grok.com", secure: true }],
    });
    expect(captured.result).toMatchObject({ ok: true, action: "create", cookieCount: 1 });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: captured.result.connection.id, name: "grok-captured", authType: "cookie", apiKey: `sso=${SSO_A}` });

    // The route's own answer, the popup's result and both dashboard reads carry no credential.
    expectNoSecrets(captured.answers[0], [pairing.token]);
    expectNoSecrets(captured.result, [pairing.token]);
    const list = await (await routes.providers.GET(request(`${DASHBOARD}/api/providers`, null, { method: "GET" }))).text();
    const one = await (await routes.provider.GET(request(`${DASHBOARD}/api/providers/${stored[0].id}`, null, { method: "GET" }), params(stored[0].id))).text();
    for (const body of [list, one]) {
      expect(body).toContain("grok-captured");
      expectNoSecrets(body, [pairing.token]);
    }
    expectCleanLogs([pairing.token]);
    expect(network).not.toHaveBeenCalled();

    // The secret worked once.
    const replay = await importCall(pairing, JSON.parse(init.body));
    expect(replay.status).toBe(401);
    expectNoSecrets(await replay.text(), [pairing.token]);
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    ["the registry's sign-in redirect host", "https://accounts.x.ai/sign-in"],
    ["the xAI site", "https://x.ai/"],
    ["a grok.com subdomain", "https://accounts.grok.com/"],
    ["a lookalike host", "https://grok.com.invalid/"],
    ["plain http", "http://grok.com/"],
  ])("refuses to capture on %s before reading any cookie", async (_label, tabUrl) => {
    const pairing = await mintPairing({ action: "create", name: "grok-wrong-tab" });
    const captured = await captureWithExtension(pairing, browser({ tabUrl }));
    expect(captured.prepared).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
    expect(captured.reads).toEqual([]);
    expect(captured.granted).toEqual([]);
    expect(captured.sent).toEqual([]);
    expect(await rows()).toEqual([]);
    // Nothing was sent, so the secret is still pending rather than consumed.
    expect(pendingPairingCount()).toBe(1);
  });

  it.each([
    ["signed out with only sso-rw and clearance left", null],
    ["an sso scoped to accounts.x.ai", sso(XAI_SSO, { domain: ".x.ai" })],
    ["an insecure sso", sso(SSO_A, { secure: false })],
    ["an empty sso", sso("")],
  ])("sends nothing for %s", async (_label, session) => {
    const pairing = await mintPairing({ action: "create", name: "grok-no-session" });
    const captured = await captureWithExtension(pairing, browser({ session }));
    expect(captured.result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(captured.sent).toEqual([]);
    expect(captured.removed).toEqual(captured.granted);
    expectNoSecrets(captured.result, [pairing.token]);
    expect(await rows()).toEqual([]);
  });

  it("has an expired captured cookie refused by the server without replacing the saved session", async () => {
    const account = await importedAccount("grok-expiry", SSO_A);
    const before = await row(account.id);
    const expired = await mintPairing({ action: "update", connectionId: account.id });
    const refused = await captureWithExtension(expired, browser({ session: sso(SSO_NEW, { expirationDate: Math.floor(Date.now() / 1000) - 1 }) }));
    expect(refused.result).toMatchObject({ ok: false, code: "rejected" });
    expect(JSON.parse(refused.answers[0])).toEqual({ error: "Cookie is expired" });
    expect(await row(account.id)).toEqual(before);

    const unexpired = await mintPairing({ action: "update", connectionId: account.id });
    const accepted = await captureWithExtension(unexpired, browser({ session: sso(SSO_NEW, { expirationDate: Math.floor(Date.now() / 1000) + 3600 }) }));
    expect(accepted.result).toMatchObject({ ok: true, action: "update" });
    expect((await row(account.id)).apiKey).toBe(`sso=${SSO_NEW}`);
    expectNoSecrets(accepted.answers[0], [unexpired.token]);
    expectCleanLogs([expired.token, unexpired.token]);
  });
});

describe("Grok Web captured credentials at the upstream boundary", () => {
  const record = (status = 200) => {
    const calls = [];
    network.mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      return status === 200 ? reply("synthetic answer") : new Response("", { status });
    });
    return calls;
  };

  it("sends each chosen account's cookie through that account's proxy only", async () => {
    const a = await importedAccount("grok-a", SSO_A);
    const b = await importedAccount("grok-b", SSO_B);
    const proxyA = await bindProxy(a.id, "a");
    const proxyB = await bindProxy(b.id, "b");
    const calls = record();

    for (const [chosen, other, proxy, value] of [[b, a, proxyB, SSO_B], [a, b, proxyA, SSO_A]]) {
      await setActive(chosen.id, true);
      await setActive(other.id, false);
      calls.length = 0;
      const response = await chat();
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(JSON.parse(body).choices[0].message.content).toBe("synthetic answer");
      expectNoSecrets(body);

      expect(calls).toHaveLength(1);
      const [{ url, init }] = calls;
      expect(url).toBe(registryEntry.transport.baseUrl);
      expect(url).toBe(CHAT_URL);
      expect(init.dispatcher).toBe(proxy.dispatcher);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(init.headers.Cookie).toBe(`sso=${value}`);
      expect(init.headers.Origin).toBe(ORIGIN);
      expect(JSON.parse(init.body)).toMatchObject({ modelName: "grok-4", modelMode: "MODEL_MODE_GROK_4", message: "synthetic prompt", temporary: true });
      // The credential travels in the Cookie header alone.
      expectNoSecrets(init.body);
      expectNoSecrets({ ...init.headers, Cookie: undefined });
    }
    // The executor's own log line was captured, so the leak check is not reading silence.
    expect(loggedText()).toContain("GROK-WEB");
    expectCleanLogs();
  });

  it("fails closed on broken strict proxies, never going direct or crossing cookie and proxy", async () => {
    const a = await importedAccount("grok-a", SSO_A);
    const b = await importedAccount("grok-b", SSO_B);
    const own = new Map([
      [`sso=${SSO_A}`, (await bindProxy(a.id, "a")).dispatcher],
      [`sso=${SSO_B}`, (await bindProxy(b.id, "b")).dispatcher],
    ]);
    const attempts = [];
    network.mockImplementation(async (_url, init) => {
      attempts.push({ cookie: init.headers.Cookie, dispatcher: init.dispatcher });
      throw new TypeError("synthetic proxy failure");
    });
    const response = await chat();
    expect(response.status).toBeGreaterThanOrEqual(500);
    // Account fallback may try the sibling, which must then bring its own proxy.
    expect(attempts.length).toBeGreaterThan(0);
    for (const { cookie, dispatcher } of attempts) {
      expect(own.has(cookie)).toBe(true);
      expect(dispatcher).toBe(own.get(cookie));
    }
    expectNoSecrets(await response.text());
    expectCleanLogs();
  });

  it("reports a rejected stored session without echoing it", async () => {
    await importedAccount("grok-rejected", SSO_A);
    const calls = record(401);
    const response = await chat();
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toMatch(/SSO cookie may be expired/i);
    expect(calls.map(({ init }) => init.headers.Cookie)).toEqual([`sso=${SSO_A}`]);
    expectNoSecrets(body);
    expectCleanLogs();
  });

  it("updates only the paired account, keeps its proxy and sends the new cookie next", async () => {
    const a = await importedAccount("grok-a", SSO_A);
    const b = await importedAccount("grok-b", SSO_B);
    const proxyA = await bindProxy(a.id, "a");
    await bindProxy(b.id, "b");
    const lockedUntil = new Date(Date.now() + 3_600_000).toISOString();
    for (const id of [a.id, b.id]) await db.updateProviderConnection(id, { "modelLock_grok-4": lockedUntil, testStatus: "unavailable" });
    const beforeA = await row(a.id);
    const beforeB = await row(b.id);

    const pairing = await mintPairing({ action: "update", connectionId: a.id });
    const captured = await captureWithExtension(pairing, browser({ session: sso(SSO_NEW) }));

    expect(captured.result).toMatchObject({ ok: true, action: "update", connection: { id: a.id, name: "grok-a" } });
    expect(JSON.parse(captured.sent[0].init.body)).toMatchObject({ connectionId: a.id });
    const afterA = await row(a.id);
    expect(afterA).toMatchObject({ id: a.id, name: "grok-a", priority: beforeA.priority, authType: "cookie", apiKey: `sso=${SSO_NEW}`, testStatus: "active" });
    expect(afterA["modelLock_grok-4"] ?? null).toBeNull();
    expect(afterA.providerSpecificData).toEqual(beforeA.providerSpecificData);
    expect(afterA.providerSpecificData.proxyPoolId).toBe(proxyA.proxyPoolId);
    expect(await row(b.id)).toEqual(beforeB);
    expect(await rows()).toHaveLength(2);
    expectNoSecrets(captured.answers[0], [pairing.token]);

    await setActive(b.id, false);
    const calls = record();
    expect((await chat()).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Cookie).toBe(`sso=${SSO_NEW}`);
    expect(calls[0].init.dispatcher).toBe(proxyA.dispatcher);
    expectCleanLogs([pairing.token]);
  });
});

describe("Grok Web pairing authority and update ownership", () => {
  it.each([
    ["no management access", () => guard.canAccessManagementApi.mockResolvedValue(false), {}],
    ["a non-operator caller", () => guard.isOperatorRequest.mockResolvedValue(false), {}],
    ["a cross-origin dashboard request", () => guard.hasExactRequestOrigin.mockReturnValue(false), { origin: "https://evil.invalid" }],
    ["the isolated login host", () => {}, { host: "login.example" }],
  ])("mints no pairing for %s", async (_label, deny, headers) => {
    deny();
    const response = await pairingCall({ provider: "grok-web", action: "create", name: "grok-denied" }, { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("pairing");
    expect(pendingPairingCount()).toBe(0);
  });

  it("will not target another provider's, another auth type's or a missing connection", async () => {
    const foreign = await db.createProviderConnection({ provider: "chatgpt-web", authType: "cookie", name: "foreign", apiKey: "synthetic-foreign" });
    const keyed = await db.createProviderConnection({ provider: "grok-web", authType: "apikey", name: "keyed", apiKey: "synthetic-keyed" });
    for (const [connectionId, status] of [[foreign.id, 409], [keyed.id, 409], ["synthetic-missing-id", 404]]) {
      const response = await pairingCall({ provider: "grok-web", action: "update", connectionId });
      expect(response.status).toBe(status);
      expectNoSecrets(await response.text());
    }
    expect(pendingPairingCount()).toBe(0);
  });

  it.each([
    ["redirected to a sibling account", (a, b) => ({ provider: "grok-web", connectionId: b.id })],
    ["turned into a create", () => ({ provider: "grok-web", name: "grok-extra" })],
    ["replayed as another provider", (a) => ({ provider: "chatgpt-web", connectionId: a.id })],
  ])("spends an update pairing %s without writing", async (_label, tamper) => {
    const a = await importedAccount("grok-a", SSO_A);
    const b = await importedAccount("grok-b", SSO_B);
    const before = await rows();
    const pairing = await mintPairing({ action: "update", connectionId: a.id });
    const payload = { origin: ORIGIN, cookies: [sso(SSO_NEW)] };
    const response = await importCall(pairing, { ...payload, ...tamper(a, b) });
    expect(response.status).toBe(409);
    expectNoSecrets(await response.text(), [pairing.token]);
    expect((await importCall(pairing, { ...payload, provider: "grok-web", connectionId: a.id })).status).toBe(401);
    expect(await rows()).toEqual(before);
  });

  it.each([
    ["the sign-in redirect origin", { origin: "https://accounts.x.ai" }, "Origin is not approved for this provider"],
    ["an origin with a trailing slash", { origin: `${ORIGIN}/` }, "Origin is not approved for this provider"],
    ["an xAI cookie domain", { cookies: [sso(SSO_NEW, { domain: ".x.ai" })] }, "Cookie domain does not match the provider origin"],
    ["sso-rw beside sso", { cookies: [sso(SSO_NEW), sso(SSO_RW, { name: "sso-rw" })] }, "Cookie name is not approved for this provider"],
    ["a clearance cookie beside sso", { cookies: [sso(SSO_NEW), sso(CLEARANCE, { name: "cf_clearance" })] }, "Cookie name is not approved for this provider"],
    ["a chunked sso", { cookies: [sso(SSO_NEW, { name: "sso.0" })] }, "Cookie name is not approved for this provider"],
    ["two sso cookies", { cookies: [sso(SSO_NEW), sso(SSO_B)] }, "Duplicate cookie name"],
    ["an insecure sso", { cookies: [sso(SSO_NEW, { secure: false })] }, "Cookie must be a secure cookie"],
    ["an expired sso", { cookies: [sso(SSO_NEW, { expirationDate: 1 })] }, "Cookie is expired"],
    ["a localStorage item", { localStorage: { sso: SSO_NEW } }, "This provider takes no localStorage value"],
  ])("refuses %s with a static error and keeps the saved cookie", async (_label, override, error) => {
    const account = await importedAccount("grok-guarded", SSO_A);
    const before = await row(account.id);
    const pairing = await mintPairing({ action: "update", connectionId: account.id });
    const response = await importCall(pairing, { provider: "grok-web", connectionId: account.id, origin: ORIGIN, cookies: [sso(SSO_NEW)], ...override });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await row(account.id)).toEqual(before);
    expectCleanLogs([pairing.token]);
  });
});

describe("Grok Web dashboard import inputs", () => {
  // Report, gap 1: today's allowlist is sso alone, so sso-rw and cf_clearance are dropped here and
  // refused by the import route. That is not parity; a repair that adds a name updates these rows.
  const cookieHeader = (value) => `x-anonuserid=synthetic-anon; sso=${value}; sso-rw=${SSO_RW}; cf_clearance=${CLEARANCE}`;
  const curl = (url, value) => `curl '${url}' \\\n  -H 'accept: */*' \\\n  -H 'Cookie: ${cookieHeader(value)}' \\\n  --data-raw '{}'`;
  const harEntry = (url, value) => ({ request: { url, headers: [{ name: "Cookie", value: cookieHeader(value) }], cookies: [] } });
  const har = (...entries) => JSON.stringify({ log: { entries } });
  const READERS = { header: "parseCookieHeaderValue", curl: "parseCurlCommand", har: "parseHarDocument" };
  /** Read the way CookieImportModal does: the local parser, then the contract the dashboard is given. */
  const read = (kind, text) => {
    const parsed = parser[READERS[kind]](text);
    return parsed.ok ? parser.buildImportCandidates({ kind, parsed }, uiContract) : parsed;
  };
  const submit = async (candidate, target) => {
    const pairing = await mintPairing(target);
    const response = await importCall(pairing, {
      provider: "grok-web", origin: candidate.origin, cookies: candidate.cookies,
      ...(target.action === "create" ? { name: target.name } : { connectionId: target.connectionId }),
    });
    const text = await response.text();
    expectNoSecrets(text, [pairing.token]);
    return { status: response.status, body: JSON.parse(text) };
  };

  it.each([
    ["a Cookie header", "header", () => `Cookie: ${cookieHeader(SSO_A)}`],
    ["a cURL command", "curl", () => curl(CHAT_URL, SSO_A)],
    ["a HAR file", "har", () => har(harEntry("https://accounts.x.ai/sign-in", XAI_SSO), harEntry(CHAT_URL, SSO_A))],
  ])("creates, updates and dispatches from %s, keeping sso alone", async (_label, kind, input) => {
    const built = read(kind, input());
    expect(built.ok, built.error).toBe(true);
    expect(built.candidates).toHaveLength(1);
    const [candidate] = built.candidates;
    expect(candidate).toMatchObject({ origin: ORIGIN, originKnown: kind !== "header", cookies: [{ name: "sso", value: SSO_A }] });
    expect(candidate.dropped).toEqual(["x-anonuserid", "sso-rw", "cf_clearance"]);

    const created = await submit(candidate, { action: "create", name: `grok-${kind}` });
    expect(created.status).toBe(201);
    const { id } = created.body.connection;
    expect((await row(id)).apiKey).toBe(`sso=${SSO_A}`);

    const renewed = read(kind, input().replaceAll(SSO_A, SSO_NEW));
    expect((await submit(renewed.candidates[0], { action: "update", connectionId: id })).status).toBe(200);
    expect((await row(id)).apiKey).toBe(`sso=${SSO_NEW}`);
    expect(await rows()).toHaveLength(1);

    const sent = [];
    network.mockImplementation(async (url, init) => { sent.push([String(url), init.headers.Cookie]); return reply("ok"); });
    expect((await chat()).status).toBe(200);
    // sso-rw and cf_clearance from the input were dropped at import, so they are not sent.
    expect(sent).toEqual([[CHAT_URL, `sso=${SSO_NEW}`]]);
    expectCleanLogs();
  });

  it("stores only the HAR account the operator picks when two sessions differ", async () => {
    const built = read("har", har(harEntry(CHAT_URL, SSO_A), harEntry(`${ORIGIN}/rest/rate-limits`, SSO_B)));
    expect(built.candidates).toHaveLength(2);
    expect(parser.candidatesAreAmbiguous(built.candidates)).toBe(true);
    expect((await submit(built.candidates[1], { action: "create", name: "grok-picked" })).status).toBe(201);
    expect((await rows()).map((saved) => saved.apiKey)).toEqual([`sso=${SSO_B}`]);
  });

  it.each([
    ["a bare sso value", "header", SSO_A, /No cookie name=value pair/],
    ["an empty sso", "header", "sso=", /No cookie name=value pair/],
    ["a header with sso-rw but no sso", "header", `sso-rw=${SSO_RW}; cf_clearance=${CLEARANCE}`, /no sso cookie/],
    ["a localStorage dump", "header", JSON.stringify({ sso: SSO_A }), /No cookie name=value pair/],
    ["cURL for the sign-in redirect host", "curl", curl("https://accounts.x.ai/sign-in", XAI_SSO), /origin is not approved/],
    ["cURL for a subdomain", "curl", curl("https://accounts.grok.com/", SSO_A), /origin is not approved/],
    ["cURL over plain http", "curl", curl("http://grok.com/", SSO_A), /origin is not approved/],
    ["cURL for a lookalike host", "curl", curl("https://grok.com.invalid/", SSO_A), /origin is not approved/],
    ["cURL naming a cookie jar file", "curl", `curl -b cookies.txt '${CHAT_URL}'`, /no Cookie header/],
    ["HAR with no grok.com request", "har", har(harEntry("https://x.ai/", SSO_A)), /no request to https:\/\/grok\.com/],
  ])("refuses %s locally with no secret in the error", (_label, kind, text, error) => {
    const built = read(kind, text);
    expect(built.ok).toBe(false);
    expect(built.error).toMatch(error);
    expectNoSecrets(built);
    expect(network).not.toHaveBeenCalled();
  });
});
