/**
 * #2034: the claude-web web-cookie flow, offline, against its real provider contract.
 *
 * Real: the shipped registry descriptor, the extension capture module, the dashboard input
 * parsers, the pairing and import routes, the SQLite connection store, the provider routes,
 * handleChat, account selection, the claude-web executor and proxyAwareFetch.
 * Synthetic: every credential, the chrome.* namespace, the claude.ai answers, the proxy
 * dispatchers and the proxy reachability check. Only the management guard's authority
 * decision is replaced. No browser, no network, no claude.ai account: nothing here shows
 * that live sign-in works.
 *
 * The claude-web transport under test is ported from OmniRoute (MIT),
 * open-sse/executors/claude-web.ts. Report:
 * internal/docs/port-reports/cookie-flows/claude-web-2034.md
 *
 * Gaps 1 and 3 are repaired by register-cookie-repairs-2034: the import profile and extension table
 * keep the optional `lastActiveOrg` beside the required `sessionKey`, and Test reports the guarded
 * probe's proxy refusal as unverified without writing the row. Gap 2 (HAR expiry) is not.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MESSAGES, confirmationFor, describePlan, prepareCapture, runCapture,
} from "../../extensions/provider-cookie-capture/capture.js";
import { PAIRING_HEADER, PROVIDERS as EXTENSION_PROVIDERS } from "../../extensions/provider-cookie-capture/providers.js";
import {
  buildImportCandidates, candidatesAreAmbiguous, parseCookieHeaderValue, parseCurlCommand, parseHarDocument,
} from "../../src/shared/utils/cookieImportParser.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const authority = vi.hoisted(() => ({ operator: true }));
vi.mock("@/dashboardGuard", async (importOriginal) => ({
  ...(await importOriginal()),
  canAccessManagementApi: async () => authority.operator,
  canManageAccessConfig: async () => authority.operator,
  isOperatorRequest: async () => authority.operator,
  hasExactRequestOrigin: () => true,
}));
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-claude-web-machine-id" }));
// The Test route first checks that the proxy is reachable: a real network call, replaced here.
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: async () => ({ ok: true, status: 200 }) }));

const ORIGIN = "https://claude.ai";
const ORGS_URL = `${ORIGIN}/api/organizations`;
const DASHBOARD = "https://dashboard.example";
const IMPORT_URL = `${DASHBOARD}/api/providers/cookie-import`;
const MODEL = "claude-web/claude-sonnet-4-6";
const PROXY_A = "http://proxy-a.invalid:8080";
const PROXY_B = "http://proxy-b.invalid:8080";
const TAB_ID = 7;

// Synthetic only, and deliberately not key-shaped, so the log redactor cannot hide a leak.
const SECRET = Object.freeze({
  a: "synthetic-claude-account-a-7f3a==",
  a2: "synthetic-claude-account-a-renewed-91bc",
  b: "synthetic-claude-account-b-c04d",
  otherStore: "synthetic-claude-other-profile-5e2f",
  noise: "synthetic-claude-clearance-noise-aa10",
});

let root;
let db;
let routes;
let handleChat;
let proxyFetch;
let clearPairings;
let restoreFetch;
let outbound;
let sent;
let logs;
let usageWrites;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-claude-web-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(key, undefined);
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  authority.operator = true;
  vi.resetModules();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  // proxyFetch captures the global fetch when it loads, so an unmocked send fails loudly.
  outbound = vi.fn(() => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);
  sent = [];
  proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    cookieImport: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    validate: await import("../../src/app/api/providers/validate/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    discovery: await import("../../src/app/api/providers/[id]/models/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  // Chat schedules usage persistence without awaiting it; teardown waits before closing SQLite.
  usageWrites = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  ({ clearPairings } = await import("@/lib/providers/cookieImport/pairing"));
  clearPairings();
}, 60_000);

afterEach(async () => {
  restoreFetch?.();
  restoreFetch = undefined;
  proxyFetch.__clearProxyDispatchersForTesting();
  clearPairings();
  await Promise.allSettled(usageWrites.mock.results.map((result) => result.value));
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const jsonRequest = (url, body, method = "POST") => new Request(`http://gateway.invalid${url}`, {
  method,
  headers: { "content-type": "application/json" },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const idParams = (id) => ({ params: Promise.resolve({ id }) });

const pairingRequest = (body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-9r-cli-token": "synthetic-operator", origin: DASHBOARD },
  body: JSON.stringify(body),
});

async function mint(target) {
  const res = await routes.pairing.POST(pairingRequest({ provider: "claude-web", ...target }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}

function deliver(url, { method = "POST", headers, body }) {
  return routes.cookieImport.POST(new NextRequest(url, {
    method, headers: { ...headers, origin: "chrome-extension://synthetic-extension" }, body,
  }));
}

const postImport = (token, body) => deliver(IMPORT_URL, {
  headers: { "content-type": "application/json", ...(token ? { [PAIRING_HEADER]: token } : null) },
  body: JSON.stringify(body),
});

const browserCookie = (name, value, extra = {}) => ({
  name, value, domain: ".claude.ai", secure: true, storeId: "tab-store", ...extra,
});

/** A fake chrome.* whose cookie jar answers by URL host, exact name and cookie store. */
function fakeChrome({ tabUrl = `${ORIGIN}/new`, jar = [] } = {}) {
  const calls = { gets: [], requested: [], removed: [] };
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const chrome = {
    tabs: {
      query: async () => [{ id: TAB_ID, url: tabUrl }],
      get: async () => ({ id: TAB_ID, url: tabUrl }),
    },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: async (query) => {
        calls.requested.push(structuredClone(query));
        names(query).forEach((name) => held.add(name));
        return true;
      },
      remove: async (query) => {
        calls.removed.push(structuredClone(query));
        names(query).forEach((name) => held.delete(name));
        return true;
      },
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "other-store", tabIds: [999] }, { id: "tab-store", tabIds: [TAB_ID] }],
      get: async ({ url, name, storeId }) => {
        calls.gets.push({ url, name, storeId });
        const host = new URL(url).hostname;
        return jar.find((cookie) => cookie.name === name && cookie.storeId === storeId &&
          (cookie.domain === host || cookie.domain === `.${host}`)) ?? null;
      },
      getAll: async () => { throw new Error("claude-web must never enumerate cookies"); },
    },
    scripting: { executeScript: async () => { throw new Error("claude-web must never script the page"); } },
  };
  return { chrome, calls };
}

