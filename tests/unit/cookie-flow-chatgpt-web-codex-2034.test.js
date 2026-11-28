/**
 * #2034: ChatGPT Web Codex capture and import, against its real registry descriptor.
 *
 * Real: the registry entry, import contract, extension capture, dashboard parsers,
 * pairing and import handlers, an isolated SQLite file, provider routes, handleChat,
 * both ChatGPT transports up to their network seam, and the Codex executor.
 * Mocked: the operator authority decision, `chrome.*`, global `fetch`, the ChatGPT
 * TLS client and the browser session/turn. Every credential is synthetic. Nothing
 * here shows that chatgpt.com accepts these requests or that a sign-in works.
 *
 * Report: internal/docs/port-reports/cookie-flows/chatgpt-web-codex-2034.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareCapture, runCapture, confirmationFor, MESSAGES } from "../../extensions/provider-cookie-capture/capture.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-codex-machine-id" }));
// Only who counts as an operator is decided here. The origin checks stay real.
vi.mock("@/dashboardGuard", async (importOriginal) => {
  const operator = async (request) => request.headers.get("x-9r-cli-token") === "synthetic-operator";
  return { ...(await importOriginal()), canAccessManagementApi: operator, isOperatorRequest: operator, canManageAccessConfig: operator };
});

const ID = "chatgpt-web-codex";
const ORIGIN = "https://chatgpt.com";
const SESSION = "__Secure-next-auth.session-token";
const SESSION_URL = `${ORIGIN}/api/auth/session`;
const CONVERSATION_URL = `${ORIGIN}/backend-api/f/conversation`;
const DASHBOARD = "https://dashboard.example";
const TAB_ID = 7;
// Synthetic only. `tag` marks the account so a crossed credential is visible.
const chunk = (tag, index) => `synthetic-codex-${tag}-chunk-${index}`;
const header = (tag) => `${SESSION}.0=${chunk(tag, 0)}; ${SESSION}.1=${chunk(tag, 1)}`;
const NOISE = "synthetic-unapproved-cookie-value";
const accessToken = (tag) => `synthetic-access-token-${tag}`;
const SECRET_PATTERN = /synthetic-codex-\w+-chunk|synthetic-unapproved|synthetic-access-token|ddpair_/;

let root;
let db;
let routes;
let pairingStore;
let tlsModule;
let executor;
let originalDeps;
let logs;
let outbound;
let tlsCalls;
let usageWrite;

const consoleText = () => logs.flatMap((spy) => spy.mock.calls)
  .map((call) => call.map((part) => (part instanceof Error ? part.stack : JSON.stringify(part) ?? String(part))).join(" "))
  .join("\n");

function dashboardRequest(url, body, { method = "POST", headers = {} } = {}) {
  return new NextRequest(`${DASHBOARD}${url}`, {
    method,
    headers: { "content-type": "application/json", host: "dashboard.example", origin: DASHBOARD, "x-9r-cli-token": "synthetic-operator", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}
const params = (id) => ({ params: Promise.resolve({ id }) });

const requestPairing = (body, options) => routes.pairing.POST(dashboardRequest("/api/providers/cookie-import/pairing", body, options));

async function mintPairing(target, provider = ID) {
  const res = await requestPairing({ provider, ...target });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).pairing;
}

/** The import request carries the pairing secret only: no operator header, extension origin. */
function submit(token, body) {
  const headers = { "content-type": "application/json", host: "dashboard.example", origin: "chrome-extension://synthetic" };
  if (token) headers["x-durindoor-pairing-token"] = token;
  return routes.import.POST(new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, { method: "POST", headers, body: JSON.stringify(body) }));
}

const serverCookies = (tag, extra = {}) => [1, 0].map((index) => ({ name: `${SESSION}.${index}`, value: chunk(tag, index), ...extra }));

