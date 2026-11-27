// Offline integration for #2034: real Veo descriptor, extension, handlers and repository.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";
import { parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { createVeoAiFreeVideoAdapter } from "../../open-sse/services/providerParity/native-veoaifree-web-video/index.js";

const state = vi.hoisted(() => ({ getAdapter: vi.fn(), getAdapterSync: vi.fn(), access: vi.fn(), operator: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: state.access, isOperatorRequest: state.operator, hasExactRequestOrigin: state.origin }));
vi.mock("@/lib/localDb", async () => ({ ...(await import("../../src/lib/db/repos/connectionsRepo.js")), getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn() }));
import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { clearPairings } from "../../src/lib/providers/cookieImport/pairing.js";
import { getProviderConnectionById } from "../../src/lib/db/repos/connectionsRepo.js";

const dashboard = "https://dashboard.example";
const origin = "https://veoaifree.com";
const name = `wordpress_logged_in_${"a".repeat(32)}`;
const secret = "synthetic-veo-session";
let db, logs;
const request = (url, body, headers = {}) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function issue(target) {
  const response = await pair(request(`${dashboard}/api/providers/cookie-import/pairing`, { provider: "veoaifree-web", ...target }, { origin: dashboard, "x-9r-cli-token": "operator-one" }));
  expect(response.status).toBe(201);
  return (await response.json()).pairing;
}
const send = (token, body) => importCookies(request(`${dashboard}/api/providers/cookie-import`, body, { "x-durindoor-pairing-token": token }));
const body = (value = secret) => ({ provider: "veoaifree-web", origin, cookies: [{ name, value, domain: "veoaifree.com", secure: true }] });
beforeEach(() => {
  vi.stubEnv("BASE_URL", dashboard);
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockResolvedValue(db); state.getAdapterSync.mockReturnValue(db);
  state.access.mockResolvedValue(true); state.operator.mockResolvedValue(true); state.origin.mockReturnValue(true);
  clearPairings();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => { db.close(); clearPairings(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("captures through a real pairing into SQLite and sends the selected stored session to the registered video transport", async () => {
  const pairing = await issue({ action: "create", name: "Veo A" });
  expect(pairing.contract).toEqual({ origin, cookieNames: [], cookiePrefixes: [], hashedCookiePrefixes: ["wordpress_logged_in_"] });
  const parsed = parsePairing(JSON.stringify({ pairing }));
  expect(parsed.ok).toBe(true);
  parsed.plan.tabId = 7;
  const held = new Set();
  const permissionNames = (q) => [...(q.permissions || []), ...(q.origins || [])];
  const getAll = vi.fn(async () => [{ ...body().cookies[0], storeId: "store-7" }, { name: "wordpress_test_cookie", value: "synthetic-noise", domain: "veoaifree.com", secure: true, storeId: "store-7" }]);
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: `${origin}/` }], get: async (id) => ({ id, url: `${origin}/` }) },
    permissions: { contains: async (q) => permissionNames(q).every((v) => held.has(v)), request: async (q) => { permissionNames(q).forEach((v) => held.add(v)); return true; }, remove: async () => true },
    cookies: { getAllCookieStores: async () => [{ id: "store-7", tabIds: [7] }], getAll },
  };
  await preflightPermissions(chrome, parsed.plan);
  let imported;
  const capture = await runCapture({ chrome, plan: parsed.plan, confirmed: confirmationFor(parsed.plan), fetch: async (url, init) => {
    imported = await importCookies(new NextRequest(url, init));
    return imported.clone();
  } });
  expect(capture.ok).toBe(true);
  expect(getAll).toHaveBeenCalledWith({ url: `${origin}/`, storeId: "store-7" });
  const result = await imported.json();
  expect(JSON.stringify([capture, result])).not.toContain(secret);
  const saved = await getProviderConnectionById(result.connection.id);
  expect(saved).toMatchObject({ provider: "veoaifree-web", authType: "apikey", apiKey: `${name}=${secret}` });
  expect(db.all("SELECT data FROM providerConnections")[0].data).not.toContain(secret);
  expect(getVideoGenerationAdapter("veoaifree-web")).toBeTruthy();
  const responses = ['nonce":"abc123"', "scene", "https://cdn.example.com/video.mp4"];
  const fetch = vi.fn(async () => new Response(responses.shift()));
  vi.stubGlobal("fetch", fetch);
  // Same implementation as the registered adapter, with polling delay removed for this offline test.
  const video = await createVeoAiFreeVideoAdapter({ pollIntervalMs: 0 }).generate({ model: "veo", body: { prompt: "rain" }, credentials: saved });
  expect(video.success).toBe(true);
  expect(fetch.mock.calls[0][1].headers.Cookie).toBeUndefined();
  expect(fetch.mock.calls[1][1].headers.Cookie).toBe(`${name}=${secret}`);
  expect(fetch.mock.calls[2][1].headers.Cookie).toBe(`${name}=${secret}`);
  expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(secret);
});

it("binds replacement to one Veo connection and refuses foreign or expired input without leaking it", async () => {
  const a = await issue({ action: "create", name: "A" });
  const b = await issue({ action: "create", name: "B" });
  const ar = await (await send(a.token, body("synthetic-a"))).json();
  const br = await (await send(b.token, body("synthetic-b"))).json();
  const update = await issue({ action: "update", connectionId: ar.connection.id });
  const mismatch = await send(update.token, { ...body(), connectionId: br.connection.id });
  expect(mismatch.status).toBe(409);
  const valid = await issue({ action: "update", connectionId: ar.connection.id });
  expect((await send(valid.token, { ...body(), connectionId: ar.connection.id })).status).toBe(200);
  expect((await getProviderConnectionById(ar.connection.id)).apiKey).toBe(`${name}=${secret}`);
  expect((await getProviderConnectionById(br.connection.id)).apiKey).toBe(`${name}=synthetic-b`);
  for (const bad of [{ ...body(), origin: "https://www.veoaifree.com" }, { ...body(), cookies: [{ ...body().cookies[0], expirationDate: 1 }] }]) {
    const p = await issue({ action: "create", name: "Rejected" });
    const res = await send(p.token, bad);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(secret);
  }
  expect(JSON.stringify(logs.flatMap((spy) => spy.mock.calls))).not.toContain(secret);
});