/** Review then Send, exactly as the popup drives the real capture module. */
async function extensionCapture(pairing, chromeOptions) {
  const harness = fakeChrome(chromeOptions);
  const post = vi.fn(deliver);
  const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { ...harness, post, result: prepared, plan: null };
  const send = () => runCapture({
    chrome: harness.chrome, fetch: post, plan: prepared.plan, confirmed: confirmationFor(prepared.plan),
  });
  return { ...harness, post, plan: prepared.plan, send, result: await send() };
}

const cookieOf = (init) => new Headers(init.headers).get("cookie") ?? "";
const sessionOf = (cookie) => /(?:^|;\s*)sessionKey=([^;]+)/.exec(cookie)?.[1] ?? "";

const sse = (text) => new Response([
  { type: "content_block_delta", delta: { type: "text_delta", text } },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

/**
 * A synthetic claude.ai behind the real proxyAwareFetch. `live` maps a sessionKey value to its
 * organizations; any other session gets 401. Every send records which egress carried it.
 */
function fakeClaude(live) {
  const egress = new Map();
  for (const [label, url] of [["proxy-a", PROXY_A], ["proxy-b", PROXY_B]]) {
    const dispatcher = {};
    egress.set(dispatcher, label);
    proxyFetch.__setProxyDispatcherForTesting(url, dispatcher);
  }
  restoreFetch = proxyFetch.__setOriginalFetchForTesting(async (url, init) => {
    const target = new URL(String(url));
    const cookie = cookieOf(init);
    sent.push({
      url: target.href, method: init.method ?? "GET", cookie, redirect: init.redirect,
      egress: egress.get(init.dispatcher) ?? "direct",
      headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null,
    });
    if (target.origin !== ORIGIN) throw new Error("unexpected provider origin");
    const organizations = live.get(sessionOf(cookie));
    if (!organizations) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (target.href === ORGS_URL) return Response.json(organizations);
    const match = /^\/api\/organizations\/([^/]+)\/chat_conversations\/[0-9a-f-]{36}\/completion$/.exec(target.pathname);
    if (!match || !organizations.some((org) => org.uuid === match[1])) return Response.json({}, { status: 404 });
    return sse(`answer from ${match[1]}`);
  });
}
const chatOrg = (uuid) => ({ uuid, capabilities: ["chat"] });
const completions = () => sent.filter((call) => call.method === "POST");
const completionOrg = (call) => new URL(call.url).pathname.split("/")[3];

const chat = (extra = {}) => handleChat(jsonRequest("/v1/chat/completions", {
  model: MODEL, messages: [{ role: "user", content: "synthetic prompt" }], stream: false, ...extra,
}));

async function addManual(name, apiKey, priority) {
  const res = await routes.providers.POST(jsonRequest("/api/providers", { provider: "claude-web", name, apiKey, priority }));
  expect(res.status).toBe(201);
  return (await res.json()).connection;
}

async function setProxy(id, connectionProxyUrl) {
  const res = await routes.provider.PUT(jsonRequest(`/api/providers/${id}`, {
    connectionProxyEnabled: true, connectionProxyUrl,
  }, "PUT"), idParams(id));
  expect(res.status).toBe(200);
}

const stored = () => db.getProviderConnections({ provider: "claude-web" });

/** Everything written to the console, objects expanded. */
const logged = () => logs.flatMap((spy) => spy.mock.calls)
  .map((call) => call.map((part) => inspect(part, { depth: 8, breakLength: Infinity })).join(" ")).join("\n");

/** Every row of every SQLite table, as it sits on disk (no repository decryption). */
async function rawDatabase() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const adapter = await getAdapter();
  const tables = adapter.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  return JSON.stringify(tables.map(({ name }) => [name, adapter.all(`SELECT * FROM "${name}"`)]));
}

const expectNoSecret = (text) => {
  for (const value of Object.values(SECRET)) expect(text).not.toContain(value);
};

/** The request body the dashboard dialog posts for one reviewed candidate. */
const dialogBody = (candidate, target) => ({ provider: "claude-web", origin: candidate.origin, cookies: candidate.cookies, ...target });

const harDocument = (...requests) => JSON.stringify({ log: { entries: requests.map(({ url, cookies }) => ({
  request: { url, headers: [], cookies },
})) } });

describe("claude-web: shipped descriptor and extension capture", () => {
  it("resolves one required cookie and the optional lastActiveOrg on one exact origin, with nothing chunked or in localStorage", async () => {
    const { default: REGISTRY } = await import("open-sse/providers/registry/index.js");
    const { default: descriptor } = await import("open-sse/providers/registry/claude-web.js");
    const { getCookieImportContract } = await import("@/lib/providers/cookieImport/contract");
    const { ClaudeWebExecutor, getExecutor } = await import("open-sse/executors/index.js");

    expect(REGISTRY.find((entry) => entry.id === "claude-web")).toBe(descriptor);
    // A narrow import profile; in-page sign-in keeps its own block, which still names sessionKey only.
    expect(descriptor.cookieImport).toEqual({
      origin: ORIGIN, cookieNames: ["sessionKey"], cookiePrefixes: [], optionalCookies: ["lastActiveOrg"], extensionCapture: true,
    });
    expect(descriptor.webLogin).toMatchObject({ origin: ORIGIN, cookieNames: ["sessionKey"] });
    const contract = getCookieImportContract("claude-web");
    expect(contract.config).toBe(descriptor.cookieImport);
    expect(contract).toMatchObject({
      authType: "cookie", origin: ORIGIN, host: "claude.ai", extensionCapture: true,
      cookieNames: ["sessionKey"], cookiePrefixes: [], optionalCookies: ["lastActiveOrg"],
    });
    for (const absent of ["hashedCookiePrefixes", "localStorageKeys", "accountEmail"]) {
      expect(contract, absent).not.toHaveProperty(absent);
    }
    expect(EXTENSION_PROVIDERS["claude-web"]).toEqual({
      label: "Claude Web", origin: ORIGIN, cookieNames: ["sessionKey"], cookiePrefixes: [], optionalCookies: ["lastActiveOrg"],
    });
    // claude-web is an active provider: both its id and alias dispatch to the real executor.
    expect(getExecutor("claude-web")).toBeInstanceOf(ClaudeWebExecutor);
    expect(getExecutor("cw")).toBe(getExecutor("claude-web"));
  });

  it("captures only the tab store's sessionKey and lastActiveOrg, stores them encrypted and sends them through that account's proxy", async () => {
    const pairing = await mint({ action: "create", name: "Claude A" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: ["sessionKey"], cookiePrefixes: [], optionalCookies: ["lastActiveOrg"] });
    const capture = await extensionCapture(pairing, { jar: [
      browserCookie("sessionKey", SECRET.otherStore, { storeId: "other-store" }),
      browserCookie("sessionKey", SECRET.a, { expirationDate: Math.floor(Date.now() / 1000) + 3600 }),
      browserCookie("lastActiveOrg", "org-a"),
      browserCookie("cf_clearance", SECRET.noise),
    ] });

    expect(capture.result).toMatchObject({ ok: true, action: "create", cookieCount: 2, connection: { name: "Claude A" } });
    expect(capture.calls.gets).toEqual([
      { url: `${ORIGIN}/`, name: "sessionKey", storeId: "tab-store" },
      { url: `${ORIGIN}/`, name: "lastActiveOrg", storeId: "tab-store" },
    ]);
    expect(capture.calls.requested).toEqual([{ permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] }]);
    expect(capture.calls.removed).toEqual(capture.calls.requested);
    expect(capture.post).toHaveBeenCalledOnce();
    const [url, init] = capture.post.mock.calls[0];
    expect(url).toBe(IMPORT_URL);
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
    expect(init.headers).toEqual({ "content-type": "application/json", [PAIRING_HEADER]: pairing.token });
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["cookies", "origin", "provider"]);
    expect(body.cookies.map((cookie) => [cookie.name, cookie.value, cookie.domain])).toEqual([
      ["sessionKey", SECRET.a, "claude.ai"], ["lastActiveOrg", "org-a", "claude.ai"],
    ]);
    expect(init.body).not.toContain(SECRET.noise);

    // One send per pairing, on both ends.
    expect(await capture.send()).toMatchObject({ ok: false, code: "already_used" });
    expect((await deliver(url, init)).status).toBe(401);
    expect(capture.post).toHaveBeenCalledOnce();
    expectNoSecret(JSON.stringify([capture.result, describePlan(capture.plan)]));
    expect(capture.plan.token).toBe("");

    const [a, ...rest] = await stored();
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ provider: "claude-web", authType: "cookie", name: "Claude A", apiKey: `sessionKey=${SECRET.a}; lastActiveOrg=org-a` });
    expectNoSecret(await rawDatabase());

    const listed = await (await routes.providers.GET(jsonRequest("/api/providers", null, "GET"))).json();
    const single = await (await routes.provider.GET(jsonRequest(`/api/providers/${a.id}`, null, "GET"), idParams(a.id))).json();
    expect(listed.connections.map((connection) => connection.id)).toContain(a.id);
    expect(single.connection).not.toHaveProperty("apiKey");
    expectNoSecret(JSON.stringify([listed, single]));

    // A second account with its own proxy, ranked below the captured one.
    const b = await addManual("Claude B", `sessionKey=${SECRET.b}`, 50);
    await setProxy(a.id, PROXY_A);
    await setProxy(b.id, PROXY_B);
    fakeClaude(new Map([[SECRET.a, [chatOrg("org-a")]], [SECRET.b, [chatOrg("org-b")]]]));

    const found = await (await routes.discovery.GET(jsonRequest(`/api/providers/${a.id}/models`, null, "GET"), idParams(a.id))).json();
    expect(found.models.map((model) => model.id)).toContain("claude-sonnet-4-6");
    expect(sent).toEqual([]); // the catalog is local: discovery never sends the session

    const answer = await chat();
    expect(answer.status).toBe(200);
    const answerBody = await answer.json();
    expect(answerBody.choices[0].message.content).toBe("answer from org-a");
    const streamed = await (await chat({ stream: true })).text();
    expect(streamed).toContain('"content":"answer from org-a"');
    expect(streamed).toContain("[DONE]");

    expect(sent.map((call) => [call.method, call.egress, call.cookie])).toEqual(
      ["GET", "POST", "GET", "POST"].map((method) => [method, "proxy-a", `sessionKey=${SECRET.a}; lastActiveOrg=org-a`]),
    );
    expect(sent[0]).toMatchObject({ url: ORGS_URL, redirect: "manual", body: null });
    const [first] = completions();
    expect(first.redirect).toBe("error");
    expect(first.headers.get("origin")).toBe(ORIGIN);
    expect(first.headers.get("referer")).toBe(`${ORIGIN}/new`);
    expect(first.headers.get("anthropic-client-platform")).toBe("web_claude_ai");
    expect(first.headers.get("authorization")).toBeNull();
    expect(first.body).toMatchObject({
      prompt: "synthetic prompt", model: "claude-sonnet-4-6", create_conversation_params: { model: "claude-sonnet-4-6" },
    });
    expect(outbound).not.toHaveBeenCalled();
    // Usage and request-detail rows land after the response; wait so the disk scan covers them.
    const raw = await vi.waitFor(async () => {
      await disposeLoadedRequestDetailsRepo();
      const disk = await rawDatabase();
      const rows = new Map(JSON.parse(disk));
      for (const table of ["providerConnections", "usageHistory", "requestDetails"]) expect(rows.get(table), table).toHaveLength(2);
      return disk;
    }, { timeout: 15_000 });
    expect(raw).toContain("Claude A");
    expect(logged()).toContain("claude-web");
    expectNoSecret(JSON.stringify([found, answerBody]) + streamed + logged() + raw);
  });

  it("replaces only the paired connection, keeping its proxy, after the old session expires onto the sibling", async () => {
    const a = await addManual("Claude A", `sessionKey=${SECRET.a}`, 1);
    const b = await addManual("Claude B", `sessionKey=${SECRET.b}`, 50);
    await setProxy(a.id, PROXY_A);
    await setProxy(b.id, PROXY_B);
    const live = new Map([[SECRET.b, [chatOrg("org-b")]]]);
    fakeClaude(live);

    // A is expired upstream: the request fails over, and each cookie stays on its own proxy.
    const fallback = await chat();
    expect(fallback.status).toBe(200);
    expect((await fallback.json()).choices[0].message.content).toBe("answer from org-b");
    expect(sent.map((call) => [call.method, call.egress, sessionOf(call.cookie)])).toEqual([
      ["GET", "proxy-a", SECRET.a], ["GET", "proxy-b", SECRET.b], ["POST", "proxy-b", SECRET.b],
    ]);
    const lockedA = await db.getProviderConnectionById(a.id);
    expect(Object.entries(lockedA).some(([key, value]) => key.startsWith("modelLock_") && value)).toBe(true);
    expectNoSecret(String(lockedA.lastError ?? ""));
    const siblingBefore = await db.getProviderConnectionById(b.id);

    const pairing = await mint({ action: "update", connectionId: a.id });
    const capture = await extensionCapture(pairing, { jar: [browserCookie("sessionKey", SECRET.a2)] });
    expect(capture.result).toMatchObject({ ok: true, action: "update", connection: { id: a.id, name: "Claude A" } });
    expectNoSecret(JSON.stringify(capture.result));

    const renewed = await db.getProviderConnectionById(a.id);
    expect(renewed).toMatchObject({ apiKey: `sessionKey=${SECRET.a2}`, testStatus: "active", priority: lockedA.priority });
    expect(renewed.providerSpecificData).toMatchObject({ connectionProxyEnabled: true, connectionProxyUrl: PROXY_A });
    expect(await db.getProviderConnectionById(b.id)).toEqual(siblingBefore);
    expect(await stored()).toHaveLength(2);

    live.set(SECRET.a2, [chatOrg("org-a")]);
    sent = [];
    const recovered = await chat();
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).choices[0].message.content).toBe("answer from org-a");
    expect(sent.map((call) => [call.egress, sessionOf(call.cookie)])).toEqual([["proxy-a", SECRET.a2], ["proxy-a", SECRET.a2]]);
    expectNoSecret(logged());
  });

  it("answers a dead stored session with a 401 that carries no cookie", async () => {
    const a = await addManual("Claude A", `sessionKey=${SECRET.a}`, 1);
    await setProxy(a.id, PROXY_A);
    fakeClaude(new Map());

    const res = await chat();
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(completions()).toEqual([]);
    expect(sent.map((call) => call.egress)).toEqual(["proxy-a"]);
    expectNoSecret(text + logged() + await rawDatabase());
  });
});