/** Pair and import the way the dashboard dialog does. */
async function importAccount(tag, target = { action: "create", name: `codex-${tag}` }) {
  const pairing = await mintPairing(target);
  const { name, connectionId } = target;
  const res = await submit(pairing.token, {
    provider: ID, origin: ORIGIN, cookies: serverCookies(tag),
    ...(target.action === "create" ? { name } : { connectionId }),
  });
  expect(res.status, await res.clone().text()).toBe(target.action === "create" ? 201 : 200);
  return (await res.json()).connection.id;
}

async function edit(id, body) {
  const res = await routes.provider.PUT(dashboardRequest(`/api/providers/${id}`, body, { method: "PUT" }), params(id));
  expect(res.status, await res.clone().text()).toBe(200);
}

const assignProxy = (id, tag, providerSpecificData) => edit(id, {
  connectionProxyEnabled: true, connectionProxyUrl: `http://proxy-${tag}.invalid:8080`,
  ...(providerSpecificData ? { providerSpecificData } : null),
});

const rows = () => db.getProviderConnections({});
async function chat(lane) {
  const writes = usageWrite.mock.calls.length;
  const res = await routes.handleChat(new Request("http://gateway.invalid/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: `cgpt-codex/${lane}`, messages: [{ role: "user", content: "hello" }] }),
  }));
  // A reply schedules its usage write without awaiting it; settle it before the database closes.
  if (res.ok) {
    await vi.waitFor(() => expect(usageWrite.mock.calls.length).toBeGreaterThan(writes));
    await Promise.all(usageWrite.mock.results.map((result) => result.value));
  }
  return res;
}

/** A chatgpt.com stand-in at the TLS client seam. The reply follows the cookie it is sent. */
function scriptTls({ rotate = {}, expired = [] } = {}) {
  tlsModule.__setTlsFetchOverrideForTesting(async (url, options) => {
    const cookie = options.headers?.Cookie ?? "";
    const tag = /synthetic-codex-(\w+)-chunk/.exec(cookie)?.[1];
    tlsCalls.push({
      url: String(url), cookie, tag, proxyUrl: options.proxyUrl, guarded: options.sameOriginRedirects,
      authorization: options.headers?.Authorization, body: options.body,
    });
    const reply = (body, extra = {}) => ({ status: 200, headers: new Headers({ "Content-Type": "application/json", ...extra }), body: null, text: JSON.stringify(body) });
    if (String(url) === SESSION_URL) {
      if (expired.includes(tag)) return reply({});
      return reply({ accessToken: accessToken(tag), user: { id: `user-${tag}` } }, rotate[tag] ? { "set-cookie": rotate[tag] } : {});
    }
    if (String(url).includes("/sentinel/chat-requirements")) return reply({ token: "requirements", proofofwork: { required: false } });
    if (String(url) === CONVERSATION_URL) {
      const message = { conversation_id: "conversation", message: { id: "reply", author: { role: "assistant" }, content: { content_type: "text", parts: [`pong-${tag}`] }, status: "finished_successfully", end_turn: true } };
      return { status: 200, headers: new Headers({ "Content-Type": "text/event-stream" }), body: null, text: `data: ${JSON.stringify(message)}\n\ndata: [DONE]\n\n` };
    }
    return reply({});
  });
}

/**
 * A chrome.* stand-in with one jar per cookie store. `cookies.get` answers by
 * exact name inside the requested store; enumeration and script injection fail.
 */
function fakeChrome(jars, { tabUrl = `${ORIGIN}/` } = {}) {
  const reads = [];
  const grants = { requested: [], removed: [] };
  const held = new Set();
  const names = (query) => [...(query.permissions ?? []), ...(query.origins ?? [])];
  return {
    reads,
    grants,
    chrome: {
      tabs: { query: async () => [{ id: TAB_ID, url: tabUrl }], get: async () => ({ id: TAB_ID, url: tabUrl }) },
      permissions: {
        contains: async (query) => names(query).every((name) => held.has(name)),
        request: async (query) => { grants.requested.push(structuredClone(query)); names(query).forEach((name) => held.add(name)); return true; },
        remove: async (query) => { grants.removed.push(structuredClone(query)); names(query).forEach((name) => held.delete(name)); return true; },
      },
      cookies: {
        getAllCookieStores: async () => [{ id: "other-profile", tabIds: [99] }, { id: "tab-profile", tabIds: [TAB_ID] }],
        get: async ({ url, name, storeId }) => { reads.push({ url, name, storeId }); return jars[storeId]?.[name] ?? null; },
        getAll: async () => { throw new Error("codex capture must not enumerate cookies"); },
      },
      scripting: { executeScript: async () => { throw new Error("codex capture must not inject a script"); } },
    },
  };
}

