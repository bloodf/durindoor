import fs from "node:fs";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { describe } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tencent-cookie-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, original, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as ingest } from "../../src/app/api/providers/cookie-import/route.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { prepareCapture, runCapture, confirmationFor, describePlan } from "../../extensions/provider-cookie-capture/capture.js";
import { TencentAIStudioWebExecutor } from "../../open-sse/executors/tencent-aistudio-web.js";

const provider = "tencent-aistudio-web", origin = "https://aistudio.tencent.ai", dashboard = "https://dashboard.example";
const secret = "synthetic-tencent-session", other = "synthetic-other-session";
let db, logs;
const req = (path, body, headers = {}) => new NextRequest(dashboard + path, { method: "POST", headers: { "content-type": "application/json", origin: dashboard, "x-9r-cli-token": "operator-one", ...headers }, body: JSON.stringify(body) });
async function issue(target) {
  const res = await pair(req("/api/providers/cookie-import/pairing", { provider, ...target }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const body = (extra = {}) => ({ provider, origin, cookies: [{ name: "sessionid", value: secret, domain: "aistudio.tencent.ai", secure: true }], ...extra });
const submit = (token, payload) => ingest(req("/api/providers/cookie-import", payload, { "x-durindoor-pairing-token": token }));

describe("original capture and parser evidence", () => {
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard); vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

it("captures the real pairing in the tab's cookie store, imports it, and sends only that stored account to the executor", async () => {
  const pairing = await issue({ action: "create", name: "Captured" });
  expect(pairing.contract).toMatchObject({ origin, cookieNames: ["sessionid"], cookiePrefixes: [] });
  const held = new Set(), reads = [];
  const names = (q) => [...(q.permissions || []), ...(q.origins || [])];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: origin + "/chat" }], get: async () => ({ id: 7, url: origin + "/chat" }) },
    permissions: { contains: async (q) => names(q).every((n) => held.has(n)), request: async (q) => { names(q).forEach((n) => held.add(n)); return true; }, remove: async (q) => { names(q).forEach((n) => held.delete(n)); return true; } },
    cookies: { getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "selected", tabIds: [7] }], get: async (q) => { reads.push(q); return { name: "sessionid", value: secret, domain: "aistudio.tencent.ai", secure: true }; }, getAll: async () => { throw Error("unexpected enumeration"); } },
    scripting: { executeScript: async () => { throw Error("unexpected localStorage read"); } },
  };
  const prepared = await prepareCapture({ chrome, text: JSON.stringify({ pairing }) });
  expect(prepared.ok).toBe(true);
  expect(describePlan(prepared.plan)).toMatchObject({ cookieNames: ["sessionid"], optionalCookies: [], localStorageKeys: [] });
  const send = vi.fn(async (url, init) => ingest(new NextRequest(url, init)));
  expect((await runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: {}, now: Date.now })).code).toBe("not_confirmed");
  expect(reads).toHaveLength(0);
  const captured = await runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: confirmationFor(prepared.plan), now: Date.now });
  expect(captured.ok).toBe(true);
  expect(reads).toEqual([{ url: origin + "/", name: "sessionid", storeId: "selected" }]);
  expect(held.size).toBe(0); expect(send).toHaveBeenCalledTimes(1);
  const rows = db.all("SELECT * FROM providerConnections");
  expect(rows).toHaveLength(1); expect(rows[0].data).not.toContain(secret);
  const selected = await getProviderConnectionById(rows[0].id);
  const second = await createProviderConnection({ provider, authType: "cookie", name: "Other", apiKey: `sessionid=${other}`, isActive: true }, { createOnly: true });
  expect(selected.apiKey).toBe(`sessionid=${secret}`);
  const calls = [];
  const result = await new TencentAIStudioWebExecutor().runSession({ model: "hy3-g", body: { messages: [{ role: "user", content: "ping" }] }, credentials: selected, stream: false }, { sendBillable: async (url, init) => { calls.push({ url, init }); return Response.json({ choices: [] }); } });
  expect(calls).toHaveLength(1); expect(calls[0].url).toBe(origin + "/api/chat/HunyuanDefault");
  expect(calls[0].init.headers.cookie).toBe(`sessionid=${secret}`); expect(calls[0].init.headers.cookie).not.toContain(other);
  expect((await getProviderConnectionById(second.id)).apiKey).toBe(`sessionid=${other}`);
  expect(result.headers.cookie).toBe("[REDACTED]");
  expect(JSON.stringify(captured)).not.toContain(secret); expect(JSON.stringify(captured)).not.toContain(pairing.token);
  expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(secret);
});

