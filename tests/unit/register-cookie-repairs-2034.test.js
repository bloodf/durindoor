/**
 * #2034 register-cookie-repairs: shared-path wiring for the cookie-flow gaps reproduced in
 * internal/docs/port-reports/cookie-flows/{grok-web,claude-web,chatgpt-web,chatplayground}-2034.md.
 * Report: internal/docs/port-reports/register-cookie-repairs-2034.md
 *
 * Real: the registry entries, the extension's capture module and table, the dashboard parser,
 * the pairing, import, provider and Test routes, an isolated on-disk SQLite database, handleChat,
 * account selection, proxyAwareFetch, the grok-web, claude-web and chatgpt-web executors, the
 * cookie-rotation write path and the live model-list code.
 *
 * Mocked: the management guard's answers, `chrome.*`, the machine id, the proxy reachability
 * ping, the last network hop under proxyAwareFetch, the proxy dispatchers, the chatgpt.com TLS
 * socket, the ChatGPT browser session (the executor's `deps` seam) and the two live-catalog
 * resolvers (stubs that record their callers and send nothing). Every credential is synthetic.
 * Nothing here shows that a provider accepts a request or that live sign-in works.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmationFor, prepareCapture, runCapture } from "../../extensions/provider-cookie-capture/capture.js";
import { PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("@/dashboardGuard", async (importOriginal) => ({
  ...(await importOriginal()),
  canAccessManagementApi: async () => true,
  canManageAccessConfig: async () => true,
  isOperatorRequest: async () => true,
  hasExactRequestOrigin: () => true,
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-register-cookie-machine-id" }));
// The Test route pings a connection proxy before probing; that ping is a real network call.
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: async () => ({ ok: true, status: 200 }) }));
// Recording stubs: the live catalog lookups send the stored credential as a Bearer token.
const catalog = vi.hoisted(() => ({ warm: [], resolve: [] }));
vi.mock("open-sse/services/liveModelLimits.js", async (importOriginal) => ({
  ...(await importOriginal()),
  warmLiveModelLimits: (provider, credentials, options) => { catalog.warm.push({ provider, credentials, options }); },
  resolveLiveOpenAIModels: async (connection, options) => { catalog.resolve.push({ connection, options }); return { models: [] }; },
}));

const DASHBOARD = "https://dashboard.example";
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;
const PROXY_A = "http://proxy-a.invalid:8080";
const PROXY_B = "http://proxy-b.invalid:8080";
const TAB_ID = 7;
const TAB_STORE = "tab-store";
const NOW_S = () => Math.floor(Date.now() / 1000);

const GROK = "https://grok.com";
const GROK_CHAT = `${GROK}/rest/app-chat/conversations/new`;
const CLAUDE = "https://claude.ai";
const CLAUDE_ORGS = `${CLAUDE}/api/organizations`;
const CHATGPT = "https://chatgpt.com";
const CHATGPT_SESSION = "__Secure-next-auth.session-token";

// Distinct, not key-shaped, so a leak is attributable and the log redactor cannot hide it.
const S = Object.freeze({
  grokA: "synthetic-reg-grok-sso-a",
  grokArw: "synthetic-reg-grok-sso-rw-a",
  grokB: "synthetic-reg-grok-sso-b",
  clearance: "synthetic-reg-grok-clearance",
  claudeA: "synthetic-reg-claude-session-a",
  claudeB: "synthetic-reg-claude-session-b",
  cgptOld: "synthetic-reg-cgpt-old-cookie",
  cgptNew: "synthetic-reg-cgpt-imported-cookie",
  cgptSaved: "synthetic-reg-cgpt-saved-state",
  cgptSibling: "synthetic-reg-cgpt-sibling-cookie",
  cgptSiblingSaved: "synthetic-reg-cgpt-sibling-state",
  cgptAccess: "synthetic-reg-cgpt-access-token",
  cplClient: "synthetic-reg-cpl-client",
});

let root;
let db;
let routes;
let proxyFetch;
let network;
let logs;
let usageWrites;
let handleChat;

const request = (url, body, method = "POST") => new NextRequest(`${DASHBOARD}${url}`, {
  method,
  headers: { "content-type": "application/json", origin: DASHBOARD },
  ...(method === "GET" ? null : { body: JSON.stringify(body) }),
});
const params = (id) => ({ params: Promise.resolve({ id }) });
const row = (id) => db.getProviderConnectionById(id);
const logged = () => logs.flatMap((spy) => spy.mock.calls).map((args) => inspect(args, { depth: 8 })).join("\n");
function expectNoSecret(text) {
  for (const value of Object.values(S)) expect(String(text)).not.toContain(value);
}

async function mint(provider, body) {
  const response = await routes.pairing.POST(request("/api/providers/cookie-import/pairing", { provider, ...body }));
  const payload = await response.json();
  expect(response.status, payload.error).toBe(201);
  return payload.pairing;
}
const importCall = (pairing, body) => routes.import.POST(new NextRequest(IMPORT_URL, {
  method: "POST",
  headers: { "content-type": "application/json", [pairing.header]: pairing.token },
  body: JSON.stringify(body),
}));

const cookie = (host, name, value, extra = {}) => ({ name, value, domain: `.${host}`, secure: true, storeId: TAB_STORE, ...extra });

/** A browser with one tab on `origin`; cookie reads answer by exact name in that tab's store. */
function browser(origin, jar) {
  const reads = [];
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const forbidden = (api) => async () => { throw new Error(`${api} must not be used`); };
  const chrome = {
    tabs: { query: async () => [{ id: TAB_ID, url: `${origin}/` }], get: async () => ({ id: TAB_ID, url: `${origin}/` }) },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: async (query) => { names(query).forEach((name) => held.add(name)); return true; },
      remove: async (query) => { names(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "other-store", tabIds: [999] }, { id: TAB_STORE, tabIds: [TAB_ID] }],
      get: async ({ url, name, storeId }) => { reads.push({ url, name, storeId }); return jar.find((c) => c.name === name && c.storeId === storeId) ?? null; },
      getAll: forbidden("cookies.getAll"),
    },
    scripting: { executeScript: forbidden("scripting.executeScript") },
  };
  return { chrome, reads };
}

