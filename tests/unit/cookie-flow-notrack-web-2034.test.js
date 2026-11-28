import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notrack-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, adapter: vi.fn(), sync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.adapter, getAdapterSync: state.sync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { NotrackWebExecutor } from "../../open-sse/executors/notrack-web.js";

const dashboard = "https://dashboard.example";
const origin = "https://notrack.ai";
const values = { uid: "synthetic-uid", si_usr_id: "synthetic-user", si_ses_id: "synthetic-session", nt_session: "synthetic-optional" };
const header = Object.entries(values).map(([k, v]) => `${k}=${v}`).join("; ");
let db, logs;
const req = (path, body, headers = {}) => new NextRequest(`${dashboard}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function issue(body) {
  const res = await pair(req("/api/providers/cookie-import/pairing", body, { origin: dashboard, "x-9r-cli-token": "synthetic-operator" }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const submit = (token, body) => importCookies(req("/api/providers/cookie-import", body, { "x-durindoor-pairing-token": token }));
const cookies = () => Object.entries(values).map(([name, value]) => ({ name, value, domain: "notrack.ai", secure: true }));
const body = (extra = {}) => ({ provider: "notrack-web", origin, cookies: cookies(), ...extra });

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.adapter.mockReset().mockResolvedValue(db); state.sync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true); state.operator.mockReset().mockResolvedValue(true); state.origin.mockReset().mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((key) => vi.spyOn(console, key).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("NoTrack real capture to stored dispatch", () => {
  it("captures only the paired names, imports the selected account, and dispatches its stored credential", async () => {
    const other = await createProviderConnection({ provider: "notrack-web", authType: "cookie", name: "Other", apiKey: "uid=other; si_usr_id=other; si_ses_id=other", isActive: true }, { createOnly: true });
    const p = await issue({ provider: "notrack-web", action: "create", name: "Captured" });
    expect(p.contract).toMatchObject({ origin, cookieNames: ["uid", "si_usr_id", "si_ses_id"], cookiePrefixes: [], optionalCookies: ["nt_session"] });
    expect(p.contract.localStorageKeys || []).toEqual([]);
    const parsed = parsePairing(JSON.stringify({ pairing: p }));
    expect(parsed.ok).toBe(true);
    const plan = parsed.plan; plan.tabId = 7;
    const held = new Set(); const reads = [];
    const names = (q) => [...(q.permissions || []), ...(q.origins || [])];
    const chrome = {
      tabs: { query: async () => [{ id: 7, url: `${origin}/` }], get: async (id) => ({ id, url: `${origin}/` }) },
      permissions: { contains: async (q) => names(q).every((n) => held.has(n)), request: async (q) => { names(q).forEach((n) => held.add(n)); return true; }, remove: async () => true },
      cookies: { getAllCookieStores: async () => [{ id: "chosen", tabIds: [7] }], get: async (q) => { reads.push(q); return { name: q.name, value: values[q.name], domain: "notrack.ai", secure: true }; } },
      scripting: { executeScript: vi.fn() },
    };
    await preflightPermissions(chrome, plan);
    let responseText = "";
    const fetchImport = vi.fn(async (url, options) => {
      const response = await importCookies(new NextRequest(url, options));
      responseText = await response.clone().text();
      return response;
    });
    const result = await runCapture({ chrome, fetch: fetchImport, plan, confirmed: confirmationFor(plan) });
    expect(result.ok).toBe(true);
    expect(reads.map((r) => r.name)).toEqual(Object.keys(values));
    expect(reads.every((r) => r.storeId === "chosen")).toBe(true);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    const imported = JSON.parse(responseText).connection;
    const stored = await getProviderConnectionById(imported.id);
    expect(stored).toMatchObject({ provider: "notrack-web", name: "Captured", isActive: true, apiKey: header });
    expect((await getProviderConnectionById(other.id)).apiKey).toContain("uid=other");
    const fetcher = vi.fn(async () => new Response('data: {"type":"message","content":"ok"}\n\n'));
    const dispatched = await new NotrackWebExecutor(fetcher).execute({ body: { messages: [{ role: "user", content: "hello" }] }, credentials: stored, model: "notrack-c" });
    expect(dispatched.response.status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toBe("https://notrack.ai/api/dispatch");
    expect(fetcher.mock.calls[0][1].headers.cookie).toBe(header);
    expect(dispatched.headers.cookie).toBe("[REDACTED]");
    const output = responseText + JSON.stringify(result) + JSON.stringify(logs.flatMap((s) => s.mock.calls));
    for (const secret of [...Object.values(values), p.token]) expect(output).not.toContain(secret);
    expect(db.all("SELECT * FROM providerConnections").find((row) => row.id === imported.id).data).not.toContain(values.uid);
  });

  it.each(["header", "curl", "har"])("imports the selected %s parser candidate through the real handler", async (kind) => {
    const inputs = {
      header: () => parseCookieHeaderValue(`Cookie: ${header}; unrelated=synthetic-noise`),
      curl: () => parseCurlCommand(`curl '${origin}/api/dispatch' -H 'Cookie: ${header}; unrelated=synthetic-noise'`),
      har: () => parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/api/dispatch`, headers: [{ name: "Cookie", value: `${header}; unrelated=synthetic-noise` }], cookies: [] } }] } })),
    };
    const parsed = inputs[kind]();
    expect(parsed.ok).toBe(true);
    const candidates = buildImportCandidates({ kind, parsed }, getCookieImportContract("notrack-web"));
    expect(candidates.ok).toBe(true);
    expect(candidates.candidates[0].dropped).toEqual(["unrelated"]);
    const p = await issue({ provider: "notrack-web", action: "create", name: kind });
    const res = await submit(p.token, body({ cookies: candidates.candidates[0].cookies }));
    expect(res.status).toBe(201);
    expect((await getProviderConnectionById((await res.json()).connection.id)).apiKey).toBe(header);
  });

  it("binds updates to the selected connection and refuses foreign origins and expired cookies", async () => {
    const a = await createProviderConnection({ provider: "notrack-web", authType: "cookie", name: "A", apiKey: "uid=old-a", isActive: true }, { createOnly: true });
    const b = await createProviderConnection({ provider: "notrack-web", authType: "cookie", name: "B", apiKey: "uid=old-b", isActive: true }, { createOnly: true });
    let p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    expect((await submit(p.token, body({ connectionId: b.id }))).status).toBe(409);
    p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    expect((await submit(p.token, body({ connectionId: a.id, origin: "https://notrack.ai.evil.example" }))).status).toBe(400);
    p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    const expired = cookies(); expired[0].expirationDate = 1;
    expect((await submit(p.token, body({ connectionId: a.id, cookies: expired }))).status).toBe(400);
    p = await issue({ provider: "notrack-web", action: "update", connectionId: a.id });
    expect((await submit(p.token, body({ connectionId: a.id }))).status).toBe(200);
    expect((await getProviderConnectionById(a.id)).apiKey).toBe(header);
    expect((await getProviderConnectionById(b.id)).apiKey).toBe("uid=old-b");
  });

  it("requires operator authority and rejects unapproved storage and chunk names", async () => {
    state.operator.mockResolvedValue(false);
    expect((await pair(req("/api/providers/cookie-import/pairing", { provider: "notrack-web", action: "create", name: "Denied" }, { origin: dashboard }))).status).toBe(403);
    state.operator.mockResolvedValue(true);
    let p = await issue({ provider: "notrack-web", action: "create", name: "Denied" });
    expect((await submit(p.token, body({ localStorage: { token: "synthetic-storage" } }))).status).toBe(400);
    p = await issue({ provider: "notrack-web", action: "create", name: "Denied" });
    expect((await submit(p.token, body({ cookies: [...cookies(), { name: "uid.0", value: "synthetic-chunk" }] }))).status).toBe(400);
    expect(db.all("SELECT * FROM providerConnections")).toHaveLength(0);
  });
});