describe("claude-web: authenticated and bounded import", () => {
  it("needs operator authority to pair and a pairing secret to import", async () => {
    authority.operator = false;
    expect((await routes.pairing.POST(pairingRequest({ provider: "claude-web", action: "create", name: "Denied" }))).status).toBe(403);
    authority.operator = true;
    const res = await postImport(null, { provider: "claude-web", origin: ORIGIN, cookies: [{ name: "sessionKey", value: SECRET.a }] });
    expect(res.status).toBe(401);
    expectNoSecret(await res.text());
    expect(await stored()).toEqual([]);
  });

  it("refuses to retarget an update to another account or another provider's row", async () => {
    const a = await addManual("Claude A", `sessionKey=${SECRET.a}`, 1);
    const b = await addManual("Claude B", `sessionKey=${SECRET.b}`, 2);
    const before = await stored();

    const pairing = await mint({ action: "update", connectionId: a.id });
    const forged = { provider: "claude-web", origin: ORIGIN, connectionId: b.id, cookies: [{ name: "sessionKey", value: SECRET.a2 }] };
    const swapped = await postImport(pairing.token, forged);
    expect(swapped.status).toBe(409);
    expectNoSecret(await swapped.text());
    // The mismatch spent the pairing: the honest retry needs a new one.
    expect((await postImport(pairing.token, { ...forged, connectionId: a.id })).status).toBe(401);

    const foreign = await db.createProviderConnection({
      provider: "grok-web", authType: "cookie", name: "Grok", apiKey: "sso=synthetic-grok", isActive: true,
    }, { createOnly: true });
    const crossProvider = await routes.pairing.POST(pairingRequest({ provider: "claude-web", action: "update", connectionId: foreign.id }));
    expect(crossProvider.status).toBe(409);
    expect(await stored()).toEqual(before);
    expect((await db.getProviderConnectionById(foreign.id)).apiKey).toBe("sso=synthetic-grok");
  });

  it("does not overwrite a saved account through a same-name create import", async () => {
    await addManual("Claude A", `sessionKey=${SECRET.a}`, 1);
    const pairing = await mint({ action: "create", name: "Claude A" });
    const capture = await extensionCapture(pairing, { jar: [browserCookie("sessionKey", SECRET.a2)] });
    expect(capture.result).toMatchObject({ ok: false, code: "conflict" });
    expect((await stored()).map((row) => row.apiKey)).toEqual([`sessionKey=${SECRET.a}`]);
    expectNoSecret(JSON.stringify(capture.result) + logged());
  });

  it.each([
    "https://claude.ai.evil.example/new", "https://www.claude.ai/new", "https://console.anthropic.com/",
    "http://claude.ai/new", "https://claude.ai:8443/new",
  ])("reads no cookie and sends nothing when the tab is %s", async (tabUrl) => {
    const pairing = await mint({ action: "create", name: "Wrong tab" });
    const capture = await extensionCapture(pairing, { tabUrl, jar: [browserCookie("sessionKey", SECRET.a)] });
    expect(capture.result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
    expect(capture.calls).toEqual({ gets: [], requested: [], removed: [] });
    expect(capture.post).not.toHaveBeenCalled();
  });

  it("rejects an edited pairing origin and never widens the cookie allowlist", async () => {
    const pairing = await mint({ action: "create", name: "Edited" });
    const moved = await extensionCapture({ ...pairing, contract: { ...pairing.contract, origin: "https://evil.example" } });
    expect(moved.result).toMatchObject({ ok: false, code: "origin_mismatch" });

    const widened = await extensionCapture({ ...pairing, contract: {
      ...pairing.contract, cookieNames: ["sessionKey", "cf_clearance"], cookiePrefixes: ["sessionKey."],
      optionalCookies: ["lastActiveOrg"], localStorageKeys: ["synthetic-item"],
    } }, { jar: [browserCookie("sessionKey", SECRET.a), browserCookie("cf_clearance", SECRET.noise)] });
    expect(widened.result).toMatchObject({ ok: true });
    // Only the compiled names: the required sessionKey and the built-in optional lastActiveOrg.
    expect(widened.calls.gets.map((call) => call.name)).toEqual(["sessionKey", "lastActiveOrg"]);
    expect(widened.calls.requested[0].permissions).toEqual(["cookies"]);

    // A pairing without the optional name (an older dashboard) narrows it away.
    const narrowed = await extensionCapture({ ...(await mint({ action: "create", name: "Narrowed" })), contract: {
      origin: ORIGIN, cookieNames: ["sessionKey"], cookiePrefixes: [],
    } }, { jar: [browserCookie("sessionKey", SECRET.b), browserCookie("lastActiveOrg", "org-b")] });
    expect(narrowed.result).toMatchObject({ ok: true, cookieCount: 1 });
    expect(narrowed.calls.gets.map((call) => call.name)).toEqual(["sessionKey"]);
  });

  it("stores nothing when the tab has no session cookie, only the organization cookie", async () => {
    // capture.js (not changed here) sends an optional cookie even without the required one. The
    // server refuses that body with fixed text, stores nothing and spends the pairing.
    const pairing = await mint({ action: "create", name: "Empty" });
    const capture = await extensionCapture(pairing, { jar: [browserCookie("lastActiveOrg", "org-a")] });
    expect(capture.result).toEqual({ ok: false, code: "rejected", message: MESSAGES.rejected });
    expect(capture.post).toHaveBeenCalledOnce();
    const [url, init] = capture.post.mock.calls[0];
    expect(url).toBe(IMPORT_URL);
    expect(JSON.parse(init.body).cookies.map((cookie) => cookie.name)).toEqual(["lastActiveOrg"]);
    const reply = await capture.post.mock.results[0].value;
    expect(reply.status).toBe(400);
    expect(await reply.json()).toEqual({ error: "Required session cookie is missing or incomplete" });
    expect((await deliver(url, init)).status).toBe(401);
    expect(capture.calls.removed).toEqual(capture.calls.requested);
    expect(await stored()).toEqual([]);
  });

  it.each([
    ["an empty value", [browserCookie("sessionKey", "")]],
    ["an insecure cookie", [browserCookie("sessionKey", SECRET.a, { secure: false })]],
    ["only another profile's session", [browserCookie("sessionKey", SECRET.otherStore, { storeId: "other-store" })]],
    ["only a chunked name", [browserCookie("sessionKey.0", SECRET.a)]],
  ])("sends nothing when the tab has %s", async (_label, jar) => {
    const capture = await extensionCapture(await mint({ action: "create", name: "Empty" }), { jar });
    expect(capture.result).toEqual({ ok: false, code: "no_cookies", message: MESSAGES.no_cookies });
    expect(capture.post).not.toHaveBeenCalled();
    expect(capture.calls.removed).toEqual(capture.calls.requested);
    expect(await stored()).toEqual([]);
  });

  it("has the server refuse an expired captured cookie without saving or echoing it", async () => {
    const capture = await extensionCapture(await mint({ action: "create", name: "Expired" }), { jar: [
      browserCookie("sessionKey", SECRET.a, { expirationDate: Math.floor(Date.now() / 1000) - 60 }),
    ] });
    expect(capture.result).toEqual({ ok: false, code: "rejected", message: MESSAGES.rejected });
    const reply = await capture.post.mock.results[0].value;
    expect(reply.status).toBe(400);
    expect(await stored()).toEqual([]);
    expectNoSecret(logged() + await rawDatabase());
  });

  const good = { name: "sessionKey", value: SECRET.a };
  it.each([
    ["a trailing-slash origin", { origin: `${ORIGIN}/` }, "Origin is not approved for this provider"],
    ["a sibling origin", { origin: "https://www.claude.ai" }, "Origin is not approved for this provider"],
    ["a foreign cookie domain", { cookies: [{ ...good, domain: "claude.ai.evil.example" }] }, "Cookie domain does not match the provider origin"],
    ["a child cookie domain", { cookies: [{ ...good, domain: "console.claude.ai" }] }, "Cookie domain does not match the provider origin"],
    ["an insecure cookie", { cookies: [{ ...good, secure: false }] }, "Cookie must be a secure cookie"],
    ["a chunked name", { cookies: [{ ...good, name: "sessionKey.0" }] }, "Cookie name is not approved for this provider"],
    ["an extra browser cookie", { cookies: [good, { name: "cf_clearance", value: SECRET.noise }] }, "Cookie name is not approved for this provider"],
    ["an organization cookie without a session", { cookies: [{ name: "lastActiveOrg", value: "org-a" }] }, "Required session cookie is missing or incomplete"],
    ["an insecure organization cookie", { cookies: [good, { name: "lastActiveOrg", value: "org-a", secure: false }] }, "Cookie must be a secure cookie"],
    ["a header-injecting organization cookie", { cookies: [good, { name: "lastActiveOrg", value: "org-a; admin=1" }] }, "Cookie value is not acceptable"],
    ["a duplicate session", { cookies: [good, { ...good, value: SECRET.b }] }, "Duplicate cookie name"],
    ["a header-injecting value", { cookies: [{ ...good, value: `${SECRET.a}; admin=1` }] }, "Cookie value is not acceptable"],
    ["a localStorage item", { localStorage: { sessionKey: SECRET.a } }, "This provider takes no localStorage value"],
  ])("refuses %s with fixed text", async (_label, override, error) => {
    const pairing = await mint({ action: "create", name: "Refused" });
    const res = await postImport(pairing.token, { provider: "claude-web", origin: ORIGIN, cookies: [good], ...override });
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error });
    expect(await stored()).toEqual([]);
    expectNoSecret(logged());
  });

  // Was the "the organization cookie" refusal row (gap 1): the repaired profile stores it.
  it("accepts the organization cookie beside the session and stores both", async () => {
    const pairing = await mint({ action: "create", name: "Accepted" });
    const res = await postImport(pairing.token, { provider: "claude-web", origin: ORIGIN, cookies: [good, { name: "lastActiveOrg", value: "org-a" }] });
    expect(res.status).toBe(201);
    expectNoSecret(await res.text());
    expect((await stored()).map((row) => row.apiKey)).toEqual([`sessionKey=${SECRET.a}; lastActiveOrg=org-a`]);
    expectNoSecret(logged());
  });
});

