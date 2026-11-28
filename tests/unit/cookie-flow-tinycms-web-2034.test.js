import fs from "node:fs";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const original = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tinycms-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, original, adapter: vi.fn(), adapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn(), fetch: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.adapter, getAdapterSync: state.adapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: state.fetch }));

import registry from "../../open-sse/providers/registry/index.js";
import { TinyCmsExecutor } from "../../open-sse/executors/tinycms-web.js";
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as ingest } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates, parseCookieHeaderValue, parseCurlCommand, parseHarDocument } from "../../src/shared/utils/cookieImportParser.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";

const site = "https://site.tinycms.xyz";
const dashboard = "https://dashboard.example";
const device = "Rsynthetic-2034-device";
let db, logs;
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.adapter.mockResolvedValue(db); state.adapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  state.fetch.mockReset();
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

it("carries a selected authenticated capture into the real executor without exposing the device", async () => {
  const descriptor = registry.find((entry) => entry.id === "tinycms-web");
  expect(descriptor.cookieImport).toMatchObject({ origin: site, cookieNames: [], localStorageKeys: ["app-config-uuid"], extensionCapture: true });
  const issued = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: descriptor.id, action: "create", name: "Selected" }, { origin: dashboard }));
  expect(issued.status).toBe(201);
  const pairing = (await issued.json()).pairing;
  const held = new Set();
  const names = (q) => [...(q.permissions ?? []), ...(q.origins ?? [])];
  const reads = [];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: `${site}/chat` }], get: async () => ({ id: 7, url: `${site}/chat` }) },
    permissions: { contains: async (q) => names(q).every((n) => held.has(n)), request: async (q) => { names(q).forEach((n) => held.add(n)); return true; }, remove: async (q) => { names(q).forEach((n) => held.delete(n)); return true; } },
    scripting: { executeScript: async ({ func, args }) => {
      vi.stubGlobal("location", { origin: site });
      vi.stubGlobal("localStorage", { getItem: (key) => { reads.push(key); return key === "app-config-uuid" ? device : "unselected"; } });
      return [{ frameId: 0, result: func(...args) }];
    } },
  };
  const prepared = await prepareCapture({ chrome, text: JSON.stringify(pairing) });
  expect(prepared.ok).toBe(true);
  const send = vi.fn((url, options) => ingest(new NextRequest(url, options)));
  expect((await runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: {} })).code).toBe("not_confirmed");
  expect(send).not.toHaveBeenCalled();
  const result = await runCapture({ chrome, fetch: send, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  expect(result).toMatchObject({ ok: true, localStorageCount: 1 });
  expect(reads).toEqual(["app-config-uuid"]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(held.size).toBe(0);
  expect(JSON.stringify(result)).not.toContain(device);
  const stored = await getProviderConnectionById(result.connection.id);
  expect(stored.providerSpecificData["app-config-uuid"]).toBe(device);
  expect(stored.apiKey || null).toBeNull();
  state.fetch.mockImplementation(async (url) => {
    if (String(url).includes("ipify")) return Response.json({ ip: "203.0.113.9" });
    if (String(url).endsWith("/api/challenge")) return Response.json({ challenge: "synthetic", challengeId: "challenge", difficulty: 0, version: "1", expiresAt: 4102444800000 });
    return Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] });
  });
  const response = await new TinyCmsExecutor().execute({ credentials: stored, body: { model: "gpt-5.5", messages: [] }, stream: false });
  expect(response.response.status).toBe(200);
  const calls = state.fetch.mock.calls;
  const challenge = calls.find(([url]) => String(url).endsWith("/api/challenge"));
  const chat = calls.find(([url]) => String(url).endsWith("/chat/completions"));
  expect(challenge[1].headers.uuid).toBe(device);
  expect(chat[1].headers.uuid).toBe(device);
  expect(JSON.stringify(response.headers)).not.toContain(device);
  expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(device);
});

