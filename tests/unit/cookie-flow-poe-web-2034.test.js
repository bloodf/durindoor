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
