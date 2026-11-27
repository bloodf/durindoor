/**
 * #2034: ChatGPT Web, one chain from capture or import to the outbound request.
 * Evidence and limits: internal/docs/port-reports/cookie-flows/chatgpt-web-2034.md.
 *
 * Real: the registry descriptor, the extension's capture module, the dashboard
 * parser, the pairing and import routes, an isolated SQLite database, the
 * connection routes, handleChat, account and proxy selection and both
 * chatgpt-web transports.
 * Mocked: the management guard's verdict, `chrome.*`, the extension's network hop
 * (handed to the real import route), the chatgpt.com TLS socket, the browser
 * session, global fetch (throws) and the machine id. Every credential is
 * synthetic. Nothing here proves a live sign-in or that chatgpt.com accepts a
 * request.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareCapture, runCapture, describePlan, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const guard = vi.hoisted(() => ({
  canAccessManagementApi: vi.fn(),
  isOperatorRequest: vi.fn(),
  hasExactRequestOrigin: vi.fn(),
  canManageAccessConfig: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => guard);
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const PROVIDER = "chatgpt-web";
const ORIGIN = "https://chatgpt.com";
const SESSION = "__Secure-next-auth.session-token";
const SESSION_URL = `${ORIGIN}/api/auth/session`;
const CONVERSATION_URL = `${ORIGIN}/backend-api/f/conversation`;
const DASHBOARD = "https://dashboard.example";
const MODEL = "cgpt-web/gpt-5-6";
const PROXY = "http://proxy-b.invalid:8080";
// Approved for nothing: other cookies a signed-in chatgpt.com tab also holds.
const UNRELATED = {
  cf_clearance: "synthetic-unrelated-clearance",
  "oai-did": "synthetic-unrelated-device",
  "__Host-next-auth.csrf-token": "synthetic-unrelated-csrf",
};

/** Synthetic two-chunk NextAuth session for one account. */
const account = (tag) => {
  const values = [`synthetic-${tag}-chunk-zero`, `synthetic-${tag}-chunk-one==`];
  return {
    tag,
    values,
    chunks: values.map((value, index) => ({ name: `${SESSION}.${index}`, value })),
    header: `${SESSION}.0=${values[0]}; ${SESSION}.1=${values[1]}`,
    accessToken: `synthetic-access-token-${tag}`,
  };
};

let root;
let db;
let registry;
let routes;
let parser;
let importContract;
let handleChat;
let executor;
let originalDeps;
let setTlsOverride;
let upstream;
let knownSessions;
let logs;
let outboundFetch;
let usageWrites;

const operatorRequest = (url, body, method = "POST") =>
  new NextRequest(`${DASHBOARD}${url}`, {
    method,
    headers: { "content-type": "application/json", "x-9r-cli-token": "synthetic-operator", origin: DASHBOARD },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });

async function requestPairing(body) {
  const response = await routes.pairing.POST(operatorRequest("/api/providers/cookie-import/pairing", { provider: PROVIDER, ...body }));
  return { response, body: await response.json() };
}

async function mint(body) {
  const result = await requestPairing(body);
  expect(result.response.status, JSON.stringify(result.body)).toBe(201);
  return result.body.pairing;
}

/** The request a client without a dashboard session sends: pairing secret only. */
const submit = (pairing, body) =>
  routes.import.POST(new NextRequest(pairing.importUrl, {
    method: "POST",
    headers: { "content-type": "application/json", [pairing.header]: pairing.token },
    body: JSON.stringify({ provider: PROVIDER, origin: ORIGIN, ...body }),
  }));

const importBody = (session, extra = {}) => ({ cookies: session.chunks, ...extra });

async function createByImport(name, session) {
  const response = await submit(await mint({ action: "create", name }), importBody(session));
  expect(response.status).toBe(201);
  return (await response.json()).connection.id;
}

async function updateConnection(id, body) {
  const response = await routes.provider.PUT(operatorRequest(`/api/providers/${id}`, body, "PUT"), params(id));
  expect(response.status).toBe(200);
  return response.text();
}