it("refuses Cookie, cURL and HAR credentials for the actual localStorage-only contract", () => {
  const contract = getCookieImportContract("tinycms-web");
  const header = `app-config-uuid=${device}`;
  const inputs = [
    ["header", parseCookieHeaderValue(header)],
    ["curl", parseCurlCommand(`curl '${site}/' -H 'Cookie: ${header}'`)],
    ["har", parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${site}/`, headers: [{ name: "Cookie", value: header }] } }] } }))],
  ];
  for (const [kind, parsed] of inputs) {
    expect(parsed.ok).toBe(true);
    const result = buildImportCandidates({ kind, parsed }, contract);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(device);
  }
});

it("binds update to its selected connection and rejects another origin without changing either account", async () => {
  const { createProviderConnection } = await import("../../src/lib/db/repos/connectionsRepo.js");
  const first = await createProviderConnection({ provider: "tinycms-web", authType: "apikey", name: "First", providerSpecificData: { "app-config-uuid": "Rsynthetic-first" }, isActive: true }, { createOnly: true });
  const second = await createProviderConnection({ provider: "tinycms-web", authType: "apikey", name: "Second", providerSpecificData: { "app-config-uuid": "Rsynthetic-second" }, isActive: true }, { createOnly: true });
  const issue = async () => {
    const response = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "tinycms-web", action: "update", connectionId: first.id }, { origin: dashboard }));
    expect(response.status).toBe(201);
    return (await response.json()).pairing;
  };
  const post = (p, body) => ingest(request(`${dashboard}/api/providers/cookie-import`, body, { origin: "chrome-extension://synthetic-extension-id", [p.header]: p.token }));
  let p = await issue();
  let response = await post(p, { provider: "tinycms-web", origin: site, connectionId: second.id, localStorage: { "app-config-uuid": device } });
  expect(response.ok).toBe(false);
  p = await issue();
  response = await post(p, { provider: "tinycms-web", origin: "https://evil.example", connectionId: first.id, localStorage: { "app-config-uuid": device } });
  expect(response.ok).toBe(false);
  expect((await getProviderConnectionById(first.id)).providerSpecificData["app-config-uuid"]).toBe("Rsynthetic-first");
  expect((await getProviderConnectionById(second.id)).providerSpecificData["app-config-uuid"]).toBe("Rsynthetic-second");
  p = await issue();
  response = await post(p, { provider: "tinycms-web", origin: site, connectionId: first.id, localStorage: { "app-config-uuid": device } });
  expect(response.status).toBe(200);
  expect(JSON.stringify(await response.json())).not.toContain(device);
  expect((await getProviderConnectionById(first.id)).providerSpecificData["app-config-uuid"]).toBe(device);
  expect((await getProviderConnectionById(second.id)).providerSpecificData["app-config-uuid"]).toBe("Rsynthetic-second");
});

// These cases use the actual public routes, database, registry and executor. Vendor
// frames are synthetic; the UUID and strict proxy are observed at the network edge.
import { describe } from "vitest";
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";

describe("TinyCMS imported accounts through public routes", () => {
  let flow;
  const values = ["Rsynthetic-public-first", "Rsynthetic-public-second"];
  const candidate = (value) => ({ origin: site, localStorage: { "app-config-uuid": value } });
  const model = "tinycms-web/gpt-5.5";
  const vendorJson = () => Response.json({ id: "synthetic", object: "chat.completion", model: "gpt-5.5", choices: [{ index: 0, message: { role: "assistant", content: "fixture answer" }, finish_reason: "stop" }] });
  const vendorSse = () => new Response('data: {"id":"synthetic","object":"chat.completion.chunk","model":"gpt-5.5","choices":[{"index":0,"delta":{"content":"fixture answer"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
  beforeEach(async () => { vi.doUnmock("../../open-sse/utils/proxyFetch.js"); flow = await cookiePublicFlow2034("tinycms-web"); });
  afterEach(async () => { await flow?.close(); });
  async function accounts() {
    const a = await flow.imported({ action: "create", name: "Public A" }, candidate(values[0]));
    const b = await flow.imported({ action: "create", name: "Public B" }, candidate(values[1]));
    return { a, b, da: await flow.bind(a.id, "tiny-a"), db: await flow.bind(b.id, "tiny-b") };
  }
  function vendor(stream, chat = stream ? vendorSse : vendorJson) {
    flow.network.mockImplementation(async (url) => {
      if (String(url).includes("ipify")) return Response.json({ ip: "203.0.113.9" });
      if (String(url).endsWith("/api/challenge")) return Response.json({ challenge: "synthetic", challengeId: "challenge", difficulty: 0, version: "1", expiresAt: 4102444800000 });
      return chat();
    });
  }
  function credentialCalls() { return flow.network.mock.calls.filter(([url]) => String(url).includes("gov.freegpt.win")); }
  it.each([false, true].flatMap((anthropic) => [false, true].flatMap((stream) => [0, 1].map((index) => [anthropic, stream, index]))))(
    "dispatches the selected stored UUID and strict proxy anthropic=%s stream=%s account=%s", async (anthropic, stream, index) => {
      const { a, b, da, db } = await accounts();
      vendor(stream);
      const response = await flow.dispatch({ model, anthropic, stream, id: [a, b][index].id });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("fixture answer");
      const calls = credentialCalls();
      expect(calls).toHaveLength(2);
      for (const [, init] of calls) {
        expect(init.headers.uuid).toBe(values[index]);
        expect(init.headers.cookie).toBeUndefined();
        expect(init.dispatcher).toBe([da, db][index]);
      }
      const listing = await (await flow.list()).text();
      for (const value of values) {
        expect(listing).not.toContain(value);
        expect(text).not.toContain(value);
        expect(JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls))).not.toContain(value);
      }
    },
  );
  it("updates only its paired account and rejects foreign origin and ownership", async () => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    let p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...candidate(device), connectionId: b.id })).ok).toBe(false);
    p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...candidate(device), origin: "https://foreign.example", connectionId: a.id })).ok).toBe(false);
    expect((await flow.pairResponse({ action: "update", connectionId: a.id }, "synthetic-foreign-owner")).status).toBe(403);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    await flow.imported({ action: "update", connectionId: a.id }, candidate(device));
    expect((await flow.db.getProviderConnectionById(a.id)).providerSpecificData["app-config-uuid"]).toBe(device);
    expect(await flow.db.getProviderConnectionById(b.id)).toEqual(before[1]);
  });
  it.each([401, 429, 502])("does not report success on a pinned chat refusal %s", async (status) => {
    const { a, da } = await accounts();
    vendor(true, () => Response.json({ error: "synthetic refusal" }, { status }));
    const response = await flow.dispatch({ model, stream: true, id: a.id });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("[DONE]");
    expect(text).not.toContain('"finish_reason":"stop"');
    const calls = credentialCalls();
    expect(calls.map(([url, init]) => [String(url).endsWith("/api/challenge") ? "challenge" : "chat", init.headers.uuid, init.dispatcher])).toEqual([["challenge", values[0], da], ["chat", values[0], da]]);
  });
});

/**
 * Completion of the #2034 TinyCMS acceptance through the shared public-route fixture.
 * Real pairing, import, SQLite, registry, selection, executor and both public chat routes;
 * only management authority and the external network are replaced. Each stored account has
 * its own strict proxy, so the dispatcher on a physical send names the account that sent it.
 * Vendor frames are synthetic. Nothing here claims live TinyCMS behavior.
 */
describe("TinyCMS gateway-selected dispatch, refusal, non-replay and import formats", () => {
  let flow;
  const uuids = { a: "Rsynthetic-gateway-a", b: "Rsynthetic-gateway-b" };
  const model = "tinycms-web/gpt-5.5";
  const challenge = () => Response.json({ challenge: "synthetic", challengeId: "challenge", difficulty: 0, version: "1", expiresAt: 4102444800000 });
  const sse = (...frames) => frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join("");
  const delta = (content) => ({ id: "synthetic", object: "chat.completion.chunk", model: "gpt-5.5", choices: [{ index: 0, delta: { content }, finish_reason: null }] });
  const stop = { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
  const goodJson = (content = "fixture answer") => Response.json({ id: "synthetic", object: "chat.completion", model: "gpt-5.5", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
  const goodSse = (content = "fixture answer") => new Response(sse(delta(content), stop, "[DONE]"), { headers: { "content-type": "text/event-stream" } });
  const good = (stream) => (stream ? goodSse() : goodJson());
  /** A body that delivers `head` first, then resets, hangs or ends as `tail` directs. Like a
   * network body, it fails when the request signal aborts. */
  function bodyThen(head, tail, type, signal) {
    const encoder = new TextEncoder();
    let sent = !head;
    return new Response(new ReadableStream({
      start(controller) { signal?.addEventListener("abort", () => { try { controller.error(signal.reason); } catch { /* already closed */ } }, { once: true }); },
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(encoder.encode(head)); return; }
        if (tail === "reset") controller.error(Object.assign(new TypeError("terminated"), { cause: { code: "ECONNRESET" } }));
        if (tail === "end") controller.close();
        if (tail === "hang") return new Promise(() => {});
      },
    }), { headers: { "content-type": type } });
  }

  beforeEach(async () => { vi.doUnmock("../../open-sse/utils/proxyFetch.js"); flow = await cookiePublicFlow2034("tinycms-web"); });
  afterEach(async () => { vi.useRealTimers(); await flow?.close(); });
  /** Rebuild the fixture with extra runtime timeouts; the fixture's close() unstubs them. */
  async function withEnv(vars) {
    await flow.close();
    for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
    flow = await cookiePublicFlow2034("tinycms-web");
  }

  /** Two imported accounts, A preferred by priority, each behind its own strict proxy. */
  async function accounts() {
    const a = await flow.imported({ action: "create", name: "Gateway A" }, { origin: site, localStorage: { "app-config-uuid": uuids.a } });
    const b = await flow.imported({ action: "create", name: "Gateway B" }, { origin: site, localStorage: { "app-config-uuid": uuids.b } });
    const da = await flow.bind(a.id, "gateway-a");
    const db = await flow.bind(b.id, "gateway-b");
    await flow.db.updateProviderConnection(a.id, { priority: 1 });
    await flow.db.updateProviderConnection(b.id, { priority: 2 });
    return { a, b, da, db, account: new Map([[da, "a"], [db, "b"]]) };
  }
  /** Script the vendor per account and endpoint; `seen` records each physical send. */
  function vendor(env, plan) {
    const seen = [];
    flow.network.mockImplementation(async (url, init = {}) => {
      const target = String(url);
      if (target.includes("ipify")) return Response.json({ ip: "203.0.113.9" });
      const who = env.account.get(init.dispatcher) ?? "direct";
      const step = target.endsWith("/api/challenge") ? "challenge" : target.endsWith("/chat/completions") ? "chat" : "other";
      seen.push({ who, step, uuid: init.headers?.uuid, cookie: init.headers?.cookie ?? init.headers?.Cookie, dispatcher: init.dispatcher, body: init.body });
      const handler = plan[who]?.[step] ?? (step === "challenge" ? challenge : undefined);
      if (!handler) throw Error(`Unexpected ${step} on ${who}`);
      return handler(init);
    });
    return seen;
  }
  const path = (seen) => seen.map(({ who, step }) => `${who}:${step}`);
  function expectOwnCredentials(seen, env) {
    for (const call of seen) {
      expect(call.who).not.toBe("direct");
      expect(call.uuid).toBe(uuids[call.who]);
      expect(call.cookie).toBeUndefined();
      expect(call.dispatcher).toBe(call.who === "a" ? env.da : env.db);
    }
  }
  async function expectRedacted(text) {
    const listing = await (await flow.list()).text();
    for (const value of Object.values(uuids)) {
      expect(listing).not.toContain(value);
      expect(text).not.toContain(value);
      expect(JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls))).not.toContain(value);
    }
  }
  /** No completion marker; an OpenAI [DONE] is allowed only after an error frame closes the stream. */
  function expectNoSuccessTerminal(text) {
    expect(text).not.toMatch(/"finish_reason":"stop"|"stop_reason":"end_turn"|event: message_stop/);
    const done = text.indexOf("[DONE]");
    if (done !== -1) expect(text.slice(0, done)).toMatch(/data: \{"error":/);
  }
  const modes = [false, true].flatMap((anthropic) => [false, true].map((stream) => [anthropic, stream]));

  it.each(modes)("lets the gateway choose the stored account and its proxy without a pin anthropic=%s stream=%s", async (anthropic, stream) => {
    const env = await accounts();
    const seen = vendor(env, { a: { chat: () => good(stream) } });
    const response = await flow.dispatch({ model, anthropic, stream });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("fixture answer");
    expect(path(seen)).toEqual(["a:challenge", "a:chat"]);
    expectOwnCredentials(seen, env);
    await expectRedacted(text);
  });

  // Uncharged setup failures and vendor auth/quota refusals prove that A did no chat work.
  it.each([
    ["challenge 401", { challenge: () => Response.json({ error: "expired" }, { status: 401 }) }, ["a:challenge"]],
    ["challenge transport failure", { challenge: () => { throw new TypeError("fetch failed"); } }, ["a:challenge"]],
    ["chat 401", { chat: () => Response.json({ error: "expired" }, { status: 401 }) }, ["a:challenge", "a:chat"]],
    ["chat 403", { chat: () => Response.json({ error: "forbidden" }, { status: 403 }) }, ["a:challenge", "a:chat"]],
    ["chat 429 quota", { chat: () => Response.json({ error: "quota" }, { status: 429, headers: { "retry-after": "30" } }) }, ["a:challenge", "a:chat"]],
  ])("falls back to the second stored account after proven-safe %s", async (_label, refusal, before) => {
    for (const [anthropic, stream] of modes) {
      if (flow.network.mock.calls.length) { await flow.close(); flow = await cookiePublicFlow2034("tinycms-web"); }
      const env = await accounts();
      const seen = vendor(env, { a: refusal, b: { chat: () => good(stream) } });
      const response = await flow.dispatch({ model, anthropic, stream });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("fixture answer");
      const order = path(seen);
      expect(order.slice(0, before.length)).toEqual(before);
      expect(order.filter((step) => step === "b:chat")).toHaveLength(1);
      expect(order.filter((step) => step === "a:chat")).toHaveLength(before.includes("a:chat") ? 1 : 0);
      expect(order.at(-1)).toBe("b:chat");
      expectOwnCredentials(seen, env);
      await expectRedacted(text);
    }
  });

  // After the chat POST left, these answers do not prove TinyCMS refused the work.
  const uncertain = {
    "HTTP 500": () => Response.json({ error: "synthetic" }, { status: 500 }),
    "HTTP 503": () => new Response("busy", { status: 503 }),
    "connection reset": () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); },
    "200 HTML page": () => new Response(`<html><body>synthetic page ${uuids.a}</body></html>`, { headers: { "content-type": "text/html" } }),
    "200 malformed JSON": () => new Response("{\"choices\":", { headers: { "content-type": "application/json" } }),
    "200 JSON without choices": () => Response.json({ id: "synthetic", object: "chat.completion" }),
    "200 error envelope 500": () => Response.json({ error: { code: 500, message: `synthetic ${uuids.a}` } }),
    "200 stream reset before output": () => bodyThen("", "reset", "text/event-stream"),
    "200 empty stream": () => bodyThen("", "end", "text/event-stream"),
    "200 stream error frame before output": () => bodyThen(sse({ error: { code: 500, message: `synthetic ${uuids.a}` } }), "end", "text/event-stream"),
  };
  it.each(Object.keys(uncertain).flatMap((kind) => modes.map(([anthropic, stream]) => [kind, anthropic, stream])))(
    "keeps %s after the chat POST terminal without replay anthropic=%s stream=%s", async (kind, anthropic, stream) => {
      const env = await accounts();
      const seen = vendor(env, { a: { chat: uncertain[kind] }, b: { chat: () => good(stream) } });
      const response = await flow.dispatch({ model, anthropic, stream });
      const text = await response.text();
      expect(response.status, text).toBeGreaterThanOrEqual(500);
      expect(text).not.toContain("fixture answer");
      expectNoSuccessTerminal(text);
      expect(path(seen)).toEqual(["a:challenge", "a:chat"]);
      expectOwnCredentials(seen, env);
      expect(flow.usage.mock.calls.some(([entry]) => entry?.status === "ok" || entry?.success === true)).toBe(false);
      await expectRedacted(text);
    },
  );

  it.each(modes)("stops a pinned streamed or buffered 502 after one challenge and one chat anthropic=%s stream=%s", async (anthropic, stream) => {
    const env = await accounts();
    const seen = vendor(env, { b: { chat: () => Response.json({ error: "synthetic" }, { status: 502 }) }, a: { chat: () => good(stream) } });
    const response = await flow.dispatch({ model, anthropic, stream, id: env.b.id });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(500);
    expectNoSuccessTerminal(text);
    expect(path(seen)).toEqual(["b:challenge", "b:chat"]);
    expectOwnCredentials(seen, env);
  });

  it.each([false, true])("ends a buffered chat at the body deadline without replay anthropic=%s", async (anthropic) => {
    const env = await accounts();
    const seen = vendor(env, { a: { chat: (init) => bodyThen("{\"id\":\"synthetic\",", "hang", "application/json", init.signal) }, b: { chat: () => goodJson() } });
    const response = await flow.dispatch({ model, anthropic });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain("fixture answer");
    expect(path(seen)).toEqual(["a:challenge", "a:chat"]);
  });

  // Text already reached the client, so no other account may generate the turn again.
  it.each([
    ["error frame", (head) => bodyThen(head + sse({ error: { message: "synthetic failure", code: 500 } }), "end", "text/event-stream")],
    ["connection reset", (head) => bodyThen(head, "reset", "text/event-stream")],
    ["truncated stream", (head) => bodyThen(head, "end", "text/event-stream")],
    ["stalled stream", (head, signal) => bodyThen(head, "hang", "text/event-stream", signal)],
  ].flatMap(([kind, make]) => [false, true].map((anthropic) => [kind, anthropic, make])))(
    "does not replay or finish successfully after partial text then %s anthropic=%s", async (kind, anthropic, make) => {
      if (kind === "stalled stream") await withEnv({ STREAM_STALL_TIMEOUT_MS: "300" });
      const env = await accounts();
      const seen = vendor(env, { a: { chat: (init) => make(sse(delta("partial words")), init.signal) }, b: { chat: () => goodSse() } });
      const response = await flow.dispatch({ model, anthropic, stream: true });
      const text = await response.text();
      expect(text).not.toContain("fixture answer");
      expectNoSuccessTerminal(text);
      expect(path(seen)).toEqual(["a:challenge", "a:chat"]);
      expectOwnCredentials(seen, env);
      await expectRedacted(text);
    },
  );

  it.each([false, true])("ends a silent accepted stream at the first-output deadline without replay anthropic=%s", async (anthropic) => {
    await withEnv({ STREAM_FIRST_CHUNK_TIMEOUT_MS: "300" });
    const env = await accounts();
    const seen = vendor(env, { a: { chat: (init) => bodyThen("", "hang", "text/event-stream", init.signal) }, b: { chat: () => goodSse() } });
    const response = await flow.dispatch({ model, anthropic, stream: true });
    const text = await response.text();
    expect(response.status, text).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain("fixture answer");
    expectNoSuccessTerminal(text);
    expect(path(seen)).toEqual(["a:challenge", "a:chat"]);
  });

  it.each([["challenge", ["a:challenge"]], ["chat", ["a:challenge", "a:chat"]]])("passes a client abort during %s without fallback", async (step, expected) => {
    const env = await accounts();
    const controller = new AbortController();
    const abort = (init) => { controller.abort(); throw init.signal?.reason ?? new DOMException("aborted", "AbortError"); };
    const seen = vendor(env, { a: { [step]: abort, chat: step === "chat" ? abort : () => goodJson() }, b: { chat: () => goodJson() } });
    const response = await flow.dispatch({ model, stream: true, signal: controller.signal });
    const text = await response.text().catch(() => "");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("fixture answer");
    expect(path(seen)).toEqual(expected);
  });

  it("routes real client API keys only to their scoped stored account", async () => {
    const env = await accounts();
    const keyA = await flow.db.createApiKey("tiny-key-a", "synthetic-machine", [], null, null, { providerConnectionIds: [env.a.id] });
    const keyB = await flow.db.createApiKey("tiny-key-b", "synthetic-machine", [], null, null, { providerConnectionIds: [env.b.id] });
    await flow.db.updateSettings({ requireApiKey: true });
    let seen = vendor(env, { a: { chat: () => goodJson("answer a") }, b: { chat: () => goodJson("answer b") } });
    for (const [key, who] of [[keyA, "a"], [keyB, "b"]]) {
      seen.length = 0;
      const response = await flow.dispatch({ model, headers: { authorization: `Bearer ${key.key}` } });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain(`answer ${who}`);
      expect(path(seen)).toEqual([`${who}:challenge`, `${who}:chat`]);
      expectOwnCredentials(seen, env);
      expect(flow.usage.mock.calls.at(-1)[0]).toMatchObject({ apiKeyId: key.id });
    }
    flow.network.mockClear();
    seen = vendor(env, { a: { chat: () => goodJson() }, b: { chat: () => goodJson() } });
    for (const headers of [{ authorization: `Bearer ${keyB.key}` }, { authorization: "Bearer synthetic-invalid" }, {}]) {
      const response = await flow.dispatch({ model, id: env.a.id, headers });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(seen).toEqual([]);
  });

  it("refuses Cookie header, cURL and HAR captures at the real import endpoint without writing", async () => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const header = `app-config-uuid=${device}`;
    const har = parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${site}/`, headers: [{ name: "Cookie", value: header }] } }] } }));
    const captures = {
      header: parseCookieHeaderValue(header).cookies,
      curl: parseCurlCommand(`curl '${site}/' -H 'Cookie: ${header}'`).cookies,
      har: har.entries[0].cookies,
    };
    for (const [kind, cookies] of Object.entries(captures)) {
      expect(cookies, kind).toEqual([{ name: "app-config-uuid", value: device }]);
      for (const target of [{ action: "create", name: `From ${kind}` }, { action: "update", connectionId: a.id }]) {
        for (const extra of [{}, { localStorage: { "app-config-uuid": device } }]) {
          const p = await flow.issue(target);
          const response = await flow.submit(p, { origin: site, cookies, ...extra, ...(target.connectionId ? { connectionId: a.id } : { name: target.name }) });
          const text = await response.text();
          expect(response.status, `${kind} ${target.action}`).toBe(400);
          expect(JSON.parse(text).error).toMatch(/cookie|localStorage/i);
          expect(text).not.toContain(device);
        }
      }
    }
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    expect((await flow.db.getProviderConnections({ provider: "tinycms-web" })).map((row) => row.name).sort()).toEqual(["Gateway A", "Gateway B"]);
  });

  it("refuses expired pairing, expired cookie metadata, a malformed UUID and a foreign owner without writing", async () => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const valid = { origin: site, localStorage: { "app-config-uuid": device }, connectionId: a.id };
    let p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...valid, cookies: [{ name: "app-config-uuid", value: device, expirationDate: 1 }] })).status).toBe(400);
    p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...valid, localStorage: { "app-config-uuid": "not-a-device" } })).status).toBe(400);
    p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...valid, localStorage: { "app-config-uuid": device, extra: "Rsynthetic-extra" } })).status).toBe(400);
    p = await flow.issue({ action: "update", connectionId: a.id });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60 * 1000 + 1);
    expect((await flow.submit(p, valid)).status).toBe(401);
    vi.useRealTimers();
    // A spent pairing token does not authorize a second write.
    expect((await flow.submit(p, valid)).status).toBe(401);
    expect((await flow.pairResponse({ action: "update", connectionId: a.id }, "synthetic-foreign-owner")).status).toBe(403);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
  });
});