it("parses header, cURL and HAR with the real contract and refuses foreign origins and chunks", () => {
  const contract = getCookieImportContract(provider);
  const har = JSON.stringify({ log: { entries: [{ request: { url: origin + "/api/chat", headers: [{ name: "Cookie", value: `sessionid=${secret}; noise=x` }], cookies: [] } }] } });
  for (const [kind, parsed] of [["header", parseCookieHeaderValue(`Cookie: sessionid=${secret}; noise=x`)], ["curl", parseCurlCommand(`curl '${origin}/api/chat' -H 'Cookie: sessionid=${secret}; noise=x'`)], ["har", parseHarDocument(har)]]) {
    expect(parsed.ok).toBe(true);
    const built = buildImportCandidates({ kind, parsed }, contract);
    expect(built.ok).toBe(true); expect(built.candidates[0].cookies).toEqual([{ name: "sessionid", value: secret }]);
  }
  const foreign = buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://foreign.example/' -H 'Cookie: sessionid=${secret}'`) }, contract);
  expect(foreign.ok).toBe(false); expect(foreign.error).toMatch(/origin/i);
  const chunks = buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue(`sessionid.0=${secret}`) }, contract);
  expect(chunks.ok).toBe(false); expect(chunks.error).toMatch(/sessionid/i);
});

it("binds updates to the selected provider and rejects invalid origin, expiry and unapproved fields", async () => {
  state.access.mockResolvedValueOnce(false);
  expect((await pair(req("/api/providers/cookie-import/pairing", { provider, action: "create", name: "Denied" }))).status).toBe(403);
  const existing = await createProviderConnection({ provider, authType: "cookie", name: "Existing", apiKey: `sessionid=${other}`, isActive: true }, { createOnly: true });
  const wrong = await createProviderConnection({ provider: "grok-web", authType: "cookie", name: "Wrong", apiKey: "sso=synthetic", isActive: true }, { createOnly: true });
  expect((await pair(req("/api/providers/cookie-import/pairing", { provider, action: "update", connectionId: wrong.id }))).status).toBe(409);
  for (const invalid of [body({ origin: "https://foreign.example" }), body({ cookies: [{ name: "sessionid", value: secret, expirationDate: 1 }] }), body({ cookies: [{ name: "sessionid.0", value: secret }] }), body({ localStorage: { token: secret } })]) {
    const p = await issue({ action: "create", name: "Invalid" });
    const res = await submit(p.token, invalid);
    expect(res.status).toBe(400); expect(await res.text()).not.toContain(secret);
  }
  const p = await issue({ action: "update", connectionId: existing.id });
  const res = await submit(p.token, body({ connectionId: existing.id }));
  expect(res.status).toBe(200); expect(await res.text()).not.toContain(secret);
  expect((await getProviderConnectionById(existing.id)).apiKey).toBe(`sessionid=${secret}`);
  expect((await getProviderConnectionById(wrong.id)).apiKey).toBe("sso=synthetic");
  expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(secret);
});

});