const stored = (id) => db.getProviderConnectionById(id);
const rowCount = async () => (await db.getProviderConnections()).length;

/** Every public read of the saved connections, as one string. */
async function publicReads(ids) {
  const list = await (await routes.providers.GET(operatorRequest("/api/providers", null, "GET"))).text();
  // The reads must really return these rows, or a redaction check proves nothing.
  for (const id of ids) expect(list).toContain(id);
  const texts = [list];
  for (const id of ids) {
    const response = await routes.provider.GET(operatorRequest(`/api/providers/${id}`, null, "GET"), params(id));
    expect(response.status).toBe(200);
    texts.push(await response.text());
  }
  return texts.join("\n");
}

function expectNoSecret(text, ...sessions) {
  for (const session of sessions) {
    for (const secret of [...session.values, session.accessToken]) expect(text).not.toContain(secret);
  }
}

const logged = () => logs.flatMap((spy) => spy.mock.calls).map((args) => args.map((arg) => {
  if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
  return typeof arg === "string" ? arg : JSON.stringify(arg);
}).join(" ")).join("\n");

/**
 * A signed-in browser profile: `stores` maps a cookie-store id to its jar. The
 * active tab belongs to `tab-store`. Enumeration and page scripting throw, so a
 * capture that tried either would fail.
 */
function browserProfile({ tabUrl = `${ORIGIN}/c/synthetic-thread`, stores }) {
  const calls = { get: [], requested: [], removed: [] };
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  const forbidden = (api) => async () => { throw new Error(`${api} must not be used for chatgpt-web`); };
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: tabUrl }], get: async (id) => ({ id, url: tabUrl }) },
    permissions: {
      contains: async (query) => names(query).every((name) => held.has(name)),
      request: async (query) => { calls.requested.push(structuredClone(query)); names(query).forEach((name) => held.add(name)); return true; },
      remove: async (query) => { calls.removed.push(structuredClone(query)); names(query).forEach((name) => held.delete(name)); return true; },
    },
    cookies: {
      getAll: forbidden("cookies.getAll"),
      getAllCookieStores: async () => Object.keys(stores).map((id) => ({ id, tabIds: id === "tab-store" ? [7] : [99] })),
      get: async ({ url, name, storeId }) => {
        calls.get.push({ url, name, storeId });
        return stores[storeId]?.find((cookie) => cookie.name === name) ?? null;
      },
    },
    scripting: { executeScript: forbidden("scripting.executeScript") },
  };
  return { chrome, calls };
}

const browserCookie = ({ name, value }, extra = {}) => ({
  name, value, domain: ".chatgpt.com", path: "/", secure: true, httpOnly: true, sameSite: "lax",
  expirationDate: Math.floor(Date.now() / 1000) + 3600, ...extra,
});

/** A jar as chatgpt.com leaves it: two chunks, a stale unchunked copy and unrelated cookies. */
const signedInJar = (session, chunkExtra = []) => [
  ...session.chunks.map((chunk, index) => browserCookie(chunk, chunkExtra[index])),
  browserCookie({ name: SESSION, value: `synthetic-${session.tag}-stale-unchunked` }),
  ...Object.entries(UNRELATED).map(([name, value]) => browserCookie({ name, value })),
];