/** The real extension capture, its one POST delivered to the real import route. */
async function capture(pairing, harness) {
  const sent = [];
  const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
  expect(prepared.ok, prepared.code).toBe(true);
  const result = await runCapture({
    chrome: harness.chrome, plan: prepared.plan, confirmed: confirmationFor(prepared.plan),
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return routes.import.POST(new NextRequest(url, { method: init.method, headers: init.headers, body: init.body }));
    },
  });
  return { result, sent, plan: prepared.plan };
}

async function setProxy(id, connectionProxyUrl) {
  const response = await routes.provider.PUT(request(`/api/providers/${id}`, { connectionProxyEnabled: true, connectionProxyUrl }, "PUT"), params(id));
  expect(response.status).toBe(200);
}
async function setActive(id, isActive) {
  const response = await routes.provider.PUT(request(`/api/providers/${id}`, { isActive }, "PUT"), params(id));
  expect(response.status).toBe(200);
}

/** Inert dispatchers: proxyAwareFetch picks one per proxy URL, the test reads which one carried a call. */
function dispatchers() {
  const byDispatcher = new Map();
  for (const [label, url] of [["proxy-a", PROXY_A], ["proxy-b", PROXY_B]]) {
    const dispatcher = { label };
    byDispatcher.set(dispatcher, label);
    proxyFetch.__setProxyDispatcherForTesting(url, dispatcher);
  }
  return (init) => byDispatcher.get(init.dispatcher) ?? "direct";
}

const chatRequest = (model, extra = {}) => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "synthetic prompt" }], stream: false, ...extra }),
}));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "register-cookie-repairs-"));
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
  catalog.warm.length = 0;
  catalog.resolve.length = 0;
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  // proxyFetch wraps the global fetch when it loads: close it first, then route the last hop to `network`.
  vi.stubGlobal("fetch", vi.fn(async (url) => { throw new Error(`closed: direct fetch ${String(url)}`); }));
  proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  network = vi.fn(async (url) => { throw new Error(`unmocked outbound request ${String(url)}`); });
  proxyFetch.__setOriginalFetchForTesting(network);
  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    models: await import("../../src/app/api/v1/models/route.js"),
  };
  (await import("../../src/lib/providers/cookieImport/pairing.js")).clearPairings();
  usageWrites = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
}, 60_000);