describe("claude-web: dashboard header, cURL and HAR input", () => {
  async function contract() {
    return (await import("@/lib/providers/cookieImport/contract")).getCookieImportContract("claude-web");
  }

  async function importCandidate(candidate, name) {
    const pairing = await mint({ action: "create", name });
    const res = await postImport(pairing.token, dialogBody(candidate, { name }));
    expect(res.status).toBe(201);
    expectNoSecret(await res.text());
    return (await stored()).find((row) => row.name === name);
  }

  it("keeps only sessionKey and lastActiveOrg, padding included, from a header and both cURL cookie forms", async () => {
    const header = `Cookie: cf_clearance=${SECRET.noise}; sessionKey=${SECRET.a}; lastActiveOrg=org-a`;
    const inputs = [
      ["header", parseCookieHeaderValue(header)],
      ["curl", parseCurlCommand(`curl '${ORGS_URL}' -H '${header}' -H 'accept: */*'`)],
      ["curl", parseCurlCommand(`curl '${ORGS_URL}' \\\n  -b '${header.slice("Cookie: ".length)}'`)],
    ];
    for (const [index, [kind, parsed]] of inputs.entries()) {
      const built = buildImportCandidates({ kind, parsed }, await contract());
      expect(built.candidates).toHaveLength(1);
      expect(built.candidates[0]).toMatchObject({ origin: ORIGIN, cookies: [{ name: "sessionKey", value: SECRET.a }, { name: "lastActiveOrg", value: "org-a" }] });
      expect(built.candidates[0].cookies).toHaveLength(2);
      expect(built.candidates[0].dropped).toEqual(["cf_clearance"]);
      const row = await importCandidate(built.candidates[0], `Input ${index}`);
      expect(row.apiKey).toBe(`sessionKey=${SECRET.a}; lastActiveOrg=org-a`);
    }
    expect(outbound).not.toHaveBeenCalled();
    expectNoSecret(logged() + await rawDatabase());
  });

  it("makes the operator choose between two HAR accounts and imports only the chosen one", async () => {
    const parsed = parseHarDocument(harDocument(
      { url: ORGS_URL, cookies: [{ name: "sessionKey", value: SECRET.a }] },
      { url: "https://claude.ai.evil.example/api/organizations", cookies: [{ name: "sessionKey", value: SECRET.otherStore }] },
      { url: ORGS_URL, cookies: [{ name: "sessionKey", value: SECRET.b }] },
    ));
    const built = buildImportCandidates({ kind: "har", parsed }, await contract());
    expect(built.candidates.map((candidate) => candidate.cookies[0].value)).toEqual([SECRET.a, SECRET.b]);
    expect(candidatesAreAmbiguous(built.candidates)).toBe(true);

    const row = await importCandidate(built.candidates[1], "Chosen");
    expect(row.apiKey).toBe(`sessionKey=${SECRET.b}`);
    expect(await stored()).toHaveLength(1);
    fakeClaude(new Map([[SECRET.b, [chatOrg("org-b")]]]));
    expect((await chat()).status).toBe(200);
    expect(sent.map((call) => call.cookie)).toEqual([`sessionKey=${SECRET.b}`, `sessionKey=${SECRET.b}`]);
  });

  it.each([
    ["a bare sessionKey value", "header", () => SECRET.b, "No cookie name=value pair was found in the input."],
    ["a padded bare value", "header", () => SECRET.a, "The input has no sessionKey cookie."],
    ["chunked names", "header", () => `sessionKey.0=${SECRET.a}; sessionKey.1=${SECRET.b}`, "The input has no sessionKey cookie."],
    ["a browser-extension JSON cookie list", "header", () => JSON.stringify([{ name: "sessionKey", value: SECRET.a }]), "No cookie name=value pair was found in the input."],
    ["cURL for another origin", "curl", () => `curl 'https://api.anthropic.com/v1/messages' -H 'Cookie: sessionKey=${SECRET.a}'`, "The request origin is not approved for this provider."],
    ["a cURL cookie-jar file", "curl", () => `curl '${ORGS_URL}' -b cookies.txt`, "The cURL command has no Cookie header."],
    ["a HAR with no claude.ai request", "har", () => harDocument({ url: "https://www.claude.ai/", cookies: [{ name: "sessionKey", value: SECRET.a }] }), `The HAR file has no request to ${ORIGIN}.`],
  ])("refuses %s without echoing it", async (_label, kind, input, error) => {
    const parse = { header: parseCookieHeaderValue, curl: parseCurlCommand, har: parseHarDocument }[kind];
    const parsed = parse(input());
    const result = parsed.ok ? buildImportCandidates({ kind, parsed }, await contract()) : parsed;
    expect(result).toEqual({ ok: false, error });
  });
});

