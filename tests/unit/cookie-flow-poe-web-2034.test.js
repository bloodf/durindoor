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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "poe-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, original, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates } from "../../src/shared/utils/cookieImportParser.js";
import { PoeWebExecutor } from "../../open-sse/executors/poe-web.js";
import { cookiePublicFlow2034 } from "./helpers/cookiePublicFlow2034.js";

const dashboard = "https://dashboard.example";
const origin = "https://www.poe.com";
const secret = "synthetic-poe-session";
let db;
let logs;
const request = (path, body, headers = {}) => new NextRequest(`${dashboard}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: dashboard, ...headers }, body: JSON.stringify(body) });
async function issue(target = { action: "create", name: "Poe A" }) {
  const res = await pair(request("/api/providers/cookie-import/pairing", { provider: "poe-web", ...target }, { "x-9r-cli-token": "operator" }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
const submit = (token, body) => importCookies(request("/api/providers/cookie-import", body, { [PAIRING_HEADER]: token }));
const cookie = (value = secret, extra = {}) => ({ name: "p-b", value, domain: ".poe.com", secure: true, ...extra });
const body = (extra = {}) => ({ provider: "poe-web", origin, cookies: [cookie()], ...extra });

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true);
  state.operator.mockReset().mockResolvedValue(true);
  state.origin.mockReset().mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("Poe real cookie contract through capture and import", () => {
  it("captures only p-b from the active tab store, imports it, and sends the stored account to Poe", async () => {
    const pairing = await issue();
    expect(pairing.contract).toMatchObject({ origin, cookieNames: ["p-b"], cookiePrefixes: [] });
    const get = vi.fn(async () => cookie());
    const chrome = {
      tabs: { query: vi.fn(async () => [{ id: 7, url: `${origin}/` }]), get: vi.fn(async () => ({ id: 7, url: `${origin}/` })) },
      permissions: { contains: vi.fn(async () => true), request: vi.fn(), remove: vi.fn() },
      cookies: { getAllCookieStores: vi.fn(async () => [{ id: "other", tabIds: [8] }, { id: "chosen", tabIds: [7] }]), get, getAll: vi.fn() },
      scripting: { executeScript: vi.fn() },
    };
    const prepared = await prepareCapture({ chrome, text: JSON.stringify({ pairing }) });
    expect(prepared.ok).toBe(true);
    const fetchDashboard = vi.fn(async (url, init) => importCookies(new NextRequest(url, init)));
    const result = await runCapture({ chrome, fetch: fetchDashboard, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
    expect(result.ok).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith({ url: `${origin}/`, name: "p-b", storeId: "chosen" });
    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    const stored = await getProviderConnectionById(result.connection.id);
    expect(stored.apiKey).toBe(`p-b=${secret}`);
    expect(db.all("SELECT * FROM providerConnections")[0].data).not.toContain(secret);
    const fetchProvider = vi.fn(async () => Response.json({ data: { chatWithBot: { text: "ok", state: "complete" } } }));
    vi.stubGlobal("fetch", fetchProvider);
    const reply = await new PoeWebExecutor().execute({ credentials: stored, model: "gpt-4o", body: { messages: [{ role: "user", content: "hello" }] } });
    expect(reply.response.status).toBe(200);
    expect(fetchProvider).toHaveBeenCalledTimes(1);
    expect(fetchProvider.mock.calls[0][0]).toBe(`${origin}/api/gql_POST`);
    expect(fetchProvider.mock.calls[0][1].headers.cookie).toBe(`p-b=${secret}`);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(reply.headers)).not.toContain(secret);
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(secret);
  });

  it("selects and updates only the bound Poe account and refuses foreign targets and invalid cookies", async () => {
    const first = await createProviderConnection({ provider: "poe-web", authType: "cookie", name: "First", apiKey: "p-b=old-first", isActive: true }, { createOnly: true });
    const second = await createProviderConnection({ provider: "poe-web", authType: "cookie", name: "Second", apiKey: "p-b=old-second", isActive: true }, { createOnly: true });
    const p = await issue({ action: "update", connectionId: first.id });
    const mismatch = await submit(p.token, body({ connectionId: second.id }));
    expect(mismatch.status).toBe(409);
    const update = await issue({ action: "update", connectionId: first.id });
    const response = await submit(update.token, body({ connectionId: first.id }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(secret);
    expect((await getProviderConnectionById(first.id)).apiKey).toBe(`p-b=${secret}`);
    expect((await getProviderConnectionById(second.id)).apiKey).toBe("p-b=old-second");
    for (const invalid of [body({ origin: "https://poe.com" }), body({ cookies: [cookie(secret, { expirationDate: 1 })] }), body({ cookies: [cookie(secret, { name: "p-b.0" })] })]) {
      const next = await issue();
      const rejected = await submit(next.token, invalid);
      expect(rejected.status).toBe(400);
      expect(JSON.stringify(await rejected.json())).not.toContain(secret);
    }
    state.access.mockResolvedValue(false);
    expect((await pair(request("/api/providers/cookie-import/pairing", { provider: "poe-web", action: "create", name: "Denied" }))).status).toBe(403);
    expect((await submit("invalid", body())).status).toBe(401);
  });

  it("filters Cookie, cURL and HAR candidates using the real Poe allowlist", () => {
    const contract = getCookieImportContract("poe-web");
    const header = parseCookieHeaderValue(`Cookie: noise=x; p-b=${secret}`);
    const curl = parseCurlCommand(`curl '${origin}/api/gql_POST' -H 'Cookie: noise=x; p-b=${secret}'`);
    const har = parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/api/gql_POST`, headers: [{ name: "Cookie", value: `noise=x; p-b=${secret}` }] } }] } }));
    for (const [kind, parsed] of [["header", header], ["curl", curl], ["har", har]]) {
      expect(parsed.ok).toBe(true);
      const result = buildImportCandidates({ kind, parsed }, contract);
      expect(result.ok).toBe(true);
      expect(result.candidates[0].cookies).toEqual([{ name: "p-b", value: secret }]);
    }
    const foreign = parseCurlCommand(`curl 'https://poe.com/' -H 'Cookie: p-b=${secret}'`);
    expect(buildImportCandidates({ kind: "curl", parsed: foreign }, contract).ok).toBe(false);
  });
});

