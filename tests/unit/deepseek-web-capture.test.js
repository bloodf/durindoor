/**
 * DeepSeek Web token capture (#2034). The credential is the `userToken` localStorage item of
 * chat.deepseek.com, read by the extension on that origin only, imported through the pairing API
 * and handed to the executor. Closed mocks and synthetic values only: a fake `chrome`, a fake
 * `fetch`, a fixture database adapter; no browser, no network, no real token.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-web-capture-"));
  process.env.DATA_DIR = dataDir;
  return {
    getAdapter: vi.fn(),
    getAdapterSync: vi.fn(() => { throw new Error("Fixture adapter is not initialized"); }),
    canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn(),
    dataDir, originalDataDir,
  };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: state.canAccessManagementApi,
  isOperatorRequest: state.isOperatorRequest,
  hasExactRequestOrigin: state.hasExactRequestOrigin,
}));
vi.mock("@/models", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCredentials } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import {
  parsePairing, preflightPermissions, runCapture, confirmationFor, readLocalStorageItems,
} from "../../extensions/provider-cookie-capture/capture.js";
import DeepSeekWebExecutor, { deepSeekUserToken } from "../../open-sse/executors/deepseek-web.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);
const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://chat.deepseek.com";
const OTHER = "https://attacker.example";
// Synthetic only: none of these is a real token.
const TOKEN = "synthetic-deepseek-token-captured";
const WRAPPED = JSON.stringify({ value: TOKEN, __version: "0" });
const PASTED = "synthetic-deepseek-token-pasted";
const OTHER_VALUE = "synthetic-other-site-value";

afterEach(() => { vi.unstubAllGlobals(); });

describe("DeepSeek Web extension profile", () => {
  it("names one origin and one localStorage item, and no cookie", () => {
    expect(EXTENSION_PROVIDERS["deepseek-web"]).toEqual({
      label: "DeepSeek Web", origin: ORIGIN, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["userToken"],
    });
    const manifest = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../extensions/provider-cookie-capture/manifest.json"), "utf8"));
    expect(manifest.optional_host_permissions).toContain(`${ORIGIN}/*`);
    expect(manifest.permissions).not.toContain("scripting");
    expect(manifest.optional_permissions).toContain("scripting");
  });
});

describe("capture on the right origin", () => {
  const pairing = (contract = { origin: ORIGIN, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["userToken"] }) => JSON.stringify({ pairing: {
    token: `ddpair_${"D".repeat(43)}`, header: PAIRING_HEADER, provider: "deepseek-web", action: "create", name: "Synthetic DeepSeek",
    expiresAt: new Date(NOW + 60_000).toISOString(), importUrl: `${DASHBOARD}/api/providers/cookie-import`, contract,
  } });

  /** `tabUrl` is the confirmed tab's URL; `pageOrigin` is the origin of the document the reader runs in. */
  function makeChrome({ items = { userToken: TOKEN }, tabUrl = `${ORIGIN}/a/chat/s/synthetic`, pageOrigin = ORIGIN, frameId = 0 } = {}) {
    const calls = [];
    const held = new Set();
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    const chrome = {
      tabs: { get: async (id) => ({ id, url: tabUrl }) },
      permissions: {
        contains: async (q) => names(q).every((n) => held.has(n)),
        request: async (q) => { calls.push(["permissions.request", q]); names(q).forEach((n) => held.add(n)); return true; },
        remove: async (q) => { calls.push(["permissions.remove", q]); names(q).forEach((n) => held.delete(n)); return true; },
      },
      cookies: { getAllCookieStores: async () => { calls.push(["cookies.getAllCookieStores"]); return []; }, get: async () => { calls.push(["cookies.get"]); return null; } },
      scripting: {
        executeScript: async (details) => {
          calls.push(["scripting.executeScript", { target: details.target, args: details.args }]);
          vi.stubGlobal("localStorage", { getItem: (key) => items[key] ?? null, setItem: () => { throw new Error("the reader must not write"); } });
          vi.stubGlobal("location", { origin: pageOrigin });
          try { return [{ frameId, result: details.func(...details.args) }]; } finally { vi.unstubAllGlobals(); }
        },
      },
    };
    return { chrome, calls };
  }

  const capture = async (options) => {
    const parsed = parsePairing(pairing(), NOW);
    expect(parsed.ok).toBe(true);
    const plan = { ...parsed.plan, tabId: 9 };
    const harness = makeChrome(options);
    await preflightPermissions(harness.chrome, plan);
    const fetch = vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ connection: { id: "c-ds", name: "Synthetic DeepSeek" } }) }));
    const result = await runCapture({ chrome: harness.chrome, fetch, plan, confirmed: confirmationFor(plan), now: () => NOW });
    return { ...harness, result, fetch };
  };

  it("reads only userToken with chrome.scripting and posts it without cookies", async () => {
    const { result, calls, fetch } = await capture();
    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 0, localStorageCount: 1 });
    expect(calls.find(([name]) => name === "permissions.request")[1]).toEqual({ permissions: ["scripting"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] });
    expect(calls.some(([name]) => name.startsWith("cookies."))).toBe(false);
    expect(calls.find(([name]) => name === "scripting.executeScript")[1]).toEqual({ target: { tabId: 9 }, args: [["userToken"], ORIGIN] });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${DASHBOARD}/api/providers/cookie-import`);
    expect(JSON.parse(init.body)).toEqual({ provider: "deepseek-web", origin: ORIGIN, localStorage: { userToken: TOKEN } });
    expect(calls.find(([name]) => name === "permissions.remove")[1]).toEqual({ permissions: ["scripting"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] });
  });

  it("carries the site's JSON-wrapped token as it is stored", async () => {
    const { result, fetch } = await capture({ items: { userToken: WRAPPED } });
    expect(result).toMatchObject({ ok: true, localStorageCount: 1 });
    expect(JSON.parse(fetch.mock.calls[0][1].body).localStorage).toEqual({ userToken: WRAPPED });
  });

  it("sends nothing when the page has no token or only a subframe answered", async () => {
    for (const options of [{ items: {} }, { frameId: 3 }]) {
      const { result, fetch } = await capture(options);
      expect(result).toMatchObject({ ok: false, code: "no_local_storage" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});

describe("refusal on another origin", () => {
  const runInPage = (origin, items, args) => {
    vi.stubGlobal("location", { origin });
    vi.stubGlobal("localStorage", { getItem: (key) => items[key] ?? null });
    try { return readLocalStorageItems(...args); } finally { vi.unstubAllGlobals(); }
  };

  it("the reader returns the token on the DeepSeek origin and nothing anywhere else", () => {
    expect(runInPage(ORIGIN, { userToken: TOKEN }, [["userToken"], ORIGIN])).toEqual({ userToken: TOKEN });
    const items = { userToken: OTHER_VALUE };
    for (const pageOrigin of [OTHER, "http://chat.deepseek.com", "https://chat.deepseek.com:8443", "https://evil.chat.deepseek.com", "https://deepseek.com"]) {
      expect(runInPage(pageOrigin, items, [["userToken"], ORIGIN]), pageOrigin).toEqual({});
    }
    expect(runInPage(ORIGIN, items, [["userToken"]])).toEqual({});
  });

  it("a confirmed tab that is not on chat.deepseek.com is refused before any script runs", async () => {
    const parsed = parsePairing(JSON.stringify({ pairing: {
      token: `ddpair_${"E".repeat(43)}`, header: PAIRING_HEADER, provider: "deepseek-web", action: "create", name: "Synthetic DeepSeek",
      expiresAt: new Date(NOW + 60_000).toISOString(), importUrl: `${DASHBOARD}/api/providers/cookie-import`,
      contract: { origin: ORIGIN, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["userToken"] },
    } }), NOW);
    const plan = { ...parsed.plan, tabId: 9 };
    const executeScript = vi.fn(async () => [{ frameId: 0, result: { userToken: OTHER_VALUE } }]);
    const held = new Set();
    const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
    const chrome = {
      tabs: { get: async (id) => ({ id, url: `${OTHER}/a/chat` }) },
      permissions: {
        contains: async (q) => names(q).every((n) => held.has(n)),
        request: async (q) => { names(q).forEach((n) => held.add(n)); return true; },
        remove: async (q) => { names(q).forEach((n) => held.delete(n)); return true; },
      },
      scripting: { executeScript },
    };
    await preflightPermissions(chrome, plan);
    const fetch = vi.fn();
    const result = await runCapture({ chrome, fetch, plan, confirmed: confirmationFor(plan), now: () => NOW });
    expect(result.ok).toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a pairing for another origin, or one that drops the item, is refused", () => {
    const make = (contract) => parsePairing(JSON.stringify({ pairing: {
      token: `ddpair_${"F".repeat(43)}`, header: PAIRING_HEADER, provider: "deepseek-web", action: "create", name: "Synthetic DeepSeek",
      expiresAt: new Date(NOW + 60_000).toISOString(), importUrl: `${DASHBOARD}/api/providers/cookie-import`, contract,
    } }), NOW);
    expect(make({ origin: OTHER, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["userToken"] }).ok).toBe(false);
    expect(make({ origin: ORIGIN, cookieNames: [], cookiePrefixes: [], localStorageKeys: [] }).ok).toBe(false);
  });
});

describe("dashboard import of the token", () => {
  let db;
  let logs;

  const pairingRequest = (body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
    method: "POST", headers: { "content-type": "application/json", "x-9r-cli-token": "operator-one", origin: DASHBOARD }, body: JSON.stringify(body),
  });
  async function issue(body) {
    const res = await pair(pairingRequest(body));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    return (await res.json()).pairing;
  }
  const importRequest = (token, body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, {
    method: "POST", headers: { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", [PAIRING_HEADER]: token }, body: JSON.stringify(body),
  });
  const rows = () => db.all("SELECT * FROM providerConnections");
  const loggedText = () => logs.flatMap((spy) => spy.mock.calls).map((call) => call.map(String).join(" ")).join("\n");

  beforeEach(() => {
    clearPairings();
    vi.stubEnv("BASE_URL", DASHBOARD);
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
    db = createBetterSqliteAdapter(":memory:");
    db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    applyVersionedMigrations(db, MIGRATIONS);
    state.getAdapter.mockReset().mockResolvedValue(db);
    state.getAdapterSync.mockReset().mockReturnValue(db);
    state.canAccessManagementApi.mockReset().mockResolvedValue(true);
    state.isOperatorRequest.mockReset().mockResolvedValue(true);
    state.hasExactRequestOrigin.mockReset().mockReturnValue(true);
    logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  });
  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = state.originalDataDir;
    fs.rmSync(state.dataDir, { recursive: true, force: true });
  });

  it("describes the localStorage item in the pairing contract", async () => {
    const pairing = await issue({ provider: "deepseek-web", action: "create", name: "DeepSeek" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["userToken"] });
  });

  it.each([["the bare token", TOKEN], ["the site's JSON wrapper", WRAPPED]])("creates an API-key connection holding %s in providerSpecificData, with no API key", async (_label, value) => {
    const pairing = await issue({ provider: "deepseek-web", action: "create", name: "DeepSeek" });
    const res = await importCredentials(importRequest(pairing.token, { provider: "deepseek-web", origin: ORIGIN, localStorage: { userToken: value } }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(JSON.stringify(payload)).not.toContain(TOKEN);
    expect(payload.connection).toEqual({ id: expect.any(String), provider: "deepseek-web", name: "DeepSeek" });
    const stored = await getProviderConnectionById(payload.connection.id);
    expect(stored).toMatchObject({ provider: "deepseek-web", authType: "apikey", providerSpecificData: { userToken: value } });
    expect(stored.apiKey || null).toBeNull();
    expect(loggedText()).not.toContain(TOKEN);
    // What the executor is handed for this connection resolves to the bare token.
    expect(deepSeekUserToken({ apiKey: stored.apiKey, providerSpecificData: stored.providerSpecificData })).toBe(TOKEN);
  });

  it.each([
    ["no localStorage value", {}],
    ["a cookie in place of the token", { cookies: [{ name: "userToken", value: TOKEN, secure: true }] }],
    ["a cookie beside the token", { localStorage: { userToken: TOKEN }, cookies: [{ name: "ds_session_id", value: "synthetic", secure: true }] }],
    ["an unapproved key", { localStorage: { userToken: TOKEN, other: TOKEN } }],
    ["a value with a space", { localStorage: { userToken: "has space in it" } }],
    ["a value with a control character", { localStorage: { userToken: "synthetic\u0000token" } }],
    ["a value that is too short", { localStorage: { userToken: "short" } }],
  ])("refuses %s and stores nothing", async (_label, extra) => {
    const pairing = await issue({ provider: "deepseek-web", action: "create", name: "DeepSeek" });
    const res = await importCredentials(importRequest(pairing.token, { provider: "deepseek-web", origin: ORIGIN, ...extra }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
    expect(rows()).toHaveLength(0);
  });

  it("refuses a token sent from another origin", async () => {
    const pairing = await issue({ provider: "deepseek-web", action: "create", name: "DeepSeek" });
    const res = await importCredentials(importRequest(pairing.token, { provider: "deepseek-web", origin: OTHER, localStorage: { userToken: TOKEN } }));
    expect(res.status).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it("replaces the token of an existing connection and clears a pasted key, which would otherwise win", async () => {
    const existing = await createProviderConnection({
      provider: "deepseek-web", authType: "apikey", name: "Existing", apiKey: PASTED, isActive: true, testStatus: "expired",
      providerSpecificData: { note: "kept" },
    }, { createOnly: true });
    const pairing = await issue({ provider: "deepseek-web", action: "update", connectionId: existing.id });
    const res = await importCredentials(importRequest(pairing.token, { provider: "deepseek-web", origin: ORIGIN, connectionId: existing.id, localStorage: { userToken: TOKEN } }));
    expect(res.status).toBe(200);
    const stored = await getProviderConnectionById(existing.id);
    expect(stored.providerSpecificData).toMatchObject({ userToken: TOKEN, note: "kept" });
    expect(stored.apiKey || null).toBeNull();
    expect(stored.testStatus).toBe("active");
  });
});

describe("the executor receives the token", () => {
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  const run = async (credentials) => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(json({ data: { biz_data: { token: "synthetic-access" } } }))
      .mockResolvedValueOnce(json({ data: { biz_data: { chat_session: { id: "synthetic-session" } } } }))
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ data: { biz_data: { response: "ok" } } })}\n\n`));
    vi.stubGlobal("fetch", upstream);
    const output = await new DeepSeekWebExecutor().execute({ model: "deepseek-chat", body: { messages: [{ role: "user", content: "hi" }] }, credentials, stream: false });
    return { output, upstream };
  };

  it("sends an imported token from providerSpecificData as the bearer, bare or unwrapped", async () => {
    for (const value of [TOKEN, WRAPPED]) {
      const { output, upstream } = await run({ apiKey: null, providerSpecificData: { userToken: value } });
      expect(output.response.status).toBe(200);
      expect(upstream.mock.calls[0][0]).toBe("https://chat.deepseek.com/api/v0/users/current");
      expect(upstream.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(upstream.mock.calls[0][1].redirect).toBe("manual");
    }
  });

  it("prefers a pasted API key over an imported value", async () => {
    const { upstream } = await run({ apiKey: PASTED, providerSpecificData: { userToken: TOKEN } });
    expect(upstream.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${PASTED}`);
  });

  it("answers 401 without a request when neither source holds a token", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const output = await new DeepSeekWebExecutor().execute({ model: "deepseek-chat", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { providerSpecificData: {} }, stream: false });
    expect(output.response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("validates an imported token with one read-only users/current GET carrying the bare token", async () => {
    const fetcher = vi.fn(async () => json({ data: { biz_data: { token: "synthetic-access" } } }));
    const result = await probeRegistryProvider("deepseek-web", null, fetcher, { userToken: WRAPPED });
    expect(result).toMatchObject({ valid: true });
    expect(fetcher.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET https://chat.deepseek.com/api/v0/users/current"]);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});