const jarCookie = (name, value, extra = {}) => [name, { name, value, domain: ".chatgpt.com", secure: true, expirationDate: Date.now() / 1000 + 3600, ...extra }];
const jarOf = (...entries) => Object.fromEntries(entries);
const sessionJar = (tag, extra) => jarOf(jarCookie(`${SESSION}.0`, chunk(tag, 0), extra), jarCookie(`${SESSION}.1`, chunk(tag, 1), extra));

/** The extension's one POST, delivered to the real import route. */
function bridgeFetch() {
  const sent = [];
  const send = vi.fn(async (url, init) => {
    sent.push({ url, init });
    return routes.import.POST(new NextRequest(url, {
      method: init.method, body: init.body,
      headers: { ...init.headers, host: "dashboard.example", origin: "chrome-extension://synthetic" },
    }));
  });
  return { send, sent };
}

async function captureWith(pairing, harness) {
  const prepared = await prepareCapture({ chrome: harness.chrome, text: JSON.stringify({ pairing }) });
  if (!prepared.ok) return { prepared, result: prepared, ...bridgeFetch() };
  const bridge = bridgeFetch();
  const result = await runCapture({ chrome: harness.chrome, fetch: bridge.send, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  return { prepared, result, ...bridge };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cookie-flow-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  outbound = vi.fn(async () => { throw new Error("unmocked outbound request"); });
  vi.stubGlobal("fetch", outbound);
  tlsCalls = [];
  db = await import("@/lib/db/index.js");
  usageWrite = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");
  pairingStore = await import("@/lib/providers/cookieImport/pairing.js");
  pairingStore.clearPairings();
  routes = {
    pairing: await import("../../src/app/api/providers/cookie-import/pairing/route.js"),
    import: await import("../../src/app/api/providers/cookie-import/route.js"),
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    test: await import("../../src/app/api/providers/[id]/test/route.js"),
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
  };
  tlsModule = await import("../../open-sse/services/chatgptTlsClient.js");
  const { __resetChatGptWebCachesForTesting } = await import("../../open-sse/executors/chatgpt-web-http.js");
  __resetChatGptWebCachesForTesting();
  scriptTls();
  executor = (await import("../../open-sse/executors/index.js")).getExecutor(ID);
  originalDeps = executor.deps;
  // A fresh database plus the route graph can pass the default hook limit on a loaded host.
}, 60_000);

afterEach(async () => {
  executor.deps = originalDeps;
  tlsModule.__setTlsFetchOverrideForTesting(null);
  pairingStore.clearPairings();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("extension capture with the real chatgpt-web-codex descriptor", () => {
  it("pairs, reads only the tab's session chunks and stores them through the real import route", async () => {
    const pairing = await mintPairing({ action: "create", name: "captured" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [SESSION], cookiePrefixes: [`${SESSION}.`] });
    const harness = fakeChrome({
      "tab-profile": {
        ...sessionJar("alpha"),
        // A stale unchunked cookie beside the chunks, and cookies outside the contract.
        ...jarOf(jarCookie(SESSION, chunk("stale", 0)), jarCookie("cf_clearance", NOISE), jarCookie("__Host-next-auth.csrf-token", NOISE)),
      },
      "other-profile": sessionJar("bravo"),
    });

    const { result, sent } = await captureWith(pairing, harness);

    expect(result).toMatchObject({ ok: true, action: "create", cookieCount: 3 });
    expect(harness.reads).toEqual([SESSION, `${SESSION}.0`, `${SESSION}.1`, `${SESSION}.2`]
      .map((name) => ({ url: `${ORIGIN}/`, name, storeId: "tab-profile" })));
    expect(harness.grants.requested).toEqual([{ permissions: ["cookies"], origins: [`${ORIGIN}/*`, `${DASHBOARD}/*`] }]);
    expect(harness.grants.removed).toEqual(harness.grants.requested);
    expect(sent).toHaveLength(1);
    expect(sent[0].init).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    expect(sent[0].init.body).not.toMatch(/bravo|synthetic-unapproved/);
    expect(JSON.parse(sent[0].init.body)).not.toHaveProperty("localStorage");

    const [row] = await rows();
    // The stale unchunked cookie is dropped and the chunks are stored in order.
    expect(row).toMatchObject({ provider: ID, authType: "cookie", name: "captured", apiKey: header("alpha") });
    const listed = await (await routes.providers.GET(dashboardRequest("/api/providers", null, { method: "GET" }))).text();
    expect(listed).toContain(row.id);
    expect(`${listed}\n${JSON.stringify(result)}\n${consoleText()}`).not.toMatch(SECRET_PATTERN);
    // The pairing is spent: a replay of the same secret writes nothing.
    expect((await submit(pairing.token, JSON.parse(sent[0].init.body))).status).toBe(401);
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    "http://chatgpt.com/",
    "https://auth.openai.com/",
    "https://sub.chatgpt.com/",
    "https://chatgpt.com.example.invalid/",
  ])("reads and sends nothing from a %s tab, although in-page sign-in may visit auth.openai.com", async (tabUrl) => {
    const harness = fakeChrome({ "tab-profile": sessionJar("alpha") }, { tabUrl });
    const { result, send } = await captureWith(await mintPairing({ action: "create", name: "wrong-tab" }), harness);
    expect(result).toMatchObject({ ok: false, code: "wrong_tab", expectedOrigin: ORIGIN });
    expect(harness.reads).toEqual([]);
    expect(harness.grants.requested).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing for foreign-domain or insecure cookies and leaves the pairing unspent", async () => {
    const harness = fakeChrome({ "tab-profile": jarOf(
      jarCookie(`${SESSION}.0`, chunk("alpha", 0), { domain: "auth.openai.com" }),
      jarCookie(SESSION, chunk("alpha", 1), { secure: false }),
    ) });
    const { result, send } = await captureWith(await mintPairing({ action: "create", name: "foreign" }), harness);
    expect(result).toEqual({ ok: false, code: "no_cookies", message: MESSAGES.no_cookies });
    expect(send).not.toHaveBeenCalled();
    expect(pairingStore.pendingPairingCount()).toBe(1);
    expect(await rows()).toEqual([]);
  });

  it("has the server refuse the whole capture when one chunk is expired", async () => {
    const jar = { ...sessionJar("alpha"), ...jarOf(jarCookie(`${SESSION}.1`, chunk("alpha", 1), { expirationDate: Date.now() / 1000 - 60 })) };
    const harness = fakeChrome({ "tab-profile": jar });
    const { result, send } = await captureWith(await mintPairing({ action: "create", name: "expired" }), harness);
    expect(result).toEqual({ ok: false, code: "rejected", message: MESSAGES.rejected });
    expect(send).toHaveBeenCalledOnce();
    expect(await (await send.mock.results[0].value).json()).toEqual({ error: "Cookie is expired" });
    expect(await rows()).toEqual([]);
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });
});

describe("dashboard import inputs for chatgpt-web-codex", () => {
  const cookieHeader = `${header("alpha").split("; ").reverse().join("; ")}; cf_clearance=${NOISE}`;
  const harEntry = (url, value) => ({ request: { url, headers: [{ name: "Cookie", value }], cookies: [] } });
  const har = (...entries) => JSON.stringify({ log: { entries } });

  async function modules() {
    const parser = await import("@/shared/utils/cookieImportParser.js");
    const { getCookieImportContract } = await import("@/lib/providers/cookieImport/contract.js");
    return { ...parser, contract: getCookieImportContract(ID) };
  }

  it.each([
    ["header", "parseCookieHeaderValue", `Cookie: ${cookieHeader}`],
    ["curl", "parseCurlCommand", `curl '${ORIGIN}/backend-api/me' \\\n  -H 'Cookie: ${cookieHeader}' -H 'authorization: Bearer ${accessToken("pasted")}'`],
    ["curl", "parseCurlCommand", `curl ${ORIGIN}/ -b '${cookieHeader}'`],
    ["har", "parseHarDocument", har(harEntry("https://auth.openai.com/authorize", header("bravo")), harEntry(`${ORIGIN}/api/auth/session`, cookieHeader))],
  ])("%s input read by %s stores only the ordered session chunks", async (kind, parse, input) => {
    const mod = await modules();
    const built = mod.buildImportCandidates({ kind, parsed: mod[parse](input) }, mod.contract);
    expect(built.ok, built.error).toBe(true);
    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0].dropped).toEqual(["cf_clearance"]);
    const pairing = await mintPairing({ action: "create", name: "pasted" });
    const res = await submit(pairing.token, { provider: ID, origin: built.candidates[0].origin, cookies: built.candidates[0].cookies, name: "pasted" });
    expect(res.status).toBe(201);
    expect(await res.text()).not.toMatch(SECRET_PATTERN);
    expect((await rows()).map((row) => row.apiKey)).toEqual([header("alpha")]);
    expect(outbound).not.toHaveBeenCalled();
    expect(tlsCalls).toEqual([]);
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });

  it("refuses unsupported or foreign input with fixed text and asks which of two HAR accounts to use", async () => {
    const mod = await modules();
    const read = (kind, parsed) => (parsed.ok ? mod.buildImportCandidates({ kind, parsed }, mod.contract) : parsed);
    // The dialog takes name=value pairs; a bare token value belongs in the manual Add Connection field.
    expect(mod.parseCookieHeaderValue(chunk("alpha", 0))).toEqual({ ok: false, error: "No cookie name=value pair was found in the input." });
    for (const url of ["http://chatgpt.com/", "https://auth.openai.com/", "https://chatgpt.com.example.invalid/"]) {
      expect(read("curl", mod.parseCurlCommand(`curl ${url} -H 'Cookie: ${header("alpha")}'`)), url)
        .toEqual({ ok: false, error: "The request origin is not approved for this provider." });
      expect(read("har", mod.parseHarDocument(har(harEntry(url, header("alpha"))))), url)
        .toEqual({ ok: false, error: `The HAR file has no request to ${ORIGIN}.` });
    }
    expect(read("header", mod.parseCookieHeaderValue(`${SESSION}.1=${chunk("alpha", 1)}`)))
      .toEqual({ ok: false, error: `The chunked ${SESSION} cookie is incomplete: chunk 0 is missing.` });
    const two = read("har", mod.parseHarDocument(har(harEntry(`${ORIGIN}/a`, header("alpha")), harEntry(`${ORIGIN}/b`, header("bravo")))));
    expect(two.ok).toBe(true);
    expect(mod.candidatesAreAmbiguous(two.candidates)).toBe(true);
  });

  it.each([
    ["another origin", { origin: "https://auth.openai.com" }, "Origin is not approved for this provider"],
    ["another cookie domain", { cookies: serverCookies("alpha", { domain: ".openai.com" }) }, "Cookie domain does not match the provider origin"],
    ["an insecure cookie", { cookies: serverCookies("alpha", { secure: false }) }, "Cookie must be a secure cookie"],
    ["an expired cookie", { cookies: serverCookies("alpha", { expirationDate: 1 }) }, "Cookie is expired"],
    ["a chunk gap", { cookies: [serverCookies("alpha")[0]] }, "Required session cookie is missing or incomplete"],
    ["an extra browser cookie", { cookies: [...serverCookies("alpha"), { name: "cf_clearance", value: NOISE }] }, "Cookie name is not approved for this provider"],
    ["a localStorage value", { localStorage: { accessToken: NOISE } }, "This provider takes no localStorage value"],
    ["an account email", { accountEmail: "synthetic@example.invalid" }, "Account email is bound by the pairing"],
  ])("the import route refuses %s without writing or echoing it", async (_label, override, error) => {
    const pairing = await mintPairing({ action: "create", name: "refused" });
    const res = await submit(pairing.token, { provider: ID, origin: ORIGIN, cookies: serverCookies("alpha"), name: "refused", ...override });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(await rows()).toEqual([]);
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });

  it("requires the operator and the dashboard origin to pair, and the pairing secret to import", async () => {
    const target = { provider: ID, action: "create", name: "unauthorized" };
    expect((await requestPairing(target, { headers: { "x-9r-cli-token": "someone-else" } })).status).toBe(403);
    expect((await requestPairing(target, { headers: { origin: ORIGIN } })).status).toBe(403);
    expect((await requestPairing({ ...target, accountEmail: "synthetic@example.invalid" })).status).toBe(400);
    expect(pairingStore.pendingPairingCount()).toBe(0);
    expect((await submit(null, { provider: ID, origin: ORIGIN, cookies: serverCookies("alpha"), name: "unauthorized" })).status).toBe(401);
    expect(await rows()).toEqual([]);
  });
});

describe("update ownership between accounts and the chatgpt-web sibling", () => {
  // chatgpt-web shares this origin and these cookie names, so only ownership keeps the two apart.
  it("replaces only the paired Codex account and keeps its proxy and transport", async () => {
    const alpha = await importAccount("alpha");
    const bravo = await importAccount("bravo");
    await assignProxy(alpha, "alpha", { transport: "http" });
    const created = await routes.providers.POST(dashboardRequest("/api/providers", { provider: "chatgpt-web", name: "sibling", apiKey: header("sibling") }));
    expect(created.status).toBe(201);
    const sibling = (await created.json()).connection.id;

    const foreign = await requestPairing({ provider: ID, action: "update", connectionId: sibling });
    expect(foreign.status).toBe(409);
    expect(await foreign.json()).toEqual({ error: "Connection does not belong to this provider" });
    expect((await requestPairing({ provider: "chatgpt-web", action: "update", connectionId: alpha })).status).toBe(409);

    const before = await rows();
    for (const mismatch of [{ connectionId: bravo }, { provider: "chatgpt-web" }]) {
      const pairing = await mintPairing({ action: "update", connectionId: alpha });
      const body = { provider: ID, origin: ORIGIN, cookies: serverCookies("fresh"), connectionId: alpha };
      const res = await submit(pairing.token, { ...body, ...mismatch });
      expect(res.status).toBe(409);
      expect(await res.text()).not.toMatch(SECRET_PATTERN);
      expect((await submit(pairing.token, body)).status).toBe(401);
    }
    expect(await rows()).toEqual(before);

    await db.updateProviderConnection(alpha, { testStatus: "unavailable", lastError: "expired", errorCode: 401, modelLock_instant: new Date(Date.now() + 60_000).toISOString() });
    await importAccount("fresh", { action: "update", connectionId: alpha });
    const updated = await db.getProviderConnectionById(alpha);
    expect(updated).toMatchObject({
      name: "codex-alpha", apiKey: header("fresh"), testStatus: "active",
      providerSpecificData: { transport: "http", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-alpha.invalid:8080" },
    });
    expect(updated.modelLock_instant ?? null).toBeNull();
    for (const id of [bravo, sibling]) {
      expect(await db.getProviderConnectionById(id)).toEqual(before.find((row) => row.id === id));
    }
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });
});

describe("imported credential consumption, HTTP transport", () => {
  const LANES = [
    ["luna", "auto"], ["think", "auto"], ["instant", "gpt-5-6"], ["medium", "gpt-5-6-thinking", "standard"],
    ["high", "gpt-5-6-thinking", "extended"], ["extra-high", "gpt-5-6-thinking", "max"], ["pro", "gpt-5-6-pro", "standard"],
  ];

  async function twoAccounts() {
    const alpha = await importAccount("alpha");
    const bravo = await importAccount("bravo");
    // Import sets no transport. `http` is available only through the connection API.
    await assignProxy(alpha, "alpha", { transport: "http" });
    await assignProxy(bravo, "bravo", { transport: "http" });
    await edit(alpha, { priority: 1 });
    await edit(bravo, { priority: 2 });
    return { alpha, bravo };
  }

  const onlyAccount = (calls, tag) => {
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, call.url).toMatchObject({ tag, proxyUrl: `http://proxy-${tag}.invalid:8080`, guarded: true });
      expect(call.url.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(call.cookie).toBe(header(tag));
      if (call.authorization) expect(call.authorization).toBe(`Bearer ${accessToken(tag)}`);
    }
  };

  it("builds all seven lane requests with one account's cookie, token and proxy, then switches cleanly", async () => {
    const { alpha } = await twoAccounts();
    for (const [lane, slug, effort] of LANES) {
      const start = tlsCalls.length;
      const res = await chat(lane);
      expect(res.status, lane).toBe(200);
      expect((await res.json()).choices[0].message.content, lane).toBe("pong-alpha");
      const sent = tlsCalls.slice(start).filter((call) => call.url === CONVERSATION_URL);
      expect(sent, lane).toHaveLength(1);
      expect(sent[0].authorization).toBe(`Bearer ${accessToken("alpha")}`);
      const body = JSON.parse(sent[0].body);
      expect(body.model, lane).toBe(slug);
      expect(body.thinking_effort, lane).toBe(effort);
      // `think` and `luna` share the `auto` slug; only the reason hint separates them.
      expect(body.system_hints ?? [], lane).toEqual(lane === "think" ? ["reason"] : []);
    }
    onlyAccount(tlsCalls, "alpha");

    await edit(alpha, { isActive: false });
    const start = tlsCalls.length;
    expect((await (await chat("instant")).json()).choices[0].message.content).toBe("pong-bravo");
    onlyAccount(tlsCalls.slice(start), "bravo");
    // The cached access token of the first account is not reused for the second.
    expect(tlsCalls.slice(start).some((call) => call.url === SESSION_URL)).toBe(true);
    expect(outbound).not.toHaveBeenCalled();
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });

  it("writes a rotated session cookie back to the account that sent the request only", async () => {
    const { alpha, bravo } = await twoAccounts();
    const untouched = await db.getProviderConnectionById(bravo);
    scriptTls({ rotate: { alpha: `${SESSION}.0=${chunk("rotated", 0)}; Path=/; Secure, ${SESSION}.1=${chunk("rotated", 1)}; Path=/; Secure` } });
    const res = await chat("instant");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(SECRET_PATTERN);
    await vi.waitFor(async () => expect((await db.getProviderConnectionById(alpha)).apiKey).toBe(header("rotated")));
    expect((await db.getProviderConnectionById(bravo)).apiKey).toBe(untouched.apiKey);
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });

  it("answers 401 for an expired imported session without sending a conversation request", async () => {
    const id = await importAccount("alpha");
    await assignProxy(id, "alpha", { transport: "http" });
    scriptTls({ expired: ["alpha"] });
    const res = await chat("instant");
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(SECRET_PATTERN);
    expect(tlsCalls.map((call) => call.url)).toEqual([SESSION_URL]);
    onlyAccount(tlsCalls, "alpha");
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });

  it("tests the stored connection with the imported cookie at the read-only session endpoint", async () => {
    const id = await importAccount("alpha");
    outbound.mockImplementation(async () => Response.json({ accessToken: accessToken("alpha") }));
    const res = await routes.test.POST(dashboardRequest(`/api/providers/${id}/test`, {}), params(id));
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ valid: true });
    expect(outbound).toHaveBeenCalledOnce();
    const [url, init] = outbound.mock.calls[0];
    expect(String(url)).toBe(SESSION_URL);
    expect(init).toMatchObject({ method: "GET", redirect: "manual", headers: { Cookie: header("alpha") } });
    expect(`${text}\n${consoleText()}`).not.toMatch(SECRET_PATTERN);
  });
});