/** Review then confirmed Send, with the extension's POST delivered to the real import route. */
async function runExtension(profile, pairing) {
  const sent = [];
  const prepared = await prepareCapture({ chrome: profile.chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { result: prepared, sent };
  const view = describePlan(prepared.plan);
  const result = await runCapture({
    chrome: profile.chrome,
    plan: prepared.plan,
    confirmed: confirmationFor(prepared.plan),
    fetch: async (url, init) => {
      const request = new NextRequest(url, {
        method: init.method,
        headers: { ...init.headers, origin: "chrome-extension://synthetic-extension-id" },
        body: init.body,
      });
      const response = await routes.import.POST(request);
      sent.push({ url, init, status: response.status, responseText: await response.clone().text() });
      return response;
    },
  });
  return { result, sent, view };
}

const sseReply = (text) => {
  const event = (status) => `data: ${JSON.stringify({
    conversation_id: "synthetic-private-conversation",
    message: { id: "synthetic-message", author: { role: "assistant" }, content: { content_type: "text", parts: [text] }, status },
  })}\r\n\r\n`;
  return `${event("in_progress")}${event("finished_successfully")}data: [DONE]\r\n\r\n`;
};

/** chatgpt.com at the TLS socket. Only a cookie header in `knownSessions` is signed in. */
async function chatgptSocket(url, options) {
  const headers = options.headers ?? {};
  upstream.push({
    url: String(url), method: options.method ?? "GET", cookie: headers.Cookie,
    authorization: headers.Authorization, proxyUrl: options.proxyUrl,
  });
  const reply = (text, type = "application/json") => ({ status: 200, headers: new Headers({ "Content-Type": type }), text, body: null });
  if (String(url) === SESSION_URL) {
    const live = knownSessions.get(headers.Cookie);
    return reply(JSON.stringify(live ? { accessToken: live.accessToken, user: { id: `user-${live.tag}` } } : {}));
  }
  if (String(url) === `${ORIGIN}/`) return reply('<html data-build="prod-synthetic"></html>', "text/html");
  if (String(url).includes("/sentinel/chat-requirements")) return reply(JSON.stringify({ token: "synthetic-requirements", proofofwork: { required: false } }));
  if (String(url) === CONVERSATION_URL) return reply(sseReply("mock answer"), "text/event-stream");
  if (/\/backend-api\/(me|conversations|models)(\?|$)/.test(String(url))) return reply("{}");
  throw new Error("unmocked chatgpt.com request");
}

const chat = (extra = {}) => handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "hello" }], ...extra }),
}));

/** One HTTP-transport turn, with every request of it bound to one account and one egress. */
async function expectTurnAs(session, proxyUrl) {
  upstream = [];
  const response = await chat();
  const text = await response.text();
  expect(response.status, text).toBe(200);
  expect(JSON.parse(text).choices[0].message.content).toBe("mock answer");
  expectNoSecret(text, session);
  expect(upstream[0]).toMatchObject({ url: SESSION_URL, method: "GET" });
  expect(upstream.at(-1)).toMatchObject({ url: CONVERSATION_URL, method: "POST" });
  for (const call of upstream) {
    expect(new URL(call.url).origin).toBe(ORIGIN);
    expect(call.cookie, call.url).toBe(session.header);
    expect(call.proxyUrl, call.url).toBe(proxyUrl);
    if (call.url.includes("/backend-api/")) expect(call.authorization, call.url).toBe(`Bearer ${session.accessToken}`);
  }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-flow-chatgpt-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  for (const verdict of Object.values(guard)) verdict.mockReset().mockReturnValue(true);
  upstream = [];
  knownSessions = new Map();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  outboundFetch = vi.fn(async () => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outboundFetch);
  db = await import("@/lib/db/index.js");
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
  };
  registry = (await import("../../open-sse/providers/registry/index.js")).default;
  importContract = (await import("../../src/lib/providers/cookieImport/contract.js")).getCookieImportContract;
  parser = await import("../../src/shared/utils/cookieImportParser.js");
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  executor = (await import("../../open-sse/executors/index.js")).getExecutor(PROVIDER);
  originalDeps = executor.deps;
  ({ __setTlsFetchOverrideForTesting: setTlsOverride } = await import("../../open-sse/services/chatgptTlsClient.js"));
  usageWrites = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  setTlsOverride(chatgptSocket);
}, 60_000);