// Public-route evidence deliberately unloads the legacy adapter mocks above.
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";
describe("Tencent imported accounts through public routes", () => {
  let flow;
  beforeEach(async () => {
    flow = await cookiePublicFlow2034(provider);
    const dispatch = flow.dispatch;
    flow.dispatch = (options) => dispatch({ model: `${provider}/hy3-g`, ...options });
  });
  afterEach(async () => { await flow?.close(); });
  const candidate = (value) => ({ origin, cookies: [{ name: "sessionid", value }] });
  const vendorJson = () => Response.json({ id: "synthetic-completion", object: "chat.completion", model: "hy3-g", choices: [{ index: 0, message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }] });
  const vendorSse = () => new Response('data: {"id":"synthetic-completion","object":"chat.completion.chunk","model":"hy3-g","choices":[{"index":0,"delta":{"content":"fixture answer"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  async function accounts() {
    const a = await flow.imported({ action: "create", name: "Public A" }, candidate(secret));
    const b = await flow.imported({ action: "create", name: "Public B" }, candidate(other));
    return { a, b, da: await flow.bind(a.id, "a"), db: await flow.bind(b.id, "b") };
  }
  function snapshot(cookie, dispatcher, stream) {
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
    const [url, init] = flow.network.mock.calls[0];
    expect(String(url)).toBe(origin + "/api/chat/HunyuanDefault");
    expect(init.dispatcher).toBe(dispatcher);
    expect(init.headers.cookie).toBe(`sessionid=${cookie}`);
    expect(init.headers.origin).toBe(origin);
    // Credentialed proxy transport upgrades manual to error: redirects cannot forward cookies.
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toEqual({ model: "HunyuanDefault", messages: [{ role: "user", content: "synthetic question" }], stream });
  }
  it.each([false, true].flatMap((anthropic) => [false, true].flatMap((stream) => ["a", "b"].map((label) => [anthropic, stream, label]))))("pins imported account through public route anthropic=%s stream=%s account=%s", async (anthropic, stream, label) => {
    const { a, b, da, db: dbDispatcher } = await accounts();
    const selected = label === "a" ? a : b;
    const value = label === "a" ? secret : other;
    const dispatcher = label === "a" ? da : dbDispatcher;
    flow.network.mockImplementation(stream ? vendorSse : vendorJson);
    const response = await flow.dispatch({ anthropic, stream, id: selected.id });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("fixture answer");
    snapshot(value, dispatcher, stream);
    expect((await flow.db.getProviderConnectionById(a.id)).apiKey).toBe(`sessionid=${secret}`);
    const listed = await (await flow.list()).text();
    for (const value of [secret, other]) {
      expect(listed).not.toContain(value);
      expect(text).not.toContain(value);
      expect(JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls))).not.toContain(value);
    }
  });
  it.each(["header", "curl", "har"])("persists parsed %s before a real public dispatch", async (kind) => {
    const contract = getCookieImportContract(provider);
    const parsed = kind === "header" ? parseCookieHeaderValue(`Cookie: sessionid=${secret}`) : kind === "curl" ? parseCurlCommand(`curl '${origin}/api/chat' -H 'Cookie: sessionid=${secret}'`) : parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: origin + "/api/chat", headers: [{ name: "Cookie", value: `sessionid=${secret}` }] } }] } }));
    const built = buildImportCandidates({ kind, parsed }, contract);
    expect(built.ok).toBe(true);
    const row = await flow.imported({ action: "create", name: `Parsed ${kind}` }, built.candidates[0]);
    expect(row.apiKey).toBe(`sessionid=${secret}`);
    const dispatcher = await flow.bind(row.id, kind);
    flow.network.mockImplementation(vendorJson);
    const response = await flow.dispatch({ id: row.id });
    expect(response.status, await response.text()).toBe(200);
    snapshot(secret, dispatcher, false);
  });
  it("updates only the paired connection and refuses foreign ownership without a write", async () => {
    const { a, b, db: dispatcher } = await accounts();
    const before = await flow.db.getProviderConnectionById(a.id);
    const p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...candidate("synthetic-replacement"), connectionId: b.id })).status).toBe(409);
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    await flow.imported({ action: "update", connectionId: b.id }, candidate("synthetic-replacement"));
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    flow.network.mockImplementation(vendorJson);
    expect((await flow.dispatch({ id: b.id })).status).toBe(200);
    snapshot("synthetic-replacement", dispatcher, false);
  });
  it.each([[401, "expired"], [429, "quota"], [502, "error"]])("returns upstream %s without success terminal or pinned-account rotation", async (status) => {
    const { a, da } = await accounts();
    flow.network.mockImplementation(() => Response.json({ error: "synthetic refusal" }, { status }));
    const response = await flow.dispatch({ stream: true, id: a.id });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    snapshot(secret, da, true);
  });
  /**
   * An HTTP 200 that looks like a sign-in page does not prove the vendor did no billable
   * work: no source-backed protocol says the chat POST was refused. It is an unusable 2xx
   * with an unknown outcome, so exactly one POST is sent, on the pinned account and its own
   * strict proxy, and the caller gets the HTML error page error.
   */
  it("refuses a pinned 200 HTML sign-in page without leaving the pinned account or proxy", async () => {
    const { a, da } = await accounts();
    flow.network.mockImplementation(() => new Response("<html>sign in</html>", { headers: { "content-type": "application/json" } }));
    const response = await flow.dispatch({ id: a.id });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(400);
    expect(text).toMatch(/HTML error page/);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain("fixture answer");
    const calls = flow.network.mock.calls;
    expect(calls).toHaveLength(1);
    for (const [url, init] of calls) {
      expect(String(url)).toBe(origin + "/api/chat/HunyuanDefault");
      expect(init.headers.cookie).toBe(`sessionid=${secret}`);
      expect(init.dispatcher).toBe(da);
    }
    expect(text).not.toContain(secret);
  });
  // Required safety assertions remain ordinary tests if the current product violates them.
  // A 200 whose body is unreadable is accepted vendor work with an unknown outcome: never replay it.
  it.each([["malformed JSON", "{broken"]])("refuses a 200 %s body without a success terminal", async (_label, payload) => {
    const { a } = await accounts();
    flow.network.mockImplementation(() => new Response(payload, { headers: { "content-type": "application/json" } }));
    const response = await flow.dispatch({ id: a.id });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]");
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["foreign origin", { origin: "https://foreign.example" }],
    ["expired metadata", { cookies: [{ name: "sessionid", value: secret, expirationDate: 1 }] }],
    ["unsupported localStorage", { localStorage: { token: secret } }],
    ["unsupported chunks", { cookies: [{ name: "sessionid.0", value: secret }] }],
  ])("refuses %s through import without changing either stored account", async (_label, change) => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const p = await flow.issue({ action: "update", connectionId: a.id });
    const response = await flow.submit(p, { ...candidate(secret), connectionId: a.id, ...change });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(secret);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    expect(flow.network).not.toHaveBeenCalled();
  });
  it("falls back to the other imported account only after an explicit 401 refusal", async () => {
    const { a, b, da, db: dispatcher } = await accounts();
    await flow.db.updateProviderConnection(a.id, { priority: 1 });
    await flow.db.updateProviderConnection(b.id, { priority: 2 });
    flow.network.mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 })).mockImplementation(vendorJson);
    const response = await flow.dispatch();
    expect(response.status, await response.text()).toBe(200);
    expect(flow.network.mock.calls.map(([, init]) => [init.headers.cookie, init.dispatcher])).toEqual([[`sessionid=${secret}`, da], [`sessionid=${other}`, dispatcher]]);
  });
  it("does not replay uncertain accepted work after the network rejects", async () => {
    await accounts();
    flow.network.mockRejectedValue(new TypeError("synthetic connection reset after dispatch"));
    const response = await flow.dispatch();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("[DONE]");
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
  });
  it("does not replay or emit success after partial text and a broken vendor stream", async () => {
    await accounts();
    let sent = false;
    flow.network.mockImplementation(() => new Response(new ReadableStream({
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial fixture"},"finish_reason":null}]}\n\n')); }
        else controller.error(new TypeError("synthetic body failure"));
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    const response = await flow.dispatch({ stream: true });
    let text = "";
    const reader = response.body.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { /* Preserve any text delivered before failure. */ }
    expect(sent).toBe(true);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
  });
  it("honors caller abort after dispatch without replay", async () => {
    await accounts();
    const controller = new AbortController();
    flow.network.mockImplementation(async (_url, init) => {
      controller.abort();
      throw init.signal.reason;
    });
    const response = await flow.dispatch({ signal: controller.signal });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("[DONE]");
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled buffered vendor body and never replays accepted work", async () => {
    await accounts();
    flow.network.mockImplementation(() => new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "application/json" } }));
    const response = await flow.dispatch();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("[DONE]");
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
  });

  it("refuses a foreign operator at pairing without writing", async () => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const response = await flow.pairResponse({ action: "update", connectionId: a.id }, "synthetic-foreign-owner");
    expect(response.status).toBe(403);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    expect(flow.network).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not turn a vendor SSE error into success anthropic=%s", async (anthropic) => {
    const { a } = await accounts();
    flow.network.mockImplementation(() => new Response('data: {"error":{"message":"synthetic quota refusal","type":"rate_limit_error"}}\n\n', { headers: { "content-type": "text/event-stream" } }));
    const response = await flow.dispatch({ anthropic, stream: true, id: a.id });
    const text = await response.text();
    expect(text).toContain("synthetic quota refusal");
    if (anthropic) {
      // Anthropic streams end on the error event. `[DONE]` is an OpenAI sentinel and has no
      // place in the Anthropic protocol, so it must not appear at all.
      expect(text.indexOf("event: error"), text).toBeGreaterThanOrEqual(0);
      expect(text).not.toContain("event: message_delta");
      expect(text).not.toContain("end_turn");
    }
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(text).not.toContain("event: message_stop");
    expect(flow.network, JSON.stringify(flow.network.mock.calls.map(([url, init]) => ({ url, cookie: init.headers.cookie, route: init.dispatcher?.label })))).toHaveBeenCalledTimes(1);
  });

  /**
   * MaxAI answers a connection reset after its chat POST with the same outcome-unknown
   * code. Two imported MaxAI accounts on distinct strict proxies: the reset attempt is
   * terminal and the sibling account is never dispatched.
   */
  it("never replays a MaxAI chat POST reset mid-send on the sibling imported account", async () => {
    await flow.close();
    flow = await cookiePublicFlow2034("maxai");
    const maxaiOrigin = "https://www.maxai.co", chatUrl = "https://api.maxai.me/gpt/cwc/chat";
    const signing = { hmacKey: "1a".repeat(32), aesKey: "2b".repeat(32), appVersion: "webpage_9.8.7", ctxKey: "3c".repeat(20) };
    const tuple = (tag) => ({ access_token: `synthetic.maxai-access-${tag}.signature`, device_id: `synthetic-device-${tag}`, user_id: `synthetic-user-${tag}` });
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const rows = [];
    for (const tag of ["alpha", "bravo"]) {
      const values = tuple(tag);
      const row = await flow.imported({ action: "create", name: `MaxAI ${tag}` }, { origin: maxaiOrigin, cookies: Object.entries(values).map(([name, value]) => ({ name, value, domain: "www.maxai.co", secure: true, expirationDate: expires })) });
      // Saved signing constants keep the setup page loads off the network boundary.
      await flow.db.updateProviderConnection(row.id, { providerSpecificData: { ...row.providerSpecificData, maxaiSigningConstants: signing } });
      rows.push({ row, values, dispatcher: await flow.bind(row.id, `maxai-${tag}`) });
    }
    flow.network.mockRejectedValue(new TypeError("synthetic connection reset after dispatch"));
    const response = await flow.dispatch({ model: "maxai/gpt-5.6" });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]");
    const calls = flow.network.mock.calls.map(([url, init]) => ({ url: String(url), bearer: new Headers(init.headers).get("authorization"), route: init.dispatcher?.label }));
    expect(calls, JSON.stringify(calls)).toHaveLength(1);
    const used = rows.find((entry) => calls[0].bearer === `Bearer ${entry.values.access_token}`);
    expect(used, JSON.stringify(calls)).toBeDefined();
    expect(calls[0]).toEqual({ url: chatUrl, bearer: `Bearer ${used.values.access_token}`, route: used.dispatcher.label });
    for (const entry of rows) for (const value of Object.values(entry.values)) expect(text).not.toContain(value);
  });

});
