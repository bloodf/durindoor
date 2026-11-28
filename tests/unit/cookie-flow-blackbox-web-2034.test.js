import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blackbox-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCredentials } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { prepareCapture, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import { BlackboxWebExecutor } from "../../open-sse/executors/blackbox-web.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const DASH = "https://dashboard.example", ORIGIN = "https://app.blackbox.ai", NAME = "next-auth.session-token";
const A = "synthetic-account-a", B = "synthetic-account-b";
let db, logs;
const req = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function issue(body) {
  const response = await pair(req(`${DASH}/api/providers/cookie-import/pairing`, body, { origin: DASH, "x-9r-cli-token": "operator" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
const submit = (token, body) => importCredentials(req(`${DASH}/api/providers/cookie-import`, body, { origin: "chrome-extension://synthetic", [PAIRING_HEADER]: token }));
const cookie = (value, extra = {}) => ({ name: NAME, value, domain: "app.blackbox.ai", secure: true, ...extra });
function browser(value) {
  const get = vi.fn(async () => cookie(value));
  const chrome = { tabs: { query: vi.fn(async () => [{ id: 7, url: ORIGIN }]), get: vi.fn(async () => ({ id: 7, url: ORIGIN })) }, permissions: { contains: vi.fn(async () => true), request: vi.fn(), remove: vi.fn() }, cookies: { getAllCookieStores: vi.fn(async () => [{ id: "other", tabIds: [8] }, { id: "chosen", tabIds: [7] }]), get, getAll: vi.fn() }, scripting: { executeScript: vi.fn() } };
  return { chrome, get };
}
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", DASH); vi.stubEnv("NEXT_PUBLIC_BASE_URL", ""); vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:"); db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"); applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("blackbox-web real cookie flow", () => {
  it("captures the selected browser store into an authenticated connection and sends its stored credential through the executor", async () => {
    const other = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "Other", apiKey: `${NAME}=${B}`, isActive: true }, { createOnly: true });
    const pairing = await issue({ provider: "blackbox-web", action: "create", name: "Chosen" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [NAME], cookiePrefixes: [] });
    const { chrome, get } = browser(A);
    const prepared = await prepareCapture({ chrome, text: JSON.stringify(pairing) });
    expect(prepared.ok).toBe(true);
    expect(JSON.stringify(describePlan(prepared.plan))).not.toContain(pairing.token);
    const network = vi.fn(async (_url, init) => submit(init.headers[PAIRING_HEADER], JSON.parse(init.body)));
    expect((await runCapture({ chrome, fetch: network, plan: prepared.plan, confirmed: {} })).code).toBe("not_confirmed");
    const result = await runCapture({ chrome, fetch: network, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
    expect(result.ok).toBe(true);
    expect(get).toHaveBeenCalledOnce(); expect(get).toHaveBeenCalledWith({ url: `${ORIGIN}/`, name: NAME, storeId: "chosen" });
    expect(chrome.cookies.getAll).not.toHaveBeenCalled(); expect(chrome.scripting.executeScript).not.toHaveBeenCalled(); expect(network).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(A);
    const storedRows = db.all("SELECT id FROM providerConnections");
    const chosenId = storedRows.find((row) => row.id !== other.id).id;
    const stored = await getProviderConnectionById(chosenId);
    expect(stored.apiKey).toBe(`${NAME}=${A}`);
    expect((await getProviderConnectionById(other.id)).apiKey).toBe(`${NAME}=${B}`);
    const calls = [];
    const restore = __setOriginalFetchForTesting(async (url, init) => { calls.push({ url: String(url), init }); return String(url).endsWith("/api/auth/session") ? Response.json({}) : new Response("synthetic answer"); });
    try {
      const result = await new BlackboxWebExecutor().execute({ model: "gpt-4", body: { messages: [{ role: "user", content: "hello" }] }, credentials: stored, proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://127.0.0.1:9", strictProxy: true } });
      expect(result.response.status).toBe(200);
      expect(calls.map((call) => call.url)).toEqual([`${ORIGIN}/api/auth/session`, `${ORIGIN}/api/chat`]);
      for (const call of calls) { expect(call.init.headers.Cookie).toBe(`${NAME}=${A}`); expect(call.init.dispatcher).toBeTruthy(); }
      expect(JSON.stringify(result.headers)).not.toContain(A);
    } finally { restore(); }
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(A);
  });

  it("imports selected real-contract header, cURL and HAR candidates and rejects foreign origins and unsupported chunks", async () => {
    const contract = getCookieImportContract("blackbox-web");
    const header = parseCookieHeaderValue(`Cookie: ${NAME}=${A}; unrelated=noise`);
    const curl = parseCurlCommand(`curl '${ORIGIN}/api/chat' -H 'Cookie: ${NAME}=${A}'`);
    const har = parseHarDocument(JSON.stringify({ log: { entries: [A, B].map((value) => ({ request: { url: `${ORIGIN}/api/chat`, cookies: [{ name: NAME, value }] } })) } }));
    for (const [kind, parsed] of [["header", header], ["curl", curl], ["har", har]]) {
      expect(parsed.ok).toBe(true);
      const selected = buildImportCandidates({ kind, parsed }, contract);
      expect(selected.ok).toBe(true); expect(selected.candidates[0].cookies).toEqual([{ name: NAME, value: A }]);
      if (kind === "har") expect(candidatesAreAmbiguous(selected.candidates)).toBe(true);
      const pairing = await issue({ provider: "blackbox-web", action: "create", name: `Imported ${kind}` });
      const response = await submit(pairing.token, { provider: "blackbox-web", origin: ORIGIN, cookies: selected.candidates[0].cookies });
      expect(response.status).toBe(201);
      const payload = await response.json(); expect(JSON.stringify(payload)).not.toContain(A);
      expect((await getProviderConnectionById(payload.connection.id)).apiKey).toBe(`${NAME}=${A}`);
    }
    expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://evil.example/' -H 'Cookie: ${NAME}=${A}'`) }, contract).ok).toBe(false);
    expect(buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`${NAME}.0=${A}`) }, contract).ok).toBe(false);
  });

  it("updates only the paired account and refuses wrong provider, origin, expiry and localStorage", async () => {
    const first = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "First", apiKey: `${NAME}=${A}`, isActive: true }, { createOnly: true });
    const second = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "Second", apiKey: `${NAME}=${B}`, isActive: true }, { createOnly: true });
    const wrong = await createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Wrong", apiKey: "sso=synthetic", isActive: true }, { createOnly: true });
    state.access.mockResolvedValueOnce(false);
    expect((await pair(req(`${DASH}/api/providers/cookie-import/pairing`, { provider: "blackbox-web", action: "create", name: "Denied" }, { origin: DASH }))).status).toBe(403);
    const denied = await pair(req(`${DASH}/api/providers/cookie-import/pairing`, { provider: "blackbox-web", action: "update", connectionId: wrong.id }, { origin: DASH }));
    expect(denied.status).toBe(409);
    for (const extra of [{ origin: "https://evil.example", cookies: [cookie(B)] }, { origin: ORIGIN, cookies: [cookie(B, { expirationDate: 1 })] }, { origin: ORIGIN, cookies: [cookie(B)], localStorage: { token: B } }, { origin: ORIGIN, connectionId: second.id, cookies: [cookie(B)] }]) {
      const p = await issue({ provider: "blackbox-web", action: "update", connectionId: first.id });
      const response = await submit(p.token, { provider: "blackbox-web", connectionId: first.id, ...extra });
      expect(response.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(await response.json())).not.toContain(B);
    }
    const p = await issue({ provider: "blackbox-web", action: "update", connectionId: first.id });
    const response = await submit(p.token, { provider: "blackbox-web", origin: ORIGIN, connectionId: first.id, cookies: [cookie(B)] });
    expect(response.status).toBe(200); expect(JSON.stringify(await response.json())).not.toContain(B);
    expect((await getProviderConnectionById(first.id)).apiKey).toBe(`${NAME}=${B}`);
    expect((await getProviderConnectionById(second.id)).apiKey).toBe(`${NAME}=${B}`);
  });
});