afterEach(async () => {
  setTlsOverride(null);
  executor.deps = originalDeps;
  // The chat response schedules usage persistence without awaiting it.
  await Promise.allSettled(usageWrites.mock.results.map((result) => result.value));
  await disposeLoadedRequestDetailsRepo();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("ChatGPT Web capture through the real pairing and import (#2034)", () => {
  it("issues a pairing from the shipped registry entry and needs the operator verdict", async () => {
    const entry = registry.find((candidate) => candidate.id === PROVIDER);
    const contract = importContract(PROVIDER);
    // The active provider's own web sign-in block is the import profile: no override, no synthetic descriptor.
    expect(contract.config).toBe(entry.webLogin);
    expect(entry.cookieImport).toBeUndefined();
    expect(executor.constructor.name).toBe("ChatGptWebExecutor");

    const pairing = await mint({ action: "create", name: "Imported" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [SESSION], cookiePrefixes: [`${SESSION}.`] });
    // No localStorage item and no account email belong to this provider.
    const withEmail = await requestPairing({ action: "create", name: "Email", accountEmail: "synthetic@example.invalid" });
    expect(withEmail.response.status).toBe(400);
    expect(withEmail.body).toEqual({ error: "This provider takes no account email" });

    for (const verdict of ["canAccessManagementApi", "isOperatorRequest"]) {
      guard[verdict].mockReturnValueOnce(false);
      const refused = await requestPairing({ action: "create", name: "Refused" });
      expect(refused.response.status, verdict).toBe(403);
      expect(refused.body).toEqual({ error: "Operator access required" });
    }
  });

  it("captures the tab's own account with bounded reads and sends it, via its proxy, on the HTTP transport", async () => {
    const other = account("A");
    const mine = account("B");
    const bystander = account("incognito");
    knownSessions.set(other.header, other).set(mine.header, mine);
    const otherId = await createByImport("Account A", other);

    const profile = browserProfile({ stores: { "other-store": signedInJar(bystander), "tab-store": signedInJar(mine) } });
    const pairing = await mint({ action: "create", name: "Account B" });
    const { result, sent, view } = await runExtension(profile, pairing);

    expect(view).toMatchObject({ providerOrigin: ORIGIN, dashboardOrigin: DASHBOARD, cookieNames: [SESSION, `${SESSION}.<n>`], optionalCookies: [], localStorageKeys: [] });
    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 3, connection: { name: "Account B" } });
    // Bounded: the base name, then chunks up to the first gap, all in the tab's store.
    expect(profile.calls.get).toEqual([SESSION, `${SESSION}.0`, `${SESSION}.1`, `${SESSION}.2`].map((name) => ({ url: `${ORIGIN}/`, name, storeId: "tab-store" })));
    const grants = { permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] };
    expect(profile.calls.requested).toEqual([grants]);
    expect(profile.calls.removed).toEqual([grants]);
    // Authenticated by the pairing secret alone.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${DASHBOARD}/api/providers/cookie-import`, status: 201, init: { method: "POST", credentials: "omit", redirect: "error" } });
    expect(Object.keys(sent[0].init.headers).sort()).toEqual(["content-type", pairing.header]);
    for (const unapproved of [...Object.values(UNRELATED), ...bystander.values]) expect(sent[0].init.body).not.toContain(unapproved);

    const id = result.connection.id;
    // The stale unchunked copy travelled with the chunks; only the chunks are stored.
    expect(await stored(id)).toMatchObject({ provider: PROVIDER, authType: "cookie", apiKey: mine.header });
    expect(JSON.parse(sent[0].responseText)).toEqual({ ok: true, action: "create", connection: { id, provider: PROVIDER, name: "Account B" } });
    expect((await submit(pairing, importBody(mine))).status).toBe(401);

    // The operator picks this account: top priority, HTTP transport, a strict proxy pool of its own.
    const pool = await db.createProxyPool({ name: "Synthetic B", proxyUrl: PROXY, strictProxy: true });
    const edited = await updateConnection(id, { priority: 1, proxyPoolId: pool.id, providerSpecificData: { transport: "http" } });
    await updateConnection(otherId, { priority: 2, providerSpecificData: { transport: "http" } });
    expect((await stored(id)).apiKey).toBe(mine.header);

    await expectTurnAs(mine, PROXY);
    // The sibling keeps its own session and does not inherit the first account's proxy.
    await updateConnection(id, { isActive: false });
    await expectTurnAs(other, undefined);

    const rows = JSON.stringify(global._dbAdapter.instance.all("SELECT * FROM providerConnections"));
    expect(rows).toContain(id);
    expectNoSecret(rows, mine, other);
    expect(logged()).toContain("chatgpt-web");
    expectNoSecret([sent[0].responseText, JSON.stringify(result), edited, await publicReads([id, otherId]), logged()].join("\n"), mine, other, bystander);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it("hands an extension-imported session to the browser transport by default, with the account's proxy", async () => {
    const mine = account("B");
    const profile = browserProfile({ stores: { "tab-store": signedInJar(mine) } });
    const { result } = await runExtension(profile, await mint({ action: "create", name: "Browser B" }));
    expect(result.ok).toBe(true);
    const id = result.connection.id;
    // An import writes no transport setting, so the connection runs the default "auto": browser first.
    expect((await stored(id)).providerSpecificData?.transport).toBeUndefined();
    const pool = await db.createProxyPool({ name: "Synthetic B", proxyUrl: PROXY, strictProxy: true });
    await updateConnection(id, { proxyPoolId: pool.id });

    const sessions = [];
    executor.deps = { browser: {
      createSession: async (input) => { sessions.push(input); return {}; },
      runTurn: async () => ({ text: "mock answer", conversationId: "synthetic-private-conversation", status: "finished_successfully", endTurn: true }),
      readSessionCookies: async () => [],
    } };
    const response = await chat();
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ connectionId: id, proxyUrl: expect.stringContaining("proxy-b.invalid:8080") });
    expect(sessions[0].storageState).toEqual({
      cookies: mine.chunks.map(({ name, value }) => ({ name, value, domain: ".chatgpt.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" })),
      origins: [],
    });
    expectNoSecret([text, logged()].join("\n"), mine);
    expect(upstream).toEqual([]);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it("replaces only the paired connection and keeps its settings and proxy", async () => {
    const stale = account("B-stale");
    const fresh = account("B-fresh");
    const sibling = account("A");
    // Only the sibling and the fresh session are signed in at the mocked chatgpt.com.
    knownSessions.set(sibling.header, sibling).set(fresh.header, fresh);
    const siblingId = await createByImport("Account A", sibling);
    const id = await createByImport("Account B", stale);
    const pool = await db.createProxyPool({ name: "Synthetic B", proxyUrl: PROXY, strictProxy: true });
    await updateConnection(id, { priority: 1, proxyPoolId: pool.id, providerSpecificData: { transport: "http" } });
    await updateConnection(siblingId, { priority: 2, isActive: false, providerSpecificData: { transport: "http" } });

    upstream = [];
    const expired = await chat();
    const expiredText = await expired.text();
    expect(expired.status).toBe(401);
    expect(expiredText).toContain("re-paste your __Secure-next-auth.session-token");
    expect(upstream.map(({ url, cookie, proxyUrl }) => ({ url, cookie, proxyUrl }))).toEqual([{ url: SESSION_URL, cookie: stale.header, proxyUrl: PROXY }]);

    const before = await stored(id);
    const siblingBefore = await stored(siblingId);
    const profile = browserProfile({ stores: { "tab-store": signedInJar(fresh) } });
    const { result, sent, view } = await runExtension(profile, await mint({ action: "update", connectionId: id }));
    expect(view).toMatchObject({ action: "update", target: id });
    expect(result).toMatchObject({ ok: true, action: "update" });
    expect(sent[0].status).toBe(200);

    const after = await stored(id);
    expect(after).toMatchObject({ apiKey: fresh.header, name: "Account B", priority: 1, testStatus: "active" });
    expect(after.providerSpecificData).toEqual(before.providerSpecificData);
    expect(await stored(siblingId)).toEqual(siblingBefore);
    expect(await rowCount()).toBe(2);
    await expectTurnAs(fresh, PROXY);
    expectNoSecret([expiredText, sent[0].responseText, await publicReads([id, siblingId]), logged()].join("\n"), stale, fresh, sibling);
  });

  it("keeps chatgpt-web and chatgpt-web-codex apart although both read the same cookie from chatgpt.com", async () => {
    const mine = account("B");
    const intruder = account("intruder");
    const mineId = await createByImport("Mine", mine);
    const otherId = await createByImport("Other", account("A"));
    const codex = account("codex");
    const codexPairing = await mint({ provider: "chatgpt-web-codex", action: "create", name: "Codex" });
    const codexImport = await submit(codexPairing, { ...importBody(codex), provider: "chatgpt-web-codex" });
    expect(codexImport.status).toBe(201);
    const codexId = (await codexImport.json()).connection.id;
    const snapshot = () => Promise.all([mineId, otherId, codexId].map(stored));
    const before = await snapshot();

    const crossTarget = await requestPairing({ action: "update", connectionId: codexId });
    expect(crossTarget.response.status).toBe(409);
    expect(crossTarget.body).toEqual({ error: "Connection does not belong to this provider" });

    const attempts = [
      ["provider swapped on an update pairing", { action: "update", connectionId: mineId }, { provider: "chatgpt-web-codex", connectionId: mineId }],
      ["provider swapped on a create pairing", { action: "create", name: "Swapped" }, { provider: "chatgpt-web-codex" }],
      ["another account's connection id", { action: "update", connectionId: mineId }, { connectionId: otherId }],
      ["the codex connection id", { action: "update", connectionId: mineId }, { connectionId: codexId }],
    ];
    for (const [label, target, body] of attempts) {
      const pairing = await mint(target);
      const response = await submit(pairing, importBody(intruder, body));
      expect(response.status, label).toBe(409);
      expectNoSecret(await response.text(), intruder);
      // The mismatch spent the secret: the correct request cannot reuse it.
      const retry = await submit(pairing, importBody(intruder, target.connectionId ? { connectionId: target.connectionId } : {}));
      expect(retry.status, label).toBe(401);
    }
    expect(await snapshot()).toEqual(before);
    expect(await rowCount()).toBe(3);
    expectNoSecret(logged(), mine, intruder, codex);
  });

  it.each([
    "https://auth.openai.com/log-in",
    "https://chat.openai.com/",
    "https://chatgpt.com.attacker.invalid/",
    "http://chatgpt.com/",
  ])("reads no cookie when the active tab is %s", async (tabUrl) => {
    const profile = browserProfile({ tabUrl, stores: { "tab-store": signedInJar(account("B")) } });
    const { result, sent } = await runExtension(profile, await mint({ action: "create", name: "Wrong tab" }));
    expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
    expect(profile.calls).toEqual({ get: [], requested: [], removed: [] });
    expect(sent).toEqual([]);
    expect(await rowCount()).toBe(0);
  });

  it("stores nothing from a signed-out tab or a session with an expired chunk", async () => {
    const mine = account("B");
    const replacement = account("replacement");
    const id = await createByImport("Account B", mine);
    const before = await stored(id);

    const signedOut = browserProfile({ stores: { "tab-store": Object.entries(UNRELATED).map(([name, value]) => browserCookie({ name, value })) } });
    const nothing = await runExtension(signedOut, await mint({ action: "update", connectionId: id }));
    expect(nothing.result).toMatchObject({ ok: false, code: "no_cookies" });
    expect(nothing.sent).toEqual([]);

    // The extension forwards expirationDate; the dashboard's clock decides.
    const profile = browserProfile({ stores: { "tab-store": signedInJar(replacement, [{}, { expirationDate: Math.floor(Date.now() / 1000) - 1 }]) } });
    const refused = await runExtension(profile, await mint({ action: "update", connectionId: id }));
    expect(refused.result).toMatchObject({ ok: false, code: "rejected" });
    expect(refused.sent[0].status).toBe(400);
    expect(JSON.parse(refused.sent[0].responseText)).toEqual({ error: "Cookie is expired" });
    expect(profile.calls.removed).toEqual(profile.calls.requested);
    expect(await stored(id)).toEqual(before);
    expect(await rowCount()).toBe(1);
    expectNoSecret([JSON.stringify(refused.result), refused.sent[0].responseText, logged()].join("\n"), mine, replacement);
  });

  it("refuses foreign origins, unapproved names, broken chunks and localStorage at the import route", async () => {
    const mine = account("B");
    const [zero, one] = mine.chunks;
    const cases = [
      ["the listed sign-in host as origin", { origin: "https://auth.openai.com" }, "Origin is not approved for this provider"],
      ["the legacy chat host as origin", { origin: "https://chat.openai.com" }, "Origin is not approved for this provider"],
      ["a sign-in host cookie domain", { cookies: [{ ...zero, domain: "auth.openai.com" }, one] }, "Cookie domain does not match the provider origin"],
      ["an openai.com cookie domain", { cookies: [{ ...zero, domain: ".openai.com" }, one] }, "Cookie domain does not match the provider origin"],
      ...Object.entries(UNRELATED).map(([name, value]) => [`the unrelated cookie ${name}`, { cookies: [zero, one, { name, value }] }, "Cookie name is not approved for this provider"]),
      ["a session without chunk 0", { cookies: [one] }, "Required session cookie is missing or incomplete"],
      ["a non-secure chunk", { cookies: [zero, { ...one, secure: false }] }, "Cookie must be a secure cookie"],
      ["a localStorage value", { localStorage: { accessToken: mine.accessToken } }, "This provider takes no localStorage value"],
    ];
    for (const [label, extra, error] of cases) {
      const response = await submit(await mint({ action: "create", name: "Refused" }), importBody(mine, extra));
      expect(response.status, label).toBe(400);
      const text = await response.text();
      expect(JSON.parse(text), label).toEqual({ error });
      expectNoSecret(text, mine);
    }
    expect(await rowCount()).toBe(0);
    expectNoSecret(logged(), mine);
  });
});

describe("ChatGPT Web dashboard import inputs (#2034)", () => {
  const cookieHeader = (session) => [
    `${SESSION}.1=${session.values[1]}`,
    `cf_clearance=${UNRELATED.cf_clearance}`,
    `${SESSION}=synthetic-${session.tag}-stale-unchunked`,
    `${SESSION}.0=${session.values[0]}`,
  ].join("; ");
  const harEntry = (url, header) => ({ request: { url, headers: [{ name: "Cookie", value: header }], cookies: [] } });
  const har = (...entries) => JSON.stringify({ log: { entries } });

  /** Parse as the dialog does, then send the chosen candidate through a real pairing. */
  async function importParsed(name, kind, parsed, choose = 0) {
    expect(parsed.ok, parsed.error).toBe(true);
    const pairing = await mint({ action: "create", name });
    const built = parser.buildImportCandidates({ kind, parsed }, importContract(PROVIDER));
    expect(built.ok, built.error).toBe(true);
    const candidate = built.candidates[choose];
    const response = await submit(pairing, { origin: candidate.origin, cookies: candidate.cookies });
    expect(response.status).toBe(201);
    return { id: (await response.json()).connection.id, built };
  }

  it.each([
    ["a Cookie header", "header", (session) => parser.parseCookieHeaderValue(`Cookie: ${cookieHeader(session)}`)],
    ["a cURL command", "curl", (session) => parser.parseCurlCommand(`curl '${CONVERSATION_URL}' \\\n  -H 'accept: text/event-stream' \\\n  -H 'authorization: Bearer ${session.accessToken}' \\\n  -b '${cookieHeader(session)}' \\\n  --data-raw '{}'`)],
    ["a HAR file", "har", (session) => parser.parseHarDocument(har(
      harEntry("https://auth.openai.com/authorize", cookieHeader(account("har-signin"))),
      harEntry("https://chat.openai.com/", cookieHeader(account("har-legacy"))),
      harEntry(SESSION_URL, cookieHeader(session)),
    ))],
  ])("imports %s and the HTTP transport sends exactly the ordered chunks", async (_label, kind, parse) => {
    const mine = account(kind);
    knownSessions.set(mine.header, mine);
    const { id, built } = await importParsed(`Via ${kind}`, kind, parse(mine));
    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0].cookies.map((cookie) => cookie.name)).toEqual([`${SESSION}.0`, `${SESSION}.1`]);
    expect((await stored(id)).apiKey).toBe(mine.header);
    await updateConnection(id, { providerSpecificData: { transport: "http" } });
    await expectTurnAs(mine, undefined);
    expectNoSecret([await publicReads([id]), logged()].join("\n"), mine);
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it("makes the operator choose between two accounts in one HAR and stores only the chosen one", async () => {
    const first = account("har-first");
    const second = account("har-second");
    const parsed = parser.parseHarDocument(har(harEntry(SESSION_URL, first.header), harEntry(CONVERSATION_URL, second.header)));
    const { id, built } = await importParsed("Chosen", "har", parsed, 1);
    expect(parser.candidatesAreAmbiguous(built.candidates)).toBe(true);
    expect((await stored(id)).apiKey).toBe(second.header);
    expect(await rowCount()).toBe(1);
  });

  it("refuses unsupported and foreign input locally without echoing it", () => {
    const mine = account("B");
    const contract = importContract(PROVIDER);
    const refusal = (kind, parsed) => {
      const result = parsed.ok ? parser.buildImportCandidates({ kind, parsed }, contract) : parsed;
      expect(result.ok).toBe(false);
      expectNoSecret(result.error, mine);
      return result.error;
    };
    // The add-connection dialog accepts a bare session token; the import dialog does not.
    expect(refusal("header", parser.parseCookieHeaderValue("synthetic-bare-session-token"))).toBe("No cookie name=value pair was found in the input.");
    expect(refusal("header", parser.parseCookieHeaderValue(`${SESSION}.1=${mine.values[1]}`))).toBe(`The chunked ${SESSION} cookie is incomplete: chunk 0 is missing.`);
    for (const url of ["https://auth.openai.com/authorize", "https://chat.openai.com/backend-api/conversation", "http://chatgpt.com/", "https://chatgpt.com.attacker.invalid/"]) {
      expect(refusal("curl", parser.parseCurlCommand(`curl '${url}' -H 'Cookie: ${mine.header}'`)), url).toBe("The request origin is not approved for this provider.");
      expect(refusal("har", parser.parseHarDocument(har(harEntry(url, mine.header)))), url).toBe(`The HAR file has no request to ${ORIGIN}.`);
    }
    expect(refusal("curl", parser.parseCurlCommand(`curl '${SESSION_URL}' -H 'authorization: Bearer ${mine.accessToken}'`))).toBe("The cURL command has no Cookie header.");
    // A Playwright storage-state JSON is a connection setting, not an import input.
    expect(refusal("har", parser.parseHarDocument(JSON.stringify({ cookies: mine.chunks, origins: [] })))).toBe("The HAR file has no request entries.");
  });
});

describe("ChatGPT Web import over a saved storage state (#2034)", () => {
  // Safe behaviour only. The browser transport's precedence for a saved storage
  // state over the imported cookie is a defect recorded, with its reproduction,
  // in the report; this suite does not assert it as correct.
  it("writes the imported cookie to the target only, redacts the storage state and uses the cookie over HTTP", async () => {
    const fresh = account("fresh");
    const saved = account("saved-state");
    const sibling = account("A");
    knownSessions.set(fresh.header, fresh);
    const siblingId = await createByImport("Account A", sibling);
    const id = await createByImport("Account B", account("original"));
    const storageState = {
      cookies: saved.chunks.map((chunk) => ({ ...chunk, domain: ".chatgpt.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" })),
      origins: [],
    };
    await updateConnection(id, { priority: 1, providerSpecificData: { transport: "http", storageState } });
    await updateConnection(siblingId, { priority: 2, isActive: false });
    const siblingBefore = await stored(siblingId);

    const response = await submit(await mint({ action: "update", connectionId: id }), importBody(fresh, { connectionId: id }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect((await stored(id)).apiKey).toBe(fresh.header);
    expect(await stored(siblingId)).toEqual(siblingBefore);
    const reads = await publicReads([id, siblingId]);
    expect(reads).not.toContain("storageState");
    await expectTurnAs(fresh, undefined);
    expectNoSecret([text, reads, logged()].join("\n"), fresh, saved, sibling);
  });
});
