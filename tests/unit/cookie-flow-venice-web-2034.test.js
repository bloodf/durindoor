/**
 * Venice Web cookie-flow round trip (#2034): the real registry descriptor from an issued pairing
 * through extension capture or a dashboard paste, the import route, SQLite, account selection and
 * the registered executor's real proxy routing.
 *
 * Real: registry, pairing and import routes, extension capture, dashboard parser, SQLite repos under
 * a private DATA_DIR, credential selection, the `venice-web` executor and proxyFetch. Mocked:
 * management guard authority, `chrome`, the outbound socket and the proxy dispatchers. All values
 * are synthetic. Nothing here shows that a live Venice sign-in, Clerk session or completion works;
 * see internal/docs/port-reports/cookie-flows/venice-web-2034.md for what stays unproved.
 *
 * The Clerk reply shapes (`{ response: { sessions } }`, `{ jwt }`) and the newline-delimited
 * `{ kind: "content" }` chat events follow cheaper-inference/OmniRoute (MIT),
 * open-sse/executors/venice-web-auth.ts and venice-web.ts at 9671192011beb2d7f83979f40be488c5da8772b9,
 * as already ported by open-sse/executors/venice-web/.
 */
import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-venice-web-"));
  process.env.DATA_DIR = dataDir;
  return {
    dataDir, originalDataDir,
    canAccessManagementApi: vi.fn(), canManageAccessConfig: vi.fn(),
    isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn(),
  };
});
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: state.canAccessManagementApi,
  canManageAccessConfig: state.canManageAccessConfig,
  isOperatorRequest: state.isOperatorRequest,
  hasExactRequestOrigin: state.hasExactRequestOrigin,
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCredentials } from "../../src/app/api/providers/cookie-import/route.js";
import { GET as listConnections } from "../../src/app/api/providers/route.js";
import { GET as readConnection } from "../../src/app/api/providers/[id]/route.js";
import { clearPairings, pendingPairingCount } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { getAdapter } from "../../src/lib/db/driver.js";
import {
  createProviderConnection, getProviderConnectionById, getProviderConnections, updateProviderConnection,
} from "../../src/lib/db/repos/connectionsRepo.js";
import { createProxyPool } from "../../src/lib/db/repos/proxyPoolsRepo.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import {
  buildImportCandidates, parseCookieHeaderValue, parseCurlCommand, parseHarDocument,
} from "../../src/shared/utils/cookieImportParser.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { confirmationFor, describePlan, prepareCapture, runCapture } from "../../extensions/provider-cookie-capture/capture.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import veniceWeb, {
  VENICE_WEB_CHAT_URL, VENICE_WEB_CLIENT_URL, veniceWebTokenUrl,
} from "../../open-sse/providers/registry/venice-web.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import {
  __clearProxyDispatchersForTesting, __setOriginalFetchForTesting, __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";

const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://clerk.venice.ai";
const SITE = "https://venice.ai";
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;
const PROXY_A = "http://proxy-a.invalid:8080";
const PROXY_B = "http://proxy-b.invalid:8080";