// The public fixture unloads the legacy adapter mocks and uses the real database and routes.
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";
describe("blackbox-web imported accounts through public routes", () => {
  let flow;
  const candidate = (value) => ({ origin: ORIGIN, cookies: [{ name: NAME, value }] });
  const dispatch = (options = {}) => flow.dispatch({ model: "blackbox-web/gpt-4", ...options });
  beforeEach(async () => { flow = await cookiePublicFlow2034("blackbox-web"); });
  afterEach(async () => { await flow?.close(); });
  async function accounts() {
    const a = await flow.imported({ action: "create", name: "Public A" }, candidate(A));
    const b = await flow.imported({ action: "create", name: "Public B" }, candidate(B));
    return { a, b, da: await flow.bind(a.id, "a"), db: await flow.bind(b.id, "b") };
  }
  function vendor(url) {
    return String(url).endsWith("/api/auth/session") ? Response.json({}) : new Response("synthetic public answer");
  }
  function snapshot(value, dispatcher) {
    expect(flow.network.mock.calls.map(([url]) => String(url))).toEqual([`${ORIGIN}/api/auth/session`, `${ORIGIN}/api/chat`]);
    for (const [, init] of flow.network.mock.calls) {
      expect(init.headers.Cookie).toBe(`${NAME}=${value}`);
      expect(init.dispatcher).toBe(dispatcher);
    }
    const body = JSON.parse(flow.network.mock.calls[1][1].body);
    expect(body.messages[0].content).toBe("synthetic question");
    expect(body.userSelectedModel).toBe("gpt-4");
  }
  it.each([false, true].flatMap((anthropic) => [false, true].flatMap((stream) => ["a", "b"].map((label) => [anthropic, stream, label]))))(
    "pins account %s/%s/%s through the public route", async (anthropic, stream, label) => {
      const { a, b, da, db } = await accounts();
      flow.network.mockImplementation(vendor);
      const response = await dispatch({ anthropic, stream, id: label === "a" ? a.id : b.id });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("synthetic public answer");
      snapshot(label === "a" ? A : B, label === "a" ? da : db);
      const listed = await (await flow.list()).text();
      for (const secret of [A, B]) {
        expect(listed).not.toContain(secret);
        expect(text).not.toContain(secret);
        expect(JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls))).not.toContain(secret);
      }
    }
  );
  it.each(["header", "curl", "har"])("dispatches a persisted %s candidate", async (kind) => {
    const parsed = kind === "header" ? parseCookieHeaderValue(`Cookie: ${NAME}=${A}`) : kind === "curl" ? parseCurlCommand(`curl '${ORIGIN}/api/chat' -H 'Cookie: ${NAME}=${A}'`) : parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${ORIGIN}/api/chat`, cookies: [{ name: NAME, value: A }] } }] } }));
    const built = buildImportCandidates({ kind, parsed }, getCookieImportContract("blackbox-web"));
    expect(built.ok).toBe(true);
    const row = await flow.imported({ action: "create", name: `Parsed ${kind}` }, built.candidates[0]);
    expect(row.apiKey).toBe(`${NAME}=${A}`);
    const dispatcher = await flow.bind(row.id, kind);
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ id: row.id });
    expect(response.status, await response.text()).toBe(200);
    snapshot(A, dispatcher);
  });
  it("updates the paired account and refuses a different connection without writing", async () => {
    const { a, b, db } = await accounts();
    const before = await flow.db.getProviderConnectionById(a.id);
    const pairing = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(pairing, { ...candidate(B), connectionId: b.id })).status).toBe(409);
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    await flow.imported({ action: "update", connectionId: b.id }, candidate("synthetic-replacement"));
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ id: b.id });
    expect(response.status, await response.text()).toBe(200);
    snapshot("synthetic-replacement", db);
  });
  it.each([401, 429, 502])("does not rotate a pinned account after session HTTP %s", async (status) => {
    const { a, da } = await accounts();
    flow.network.mockImplementation(() => new Response("refused", { status }));
    const response = await dispatch({ id: a.id, stream: true });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(flow.network.mock.calls.map(([url]) => String(url))).toEqual([`${ORIGIN}/api/auth/session`]);
    expect(flow.network.mock.calls[0][1].headers.Cookie).toBe(`${NAME}=${A}`);
    expect(flow.network.mock.calls[0][1].dispatcher).toBe(da);
  });
  it("falls back after a session authentication refusal", async () => {
    const { a, b, da, db } = await accounts();
    await flow.db.updateProviderConnection(a.id, { priority: 1 });
    await flow.db.updateProviderConnection(b.id, { priority: 2 });
    flow.network.mockResolvedValueOnce(new Response("refused", { status: 401 })).mockImplementation(vendor);
    const response = await dispatch();
    expect(response.status, await response.text()).toBe(200);
    expect(flow.network.mock.calls.map(([, init]) => [init.headers.Cookie, init.dispatcher])).toEqual([
      [`${NAME}=${A}`, da], [`${NAME}=${B}`, db], [`${NAME}=${B}`, db],
    ]);
  });
  it("does not replay a rejected chat transport with an uncertain outcome", async () => {
    const { a, da } = await accounts();
    flow.network.mockImplementation((url) => String(url).endsWith("/api/auth/session") ? Response.json({}) : Promise.reject(new Error("synthetic transport failure")));
    const response = await dispatch({ id: a.id, stream: true });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]");
    expect(flow.network.mock.calls.map(([url]) => String(url))).toEqual([`${ORIGIN}/api/auth/session`, `${ORIGIN}/api/chat`]);
    for (const [, init] of flow.network.mock.calls) {
      expect(init.headers.Cookie).toBe(`${NAME}=${A}`);
      expect(init.dispatcher).toBe(da);
    }
  });
  it.each([["foreign origin", { origin: "https://foreign.example" }], ["expired cookie", { cookies: [cookie(A, { expirationDate: 1 })] }], ["localStorage", { localStorage: { token: A } }]])("refuses %s without a write", async (_label, change) => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const pairing = await flow.issue({ action: "update", connectionId: a.id });
    const response = await flow.submit(pairing, { ...candidate(A), connectionId: a.id, ...change });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain(A);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    expect(flow.network).not.toHaveBeenCalled();
  });
});

// Acceptance for the request-safety repair. Synthetic transport only: controlled bodies and
// abort controllers stand in for the provider; nothing here establishes live Blackbox behavior.
describe("blackbox-web public request safety", () => {
  let flow;
  const SESSION = `${ORIGIN}/api/auth/session`, CHAT = `${ORIGIN}/api/chat`;
  const SECRETS = [A, B, "synthetic socket detail", "synthetic provider detail"];
  const dispatch = (options = {}) => flow.dispatch({ model: "blackbox-web/gpt-4", ...options });
  const urls = () => flow.network.mock.calls.map(([url]) => String(url));
  const cookies = () => flow.network.mock.calls.map(([, init]) => [init.headers.Cookie, init.dispatcher]);
  const chat = (answer) => (url) => String(url).endsWith("/api/auth/session") ? Response.json({}) : answer(url);
  beforeEach(async () => { flow = await cookiePublicFlow2034("blackbox-web"); });
  afterEach(async () => { await flow?.close(); flow = undefined; });
  async function accounts({ key = false } = {}) {
    const a = await flow.imported({ action: "create", name: "Safety A" }, { origin: ORIGIN, cookies: [{ name: NAME, value: A }] });
    const b = await flow.imported({ action: "create", name: "Safety B" }, { origin: ORIGIN, cookies: [{ name: NAME, value: B }] });
    await flow.db.updateProviderConnection(a.id, { priority: 1 });
    await flow.db.updateProviderConnection(b.id, { priority: 2 });
    const bound = { a, b, da: await flow.bind(a.id, "a"), db: await flow.bind(b.id, "b"), headers: {} };
    if (key) {
      const stored = await flow.db.createApiKey("blackbox", "synthetic-machine", [], null, null, { providerConnectionIds: [a.id, b.id] });
      await flow.db.updateSettings({ requireApiKey: true });
      bound.headers = { authorization: `Bearer ${stored.key}` };
      bound.key = stored;
    }
    return bound;
  }
  function redacted(text, secrets = SECRETS) {
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
      expect(JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls))).not.toContain(A);
      expect(JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls))).not.toContain(B);
    }
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(text).not.toContain('"stop_reason":"end_turn"');
  }
  // Unproven work never yields a successful usage row or a duplicate receipt. The single
  // unknown-cost receipt is owned by the separate accounting activation, not asserted here.
  const noSuccessUsage = () => {
    const rows = flow.usage.mock.calls.map(([row]) => row);
    expect(rows.filter((row) => row?.status !== "error")).toEqual([]);
    expect(rows.length).toBeLessThanOrEqual(1);
  };
  const matrix = [false, true].flatMap((anthropic) => [false, true].map((stream) => [anthropic, stream]));

  it.each(matrix)("authorizes a stored client key and serves both accounts anthropic=%s stream=%s", async (anthropic, stream) => {
    const { a, b, da, db, headers, key } = await accounts({ key: true });
    expect((await dispatch({ anthropic, stream, id: a.id })).status).toBe(401);
    expect(flow.network).not.toHaveBeenCalled();
    flow.network.mockImplementation(chat(() => new Response("synthetic safe answer")));
    for (const [row, value, dispatcher] of [[a, A, da], [b, B, db]]) {
      flow.network.mockClear();
      const response = await dispatch({ anthropic, stream, id: row.id, headers });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("synthetic safe answer");
      expect(urls()).toEqual([SESSION, CHAT]);
      expect(cookies()).toEqual([[`${NAME}=${value}`, dispatcher], [`${NAME}=${value}`, dispatcher]]);
      expect(text).not.toContain(value);
    }
    // A completed turn does record a non-error row for the admitted key, so the
    // no-success-row checks below can tell success from refusal.
    await vi.waitFor(() => expect(flow.usage.mock.calls.map(([row]) => row).filter((row) => row?.status !== "error" && row?.apiKeyId === key.id).length).toBeGreaterThan(0));
  });

  it.each([["HTML", () => new Response("<!doctype html><title>Sign in</title>", { headers: { "content-type": "text/html" } })], ["malformed JSON", () => new Response("{synthetic", { headers: { "content-type": "application/json" } })], ["array JSON", () => Response.json([])], ["session 503", () => new Response("synthetic provider detail", { status: 503 })]])(
    "stops a %s session answer before the billable chat without replay", async (_label, answer) => {
      const { headers } = await accounts({ key: true });
      flow.network.mockImplementation(answer);
      const response = await dispatch({ stream: true, headers });
      const text = await response.text();
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(urls()).toEqual([SESSION]);
      redacted(text);
      noSuccessUsage();
    }
  );

  it.each([401, 403, 429])("keeps sibling fallback after an explicit chat HTTP %s refusal", async (status) => {
    const { da, db, headers } = await accounts({ key: true });
    let chats = 0;
    flow.network.mockImplementation(chat(() => (++chats === 1 ? new Response("synthetic provider detail", { status }) : new Response("synthetic safe answer"))));
    const response = await dispatch({ headers });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(urls()).toEqual([SESSION, CHAT, SESSION, CHAT]);
    expect(cookies()).toEqual([[`${NAME}=${A}`, da], [`${NAME}=${A}`, da], [`${NAME}=${B}`, db], [`${NAME}=${B}`, db]]);
  });

  it("falls back after a session rate limit that never reached the chat", async () => {
    const { da, db, headers } = await accounts({ key: true });
    flow.network.mockResolvedValueOnce(new Response("synthetic provider detail", { status: 429 })).mockImplementation(chat(() => new Response("synthetic safe answer")));
    const response = await dispatch({ headers });
    expect(response.status, await response.text()).toBe(200);
    expect(urls()).toEqual([SESSION, SESSION, CHAT]);
    expect(cookies().map(([, dispatcher]) => dispatcher)).toEqual([da, db, db]);
  });

  const uncertainAnswers = [
    ["connection reset", () => Promise.reject(Object.assign(new Error("synthetic socket detail"), { code: "ECONNRESET" }))],
    ["HTTP 500", () => new Response("synthetic provider detail", { status: 500 })],
    ["HTTP 502", () => new Response("synthetic provider detail", { status: 502 })],
    ["HTML 200", () => new Response("<html><body>synthetic provider detail</body></html>", { headers: { "content-type": "text/html" } })],
    ["untyped HTML 200", () => new Response("<!DOCTYPE html><p>synthetic provider detail</p>")],
    ["empty 200", () => new Response("")],
    ["partial body then reset", () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("synthetic partial")); controller.error(new Error("synthetic socket detail")); } }))],
    ["stalled body deadline", () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("synthetic partial")); } }))],
  ];
  it.each(uncertainAnswers.flatMap(([label, answer]) => matrix.map(([anthropic, stream]) => [label, anthropic, stream, answer])))(
    "never replays or completes an uncertain chat (%s) anthropic=%s stream=%s", async (label, anthropic, stream, answer) => {
      const { da, headers } = await accounts({ key: true });
      flow.network.mockImplementation(chat(answer));
      const response = await dispatch({ anthropic, stream, headers });
      const text = await response.text();
      expect(response.status, text).toBeGreaterThanOrEqual(500);
      if (label === "stalled body deadline") expect(response.status).toBe(504);
      expect(urls()).toEqual([SESSION, CHAT]);
      expect(cookies()).toEqual([[`${NAME}=${A}`, da], [`${NAME}=${A}`, da]]);
      expect(text).not.toContain("synthetic partial");
      // An unreadable body keeps the shared throw-and-settle transport contract, and the shared
      // chatCore formatter then shows the socket message (credential-sanitized). Cookies and
      // provider body text stay redacted; the socket-text gap is recorded in the port report.
      redacted(text, label === "partial body then reset" ? SECRETS.filter((secret) => secret !== "synthetic socket detail") : SECRETS);
      noSuccessUsage();
    }
  );

  it.each([false, true])("does not replay a chat aborted by the client after dispatch stream=%s", async (stream) => {
    const { a, headers } = await accounts({ key: true });
    const controller = new AbortController();
    let sent;
    const dispatched = new Promise((resolve) => { sent = resolve; });
    flow.network.mockImplementation(chat((_url) => new Response(new ReadableStream({ start(body) { body.enqueue(new TextEncoder().encode("synthetic partial")); sent(); } }))));
    const pending = dispatch({ stream, id: a.id, headers, signal: controller.signal });
    await dispatched;
    controller.abort();
    const response = await pending;
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(urls()).toEqual([SESSION, CHAT]);
    expect(text).not.toContain("synthetic partial");
    redacted(text);
    noSuccessUsage();
  });
});