/**
 * Public-route evidence: real pairing, import, encrypted SQLite storage, registry,
 * account selection, `/api/v1/chat/completions` and `/api/v1/messages`, with each
 * stored account behind its own strict proxy. Only operator authority and the
 * external network are replaced; vendor frames are synthetic Poe GraphQL bodies.
 */
describe("Poe imported accounts through public routes", () => {
  let flow;
  const other = "synthetic-poe-second";
  const candidate = (value) => ({ origin, cookies: [{ name: "p-b", value }] });
  const vendor = () => Response.json({ data: { chatWithBot: { text: "fixture answer", state: "complete" } } });
  const modes = [false, true].flatMap((anthropic) => [false, true].map((stream) => [anthropic, stream]));
  const successTerminals = ["[DONE]", '"finish_reason":"stop"', "message_stop", '"stop_reason":"end_turn"'];
  beforeEach(async () => { flow = await cookiePublicFlow2034("poe-web"); });
  afterEach(async () => { await flow?.close(); });
  async function accounts() {
    const a = await flow.imported({ action: "create", name: "Public A" }, candidate(secret));
    const b = await flow.imported({ action: "create", name: "Public B" }, candidate(other));
    return { a, b, da: await flow.bind(a.id, "a"), db: await flow.bind(b.id, "b") };
  }
  const dispatch = (options = {}) => flow.dispatch({ model: "poe-web/gpt-4o", ...options });
  /** One vendor call, carrying exactly the chosen cookie through the chosen proxy. */
  function snapshot(value, dispatcher) {
    expect(flow.network).toHaveBeenCalledTimes(1);
    const [url, init] = flow.network.mock.calls[0];
    expect(String(url)).toBe(`${origin}/api/gql_POST`);
    expect(init.headers.cookie).toBe(`p-b=${value}`);
    expect(init.headers.origin).toBe(origin);
    expect(init.dispatcher).toBe(dispatcher);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body).variables).toEqual({ bot: "GPT-4o", query: "synthetic question" });
  }
  async function redacted(...texts) {
    const listed = await (await flow.list()).text();
    const logged = JSON.stringify(flow.logs.flatMap((spy) => spy.mock.calls));
    for (const value of [secret, other]) for (const text of [listed, logged, ...texts]) expect(text).not.toContain(value);
  }
  it.each(modes.flatMap(([anthropic, stream]) => ["a", "b"].map((label) => [anthropic, stream, label])))("pins the selected account (anthropic=%s, stream=%s, account=%s)", async (anthropic, stream, label) => {
    const { a, b, da, db: dbDispatcher } = await accounts();
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ anthropic, stream, id: label === "a" ? a.id : b.id });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("fixture answer");
    snapshot(label === "a" ? secret : other, label === "a" ? da : dbDispatcher);
    await redacted(text);
  });
  it.each([["header", false, false], ["curl", false, true], ["har", true, false], ["header", true, true]])("imports a parsed %s candidate and dispatches it (anthropic=%s, stream=%s)", async (kind, anthropic, stream) => {
    const parsed = kind === "header" ? parseCookieHeaderValue(`Cookie: noise=x; p-b=${secret}`) : kind === "curl" ? parseCurlCommand(`curl '${origin}/api/gql_POST' -H 'Cookie: noise=x; p-b=${secret}'`) : parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/api/gql_POST`, headers: [{ name: "Cookie", value: `noise=x; p-b=${secret}` }] } }] } }));
    expect(parsed.ok).toBe(true);
    const pairing = await flow.issue({ action: "create", name: `Parsed ${kind}` });
    const built = buildImportCandidates({ kind, parsed }, pairing.contract);
    expect(built.ok).toBe(true);
    expect(built.candidates[0].cookies).toEqual([{ name: "p-b", value: secret }]);
    const imported = await flow.submit(pairing, { ...built.candidates[0], name: `Parsed ${kind}` });
    const importText = await imported.text();
    expect(imported.status, importText).toBe(201);
    const row = await flow.db.getProviderConnectionById(JSON.parse(importText).connection.id);
    expect(row.apiKey).toBe(`p-b=${secret}`);
    const dispatcher = await flow.bind(row.id, kind);
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ anthropic, stream, id: row.id });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("fixture answer");
    snapshot(secret, dispatcher);
    await redacted(importText, text);
  });
  it("updates only the paired account and rejects a different target and foreign operator without writes", async () => {
    const { a, b, db: dispatcher } = await accounts();
    const before = await flow.db.getProviderConnectionById(a.id);
    const beforeB = await flow.db.getProviderConnectionById(b.id);
    const p = await flow.issue({ action: "update", connectionId: a.id });
    expect((await flow.submit(p, { ...candidate("synthetic-replacement"), connectionId: b.id })).status).toBe(409);
    expect((await flow.pairResponse({ action: "update", connectionId: a.id }, "synthetic-foreign-owner")).status).toBe(403);
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    expect(await flow.db.getProviderConnectionById(b.id)).toEqual(beforeB);
    await flow.imported({ action: "update", connectionId: b.id }, candidate("synthetic-replacement"));
    expect(await flow.db.getProviderConnectionById(a.id)).toEqual(before);
    flow.network.mockImplementation(vendor);
    const response = await dispatch({ id: b.id });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    snapshot("synthetic-replacement", dispatcher);
    await redacted(text);
  });
  it.each([["origin", { origin: "https://poe.com" }], ["expiry", { cookies: [cookie(secret, { expirationDate: 1 })] }], ["chunk", { cookies: [cookie(secret, { name: "p-b.0" })] }], ["localStorage", { cookies: [], localStorage: { token: secret } }]])("rejects invalid %s without writes", async (_label, change) => {
    const { a, b } = await accounts();
    const before = await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById));
    const p = await flow.issue({ action: "update", connectionId: a.id });
    const response = await flow.submit(p, { ...candidate(secret), connectionId: a.id, ...change });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(secret);
    expect(await Promise.all([a.id, b.id].map(flow.db.getProviderConnectionById))).toEqual(before);
    expect(flow.network).not.toHaveBeenCalled();
  });
  it.each([401, 429].flatMap((status) => modes.map(([anthropic, stream]) => [status, anthropic, stream])))("does not rotate a pinned account or emit success on HTTP %s (anthropic=%s, stream=%s)", async (status, anthropic, stream) => {
    const { a, da } = await accounts();
    flow.network.mockImplementation(() => Response.json({ error: "synthetic refusal" }, { status }));
    const response = await dispatch({ anthropic, stream, id: a.id });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    for (const terminal of successTerminals) expect(text).not.toContain(terminal);
    expect(text).not.toContain("fixture answer");
    snapshot(secret, da);
    await redacted(text);
  });
  it.each([false, true])("falls back to the second account only after an explicit 401 refusal (anthropic=%s)", async (anthropic) => {
    const { a, b, da, db: dispatcher } = await accounts();
    await flow.db.updateProviderConnection(a.id, { priority: 1 });
    await flow.db.updateProviderConnection(b.id, { priority: 2 });
    flow.network.mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 })).mockImplementation(vendor);
    const response = await dispatch({ anthropic, stream: true });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("fixture answer");
    expect(flow.network.mock.calls.map(([, init]) => [init.headers.cookie, init.dispatcher])).toEqual([[`p-b=${secret}`, da], [`p-b=${other}`, dispatcher]]);
    await redacted(text);
  });
  it("does not replay after the caller aborts an accepted request", async () => {
    await accounts();
    const controller = new AbortController();
    flow.network.mockImplementation(async () => { controller.abort(); throw controller.signal.reason; });
    const response = await dispatch({ stream: true, signal: controller.signal });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    for (const terminal of successTerminals) expect(text).not.toContain(terminal);
    expect(flow.network).toHaveBeenCalledTimes(1);
  });
});
