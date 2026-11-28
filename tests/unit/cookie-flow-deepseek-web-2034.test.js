/**
 * DeepSeek Web cookie-flow round trip (#2034): the real registry descriptor from pairing through
 * extension capture, import, SQLite, account selection and the executor's real proxy routing.
 *
 * Real: registry, pairing and import routes, extension capture and dashboard parser, SQLite repos
 * under a private DATA_DIR, credential selection, executor and proxyFetch. Mocked: management guard
 * authority, `chrome` and page storage, the outbound socket and the proxy dispatchers. All values are
 * synthetic. Nothing here shows that a live DeepSeek sign-in or completion works; see
 * internal/docs/port-reports/cookie-flows/deepseek-web-2034.md for the execution gaps.
 *
 * The `{ code: 40003 }` envelope shape and the proof-of-work challenge request follow
 * cheaper-inference/OmniRoute (MIT), open-sse/executors/deepseek-web.ts and
 * open-sse/executors/deepseek-web/pow.ts at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 */
import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-deepseek-web-"));
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
import { clearPairings, pendingPairingCount, PAIRING_TTL_MS } from "../../src/lib/providers/cookieImport/pairing.js";
import { MAX_IMPORT_BODY_BYTES, PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
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
import {
  confirmationFor, describePlan, parsePairing, prepareCapture, runCapture,
} from "../../extensions/provider-cookie-capture/capture.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import deepseekWeb from "../../open-sse/providers/registry/deepseek-web.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { POW_TARGET } from "../../open-sse/executors/deepseek-web/pow.js";
import { deepSeekHashV1 } from "../../open-sse/executors/deepseek-web/deepseek-pow-hash.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import {
  __clearProxyDispatchersForTesting, __setOriginalFetchForTesting, __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";

const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://chat.deepseek.com";
const API = `${ORIGIN}/api/v0`;
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;
// Synthetic only: none of these is a real token.
const TOKEN_A = "synthetic-dsweb-account-a";
const TOKEN_B = "synthetic-dsweb-account-b";
const TOKEN_B2 = "synthetic-dsweb-account-b-replaced";
const PASTED = "synthetic-dsweb-pasted-key";
const ACCESS = "synthetic-dsweb-short-lived-access";
const DECOY = "synthetic-dsweb-unrelated-storage";
const SECRETS = [TOKEN_A, TOKEN_B, TOKEN_B2, PASTED, ACCESS, DECOY];
const wrapped = (value) => JSON.stringify({ value, __version: "0" });
const PROXY_A = "http://proxy-a.invalid:8080";
const PROXY_B = "http://proxy-b.invalid:8080";

let logs;

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const expectNoSecret = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
};
const loggedText = () => logs.flatMap((spy) => spy.mock.calls)
  .map((call) => call.map((part) => (part instanceof Error ? `${part.message}\n${part.stack}` : typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "))
  .join("\n");
const rows = () => getProviderConnections({ provider: "deepseek-web" });

const pairingRequest = (body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
  method: "POST", headers: { "content-type": "application/json", "x-9r-cli-token": "synthetic-operator", origin: DASHBOARD }, body: JSON.stringify(body),
});

/** The pairing response exactly as the dashboard hands it to the operator to paste into the extension. */
async function issue(body) {
  const response = await pair(pairingRequest({ provider: "deepseek-web", ...body }));
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return { text, pairing: JSON.parse(text).pairing };
}

const importRequest = (token, body) => new NextRequest(IMPORT_URL, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", ...(token ? { [PAIRING_HEADER]: token } : null) },
  body: JSON.stringify(body),
});

const importBody = (userToken, extra) => ({ provider: "deepseek-web", origin: ORIGIN, localStorage: { userToken }, ...extra });

/** A signed-in provider tab. Cookie APIs throw: this credential must never touch them. */
function browser(storage, { tabUrl = `${ORIGIN}/a/chat/s/synthetic` } = {}) {
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const noCookies = () => { throw new Error("deepseek-web capture must not use the cookie API"); };
  const readKeys = [];
  const chrome = {
    tabs: { query: async () => [{ id: 11, url: tabUrl }], get: async (id) => ({ id, url: tabUrl }) },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: vi.fn(async (query) => { names(query).forEach((name) => held.add(name)); return true; }),
      remove: async (query) => { names(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: { get: vi.fn(noCookies), getAll: vi.fn(noCookies), getAllCookieStores: vi.fn(noCookies) },
    scripting: {
      executeScript: vi.fn(async ({ func, args }) => {
        vi.stubGlobal("location", { origin: ORIGIN });
        vi.stubGlobal("localStorage", { getItem: (key) => { readKeys.push(key); return storage[key] ?? null; } });
        try { return [{ frameId: 0, result: func(...args) }]; } finally { vi.unstubAllGlobals(); }
      }),
    },
  };
  return { chrome, held, readKeys };
}

/** The extension's one POST, delivered to the real import route. */
function dashboardFetch() {
  const responses = [];
  const fetch = vi.fn(async (url, init) => {
    if (url !== IMPORT_URL) throw new Error("unexpected extension destination");
    const response = await importCredentials(new NextRequest(url, {
      method: init.method,
      headers: { ...init.headers, origin: "chrome-extension://synthetic-extension-id" },
      body: init.body,
    }));
    responses.push(await response.clone().text());
    return response;
  });
  return { fetch, responses };
}

/** Server pairing -> real extension review and send -> real import route. */
async function captureAndImport(storage, target) {
  const { text, pairing } = await issue(target);
  const tab = browser(storage);
  const prepared = await prepareCapture({ chrome: tab.chrome, text });
  expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
  const view = describePlan(prepared.plan);
  const dashboard = dashboardFetch();
  const result = await runCapture({ chrome: tab.chrome, fetch: dashboard.fetch, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  return { ...tab, ...dashboard, pairing, text, plan: prepared.plan, view, result };
}

beforeEach(async () => {
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

describe("the registered deepseek-web descriptor", () => {
  it("is the one the server contract, dashboard projection and extension table agree on", () => {
    expect(REGISTRY.find((entry) => entry.id === "deepseek-web")).toBe(deepseekWeb);
    const server = getCookieImportContract("deepseek-web");
    expect(server).toMatchObject({
      authType: "apikey", origin: ORIGIN, extensionCapture: true, cookieNames: [], cookiePrefixes: [],
      localStorageKeys: ["userToken"], credentialPattern: deepseekWeb.cookieImport.credentialPattern,
    });
    expect(server.optionalCookies).toBeUndefined();
    expect(server.hashedCookiePrefixes).toBeUndefined();
    // The dashboard filters "Replace session" targets by this authType.
    expect(AI_PROVIDERS["deepseek-web"].cookieImport).toMatchObject({ authType: "apikey", origin: ORIGIN, localStorageKeys: ["userToken"] });
    const builtIn = EXTENSION_PROVIDERS["deepseek-web"];
    expect([builtIn.origin, builtIn.cookieNames, builtIn.cookiePrefixes, builtIn.localStorageKeys])
      .toEqual([server.origin, [...server.cookieNames], [...server.cookiePrefixes], [...server.localStorageKeys]]);
    // Active, not staged: nothing in the descriptor hides or guards it.
    expect(deepseekWeb.hidden).toBeUndefined();
    expect(getExecutor("deepseek-web").provider).toBe("deepseek-web");
  });
});

describe("server pairing through extension capture to stored credential", () => {
  it("creates from only userToken, ignoring chunk-like and unrelated page storage", async () => {
    const storage = {
      userToken: wrapped(TOKEN_A), "userToken.0": DECOY, "userToken.1": DECOY, ds_session_id: DECOY, token: DECOY,
    };
    const run = await captureAndImport(storage, { action: "create", name: "DS account A" });
    expect(run.result).toMatchObject({ ok: true, action: "create", cookieCount: 0, localStorageCount: 1 });
    expect(run.readKeys).toEqual(["userToken"]);
    expect(run.chrome.cookies.get).not.toHaveBeenCalled();
    expect(run.chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(run.chrome.cookies.getAllCookieStores).not.toHaveBeenCalled();
    expect(run.fetch).toHaveBeenCalledTimes(1);
    expect(run.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    // Everything this run was granted is returned, and the secret is dropped from the plan.
    expect([...run.held]).toEqual([]);
    expect(run.plan.token).toBe("");

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: run.result.connection.id, authType: "apikey", name: "DS account A", isActive: true });
    expect(stored[0].apiKey || null).toBeNull();
    expect(stored[0].providerSpecificData.userToken).toBe(wrapped(TOKEN_A));
    expect(JSON.stringify(stored[0])).not.toContain(DECOY);
    for (const surface of [run.text, run.view, run.result, ...run.responses]) {
      expectNoSecret(surface);
      if (surface !== run.text) expect(JSON.stringify(surface)).not.toContain(run.pairing.token);
    }
    expectNoSecret(loggedText());
    expect(loggedText()).not.toContain(run.pairing.token);
  });

  it("redacts the imported token from the management list and single-connection reads", async () => {
    const run = await captureAndImport({ userToken: wrapped(TOKEN_A) }, { action: "create", name: "DS account A" });
    const id = run.result.connection.id;
    for (const operator of [true, false]) {
      state.isOperatorRequest.mockResolvedValue(operator);
      const list = await (await listConnections(new Request(`${DASHBOARD}/api/providers`))).json();
      const one = await (await readConnection(new Request(`${DASHBOARD}/api/providers/${id}`), { params: Promise.resolve({ id }) })).json();
      for (const connection of [list.connections.find((candidate) => candidate.id === id), one.connection]) {
        expect(connection).toMatchObject({ id, provider: "deepseek-web" });
        expect(connection.providerSpecificData).toBeDefined();
        expect(connection.providerSpecificData).not.toHaveProperty("userToken");
        expect(connection).not.toHaveProperty("apiKey");
      }
      expectNoSecret(list);
      expectNoSecret(one);
    }
    expectNoSecret(loggedText());
  });

  it.each([
    ["contains a space", "synthetic dsweb spaced"],
    ["contains a newline", "synthetic-dsweb\nsplit"],
    ["exceeds the 8192-character bound", "s".repeat(8193)],
  ])("sends nothing when the stored item %s", async (_label, value) => {
    const run = await captureAndImport({ userToken: value }, { action: "create", name: "DS account A" });
    expect(run.result).toMatchObject({ ok: false, code: "no_local_storage" });
    expect(run.fetch).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
    expect(JSON.stringify(run.result)).not.toContain(value);
  });

  it("reports a fixed rejection when the server refuses a captured value below the credential pattern", async () => {
    const run = await captureAndImport({ userToken: "tiny" }, { action: "create", name: "DS account A" });
    expect(run.result).toMatchObject({ ok: false, code: "rejected" });
    expect(run.fetch).toHaveBeenCalledTimes(1);
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a sibling DeepSeek origin at review, before any permission prompt or page read", async () => {
    const { text } = await issue({ action: "create", name: "DS account A" });
    for (const tabUrl of ["https://platform.deepseek.com/api_keys", "https://deepseek.com/", "http://chat.deepseek.com/"]) {
      const tab = browser({ userToken: TOKEN_A }, { tabUrl });
      const prepared = await prepareCapture({ chrome: tab.chrome, text });
      expect(prepared, tabUrl).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
      expect(tab.chrome.permissions.request).not.toHaveBeenCalled();
      expect(tab.chrome.scripting.executeScript).not.toHaveBeenCalled();
    }
  });
});

describe("input modes that cannot carry the localStorage credential", () => {
  const cookie = `userToken=${TOKEN_A}; ds_session_id=${DECOY}`;
  const har = JSON.stringify({ log: { entries: [{ request: {
    url: `${API}/users/current`, cookies: [{ name: "userToken", value: TOKEN_A }],
    headers: [{ name: "Cookie", value: cookie }, { name: "Authorization", value: `Bearer ${TOKEN_A}` }],
  } }] } });

  it.each([
    ["Cookie header", "header", () => parseCookieHeaderValue(`Cookie: ${cookie}`), "The input has no cookie this provider approves."],
    ["cURL command", "curl", () => parseCurlCommand(`curl '${API}/users/current' -H 'Authorization: Bearer ${TOKEN_A}' -H 'Cookie: ${cookie}'`), "The input has no cookie this provider approves."],
    ["HAR export", "har", () => parseHarDocument(har), `The HAR file has no request to ${ORIGIN}.`],
  ])("the dashboard parser refuses a %s without echoing it", (_label, kind, parse, error) => {
    const parsed = parse();
    expect(parsed.ok).toBe(true);
    const built = buildImportCandidates({ kind, parsed }, AI_PROVIDERS["deepseek-web"].cookieImport);
    expect(built).toEqual({ ok: false, error });
    expectNoSecret(built);
  });

  it.each([
    ["a raw Cookie header field", { cookieHeader: cookie }, "localStorage values are required"],
    ["a raw cURL field", { curl: `curl '${API}/users/current' -H 'Cookie: ${cookie}'` }, "localStorage values are required"],
    ["a raw HAR field", { har }, "localStorage values are required"],
    ["a bearer pasted as apiKey", { apiKey: TOKEN_A }, "localStorage values are required"],
    ["chunked item names", { localStorage: { "userToken.0": TOKEN_A, "userToken.1": TOKEN_B } }, "localStorage key is not approved for this provider"],
    ["a chunk beside the item", { localStorage: { userToken: TOKEN_A, "userToken.0": TOKEN_B } }, "localStorage key is not approved for this provider"],
  ])("the import route refuses %s with a fixed error", async (_label, extra, error) => {
    const { pairing } = await issue({ action: "create", name: "DS account A" });
    const response = await importCredentials(importRequest(pairing.token, { provider: "deepseek-web", origin: ORIGIN, ...extra }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await rows()).toHaveLength(0);
    expectNoSecret(loggedText());
  });

  it("stores only the approved item when the body also tries to set credentials and routing", async () => {
    const { pairing } = await issue({ action: "create", name: "DS account A" });
    const response = await importCredentials(importRequest(pairing.token, importBody(TOKEN_A, {
      apiKey: PASTED, providerSpecificData: { userToken: TOKEN_B, proxyPoolId: "injected-pool", connectionProxyUrl: PROXY_B },
    })));
    expect(response.status).toBe(201);
    const [stored] = await rows();
    expect(stored.apiKey || null).toBeNull();
    expect(stored.providerSpecificData.userToken).toBe(TOKEN_A);
    expect(stored.providerSpecificData.proxyPoolId).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(PROXY_B);
  });

  it("takes no account email", async () => {
    const response = await pair(pairingRequest({ provider: "deepseek-web", action: "create", name: "DS account A", accountEmail: "synthetic@example.com" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "This provider takes no account email" });
    expect(pendingPairingCount()).toBe(0);
  });
});

describe("authentication, expiry and update ownership", () => {
  const existing = (provider, name, extra) => createProviderConnection(
    { provider, authType: "apikey", name, isActive: true, apiKey: PASTED, ...extra }, { createOnly: true });

  it.each([
    ["management access", () => state.canAccessManagementApi.mockResolvedValue(false)],
    ["operator authority", () => state.isOperatorRequest.mockResolvedValue(false)],
  ])("issues no pairing without %s", async (_label, deny) => {
    deny();
    const response = await pair(pairingRequest({ provider: "deepseek-web", action: "create", name: "DS account A" }));
    expect(response.status).toBe(403);
    expect(pendingPairingCount()).toBe(0);
  });

  it("does not accept operator authority in place of a pairing", async () => {
    const response = await importCredentials(importRequest(null, importBody(TOKEN_A)));
    expect(response.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  it("bounds the import body", async () => {
    const { pairing } = await issue({ action: "create", name: "DS account A" });
    const response = await importCredentials(importRequest(pairing.token, importBody(TOKEN_A, { padding: "p".repeat(MAX_IMPORT_BODY_BYTES) })));
    expect(response.status).toBe(413);
    expect(await rows()).toHaveLength(0);
  });

  it("lets one pairing succeed once", async () => {
    const { pairing } = await issue({ action: "create", name: "DS account A" });
    expect((await importCredentials(importRequest(pairing.token, importBody(TOKEN_A)))).status).toBe(201);
    const replay = await importCredentials(importRequest(pairing.token, importBody(TOKEN_B)));
    expect(replay.status).toBe(401);
    expectNoSecret(await replay.text());
    const stored = await rows();
    expect(stored.map((row) => row.providerSpecificData.userToken)).toEqual([TOKEN_A]);
  });

  it("refuses an expired pairing in both the extension and the import route", async () => {
    const { text, pairing } = await issue({ action: "create", name: "DS account A" });
    const later = Date.now() + PAIRING_TTL_MS + 1000;
    expect(parsePairing(text, later)).toMatchObject({ ok: false, code: "pairing_expired" });
    vi.spyOn(Date, "now").mockReturnValue(later);
    const response = await importCredentials(importRequest(pairing.token, importBody(TOKEN_A)));
    expect(response.status).toBe(401);
    expect(await rows()).toHaveLength(0);
  });

  it("will not retarget the sibling `deepseek` API-key provider, which has the same auth type", async () => {
    const sibling = await existing("deepseek", "DeepSeek platform key");
    const before = await getProviderConnectionById(sibling.id);
    const response = await pair(pairingRequest({ provider: "deepseek-web", action: "update", connectionId: sibling.id }));
    expect(response.status).toBe(409);
    expect(pendingPairingCount()).toBe(0);
    expect(await getProviderConnectionById(sibling.id)).toEqual(before);
  });

  it("will not move an update pairing to another account, and spends it on the attempt", async () => {
    const a = await existing("deepseek-web", "DS account A");
    const b = await existing("deepseek-web", "DS account B");
    const before = await rows();
    const { pairing } = await issue({ action: "update", connectionId: a.id });
    const moved = await importCredentials(importRequest(pairing.token, importBody(TOKEN_B2, { connectionId: b.id })));
    expect(moved.status).toBe(409);
    const retry = await importCredentials(importRequest(pairing.token, importBody(TOKEN_B2, { connectionId: a.id })));
    expect(retry.status).toBe(401);
    expect(await rows()).toEqual(before);
  });

  it("will not overwrite an existing API-key row through a same-name create", async () => {
    const a = await existing("deepseek-web", "DS account A");
    const before = await getProviderConnectionById(a.id);
    const run = await captureAndImport({ userToken: TOKEN_B2 }, { action: "create", name: "DS account A" });
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
    // Every real egress path in proxyFetch ends here. An unprogrammed send fails the test.
    socket = vi.fn(async () => { throw new Error("unprogrammed outbound request"); });
    restoreSocket = __setOriginalFetchForTesting(socket);
    // The source challenge runs before the completion only when the operator opts in.
    vi.stubEnv("DURINDOOR_DEEPSEEK_WEB_POW", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    restoreSocket();
    __clearProxyDispatchersForTesting();
  });

  /** Two extension-imported accounts on two strict pools; B's token is then replaced by the extension. */
  async function twoAccounts() {
    const ids = {};
    for (const [label, token, proxyUrl] of [["A", TOKEN_A, PROXY_A], ["B", TOKEN_B, PROXY_B]]) {
      const run = await captureAndImport({ userToken: wrapped(token) }, { action: "create", name: `DS account ${label}` });
      ids[label] = run.result.connection.id;
      const pool = await createProxyPool({ name: `synthetic pool ${label}`, proxyUrl, strictProxy: true });
      const row = await getProviderConnectionById(ids[label]);
      await updateProviderConnection(ids[label], { providerSpecificData: { ...row.providerSpecificData, proxyPoolId: pool.id } });
    }
    const beforeA = await getProviderConnectionById(ids.A);
    const beforeB = await getProviderConnectionById(ids.B);
    const update = await captureAndImport({ userToken: wrapped(TOKEN_B2) }, { action: "update", connectionId: ids.B });
    expect(update.result).toMatchObject({ ok: true, action: "update", connection: { id: ids.B } });
    expectNoSecret(update.responses.join(""));
    expect(await getProviderConnectionById(ids.A)).toEqual(beforeA);
    const afterB = await getProviderConnectionById(ids.B);
    expect(afterB.providerSpecificData).toMatchObject({ userToken: wrapped(TOKEN_B2), proxyPoolId: beforeB.providerSpecificData.proxyPoolId });
    expect(await rows()).toHaveLength(2);
    return ids;
  }

  async function execute(connectionId, model = "deepseek-v4-flash-think-search") {
    const credentials = await getProviderCredentials("deepseek-web", null, model, { preferredConnectionId: connectionId });
    expect(credentials.connectionId).toBe(connectionId);
    const result = await getExecutor("deepseek-web").execute({
      model, stream: false, credentials, proxyOptions: resolveCredentialProxyOptions(credentials),
      body: { messages: [{ role: "system", content: "be brief" }, { role: "user", content: "synthetic question" }] },
    });
    return { result, text: await result.response.text() };
  }

  // A deterministic DeepSeekHashV1 challenge whose answer is nonce 5, solved by the real worker.
  const powChallenge = (salt) => ({
    algorithm: "DeepSeekHashV1", challenge: deepSeekHashV1(`${salt}_1900000000_5`), salt,
    signature: `synthetic-signature-${salt}`, difficulty: 16, expire_at: 1900000000, expire_after: 300000, target_path: POW_TARGET,
  });
  const setupReplies = (salt) => socket
    .mockResolvedValueOnce(json({ data: { biz_data: { token: ACCESS } } }))
    .mockResolvedValueOnce(json({ data: { biz_data: { chat_session: { id: "synthetic-session" } } } }))
    .mockResolvedValueOnce(json({ code: 0, msg: "", data: { biz_code: 0, biz_msg: "", biz_data: { challenge: powChallenge(salt) } } }));
  const wire = () => JSON.stringify(socket.mock.calls.map(([url, init]) => [url, init.headers, init.body ?? null]));

  it.each([["A", TOKEN_A, TOKEN_B2, PROXY_A], ["B", TOKEN_B2, TOKEN_A, PROXY_B]])(
    "builds account %s's requests with its token and proxy only", async (label, token, otherToken, proxyUrl) => {
      const ids = await twoAccounts();
      // The completion is answered with a quota refusal: this proves what is sent, not reply decoding.
      const salt = `synthetic-salt-${label}`;
      setupReplies(salt).mockResolvedValueOnce(json({ msg: `limited ${ACCESS}` }, 429));
      const { result, text } = await execute(ids[label]);

      expect(socket.mock.calls.map(([url, init]) => `${init.method ?? "GET"} ${url}`)).toEqual([
        `GET ${API}/users/current`, `POST ${API}/chat_session/create`,
        `POST ${API}/chat/create_pow_challenge`, `POST ${API}/chat/completion`,
      ]);
      for (const [, init] of socket.mock.calls) {
        expect(init.dispatcher).toBe(dispatchers[proxyUrl]);
        expect(init).not.toHaveProperty("proxyOptions");
      }
      expect(socket.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual([`Bearer ${token}`, `Bearer ${ACCESS}`, `Bearer ${ACCESS}`, `Bearer ${ACCESS}`]);
      expect(socket.mock.calls[0][1].headers).not.toHaveProperty("Cookie");
      expect(socket.mock.calls[2][1]).toMatchObject({ method: "POST", redirect: "manual" });
      expect(JSON.parse(socket.mock.calls[2][1].body)).toEqual({ target_path: POW_TARGET });
      expect(socket.mock.calls[2][1].headers).not.toHaveProperty("X-Ds-Pow-Response");
      // Exactly one billable completion, carrying the real solver's answer to this account's challenge.
      expect(JSON.parse(Buffer.from(socket.mock.calls[3][1].headers["X-Ds-Pow-Response"], "base64").toString())).toEqual({
        algorithm: "DeepSeekHashV1", challenge: powChallenge(salt).challenge, salt, answer: 5,
        signature: `synthetic-signature-${salt}`, target_path: POW_TARGET,
      });
      expect(JSON.parse(socket.mock.calls[3][1].body)).toEqual({
        chat_session_id: "synthetic-session", parent_message_id: null, model_type: "default",
        prompt: "system: be brief\n\nsynthetic question", ref_file_ids: [], thinking_enabled: true, search_enabled: true, preempt: false,
      });
      // The long-lived userToken goes out once; the other account's token never does.
      expect(wire().split(token)).toHaveLength(2);
      expect(wire()).not.toContain(otherToken);
      // The replaced token of account B (a prefix of its successor) is gone too.
      expect(wire()).not.toMatch(new RegExp(`${TOKEN_B}(?!-replaced)`));
      expect(result.response.status).toBe(429);
      expectNoSecret(text);
      expectNoSecret(loggedText());
    });

  it("never falls back to a direct send when the chosen strict proxy fails", async () => {
    const ids = await twoAccounts();
    socket.mockRejectedValue(new Error("synthetic proxy outage"));
    const { result, text } = await execute(ids.B);
    expect(result.response.status).toBe(502);
    expect(socket).toHaveBeenCalledTimes(1);
    expect(socket.mock.calls[0][1].dispatcher).toBe(dispatchers[PROXY_B]);
    expectNoSecret(text);
    expectNoSecret(loggedText());
  });

  it.each([
    ["HTTP 401", () => json({ msg: `expired ${TOKEN_A}` }, 401), 401],
    ["HTTP 403", () => json({ msg: `forbidden ${TOKEN_A}` }, 403), 403],
    ["a 200 rejection envelope", () => json({ code: 40003, msg: `expired ${TOKEN_A}`, data: null }), 401],
    ["a sign-in redirect", () => new Response(null, { status: 302, headers: { Location: "https://attacker.example/sign_in" } }), 401],
  ])("stops at users/current on %s, leaving both stored accounts unchanged", async (_label, reply, status) => {
    const ids = await twoAccounts();
    socket.mockResolvedValueOnce(reply());
    const credentialsBefore = (await rows()).map((row) => row.providerSpecificData.userToken);
    const { result, text } = await execute(ids.A);
    expect(result.response.status).toBe(status);
    expect(socket).toHaveBeenCalledTimes(1);
    expect(socket.mock.calls[0][1]).toMatchObject({ redirect: "manual", dispatcher: dispatchers[PROXY_A] });
    expectNoSecret(text);
    expectNoSecret(loggedText());
    expect((await rows()).map((row) => row.providerSpecificData.userToken)).toEqual(credentialsBefore);
  });
});
