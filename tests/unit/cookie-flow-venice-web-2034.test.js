// Closed browser and network fixtures; all credentials are synthetic.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "venice-flow-2034-"));
  process.env.DATA_DIR = dir;
  return { original, dir, getAdapter: vi.fn(), getAdapterSync: vi.fn(), send: vi.fn() };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: vi.fn(async () => true), isOperatorRequest: vi.fn(async () => true),
  hasExactRequestOrigin: vi.fn(() => true), isNonAdminApiKeyCaller: vi.fn(async () => false),
}));
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(async () => []), getProxyPoolById: vi.fn(), getSettings: vi.fn(async () => ({})),
}));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({ ...(await importOriginal()), proxyAwareFetch: state.send }));
import { getExecutor } from "../../open-sse/executors/index.js";
import { VENICE_WEB_CLIENT_URL, VENICE_WEB_CHAT_URL, veniceWebTokenUrl } from "../../open-sse/providers/registry/venice-web.js";
import registry from "../../open-sse/providers/registry/index.js";
import { prepareCapture, confirmationFor, runCapture } from "../../extensions/provider-cookie-capture/capture.js";
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as submit } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";

const dashboard = "https://dashboard.example";
const origin = "https://clerk.venice.ai";
const jwt = (claims) => `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
const secret = jwt({ id: "client_a" });
const otherSecret = jwt({ id: "client_b" });
let db;
beforeEach(() => {
  vi.stubEnv("BASE_URL", dashboard);
  clearPairings();
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db);
  state.getAdapterSync.mockReturnValue(db);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => {
  if (state.original === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = state.original;
  fs.rmSync(state.dir, { recursive: true, force: true });
});

it("carries a real issued Venice pairing through the confirmed tab store into SQLite", async () => {
  const entry = registry.find((item) => item.id === "venice-web");
  expect(entry.cookieImport).toMatchObject({ origin, cookieNames: ["__client"] });
  const issued = await pair(new NextRequest(`${dashboard}/api/providers/cookie-import/pairing`, {
    method: "POST", headers: { "content-type": "application/json", origin: dashboard },
    body: JSON.stringify({ provider: entry.id, action: "create", name: "Venice captured" }),
  }));
  expect(issued.status).toBe(201);
  const { pairing } = await issued.json();
  const reads = [];
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: `${origin}/` }], get: async () => ({ id: 7, url: `${origin}/` }) },
    permissions: { contains: async () => true, request: vi.fn(), remove: vi.fn() },
    cookies: {
      getAllCookieStores: async () => [{ id: "other", tabIds: [8] }, { id: "selected", tabIds: [7] }],
      get: async (query) => { reads.push(query); return { name: "__client", value: secret, domain: ".venice.ai", secure: true }; },
      getAll: vi.fn(() => { throw new Error("unexpected enumeration"); }),
    },
    scripting: { executeScript: vi.fn(() => { throw new Error("unexpected localStorage read"); }) },
  };
  const prepared = await prepareCapture({ chrome, text: JSON.stringify({ pairing }) });
  expect(prepared.ok).toBe(true);
  expect(prepared.plan.localStorageKeys).toEqual([]);
  expect(prepared.plan.cookiePrefixes).toEqual([]);
  const network = vi.fn(async (url, init) => submit(new NextRequest(url, { ...init, headers: { ...init.headers, origin: "chrome-extension://synthetic" } })));
  const result = await runCapture({ chrome, fetch: network, plan: prepared.plan, confirmed: confirmationFor(prepared.plan) });
  expect(result.ok).toBe(true);
  expect(reads).toEqual([{ url: `${origin}/`, name: "__client", storeId: "selected" }]);
  expect(network).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain(pairing.token);
  const stored = await getProviderConnectionById(result.connection.id);
  expect(stored).toMatchObject({ provider: entry.id, authType: "cookie", apiKey: `__client=${secret}` });

  const token = jwt({ sub: "synthetic-user-a", exp: Math.floor(Date.now() / 1000) + 3600 });
  const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080" };
  state.send.mockReset().mockImplementation(async (url, init, route) => {
    expect(route).toEqual(proxy);
    if (url === VENICE_WEB_CLIENT_URL) {
      expect(init.headers.Cookie).toBe(`__client=${secret}`);
      return Response.json({ response: { sessions: [{ id: "sess_a", status: "active" }] } });
    }
    if (url === veniceWebTokenUrl("sess_a")) {
      expect(init.headers.Cookie).toBe(`__client=${secret}`);
      return Response.json({ jwt: token });
    }
    expect(url).toBe(VENICE_WEB_CHAT_URL);
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
    return new Response(`${JSON.stringify({ kind: "content", content: "synthetic reply" })}\n`);
  });
  const executed = await getExecutor(entry.id).execute({ model: "venice-uncensored", stream: false,
    credentials: { apiKey: stored.apiKey }, proxyOptions: proxy,
    body: { messages: [{ role: "user", content: "hello" }] } });
  expect(executed.response.status).toBe(200);
  expect(await executed.response.text()).toContain("synthetic reply");
  expect(state.send).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(executed.headers)).not.toContain(token);
  expect(JSON.stringify(executed.transformedBody)).not.toContain("synthetic-user-a");

  const update = await pair(new NextRequest(`${dashboard}/api/providers/cookie-import/pairing`, {
    method: "POST", headers: { "content-type": "application/json", origin: dashboard },
    body: JSON.stringify({ provider: entry.id, action: "update", connectionId: stored.id }),
  }));
  expect(update.status).toBe(201);
  const next = (await update.json()).pairing;
  const updatedPlan = await prepareCapture({ chrome, text: JSON.stringify({ pairing: next }) });
  chrome.cookies.get = async () => ({ name: "__client", value: otherSecret, domain: "clerk.venice.ai", secure: true });
  const updated = await runCapture({ chrome, fetch: network, plan: updatedPlan.plan, confirmed: confirmationFor(updatedPlan.plan) });
  expect(updated.ok).toBe(true);
  expect((await getProviderConnectionById(stored.id)).apiKey).toBe(`__client=${otherSecret}`);
  expect(JSON.stringify(updated)).not.toContain(otherSecret);
});

it("spends a pairing on expired or off-origin Venice cookies without storing them", async () => {
  for (const cookie of [
    { name: "__client", value: secret, domain: "clerk.venice.ai", secure: true, expirationDate: 1 },
    { name: "__client", value: secret, domain: "outerface.venice.ai", secure: true },
    { name: "__client.0", value: secret, domain: "clerk.venice.ai", secure: true },
  ]) {
    const issued = await pair(new NextRequest(`${dashboard}/api/providers/cookie-import/pairing`, {
      method: "POST", headers: { "content-type": "application/json", origin: dashboard },
      body: JSON.stringify({ provider: "venice-web", action: "create", name: "refused Venice" }),
    }));
    const { pairing } = await issued.json();
    const request = () => new NextRequest(pairing.importUrl, {
      method: "POST", headers: { "content-type": "application/json", [pairing.header]: pairing.token },
      body: JSON.stringify({ provider: "venice-web", origin, cookies: [cookie] }),
    });
    const response = await submit(request());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(secret);
    expect((await submit(request())).status).toBe(401);
  }
});
