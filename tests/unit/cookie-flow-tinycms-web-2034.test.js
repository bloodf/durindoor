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