describe("imported credential consumption, default `auto` transport", () => {
  /** The browser seam: records what would open a page, and never starts one. */
  function browserSeam(createSession) {
    const sessions = [];
    const create = vi.fn(createSession ?? (async (input) => { sessions.push(input); return {}; }));
    executor.deps = { browser: {
      createSession: create,
      runTurn: async () => ({ text: "browser-pong", status: "finished_successfully", endTurn: true }),
      readSessionCookies: async () => [],
    } };
    return { sessions, create };
  }

  async function freshImport() {
    const id = await importAccount("alpha");
    await assignProxy(id, "alpha");
    expect((await db.getProviderConnectionById(id)).providerSpecificData.transport).toBeUndefined();
    return id;
  }

  it.each([["luna", false], ["think", true]])("opens the %s browser request with the imported cookies and proxy", async (lane, thinkEnabled) => {
    const id = await freshImport();
    const { sessions } = browserSeam();
    const res = await chat(lane);
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("browser-pong");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      connectionId: id, proxyUrl: "http://proxy-alpha.invalid:8080", sameOriginRedirects: true,
      selection: { kind: "free", thinkEnabled },
    });
    expect(sessions[0].storageState.cookies.map(({ name, value, domain, secure }) => ({ name, value, domain, secure })))
      .toEqual([0, 1].map((index) => ({ name: `${SESSION}.${index}`, value: chunk("alpha", index), domain: ".chatgpt.com", secure: true })));
    expect(tlsCalls).toEqual([]);
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });

  it("falls back to HTTP with the same account and proxy when no browser can start", async () => {
    await freshImport();
    const { BrowserUnavailableError } = await import("../../open-sse/services/browserPool.js");
    const { create } = browserSeam(async () => { throw new BrowserUnavailableError("synthetic: no browser"); });
    const res = await chat("luna");
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("pong-alpha");
    expect(create).toHaveBeenCalledOnce();
    for (const call of tlsCalls) expect(call).toMatchObject({ cookie: header("alpha"), proxyUrl: "http://proxy-alpha.invalid:8080" });
    expect(tlsCalls.map((call) => call.url)).toContain(CONVERSATION_URL);
  });

  // #2034: each formerly refused lane now binds exactly one existing selection.
  it.each([
    ["instant", 0], ["medium", 1], ["high", 2],
    ["extra-high", 3], ["pro", 4],
  ])("dispatches the %s lane at existing selection %s exactly once", async (lane, index) => {
    const id = await freshImport();
    const { create, sessions } = browserSeam();
    const turn = vi.fn(executor.deps.browser.runTurn);
    executor.deps.browser.runTurn = turn;
    const res = await chat(lane);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).choices[0].message.content).toBe("browser-pong");
    expect(sessions[0]).toMatchObject({ connectionId: id, proxyUrl: "http://proxy-alpha.invalid:8080", sameOriginRedirects: true, selection: { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: index } });
    expect(sessions[0].storageState.cookies.map(({ name, value }) => `${name}=${value}`).join("; ")).toBe(header("alpha"));
    expect(text).not.toMatch(SECRET_PATTERN);
    expect(create).toHaveBeenCalledOnce();
    expect(turn).toHaveBeenCalledOnce();
    expect(tlsCalls).toEqual([]);
    expect(outbound).not.toHaveBeenCalled();
    expect((await db.getProviderConnectionById(id)).apiKey).toBe(header("alpha"));
    expect(consoleText()).not.toMatch(SECRET_PATTERN);
  });
});