describe("claude-web: stored session checks", () => {
  it("validates and tests a direct connection with one organization GET and no conversation", async () => {
    const a = await addManual("Claude A", `sessionKey=${SECRET.a}`, 1);
    fakeClaude(new Map([[SECRET.a, [chatOrg("org-a")]]]));

    const validated = await (await routes.validate.POST(jsonRequest("/api/providers/validate", { provider: "claude-web", apiKey: `sessionKey=${SECRET.a}` }))).json();
    expect(validated).toMatchObject({ valid: true });
    const tested = await (await routes.test.POST(jsonRequest(`/api/providers/${a.id}/test`, {}), idParams(a.id))).json();
    expect(tested).toMatchObject({ valid: true });
    expect(sent.map((call) => [call.method, call.url, call.cookie])).toEqual(
      Array(2).fill(["GET", ORGS_URL, `sessionKey=${SECRET.a}`]),
    );
    expectNoSecret(JSON.stringify([validated, tested]) + logged());
  });

  it("reports a proxied connection's Test as unverified, sends the cookie nowhere and leaves the row unchanged", async () => {
    const a = await addManual("Claude A", `sessionKey=${SECRET.a}`, 1);
    await setProxy(a.id, PROXY_A);
    fakeClaude(new Map([[SECRET.a, [chatOrg("org-a")]]]));
    const before = await db.getProviderConnectionById(a.id);

    const tested = await (await routes.test.POST(jsonRequest(`/api/providers/${a.id}/test`, {}), idParams(a.id))).json();
    // The guard's proxy refusal stays: nothing is sent, directly or through the proxy.
    expect(tested).toMatchObject({ valid: false, skipped: true, unavailable: false });
    expect(tested.error).toMatch(/^Not verified/);
    expect(sent).toEqual([]);
    expect(outbound).not.toHaveBeenCalled();
    // The session was never checked, so neither success nor a credential error is recorded.
    const row = await db.getProviderConnectionById(a.id);
    expect(row).toEqual(before);
    expect(row.testStatus).not.toBe("error");
    expect(row.testStatus).not.toBe("active");

    // Chat with the same row still uses the saved session and its proxy.
    expect((await chat()).status).toBe(200);
    expect(sent.map((call) => [call.egress, sessionOf(call.cookie)])).toEqual([["proxy-a", SECRET.a], ["proxy-a", SECRET.a]]);
    expectNoSecret(JSON.stringify(tested) + logged());
  });
});