afterEach(async () => {
  proxyFetch.__clearProxyDispatchersForTesting();
  await Promise.allSettled(usageWrites.mock.results.map((result) => result.value));
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("Grok Web: sso required, sso-rw optional", () => {
  const grokReply = () => new Response(`${JSON.stringify({ result: { response: { modelResponse: { message: "synthetic answer" } } } })}\n`);

  it("declares sso-rw in the registry profile and the extension table together, and no Cloudflare cookie", async () => {
    const { default: entry } = await import("open-sse/providers/registry/grok-web.js");
    const { getCookieImportContract } = await import("@/lib/providers/cookieImport/contract");
    const contract = getCookieImportContract("grok-web");
    expect(contract).toMatchObject({ origin: GROK, cookieNames: ["sso"], cookiePrefixes: [], optionalCookies: ["sso-rw"], extensionCapture: true });
    expect(EXTENSION_PROVIDERS["grok-web"]).toEqual({ label: "Grok Web", origin: GROK, cookieNames: ["sso"], cookiePrefixes: [], optionalCookies: ["sso-rw"] });
    // In-page sign-in keeps its own block and requirement.
    expect(entry.webLogin.cookieNames).toEqual(["sso"]);
    for (const name of ["cf_clearance", "__cf_bm"]) {
      expect(contract.optionalCookies).not.toContain(name);
      expect(EXTENSION_PROVIDERS["grok-web"].optionalCookies).not.toContain(name);
    }
  });

  it("captures both values when present and sso alone when absent, and each account sends its own cookie through its own proxy", async () => {
    const jarA = [cookie("grok.com", "sso", S.grokA), cookie("grok.com", "sso-rw", S.grokArw), cookie("grok.com", "cf_clearance", S.clearance)];
    const jarB = [cookie("grok.com", "sso", S.grokB, { expirationDate: NOW_S() + 3600 }), cookie("grok.com", "cf_clearance", S.clearance)];
    const a = await capture(await mint("grok-web", { action: "create", name: "grok-a" }), browser(GROK, jarA));
    const harnessB = browser(GROK, jarB);
    const b = await capture(await mint("grok-web", { action: "create", name: "grok-b" }), harnessB);
    expect(a.result).toMatchObject({ ok: true, cookieCount: 2 });
    expect(b.result).toMatchObject({ ok: true, cookieCount: 1 });
    // Exact names only; a missing optional cookie is read once and not required.
    expect(harnessB.reads.map((read) => read.name)).toEqual(["sso", "sso-rw"]);
    expect(a.sent[0].cookies.map((c) => c.name)).toEqual(["sso", "sso-rw"]);
    expect(b.sent[0].cookies.map((c) => c.name)).toEqual(["sso"]);
    for (const body of [...a.sent, ...b.sent]) expect(JSON.stringify(body)).not.toContain(S.clearance);
    const idA = a.result.connection.id;
    const idB = b.result.connection.id;
    expect((await row(idA)).apiKey).toBe(`sso=${S.grokA}; sso-rw=${S.grokArw}`);
    expect((await row(idB)).apiKey).toBe(`sso=${S.grokB}`);
    expectNoSecret(JSON.stringify([a.result, b.result]));

    await setProxy(idA, PROXY_A);
    await setProxy(idB, PROXY_B);
    const egress = dispatchers();
    const calls = [];
    network.mockImplementation(async (url, init) => { calls.push({ url: String(url), cookie: init.headers.Cookie, egress: egress(init) }); return grokReply(); });
    for (const [on, off, header, proxy] of [[idA, idB, `sso=${S.grokA}; sso-rw=${S.grokArw}`, "proxy-a"], [idB, idA, `sso=${S.grokB}`, "proxy-b"]]) {
      await setActive(on, true);
      await setActive(off, false);
      calls.length = 0;
      const response = await chatRequest("gw/grok-4");
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(calls).toEqual([{ url: GROK_CHAT, cookie: header, egress: proxy }]);
      expectNoSecret(text);
    }
    expectNoSecret(logged());
  });

  it("imports a pasted header with or without sso-rw and refuses Cloudflare cookies at the route", async () => {
    const parser = await import("../../src/shared/utils/cookieImportParser.js");
    const ui = (await import("../../src/shared/constants/providers.js")).WEB_COOKIE_PROVIDERS["grok-web"].cookieImport;
    const read = (header) => parser.buildImportCandidates({ kind: "header", parsed: parser.parseCookieHeaderValue(header) }, ui).candidates[0];
    const absent = read(`sso=${S.grokB}; cf_clearance=${S.clearance}; __cf_bm=${S.clearance}`);
    expect(absent.cookies).toEqual([{ name: "sso", value: S.grokB }]);
    expect(absent.dropped).toEqual(["cf_clearance", "__cf_bm"]);
    const both = read(`sso-rw=${S.grokArw}; sso=${S.grokA}`);
    expect(both.cookies.map((c) => c.name).sort()).toEqual(["sso", "sso-rw"]);

    for (const [name, candidate, header] of [["absent", absent, `sso=${S.grokB}`], ["both", both, `sso=${S.grokA}; sso-rw=${S.grokArw}`]]) {
      const pairing = await mint("grok-web", { action: "create", name });
      const response = await importCall(pairing, { provider: "grok-web", origin: GROK, name, cookies: candidate.cookies });
      expect(response.status).toBe(201);
      expect((await row((await response.json()).connection.id)).apiKey).toBe(header);
    }
    for (const name of ["cf_clearance", "__cf_bm"]) {
      const pairing = await mint("grok-web", { action: "create", name: `refused-${name}` });
      const response = await importCall(pairing, { provider: "grok-web", origin: GROK, name: `refused-${name}`, cookies: [{ name: "sso", value: S.grokA }, { name, value: S.clearance }] });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Cookie name is not approved for this provider" });
    }
    expect(network).not.toHaveBeenCalled();
  });
});

describe("Claude Web: lastActiveOrg optional beside sessionKey", () => {
  const chatOrg = (uuid) => ({ uuid, capabilities: ["chat"] });
  const sse = (text) => new Response([
    { type: "content_block_delta", delta: { type: "text_delta", text } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

  /** A synthetic claude.ai: `live` maps a sessionKey to its organizations. */
  function fakeClaude(live) {
    const egress = dispatchers();
    const sent = [];
    network.mockImplementation(async (url, init) => {
      const target = new URL(String(url));
      const cookieHeader = new Headers(init.headers).get("cookie") ?? "";
      const session = /(?:^|;\s*)sessionKey=([^;]+)/.exec(cookieHeader)?.[1];
      sent.push({ method: init.method ?? "GET", url: target.href, cookie: cookieHeader, egress: egress(init) });
      const organizations = live.get(session);
      if (!organizations) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (target.href === CLAUDE_ORGS) return Response.json(organizations);
      const org = /^\/api\/organizations\/([^/]+)\/chat_conversations\/[0-9a-f-]{36}\/completion$/.exec(target.pathname)?.[1];
      return organizations.some((candidate) => candidate.uuid === org) ? sse(`answer from ${org}`) : Response.json({}, { status: 404 });
    });
    return sent;
  }

  it("declares lastActiveOrg in the registry profile and the extension table together, keeping sessionKey required", async () => {
    const { default: entry } = await import("open-sse/providers/registry/claude-web.js");
    const contract = (await import("@/lib/providers/cookieImport/contract")).getCookieImportContract("claude-web");
    expect(contract).toMatchObject({ origin: CLAUDE, cookieNames: ["sessionKey"], optionalCookies: ["lastActiveOrg"] });
    expect(EXTENSION_PROVIDERS["claude-web"].optionalCookies).toEqual(["lastActiveOrg"]);
    expect(entry.webLogin.cookieNames).toEqual(["sessionKey"]);
    // Only the one organization hint is added; the extension still asks for the cookies permission alone.
    expect(EXTENSION_PROVIDERS["claude-web"].cookieNames).toEqual(["sessionKey"]);
  });

  it("selects the same organization for an imported two-organization account as for manual input, per account and proxy", async () => {
    const orgs = [chatOrg("org-first"), chatOrg("org-last-active")];
    const sent = fakeClaude(new Map([[S.claudeA, orgs], [S.claudeB, orgs]]));
    const jarA = [cookie("claude.ai", "sessionKey", S.claudeA), cookie("claude.ai", "lastActiveOrg", "org-last-active")];
    const a = await capture(await mint("claude-web", { action: "create", name: "Imported A" }), browser(CLAUDE, jarA));
    const b = await capture(await mint("claude-web", { action: "create", name: "Imported B" }), browser(CLAUDE, [cookie("claude.ai", "sessionKey", S.claudeB)]));
    expect(a.result).toMatchObject({ ok: true, cookieCount: 2 });
    expect(b.result).toMatchObject({ ok: true, cookieCount: 1 });
    const idA = a.result.connection.id;
    const idB = b.result.connection.id;
    expect((await row(idA)).apiKey).toBe(`sessionKey=${S.claudeA}; lastActiveOrg=org-last-active`);
    expect((await row(idB)).apiKey).toBe(`sessionKey=${S.claudeB}`);
    // Manual control with the same header as A.
    const manual = await routes.providers.POST(request("/api/providers", { provider: "claude-web", name: "Manual", apiKey: `sessionKey=${S.claudeA}; lastActiveOrg=org-last-active` }));
    expect(manual.status).toBe(201);
    const idManual = (await manual.json()).connection.id;
    await setProxy(idA, PROXY_A);
    await setProxy(idB, PROXY_B);
    await setProxy(idManual, PROXY_A);

    const chosen = {};
    for (const id of [idManual, idA, idB]) {
      for (const other of [idManual, idA, idB]) await setActive(other, other === id);
      sent.length = 0;
      const response = await chatRequest("claude-web/claude-sonnet-4-6");
      const body = await response.text();
      expect(response.status, body).toBe(200);
      expectNoSecret(body);
      chosen[id] = JSON.parse(body).choices[0].message.content;
      const own = id === idB ? "proxy-b" : "proxy-a";
      expect(sent.map((call) => call.egress)).toEqual([own, own]);
      expect(new Set(sent.map((call) => call.cookie)).size).toBe(1);
    }
    expect(chosen[idA]).toBe(chosen[idManual]);
    expect(chosen[idA]).toBe("answer from org-last-active");
    // Absent optional cookie: the executor's fallback, the first chat organization.
    expect(chosen[idB]).toBe("answer from org-first");
    expectNoSecret(logged());
  });
});

describe("shared connection Test: the guarded probe's proxy refusal is unverified", () => {
  async function claudeConnection(name, apiKey) {
    const response = await routes.providers.POST(request("/api/providers", { provider: "claude-web", name, apiKey }));
    expect(response.status).toBe(201);
    return (await response.json()).connection.id;
  }
  const runTest = async (id) => (await routes.test.POST(request(`/api/providers/${id}/test`, {}), params(id))).json();

  it("sends nothing, goes nowhere direct and writes nothing for a proxied claude-web connection", async () => {
    const id = await claudeConnection("Proxied", `sessionKey=${S.claudeA}`);
    await setProxy(id, PROXY_A);
    await db.updateProviderConnection(id, { testStatus: "active", lastError: null });
    const before = await row(id);
    const tested = await runTest(id);
    expect(tested).toMatchObject({ valid: false, skipped: true, unavailable: false });
    expect(tested.error).toMatch(/^Not verified/);
    expect(network).not.toHaveBeenCalled();
    expect(await row(id)).toEqual(before);
    expectNoSecret(JSON.stringify(tested) + logged());
  });

  it.each([401, 403])("still records an actual %s rejection of a direct connection as an error", async (status) => {
    const id = await claudeConnection("Direct", `sessionKey=${S.claudeB}`);
    const egress = dispatchers();
    const calls = [];
    network.mockImplementation(async (url, init) => { calls.push([String(url), egress(init)]); return new Response("", { status }); });
    const tested = await runTest(id);
    expect(tested).toMatchObject({ valid: false, skipped: false });
    expect(calls).toEqual([[CLAUDE_ORGS, "direct"]]);
    expect(await row(id)).toMatchObject({ testStatus: "error" });
    expectNoSecret(JSON.stringify(tested) + logged());
  });
});

describe("ChatGPT Web: a replaced cookie drops the row's saved browser state", () => {
  const header = (value) => `${CHATGPT_SESSION}=${value}`;
  const savedState = (value) => ({
    cookies: [{ name: CHATGPT_SESSION, value, domain: ".chatgpt.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
    origins: [],
  });
  const extras = { customUserAgent: "Synthetic UA", locale: "en-US", connectionProxyEnabled: true, connectionProxyUrl: PROXY_A };

  async function savedConnection(provider, name, value, state) {
    return (await db.createProviderConnection({ provider, authType: "cookie", name, apiKey: header(value), providerSpecificData: { ...extras, storageState: savedState(state) } })).id;
  }
  async function importUpdate(provider, id, value) {
    const pairing = await mint(provider, { action: "update", connectionId: id });
    const response = await importCall(pairing, { provider, origin: CHATGPT, connectionId: id, cookies: [{ name: CHATGPT_SESSION, value }] });
    const text = await response.text();
    expectNoSecret(text);
    return response.status;
  }
  const withoutState = (connection) => {
    const { storageState: _drop, ...rest } = connection.providerSpecificData;
    return rest;
  };

  it.each(["chatgpt-web", "chatgpt-web-codex"])("clears storageState on an authenticated %s import of a new cookie, on that row only", async (provider) => {
    const id = await savedConnection(provider, "Target", S.cgptOld, S.cgptSaved);
    const sibling = await savedConnection(provider, "Sibling", S.cgptSibling, S.cgptSiblingSaved);
    const before = await row(id);
    const siblingBefore = await row(sibling);

    expect(await importUpdate(provider, id, S.cgptNew)).toBe(200);
    const after = await row(id);
    expect(after.apiKey).toBe(header(S.cgptNew));
    expect(after.providerSpecificData.storageState).toBeNull();
    expect(withoutState(after)).toEqual(withoutState(before));
    expect(await row(sibling)).toEqual(siblingBefore);

    // The same cookie again is not a replacement: a saved state written later is kept.
    await db.updateProviderConnection(id, { providerSpecificData: { storageState: savedState(S.cgptSaved) } });
    expect(await importUpdate(provider, id, S.cgptNew)).toBe(200);
    expect((await row(id)).providerSpecificData.storageState).toEqual(savedState(S.cgptSaved));
  });

  it("sends the imported account on both transports after the update, and leaves the other account's state alone", async () => {
    const id = await savedConnection("chatgpt-web", "Target", S.cgptOld, S.cgptSaved);
    const sibling = await savedConnection("chatgpt-web", "Sibling", S.cgptSibling, S.cgptSiblingSaved);
    await db.updateProviderConnection(sibling, { isActive: false });
    const siblingBefore = await row(sibling);
    expect(await importUpdate("chatgpt-web", id, S.cgptNew)).toBe(200);

    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const executor = getExecutor("chatgpt-web");
    const originalDeps = executor.deps;
    const { __setTlsFetchOverrideForTesting: setTls } = await import("../../open-sse/services/chatgptTlsClient.js");
    try {
      const sessions = [];
      executor.deps = { browser: {
        createSession: async (input) => { sessions.push(input); return {}; },
        runTurn: async () => ({ text: "browser answer", status: "finished_successfully", endTurn: true }),
        readSessionCookies: async () => [],
      } };
      const browserTurn = await chatRequest("cgpt-web/gpt-5-6");
      const browserText = await browserTurn.text();
      expect(browserTurn.status, browserText).toBe(200);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ connectionId: id, proxyUrl: expect.stringContaining("proxy-a.invalid:8080") });
      expect(sessions[0].storageState.cookies.map((c) => [c.name, c.value])).toEqual([[CHATGPT_SESSION, S.cgptNew]]);

      // The HTTP transport on the same row uses the same imported account.
      await routes.provider.PUT(request(`/api/providers/${id}`, { providerSpecificData: { transport: "http" } }, "PUT"), params(id));
      expect((await row(id)).providerSpecificData.storageState).toBeNull();
      const socket = [];
      setTls(async (url, options) => {
        socket.push({ url: String(url), cookie: options.headers?.Cookie, proxyUrl: options.proxyUrl });
        const reply = (text, type = "application/json") => ({ status: 200, headers: new Headers({ "Content-Type": type }), text, body: null });
        if (String(url) === `${CHATGPT}/api/auth/session`) {
          return reply(JSON.stringify(options.headers?.Cookie === header(S.cgptNew) ? { accessToken: S.cgptAccess, user: { id: "user-imported" } } : {}));
        }
        if (String(url) === `${CHATGPT}/`) return reply("<html></html>", "text/html");
        if (String(url).includes("/sentinel/chat-requirements")) return reply(JSON.stringify({ token: "synthetic-requirements", proofofwork: { required: false } }));
        if (String(url) === `${CHATGPT}/backend-api/f/conversation`) {
          const event = (status) => `data: ${JSON.stringify({ conversation_id: "c", message: { id: "m", author: { role: "assistant" }, content: { content_type: "text", parts: ["http answer"] }, status } })}\r\n\r\n`;
          return reply(`${event("in_progress")}${event("finished_successfully")}data: [DONE]\r\n\r\n`, "text/event-stream");
        }
        if (/\/backend-api\/(me|conversations|models)(\?|$)/.test(String(url))) return reply("{}");
        throw new Error("unmocked chatgpt.com request");
      });
      const httpTurn = await chatRequest("cgpt-web/gpt-5-6");
      const httpText = await httpTurn.text();
      expect(httpTurn.status, httpText).toBe(200);
      expect(socket.length).toBeGreaterThan(0);
      for (const call of socket) {
        expect(call.cookie, call.url).toBe(header(S.cgptNew));
        expect(call.proxyUrl, call.url).toContain("proxy-a.invalid:8080");
      }
      expectNoSecret(browserText + httpText);
    } finally {
      executor.deps = originalDeps;
      setTls(null);
    }
    expect(await row(sibling)).toEqual(siblingBefore);
    expectNoSecret(logged());
  });

  it("clears storageState on an Edit that re-pastes a new cookie, keeps it otherwise, and never touches other providers", async () => {
    const edit = async (id, body) => {
      const response = await routes.provider.PUT(request(`/api/providers/${id}`, body, "PUT"), params(id));
      expect(response.status).toBe(200);
      expectNoSecret(await response.text());
      return row(id);
    };
    const id = await savedConnection("chatgpt-web", "Edited", S.cgptOld, S.cgptSaved);
    const before = await row(id);
    // Unchanged cookie, other edits: the saved state stays.
    expect((await edit(id, { apiKey: header(S.cgptOld), name: "Renamed" })).providerSpecificData.storageState).toEqual(savedState(S.cgptSaved));
    // New cookie: the saved state goes, other fields stay.
    const replaced = await edit(id, { apiKey: header(S.cgptNew) });
    expect(replaced.apiKey).toBe(header(S.cgptNew));
    expect(replaced.providerSpecificData.storageState).toBeNull();
    expect(withoutState(replaced)).toEqual(withoutState(before));
    // A request that sets the state itself keeps what it sent.
    const explicit = await edit(id, { apiKey: header(S.cgptOld), providerSpecificData: { storageState: savedState(S.cgptSaved) } });
    expect(explicit.providerSpecificData.storageState).toEqual(savedState(S.cgptSaved));

    // Another cookie provider with a field of the same name is left alone.
    const grok = (await db.createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Grok", apiKey: `sso=${S.grokA}`, providerSpecificData: { storageState: { marker: true } } })).id;
    expect((await edit(grok, { apiKey: `sso=${S.grokB}` })).providerSpecificData.storageState).toEqual({ marker: true });
  });

  it("refuses the write when the row's cookie changed after the decision, and a stale rotation cannot resurrect anything", async () => {
    const { savedBrowserStateInvalidation } = await import("@/lib/providers/browserStateInvalidation");
    const id = await savedConnection("chatgpt-web", "Raced", S.cgptOld, S.cgptSaved);
    const read = await row(id);
    expect(savedBrowserStateInvalidation(read, header(S.cgptOld))).toBeNull();
    expect(savedBrowserStateInvalidation({ ...read, provider: "grok-web" }, header(S.cgptNew))).toBeNull();
    expect(savedBrowserStateInvalidation({ ...read, providerSpecificData: {} }, header(S.cgptNew))).toBeNull();
    const invalidation = savedBrowserStateInvalidation(read, header(S.cgptNew));
    expect(invalidation.providerSpecificData).toEqual({ storageState: null });

    // Compare-and-swap against real SQLite: a concurrent cookie change wins, nothing is overwritten.
    await db.updateProviderConnection(id, { apiKey: header(S.cgptSibling) });
    const concurrent = await row(id);
    const raced = await db.updateProviderConnection(id, { apiKey: header(S.cgptNew), providerSpecificData: invalidation.providerSpecificData },
      { shouldCommitConnection: invalidation.shouldCommitConnection, returnCommitResult: true });
    expect(raced.applied).toBe(false);
    expect(await row(id)).toEqual(concurrent);

    // After a real import, a rotation captured from the old session is refused by the existing CAS.
    const { providerRefreshContext } = await import("../../src/shared/utils/providerCredentialContext.js");
    const staleContext = providerRefreshContext(await row(id));
    expect(await importUpdate("chatgpt-web", id, S.cgptNew)).toBe(200);
    const imported = await row(id);
    const { updateProviderCredentials } = await import("../../src/sse/services/tokenRefresh.js");
    expect(await updateProviderCredentials(id, { rotatedApiKey: header(`${S.cgptOld}-rotated`) }, { expectedRefreshContext: staleContext })).toBe(false);
    expect(await row(id)).toEqual(imported);
    expect(imported.providerSpecificData.storageState).toBeNull();
  });
});

describe("ChatPlayground: the stored Cookie never reaches the generic Bearer catalog lookups", () => {
  const cplHeader = () => {
    const sessionJwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sid: "sess_reg" })).toString("base64url")}.sig`;
    return `__client=${S.cplClient}; __session=${sessionJwt}`;
  };

  it("does not warm live model limits for chatplayground, but still does for an API-key provider", async () => {
    const { warmRequestModelLimits } = await import("../../src/sse/handlers/chat/singleModel/providerHooks.js");
    warmRequestModelLimits("chatplayground", { apiKey: cplHeader(), connectionId: "cpl" });
    warmRequestModelLimits("cpl", { apiKey: cplHeader(), connectionId: "cpl" });
    expect(catalog.warm).toEqual([]);
    warmRequestModelLimits("deepinfra", { apiKey: "synthetic-deepinfra-key", connectionId: "di" });
    expect(catalog.warm.map((call) => [call.provider, call.options.endpoint])).toEqual([["deepinfra", "https://api.deepinfra.com/v1/openai/models"]]);
    expect(network).not.toHaveBeenCalled();
  });

  it("lists models without handing the chatplayground connection to the Bearer resolver", async () => {
    await db.createProviderConnection({ provider: "chatplayground", authType: "cookie", name: "CPL", apiKey: cplHeader() });
    await db.createProviderConnection({ provider: "deepinfra", authType: "apikey", name: "DI", apiKey: "synthetic-deepinfra-key" });
    const listed = await routes.models.GET(new NextRequest("http://gateway.invalid/v1/models", { method: "GET" }));
    expect(listed.status).toBe(200);
    expect(catalog.resolve.map((call) => call.options.provider)).toContain("deepinfra");
    expect(catalog.resolve.filter((call) => call.options.provider === "chatplayground" || call.connection.provider === "chatplayground")).toEqual([]);
    expect(network.mock.calls.filter(([url]) => String(url).includes("chatplayground"))).toEqual([]);
    expectNoSecret(await listed.text());
  });
});