// Synthetic JWT-shaped values only. The executor keeps a process-wide session-token cache keyed by
// the whole cookie, so every test mints fresh values and no test can see another test's token.
let serial = 0;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.c3ludGhldGlj`;
function minted() {
  serial += 1;
  const n = serial;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    A: jwt({ id: `client_synthetic_a_${n}` }),
    B: jwt({ id: `client_synthetic_b_${n}` }),
    B2: jwt({ id: `client_synthetic_b2_${n}` }),
    accessA: jwt({ sub: `user_synthetic_a_${n}`, exp }),
    accessB2: jwt({ sub: `user_synthetic_b2_${n}`, exp }),
    userA: `user_synthetic_a_${n}`,
    userB2: `user_synthetic_b2_${n}`,
    decoy: `synthetic-venice-decoy-${n}`,
  };
}

let v;
let logs;
const secrets = () => Object.entries(v).filter(([key]) => !key.startsWith("user")).map(([, value]) => value);
const expectNoSecret = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets()) expect(text).not.toContain(secret);
};
const loggedText = () => logs.flatMap((spy) => spy.mock.calls)
  .map((call) => call.map((part) => (part instanceof Error ? `${part.message}\n${part.stack}` : typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "))
  .join("\n");
const rows = () => getProviderConnections({ provider: "venice-web" });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

const pairingRequest = (body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
  method: "POST", headers: { "content-type": "application/json", origin: DASHBOARD }, body: JSON.stringify(body),
});

/** The pairing response exactly as the dashboard hands it to the operator. */
async function issue(body) {
  const response = await pair(pairingRequest({ provider: "venice-web", ...body }));
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return { text, pairing: JSON.parse(text).pairing };
}

const importRequest = (token, body, origin = "chrome-extension://synthetic-extension-id") => new NextRequest(IMPORT_URL, {
  method: "POST",
  headers: { "content-type": "application/json", origin, ...(token ? { [PAIRING_HEADER]: token } : null) },
  body: JSON.stringify(body),
});

const clientCookie = (value, extra) => ({ name: "__client", value, domain: "clerk.venice.ai", secure: true, ...extra });

/**
 * A signed-in browser whose active tab is on the Clerk origin. The selected tab's cookie store
 * holds `jar`; a second store holds a decoy that must never be read. Enumeration and page scripts
 * throw: this credential is one named cookie.
 */
function browser(jar, { tabUrl = `${ORIGIN}/` } = {}) {
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const reads = [];
  const other = { __client: clientCookie(v.decoy) };
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async (id) => ({ id, url: tabUrl }) },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: vi.fn(async (query) => { names(query).forEach((name) => held.add(name)); return true; }),
      remove: async (query) => { names(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: {
      getAllCookieStores: vi.fn(async () => [{ id: "other", tabIds: [8] }, { id: "selected", tabIds: [7] }]),
      get: vi.fn(async (query) => { reads.push(query); return (query.storeId === "selected" ? jar : other)[query.name] ?? null; }),
      getAll: vi.fn(() => { throw new Error("venice-web capture must not enumerate cookies"); }),
    },
    scripting: { executeScript: vi.fn(() => { throw new Error("venice-web capture must not read page storage"); }) },
  };
  return { chrome, held, reads };
}

/** The extension's one POST, delivered to the real import route. */
function dashboardFetch() {
  const responses = [];
  const fetch = vi.fn(async (url, init) => {
    if (url !== IMPORT_URL) throw new Error("unexpected extension destination");
    const response = await importCredentials(new NextRequest(url, {
      method: init.method, headers: { ...init.headers, origin: "chrome-extension://synthetic-extension-id" }, body: init.body,
    }));
    responses.push(await response.clone().text());
    return response;
  });
  return { fetch, responses };
}

/** Server pairing -> real extension review and send -> real import route. */
async function captureAndImport(jar, target, options) {
  const { text, pairing } = await issue(target);
  const tab = browser(jar, options);
  const prepared = await prepareCapture({ chrome: tab.chrome, text });
  expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
  const view = describePlan(prepared.plan);
  const dashboard = dashboardFetch();
  const result = await runCapture({ chrome: tab.chrome, fetch: dashboard.fetch, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  return { ...tab, ...dashboard, pairing, text, plan: prepared.plan, view, result };
}

/** The request the dashboard import modal sends for the selected parsed candidate. */
async function pasteAndImport(kind, parsed, target) {
  const built = buildImportCandidates({ kind, parsed }, AI_PROVIDERS["venice-web"].cookieImport);
  if (!built.ok) return { built };
  const [selected] = built.candidates;
  const { pairing } = await issue(target);
  const response = await importCredentials(importRequest(pairing.token, {
    provider: "venice-web", origin: selected.origin, cookies: selected.cookies, name: target.name,
  }, DASHBOARD));
  return { built, selected, response, text: await response.text() };
}

beforeEach(async () => {
  v = minted();
  clearPairings();
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(name, "");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  state.canAccessManagementApi.mockReset().mockResolvedValue(true);
  state.canManageAccessConfig.mockReset().mockResolvedValue(true);
  state.isOperatorRequest.mockReset().mockResolvedValue(true);
  state.hasExactRequestOrigin.mockReset().mockReturnValue(true);
  const db = await getAdapter();
  db.run("DELETE FROM providerConnections");
  db.run("DELETE FROM proxyPools");
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.originalDataDir;
  fs.rmSync(state.dataDir, { recursive: true, force: true });
});

describe("the registered venice-web descriptor", () => {
  it("is the one the server contract, pairing, dashboard projection and extension table agree on", async () => {
    expect(REGISTRY.find((entry) => entry.id === "venice-web")).toBe(veniceWeb);
    const server = getCookieImportContract("venice-web");
    expect(server).toMatchObject({ authType: "cookie", origin: ORIGIN, extensionCapture: true, cookieNames: ["__client"], cookiePrefixes: [] });
    for (const absent of ["optionalCookies", "hashedCookiePrefixes", "localStorageKeys", "accountEmail"]) expect(server[absent]).toBeUndefined();
    // The capture origin is Clerk, not the website where the user signs in.
    expect(veniceWeb.display.website).toBe(SITE);
    expect(server.origin).not.toBe(veniceWeb.display.website);
    expect(AI_PROVIDERS["venice-web"].cookieImport).toMatchObject({ authType: "cookie", origin: ORIGIN, cookieNames: ["__client"] });
    const builtIn = EXTENSION_PROVIDERS["venice-web"];
    expect([builtIn.origin, builtIn.cookieNames, builtIn.cookiePrefixes]).toEqual([server.origin, [...server.cookieNames], [...server.cookiePrefixes]]);
    const { pairing } = await issue({ action: "create", name: "Venice A" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: ["__client"], cookiePrefixes: [] });
    expect(veniceWeb.hidden).toBeUndefined();
    expect(getExecutor("venice-web").provider).toBe("venice-web");
  });
});

describe("server pairing through extension capture to stored credential", () => {
  it("creates from the selected tab store's one __client cookie, with every surface redacted", async () => {
    const jar = { __client: clientCookie(v.A, { domain: ".venice.ai" }), __session: clientCookie(v.decoy), __client_uat: clientCookie(v.decoy) };
    const run = await captureAndImport(jar, { action: "create", name: "Venice A" });
    expect(run.result).toMatchObject({ ok: true, action: "create", cookieCount: 1 });
    expect(run.plan.localStorageKeys).toEqual([]);
    expect(run.reads).toEqual([{ url: `${ORIGIN}/`, name: "__client", storeId: "selected" }]);
    expect(run.chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(run.chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(run.fetch).toHaveBeenCalledTimes(1);
    expect(run.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    const sent = JSON.parse(run.fetch.mock.calls[0][1].body);
    expect(sent).not.toHaveProperty("accountEmail");
    expect(sent.cookies.map((cookie) => cookie.name)).toEqual(["__client"]);
    expect([...run.held]).toEqual([]);
    expect(run.plan.token).toBe("");

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: run.result.connection.id, provider: "venice-web", authType: "cookie", name: "Venice A", isActive: true, apiKey: `__client=${v.A}` });
    expect(JSON.stringify(stored[0])).not.toContain(v.decoy);
    for (const surface of [run.view, run.result, ...run.responses]) {
      expectNoSecret(surface);
      expect(JSON.stringify(surface)).not.toContain(run.pairing.token);
    }
    expectNoSecret(loggedText());
    expect(loggedText()).not.toContain(run.pairing.token);
  });

  it("redacts the imported cookie from the management list and single-connection reads", async () => {
    const run = await captureAndImport({ __client: clientCookie(v.A) }, { action: "create", name: "Venice A" });
    const id = run.result.connection.id;
    for (const operator of [true, false]) {
      state.isOperatorRequest.mockResolvedValue(operator);
      const list = await (await listConnections(new Request(`${DASHBOARD}/api/providers`))).json();
      const one = await (await readConnection(new Request(`${DASHBOARD}/api/providers/${id}`), { params: Promise.resolve({ id }) })).json();
      expect(list.connections.find((candidate) => candidate.id === id)).toMatchObject({ id, provider: "venice-web" });
      expect(one.connection).toMatchObject({ id, provider: "venice-web" });
      expectNoSecret(list);
      expectNoSecret(one);
    }
    expectNoSecret(loggedText());
  });

  it.each([
    ["venice.ai, where the user signs in", `${SITE}/chat`],
    ["the inference host", "https://outerface.venice.ai/"],
    ["plain-HTTP Clerk", "http://clerk.venice.ai/"],
  ])("refuses a tab on %s before any permission prompt or cookie read", async (_label, tabUrl) => {
    const { text } = await issue({ action: "create", name: "Venice A" });
    const tab = browser({ __client: clientCookie(v.A) }, { tabUrl });
    const prepared = await prepareCapture({ chrome: tab.chrome, text });
    expect(prepared).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
    expect(tab.chrome.permissions.request).not.toHaveBeenCalled();
    expect(tab.reads).toEqual([]);
    expect(pendingPairingCount()).toBe(1);
  });

  it.each([
    ["no __client cookie (signed out at Clerk)", {}],
    ["only an insecure __client", { __client: clientCookie("x", { secure: false }) }],
    ["only a __client of a foreign host", { __client: clientCookie("x", { domain: "venice.example" }) }],
    ["only chunk-named cookies", { "__client.0": clientCookie("x", { name: "__client.0" }) }],
  ])("sends nothing when the tab store holds %s", async (_label, jar) => {
    const run = await captureAndImport(jar, { action: "create", name: "Venice A" });
    expect(run.result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(run.fetch).not.toHaveBeenCalled();
    expect(run.reads.map((query) => query.name)).toEqual(["__client"]);
    expect(await rows()).toHaveLength(0);
  });

  it("forwards an expired browser cookie to the server, which refuses it and spends the pairing", async () => {
    const run = await captureAndImport({ __client: clientCookie(v.A, { expirationDate: 1 }) }, { action: "create", name: "Venice A" });
    expect(run.fetch).toHaveBeenCalledTimes(1);
    expect(run.result).toMatchObject({ ok: false, code: "rejected" });
    expect(run.responses.map((text) => JSON.parse(text))).toEqual([{ error: "Cookie is expired" }]);
    expect(pendingPairingCount()).toBe(0);
    expect(await rows()).toHaveLength(0);
    expectNoSecret(run.responses.join(""));
    expectNoSecret(loggedText());
  });
});

describe("dashboard paste modes into the import route", () => {
  const header = () => `Cookie: __session=${v.decoy}; __client=${v.A}; __client_uat=1700000000`;

  it.each([
    ["Cookie header", "header", () => parseCookieHeaderValue(header())],
    ["cURL from the Clerk origin", "curl", () => parseCurlCommand(`curl '${ORIGIN}/v1/client?_clerk_js_version=5' -H '${header()}'`)],
    ["HAR with Clerk and inference entries", "har", () => parseHarDocument(JSON.stringify({ log: { entries: [
      { request: { url: "https://outerface.venice.ai/api/inference/chat", headers: [{ name: "Authorization", value: `Bearer ${v.accessA}` }], cookies: [] } },
      { request: { url: `${ORIGIN}/v1/client`, headers: [{ name: "Cookie", value: header().slice(8) }], cookies: [] } },
    ] } }))],
  ])("stores only __client from a %s", async (_label, kind, parse) => {
    const parsed = parse();
    expect(parsed.ok).toBe(true);
    const run = await pasteAndImport(kind, parsed, { action: "create", name: "Venice pasted" });
    expect(run.built.ok, JSON.stringify(run.built)).toBe(true);
    expect(run.selected.cookies.map((cookie) => cookie.name)).toEqual(["__client"]);
    expect(run.response.status, run.text).toBe(201);
    expectNoSecret(run.text);
    const [stored] = await rows();
    expect(stored).toMatchObject({ authType: "cookie", name: "Venice pasted", apiKey: `__client=${v.A}` });
    expect(JSON.stringify(stored)).not.toContain(v.decoy);
    expectNoSecret(loggedText());
  });

  it.each([
    ["cURL copied from venice.ai", "curl", () => parseCurlCommand(`curl '${SITE}/chat' -H 'Cookie: __client=${v.A}'`), "The request origin is not approved for this provider."],
    ["cURL copied from the inference host", "curl", () => parseCurlCommand(`curl '${VENICE_WEB_CHAT_URL}' -H 'Cookie: __client=${v.A}'`), "The request origin is not approved for this provider."],
    ["HAR with no Clerk request", "har", () => parseHarDocument(JSON.stringify({ log: { entries: [
      { request: { url: `${SITE}/chat`, headers: [{ name: "Cookie", value: `__client=${v.A}` }], cookies: [] } },
    ] } })), `The HAR file has no request to ${ORIGIN}.`],
    ["Cookie header with only Clerk siblings", "header", () => parseCookieHeaderValue(`__session=${v.decoy}; __client_uat=1`), "The input has no __client cookie."],
  ])("refuses a %s in the parser, before any pairing", async (_label, kind, parse, error) => {
    const run = await pasteAndImport(kind, parse(), { action: "create", name: "Venice pasted" });
    expect(run.built).toEqual({ ok: false, error });
    expectNoSecret(run.built);
    expect(pendingPairingCount()).toBe(0);
    expect(await rows()).toHaveLength(0);
  });
});

describe("input modes and shapes the import route refuses", () => {
  it.each([
    ["the venice.ai origin", () => ({ origin: SITE, cookies: [clientCookie(v.A)] }), "Origin is not approved for this provider"],
    ["a cookie of the inference host", () => ({ cookies: [clientCookie(v.A, { domain: "outerface.venice.ai" })] }), "Cookie domain does not match the provider origin"],
    ["an expired cookie", () => ({ cookies: [clientCookie(v.A, { expirationDate: 1 })] }), "Cookie is expired"],
    ["an insecure cookie", () => ({ cookies: [clientCookie(v.A, { secure: false })] }), "Cookie must be a secure cookie"],
    ["a chunk-named cookie", () => ({ cookies: [clientCookie(v.A, { name: "__client.0" })] }), "Cookie name is not approved for this provider"],
    ["a Clerk sibling cookie", () => ({ cookies: [clientCookie(v.A), clientCookie(v.decoy, { name: "__session" })] }), "Cookie name is not approved for this provider"],
    ["a duplicated __client", () => ({ cookies: [clientCookie(v.A), clientCookie(v.B)] }), "Duplicate cookie name"],
    ["a localStorage value", () => ({ cookies: [clientCookie(v.A)], localStorage: { __client: v.B } }), "This provider takes no localStorage value"],
    ["an account email in the body", () => ({ cookies: [clientCookie(v.A)], accountEmail: "synthetic@example.com" }), "Account email is bound by the pairing"],
    ["a raw Cookie header field", () => ({ cookieHeader: `__client=${v.A}` }), "cookies must be a non-empty array"],
    ["a raw HAR field", () => ({ har: JSON.stringify({ log: { entries: [] } }) }), "cookies must be a non-empty array"],
    ["a pasted apiKey", () => ({ apiKey: `__client=${v.A}` }), "cookies must be a non-empty array"],
  ])("refuses %s with a fixed error, spends the pairing and stores nothing", async (_label, extra, error) => {
    const { pairing } = await issue({ action: "create", name: "Venice A" });
    const body = { provider: "venice-web", origin: ORIGIN, ...extra() };
    const response = await importCredentials(importRequest(pairing.token, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    const replay = await importCredentials(importRequest(pairing.token, { provider: "venice-web", origin: ORIGIN, cookies: [clientCookie(v.A)] }));
    expect(replay.status).toBe(401);
    expect(await rows()).toHaveLength(0);
    expectNoSecret(loggedText());
  });

  it("takes no account email at pairing, so none can be bound to a Venice connection", async () => {
    const response = await pair(pairingRequest({ provider: "venice-web", action: "create", name: "Venice A", accountEmail: "synthetic@example.com" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This provider takes no account email" });
    expect(pendingPairingCount()).toBe(0);
  });

  it("stores a non-JWT __client, which the executor then refuses before any send", async () => {
    // Current behavior, documented in the report: import checks name, origin and cookie syntax, not
    // the JWT shape the executor needs. The unusable value never leaves the gateway.
    const run = await captureAndImport({ __client: clientCookie("synthetic-not-a-jwt") }, { action: "create", name: "Venice A" });
    expect(run.result).toMatchObject({ ok: true, action: "create" });
    const socket = vi.fn(async () => { throw new Error("unexpected send"); });
    const restore = __setOriginalFetchForTesting(socket);
    try {
      const credentials = await getProviderCredentials("venice-web", null, "venice-uncensored", { preferredConnectionId: run.result.connection.id });
      const result = await getExecutor("venice-web").execute({
        model: "venice-uncensored", stream: false, credentials, proxyOptions: resolveCredentialProxyOptions(credentials),
        body: { messages: [{ role: "user", content: "synthetic question" }] },
      });
      expect(result.response.status).toBe(401);
      expect((await result.response.json()).error).toMatchObject({ code: "invalid_credential" });
      expect(socket).not.toHaveBeenCalled();
    } finally { restore(); }
  });
});

describe("authentication and update ownership", () => {
  const existing = (provider, name, apiKey) => createProviderConnection(
    { provider, authType: provider === "venice" ? "apikey" : "cookie", name, isActive: true, apiKey }, { createOnly: true });

  it("does not accept operator authority in place of a pairing", async () => {
    const response = await importCredentials(importRequest(null, { provider: "venice-web", origin: ORIGIN, cookies: [clientCookie(v.A)] }));
    expect(response.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  it("will not retarget the `venice` API-key provider connection", async () => {
    const twin = await existing("venice", "Venice API key", "synthetic-venice-api-key");
    const before = await getProviderConnectionById(twin.id);
    const response = await pair(pairingRequest({ provider: "venice-web", action: "update", connectionId: twin.id }));
    expect(response.status).toBe(409);
    expect(pendingPairingCount()).toBe(0);
    expect(await getProviderConnectionById(twin.id)).toEqual(before);
  });

  it("will not move an extension update pairing to another account, and spends it on the attempt", async () => {
    const a = await existing("venice-web", "Venice A", `__client=${v.A}`);
    const b = await existing("venice-web", "Venice B", `__client=${v.B}`);
    const before = await rows();
    const { pairing } = await issue({ action: "update", connectionId: a.id });
    const moved = await importCredentials(importRequest(pairing.token, { provider: "venice-web", origin: ORIGIN, connectionId: b.id, cookies: [clientCookie(v.B2)] }));
    expect(moved.status).toBe(409);
    const retry = await importCredentials(importRequest(pairing.token, { provider: "venice-web", origin: ORIGIN, connectionId: a.id, cookies: [clientCookie(v.B2)] }));
    expect(retry.status).toBe(401);
    expect(await rows()).toEqual(before);
  });

  it("will not overwrite an existing row through a same-name capture", async () => {
    const a = await existing("venice-web", "Venice A", `__client=${v.A}`);
    const before = await getProviderConnectionById(a.id);
    const run = await captureAndImport({ __client: clientCookie(v.B2) }, { action: "create", name: "Venice A" });
    expect(run.result).toMatchObject({ ok: false, code: "conflict" });
    expect(await rows()).toHaveLength(1);
    expect(await getProviderConnectionById(a.id)).toEqual(before);
    expectNoSecret(run.responses.join(""));
    expectNoSecret(loggedText());
  });
});

describe("a selected imported account reaches the executor over its own proxy", () => {
  const dispatchers = { [PROXY_A]: Object.freeze({ route: "synthetic-a" }), [PROXY_B]: Object.freeze({ route: "synthetic-b" }) };
  let socket;
  let restoreSocket;

  beforeEach(() => {
    __clearProxyDispatchersForTesting();
    for (const [url, dispatcher] of Object.entries(dispatchers)) __setProxyDispatcherForTesting(url, dispatcher);
    socket = vi.fn(async () => { throw new Error("unprogrammed outbound request"); });
    restoreSocket = __setOriginalFetchForTesting(socket);
  });
  afterEach(() => {
    restoreSocket();
    __clearProxyDispatchersForTesting();
  });

  /** Two extension-captured accounts on two strict pools; B's cookie is then replaced by the extension. */
  async function twoAccounts() {
    const ids = {};
    for (const [label, cookie, proxyUrl] of [["A", v.A, PROXY_A], ["B", v.B, PROXY_B]]) {
      const run = await captureAndImport({ __client: clientCookie(cookie) }, { action: "create", name: `Venice ${label}` });
      expect(run.result.ok, JSON.stringify(run.result)).toBe(true);
      ids[label] = run.result.connection.id;
      const pool = await createProxyPool({ name: `synthetic pool ${label}`, proxyUrl, strictProxy: true });
      const row = await getProviderConnectionById(ids[label]);
      await updateProviderConnection(ids[label], { providerSpecificData: { ...(row.providerSpecificData || {}), proxyPoolId: pool.id } });
    }
    const beforeA = await getProviderConnectionById(ids.A);
    const beforeB = await getProviderConnectionById(ids.B);
    const update = await captureAndImport({ __client: clientCookie(v.B2) }, { action: "update", connectionId: ids.B });
    expect(update.result).toMatchObject({ ok: true, action: "update", connection: { id: ids.B } });
    expectNoSecret(update.responses.join(""));
    expect(await getProviderConnectionById(ids.A)).toEqual(beforeA);
    const afterB = await getProviderConnectionById(ids.B);
    expect(afterB.apiKey).toBe(`__client=${v.B2}`);
    expect(afterB.providerSpecificData.proxyPoolId).toBe(beforeB.providerSpecificData.proxyPoolId);
    expect(await rows()).toHaveLength(2);
    return ids;
  }

  /** Clerk and inference answers keyed by the cookie actually sent; anything else fails. */
  function program() {
    const accounts = { [v.A]: { session: "sess_synthetic_a", access: v.accessA }, [v.B2]: { session: "sess_synthetic_b2", access: v.accessB2 } };
    const bySession = Object.fromEntries(Object.values(accounts).map((account) => [account.session, account]));
    socket.mockImplementation(async (url, init) => {
      const cookie = init.headers?.Cookie?.replace(/^__client=/, "");
      if (url === VENICE_WEB_CLIENT_URL && accounts[cookie]) return json({ response: { sessions: [{ id: accounts[cookie].session, status: "active" }] } });
      const mint = /\/sessions\/([^/]+)\/tokens$/.exec(url);
      if (mint && url === veniceWebTokenUrl(mint[1]) && accounts[cookie]?.session === mint[1]) return json({ jwt: bySession[mint[1]].access });
      if (url === VENICE_WEB_CHAT_URL) return new Response(`${JSON.stringify({ kind: "content", content: "synthetic reply" })}\n`);
      return json({ error: "unexpected" }, 500);
    });
  }

  async function execute(connectionId) {
    const credentials = await getProviderCredentials("venice-web", null, "venice-uncensored", { preferredConnectionId: connectionId });
    expect(credentials.connectionId).toBe(connectionId);
    const result = await getExecutor("venice-web").execute({
      model: "venice-uncensored", stream: false, credentials, proxyOptions: resolveCredentialProxyOptions(credentials),
      body: { messages: [{ role: "system", content: "be brief" }, { role: "user", content: "synthetic question" }] },
    });
    return { result, text: await result.response.text() };
  }

  const wire = () => JSON.stringify(socket.mock.calls.map(([url, init]) => [url, init.headers, init.body ?? null]));

  it.each([
    ["A", () => [v.A, v.accessA, v.userA, PROXY_A, [v.B2, v.accessB2, v.userB2, v.B]]],
    ["B", () => [v.B2, v.accessB2, v.userB2, PROXY_B, [v.A, v.accessA, v.userA, v.B]]],
  ])("builds account %s's Clerk and chat requests with its cookie, session and proxy only", async (_label, pick) => {
    const ids = await twoAccounts();
    const [cookie, access, userId, proxyUrl, foreign] = pick();
    program();
    const { result, text } = await execute(ids[_label]);

    expect(result.response.status, text).toBe(200);
    expect(JSON.parse(text).choices[0].message).toEqual({ role: "assistant", content: "synthetic reply" });
    const session = _label === "A" ? "sess_synthetic_a" : "sess_synthetic_b2";
    expect(socket.mock.calls.map(([url, init]) => `${init.method ?? "GET"} ${url}`)).toEqual([
      `GET ${VENICE_WEB_CLIENT_URL}`, `POST ${veniceWebTokenUrl(session)}`, `POST ${VENICE_WEB_CHAT_URL}`,
    ]);
    for (const [, init] of socket.mock.calls) {
      expect(init.dispatcher).toBe(dispatchers[proxyUrl]);
      expect(init.redirect).toBe("manual");
      expect(init).not.toHaveProperty("proxyOptions");
    }
    // The long-lived cookie goes to Clerk only; the chat carries the minted session token only.
    expect(socket.mock.calls.map(([, init]) => init.headers.Cookie)).toEqual([`__client=${cookie}`, `__client=${cookie}`, undefined]);
    expect(socket.mock.calls[2][1].headers.Authorization).toBe(`Bearer ${access}`);
    expect(JSON.parse(socket.mock.calls[2][1].body)).toMatchObject({ modelId: "venice-uncensored", userId });
    for (const value of foreign) expect(wire()).not.toContain(value);
    // What the executor reports back as sent is redacted.
    expect(result.headers.Authorization).toBe("[REDACTED]");
    expect(result.transformedBody.userId).toBe("[REDACTED]");
    expectNoSecret(text);
    expectNoSecret(loggedText());
  });

  it("never falls back to a direct send when the chosen strict proxy fails", async () => {
    const ids = await twoAccounts();
    socket.mockRejectedValue(new Error(`synthetic proxy outage ${v.B2}`));
    const { result, text } = await execute(ids.B);
    expect(result.response.status).toBe(502);
    expect(socket).toHaveBeenCalledTimes(1);
    expect(socket.mock.calls[0][1].dispatcher).toBe(dispatchers[PROXY_B]);
    expectNoSecret(text);
    expectNoSecret(loggedText());
  });

  it.each([
    ["HTTP 401", () => json({ errors: [{ message: `expired ${v.A}` }] }, 401)],
    ["HTTP 403", () => json({ errors: [{ message: `forbidden ${v.A}` }] }, 403)],
    ["a client that no longer exists", () => json({ response: null })],
    ["no active session", () => json({ response: { sessions: [{ id: "sess_synthetic_a", status: "ended" }] } })],
    ["a sign-in redirect", () => new Response(null, { status: 302, headers: { Location: "https://attacker.example/sign-in" } })],
  ])("stops at the Clerk lookup on %s, leaving both stored accounts unchanged", async (_label, reply) => {
    const ids = await twoAccounts();
    socket.mockResolvedValueOnce(reply());
    const before = await rows();
    const { result, text } = await execute(ids.A);
    expect(result.response.status).toBe(401);
    expect(JSON.parse(text).error).toMatchObject({ code: "session_expired" });
    expect(socket).toHaveBeenCalledTimes(1);
    expect(socket.mock.calls[0][0]).toBe(VENICE_WEB_CLIENT_URL);
    expect(socket.mock.calls[0][1]).toMatchObject({ redirect: "manual", dispatcher: dispatchers[PROXY_A] });
    expectNoSecret(text);
    expectNoSecret(loggedText());
    expect(await rows()).toEqual(before);
  });
});