describe("claude-web: known gaps (NOT PARITY)", () => {
  const twoOrganizations = [chatOrg("org-first"), chatOrg("org-last-active")];
  const fullHeader = `sessionKey=${SECRET.a}; lastActiveOrg=org-last-active`;

  // Gap 1, repaired: this case used to show the import dropping lastActiveOrg.
  it("import keeps lastActiveOrg, so an imported account makes the same organization choice as manual input", async () => {
    const { getCookieImportContract } = await import("@/lib/providers/cookieImport/contract");
    fakeClaude(new Map([[SECRET.a, twoOrganizations]]));

    // Control: the same session pasted into the manual Add dialog keeps the cookie the executor reads.
    const manual = await addManual("Manual", fullHeader, 1);
    expect((await chat()).status).toBe(200);
    expect(completionOrg(completions().at(-1))).toBe("org-last-active");
    await db.updateProviderConnection(manual.id, { isActive: false });

    // Import of that same header keeps the organization cookie, so the executor picks the same organization.
    const built = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(fullHeader) }, getCookieImportContract("claude-web"));
    expect(built.candidates[0].dropped).toEqual([]);
    const pairing = await mint({ action: "create", name: "Imported" });
    expect((await postImport(pairing.token, dialogBody(built.candidates[0], { name: "Imported" }))).status).toBe(201);
    expect((await stored()).find((row) => row.name === "Imported").apiKey).toBe(fullHeader);
    expect((await chat()).status).toBe(200);
    expect(completionOrg(completions().at(-1))).toBe("org-last-active");
  });

  it("NOT PARITY: HAR parsing drops cookie expiry, so the server cannot apply its expiry refusal", async () => {
    const parsed = parseHarDocument(harDocument({ url: ORGS_URL, cookies: [
      { name: "sessionKey", value: SECRET.a, expires: "2000-01-01T00:00:00.000Z", secure: true },
    ] }));
    expect(parsed.entries[0].cookies).toEqual([{ name: "sessionKey", value: SECRET.a }]);

    // The server's rule works on the extension's field, which the HAR path never produces.
    const { buildImportedCookieHeader, getCookieImportContract } = await import("@/lib/providers/cookieImport/contract");
    expect(buildImportedCookieHeader(getCookieImportContract("claude-web"), [
      { name: "sessionKey", value: SECRET.a, expirationDate: Date.parse("2000-01-01T00:00:00.000Z") / 1000 },
    ])).toEqual({ ok: false, error: "Cookie is expired" });
  });
});