// The public fixture unloads the adapter mocks above and exercises the real gateway.
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";
describe("NoTrack imported accounts through public routes", () => {
  let flow;
  const otherValues = { uid: "synthetic-uid-b", si_usr_id: "synthetic-user-b", si_ses_id: "synthetic-session-b", nt_session: "synthetic-optional-b" };
  const candidate = (v) => ({ origin, cookies: Object.entries(v).map(([name, value]) => ({ name, value, domain: "notrack.ai", secure: true })) });
  const cookie = (v) => Object.entries(v).map(([name, value]) => `${name}=${value}`).join("; ");
  const vendor = () => new Response('data: {"type":"delta","chunk":"fixture answer"}\n\n', { headers: { "content-type": "text/event-stream" } });
  beforeEach(async () => { flow = await cookiePublicFlow2034("notrack-web"); });
  afterEach(async () => { await flow?.close(); });
  async function accounts() {
    const a = await flow.imported({ action: "create", name: "Public A" }, candidate(values));
    const b = await flow.imported({ action: "create", name: "Public B" }, candidate(otherValues));
    const da = await flow.bind(a.id, "a"); const dbDispatcher = await flow.bind(b.id, "b");
    return { a, b, da, dbDispatcher };
  }
  function snapshot(v, dispatcher, index = 0) {
    const [url, init] = flow.network.mock.calls[index];
    expect(String(url)).toBe(`${origin}/api/dispatch`);
    expect(init.headers.cookie).toBe(cookie(v));
    expect(init.dispatcher).toBe(dispatcher);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body)).toMatchObject({ user_input: "[User]\nsynthetic question", model: "C" });
  }
  const dispatch = (options = {}) => flow.dispatch({ model: "notrack-web/notrack-c", ...options });
  it.each([false, true].flatMap((anthropic) => [false, true].flatMap((stream) => ["a", "b"].map((label) => [anthropic, stream, label]))))("pins public route anthropic=%s stream=%s account=%s", async (anthropic, stream, label) => {
    const { a, b, da, dbDispatcher } = await accounts();
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ anthropic, stream, id: label === "a" ? a.id : b.id });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("fixture answer");
    expect(flow.network).toHaveBeenCalledTimes(1);
    snapshot(label === "a" ? values : otherValues, label === "a" ? da : dbDispatcher);
    const listed = await (await flow.list()).text();
    const output = listed + text + JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls));
    for (const secret of [...Object.values(values), ...Object.values(otherValues)]) expect(output).not.toContain(secret);
  });
  it.each(["header", "curl", "har"])("persists parsed %s before public dispatch", async (kind) => {
    const parsed = kind === "header" ? parseCookieHeaderValue(`Cookie: ${header}`) : kind === "curl" ? parseCurlCommand(`curl '${origin}/api/dispatch' -H 'Cookie: ${header}'`) : parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/api/dispatch`, headers: [{ name: "Cookie", value: header }], cookies: [] } }] } }));
    const built = buildImportCandidates({ kind, parsed }, getCookieImportContract("notrack-web"));
    expect(built.ok).toBe(true);
    const row = await flow.imported({ action: "create", name: kind }, built.candidates[0]);
    expect(row.apiKey).toBe(header);
    const dispatcher = await flow.bind(row.id, kind);
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ id: row.id });
    expect(response.status, await response.text()).toBe(200);
    expect(flow.network).toHaveBeenCalledTimes(1);
    snapshot(values, dispatcher);
  });
  it("updates only the paired account and rejects a foreign owner", async () => {
    const { a, b, dbDispatcher } = await accounts();
    const before = await flow.db.getProviderConnectionById(a.id);
    const p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...candidate(otherValues), connectionId: b.id })).status).toBe(409);
    expect((await flow.pairResponse({ action: "update", connectionId: a.id }, "synthetic-foreign-owner")).status).toBe(403);
    await flow.imported({ action: "update", connectionId: b.id }, candidate(values));
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    flow.network.mockImplementation(vendor);
    expect((await dispatch({ id: b.id })).status).toBe(200);
    snapshot(values, dbDispatcher);
  });
  it.each([["foreign origin", { origin: "https://notrack.ai.evil.example" }], ["expired", { cookies: [{ ...candidate(values).cookies[0], expirationDate: 1 }, ...candidate(values).cookies.slice(1)] }], ["localStorage", { localStorage: { token: "synthetic-storage" } }]])("rejects %s without a write", async (_label, change) => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...candidate(values), connectionId: a.id, ...change })).status).toBe(400);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    expect(flow.network).not.toHaveBeenCalled();
  });
  it.each([401, 429, 502])("does not rotate a pinned account on HTTP %s", async (status) => {
    const { a, da } = await accounts();
    flow.network.mockImplementation(() => new Response("synthetic refusal", { status }));
    const response = await dispatch({ id: a.id, stream: true });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]"); expect(text).not.toContain('"finish_reason":"stop"');
    expect(flow.network).toHaveBeenCalledTimes(1); snapshot(values, da);
  });
  it("falls back only after an explicit 401 refusal", async () => {
    const { a, b, da, dbDispatcher } = await accounts();
    await flow.db.updateProviderConnection(a.id, { priority: 1 });
    await flow.db.updateProviderConnection(b.id, { priority: 2 });
    flow.network.mockResolvedValueOnce(new Response("refused", { status: 401 })).mockImplementation(vendor);
    const response = await dispatch();
    expect(response.status, await response.text()).toBe(200);
    expect(flow.network).toHaveBeenCalledTimes(2); snapshot(values, da, 0); snapshot(otherValues, dbDispatcher, 1);
  });
  it("does not replay a rejected network request with an uncertain outcome", async () => {
    await accounts();
    flow.network.mockRejectedValue(new TypeError("synthetic connection reset after dispatch"));
    const response = await dispatch();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("[DONE]");
    expect(flow.network).toHaveBeenCalledTimes(1);
  });
  it.each([["HTML", "<html>sign in</html>"], ["malformed", "data: {broken\n\n"], ["vendor error", 'data: {"type":"error","message":"synthetic quota refusal"}\n\n']])("rejects %s vendor body without a success terminal", async (_label, bodyText) => {
    const { a } = await accounts();
    flow.network.mockImplementation(() => new Response(bodyText, { headers: { "content-type": "text/event-stream" } }));
    const response = await dispatch({ id: a.id, stream: true });
    const text = await response.text();
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    expect(flow.network).toHaveBeenCalledTimes(1);
  });
  it("does not replay after partial text and a broken vendor body", async () => {
    await accounts();
    let sent = false;
    flow.network.mockImplementation(() => new Response(new ReadableStream({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('data: {"type":"delta","chunk":"partial fixture"}\n\n')); }
      else controller.error(new TypeError("synthetic body failure"));
    } }), { headers: { "content-type": "text/event-stream" } }));
    const response = await dispatch({ stream: true });
    let text = ""; const reader = response.body.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { /* Preserve delivered bytes. */ }
    expect(sent).toBe(true);
    expect(text).not.toContain("[DONE]"); expect(text).not.toContain('"finish_reason":"stop"');
    expect(flow.network).toHaveBeenCalledTimes(1);
  });
  it("honors caller abort without replay", async () => {
    await accounts(); const controller = new AbortController();
    flow.network.mockImplementation(async (_url, init) => { controller.abort(); throw init.signal.reason; });
    const response = await dispatch({ signal: controller.signal });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("[DONE]");
    expect(flow.network).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled buffered vendor body without replay", async () => {
    await accounts();
    flow.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) { setTimeout(() => { try { controller.close(); } catch { /* The body deadline already cancelled it. */ } }, 1500); } }), { headers: { "content-type": "text/event-stream" } }));
    const pending = dispatch();
    const result = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(null), 1000))]);
    if (!result) await pending;
    expect(result, "the 100ms body deadline must terminate the request").not.toBeNull();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(await result.text()).not.toContain("[DONE]");
    expect(flow.network).toHaveBeenCalledTimes(1);
  }, 10000);

  // Repair evidence. Each case below runs the real public route, gateway
  // selection, registry executor and stored proxy binding; only the vendor
  // transport answers with synthetic frames. None of it is live NoTrack proof.
  const sse = (text) => new Response(text, { headers: { "content-type": "text/event-stream" } });
  const formats = [false, true].flatMap((anthropic) => [false, true].map((stream) => [anthropic, stream]));
  async function ordered() {
    const set = await accounts();
    await flow.db.updateProviderConnection(set.a.id, { priority: 1 });
    await flow.db.updateProviderConnection(set.b.id, { priority: 2 });
    return set;
  }
  /** Read what a stream delivered before it broke; `failed` tells whether it ended in an error. */
  async function drain(response) {
    let text = "", failed = false;
    const reader = response.body.getReader();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } } catch { failed = true; }
    return { text, failed };
  }
  function noSecrets(text) {
    const output = text + JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls));
    for (const secret of [...Object.values(values), ...Object.values(otherValues)]) expect(output).not.toContain(secret);
  }
  const unusable = [
    ["HTML", () => sse("<html>sign in</html>"), "Notrack returned an unusable response"],
    ["malformed SSE", () => sse("data: {broken\n\n"), "Notrack returned an unusable response"],
    ["vendor error frame", () => sse('data: {"type":"error","message":"synthetic quota refusal"}\n\n'), "Notrack reported a generation failure"],
    ["HTTP 500", () => new Response("synthetic failure", { status: 500 }), "Notrack returned HTTP 500"],
    ["HTTP 502", () => new Response("synthetic failure", { status: 502 }), "Notrack returned HTTP 502"],
    ["transport reset", () => { throw new TypeError("synthetic connection reset after dispatch"); }, "Notrack connection failed"],
  ];
  it.each(unusable.flatMap(([label, make, message]) => formats.map(([anthropic, stream]) => [label, anthropic, stream, make, message])))("answers %s once with a fixed error and no fallback anthropic=%s stream=%s", async (_label, anthropic, stream, make, message) => {
    const { da } = await ordered();
    flow.network.mockImplementation(make);
    const response = await dispatch({ anthropic, stream });
    const text = await response.text();
    expect(response.status).toBe(502);
    const body = JSON.parse(text);
    expect(anthropic ? body.error.type : body.error.code).toBe(anthropic ? "api_error" : "bad_gateway");
    expect(body.error.message).toContain(message);
    expect(body.choices).toBeUndefined(); expect(body.content).toBeUndefined(); expect(body.usage).toBeUndefined();
    for (const marker of ["[DONE]", '"finish_reason":"stop"', "message_stop", "end_turn", "synthetic quota refusal", "synthetic failure"]) expect(text).not.toContain(marker);
    expect(flow.network).toHaveBeenCalledTimes(1); snapshot(values, da);
    expect(flow.usage).not.toHaveBeenCalled();
    noSecrets(text);
  });
  it.each([403, 429])("falls back only after an explicit %s refusal", async (status) => {
    const { da, dbDispatcher } = await ordered();
    flow.network.mockResolvedValueOnce(new Response("refused", { status })).mockImplementation(vendor);
    const response = await dispatch();
    expect(response.status, await response.text()).toBe(200);
    expect(flow.network).toHaveBeenCalledTimes(2); snapshot(values, da, 0); snapshot(otherValues, dbDispatcher, 1);
  });
  const midStream = [
    ["vendor error frame", 'data: {"type":"error","message":"synthetic quota refusal"}\n\n'],
    ["malformed frame", "data: {broken\n\n"],
    ["stalled body", null],
  ];
  it.each(midStream.flatMap(([label, tail]) => [false, true].map((anthropic) => [label, anthropic, tail])))("ends a stream with %s after partial text without a success terminal or replay anthropic=%s", async (_label, anthropic, tail) => {
    const { da } = await ordered(); const cancelled = vi.fn();
    flow.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"delta","chunk":"partial fixture"}\n\n'));
      if (tail) controller.enqueue(new TextEncoder().encode(tail));
    }, cancel: cancelled }), { headers: { "content-type": "text/event-stream" } }));
    const started = Date.now();
    const response = await dispatch({ anthropic, stream: true });
    expect(response.status).toBe(200);
    const { text, failed } = await drain(response);
    expect(Date.now() - started, "the 100ms idle body deadline must end a stalled stream").toBeLessThan(1000);
    expect(failed).toBe(true);
    expect(text).toContain("partial fixture");
    expect(cancelled, "the upstream body is cancelled once the stream fails").toHaveBeenCalled();
    for (const marker of ["[DONE]", '"finish_reason":"stop"', "message_stop", "end_turn", "synthetic quota refusal"]) expect(text).not.toContain(marker);
    expect(flow.network).toHaveBeenCalledTimes(1); snapshot(values, da);
    expect(flow.usage.mock.calls.map(([entry]) => entry.status)).not.toContain("success");
    noSecrets(text);
  }, 10000);
  it.each([false, true])("bounds a streamed body that stalls before any text without replay anthropic=%s", async (anthropic) => {
    const { da } = await ordered();
    const cancelled = vi.fn();
    flow.network.mockImplementation(() => new Response(new ReadableStream({ start(controller) { setTimeout(() => { try { controller.close(); } catch { /* The body deadline already cancelled it. */ } }, 1500); }, cancel: cancelled }), { headers: { "content-type": "text/event-stream" } }));
    const started = Date.now();
    const response = await dispatch({ anthropic, stream: true });
    const text = await response.text();
    expect(Date.now() - started, "the 100ms idle body deadline must end the request").toBeLessThan(1000);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(text).toContain("Notrack response body timed out");
    expect(text).not.toContain("[DONE]"); expect(text).not.toContain("message_stop");
    expect(cancelled).toHaveBeenCalled();
    expect(flow.network).toHaveBeenCalledTimes(1); snapshot(values, da);
  }, 10000);
  it("passes a caller abort during the buffered body read without replay", async () => {
    await ordered(); const controller = new AbortController();
    flow.network.mockImplementation(() => { setTimeout(() => controller.abort(), 20); return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), { headers: { "content-type": "text/event-stream" } }); });
    const response = await dispatch({ signal: controller.signal });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("[DONE]");
    expect(flow.network).toHaveBeenCalledTimes(1);
  });
  it.each(formats)("enforces client API key scopes on the public route anthropic=%s stream=%s", async (anthropic, stream) => {
    const { a, b, da, dbDispatcher } = await accounts();
    const keyA = await flow.db.createApiKey("a", "synthetic-machine", [], null, null, { providerConnectionIds: [a.id] });
    const keyB = await flow.db.createApiKey("b", "synthetic-machine", [], null, null, { providerConnectionIds: [b.id] });
    await flow.db.updateSettings({ requireApiKey: true });
    flow.network.mockImplementation(vendor);
    for (const [row, key, v, dispatcher] of [[a, keyA, values, da], [b, keyB, otherValues, dbDispatcher]]) {
      flow.network.mockClear();
      const response = await dispatch({ anthropic, stream, id: row.id, headers: { authorization: `Bearer ${key.key}` } });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("fixture answer");
      expect(flow.network).toHaveBeenCalledTimes(1); snapshot(v, dispatcher);
      expect(flow.usage.mock.calls.at(-1)[0]).toMatchObject({ apiKeyId: key.id });
      noSecrets(text + JSON.stringify(flow.usage.mock.calls));
    }
    flow.network.mockClear();
    for (const headers of [{ authorization: `Bearer ${keyB.key}` }, { authorization: "Bearer synthetic-invalid" }, {}]) {
      const response = await dispatch({ anthropic, stream, id: a.id, headers });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain("fixture answer");
    }
    expect(flow.network).not.toHaveBeenCalled();
  });

});
