/**
 * Cookie import API, localStorage path (#2034 batch C, TinyCMS Web). The production registry is used:
 * TinyCMS is an API-key provider whose import profile names the `app-config-uuid` localStorage item
 * and no cookie. Only the database adapter and the dashboard operator gate are fixtures; pairing,
 * validation, creation, update and encryption are the real code. Every value is synthetic.
 */
import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../../src/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "../../../src/lib/db/migrations/index.js";
import { applyVersionedMigrations } from "../../../src/lib/db/migrate.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-import-local-storage-"));
  process.env.DATA_DIR = dataDir;
  return {
    getAdapter: vi.fn(),
    getAdapterSync: vi.fn(() => { throw new Error("Fixture adapter is not initialized"); }),
    canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn(),
    dataDir, originalDataDir,
  };
});
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: state.getAdapter, getAdapterSync: state.getAdapterSync }));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: state.canAccessManagementApi,
  isOperatorRequest: state.isOperatorRequest,
  hasExactRequestOrigin: state.hasExactRequestOrigin,
}));
vi.mock("@/models", async () => ({
  ...(await import("../../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));

import { POST as pair } from "../../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCredentials } from "../../../src/app/api/providers/cookie-import/route.js";
import { GET as listConnections } from "../../../src/app/api/providers/route.js";
import { clearPairings } from "../../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER } from "../../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../../src/lib/db/repos/connectionsRepo.js";

const DASHBOARD = "https://dashboard.example";
const ORIGIN = "https://site.tinycms.xyz";
const UUID = "Rsynthetic-device-imported";
const PASTED = "Rsynthetic-device-pasted";

let db;
let logs;

const pairingRequest = (body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import/pairing`, {
  method: "POST", headers: { "content-type": "application/json", "x-9r-cli-token": "operator-one", origin: DASHBOARD }, body: JSON.stringify(body),
});
async function issue(body) {
  const res = await pair(pairingRequest(body));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()).pairing;
}
const importRequest = (token, body) => new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, {
  method: "POST", headers: { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", [PAIRING_HEADER]: token }, body: JSON.stringify(body),
});
const rows = () => db.all("SELECT * FROM providerConnections");
const loggedText = () => logs.flatMap((spy) => spy.mock.calls).map((call) => call.map(String).join(" ")).join("\n");

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:");
  db.exec("CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  applyVersionedMigrations(db, MIGRATIONS);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  state.canAccessManagementApi.mockReset().mockResolvedValue(true);
  state.isOperatorRequest.mockReset().mockResolvedValue(true);
  state.hasExactRequestOrigin.mockReset().mockReturnValue(true);
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.originalDataDir;
  fs.rmSync(state.dataDir, { recursive: true, force: true });
});

describe("TinyCMS localStorage import through the authenticated import API", () => {
  it("describes the localStorage item in the pairing contract", async () => {
    const pairing = await issue({ provider: "tinycms-web", action: "create", name: "Tiny" });
    expect(pairing.contract).toEqual({ origin: ORIGIN, cookieNames: [], cookiePrefixes: [], localStorageKeys: ["app-config-uuid"] });
  });

  it("creates an API-key connection holding the value in providerSpecificData, with no API key", async () => {
    const pairing = await issue({ provider: "tinycms-web", action: "create", name: "Tiny" });
    const res = await importCredentials(importRequest(pairing.token, { provider: "tinycms-web", origin: ORIGIN, localStorage: { "app-config-uuid": UUID } }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(JSON.stringify(payload)).not.toContain(UUID);
    const { connection } = payload;
    expect(connection).toEqual({ id: expect.any(String), provider: "tinycms-web", name: "Tiny" });
    const stored = await getProviderConnectionById(connection.id);
    expect(stored).toMatchObject({ provider: "tinycms-web", authType: "apikey", providerSpecificData: { "app-config-uuid": UUID } });
    expect(stored.apiKey || null).toBeNull();
    expect(loggedText()).not.toContain(UUID);
    // The connections API never returns the imported device UUID.
    const listed = await listConnections(new NextRequest(`${DASHBOARD}/api/providers`, { headers: { "x-9r-cli-token": "operator-one" } }));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.connections.find((row) => row.id === connection.id)).toMatchObject({ provider: "tinycms-web" });
    expect(JSON.stringify(body)).not.toContain(UUID);
  });

  it.each([
    ["no localStorage value", {}],
    ["a cookie in place of the value", { cookies: [{ name: "app-config-uuid", value: UUID, secure: true }] }],
    ["a cookie beside the value", { localStorage: { "app-config-uuid": UUID }, cookies: [{ name: "sid", value: "synthetic", secure: true }] }],
    ["an unapproved key", { localStorage: { "app-config-uuid": UUID, other: UUID } }],
    ["a value in the wrong format", { localStorage: { "app-config-uuid": "Xsynthetic" } }],
    ["a value with a control character", { localStorage: { "app-config-uuid": "R\u0000synthetic" } }],
  ])("refuses %s and stores nothing", async (_label, extra) => {
    const pairing = await issue({ provider: "tinycms-web", action: "create", name: "Tiny" });
    const res = await importCredentials(importRequest(pairing.token, { provider: "tinycms-web", origin: ORIGIN, ...extra }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain(UUID);
    expect(rows()).toHaveLength(0);
  });

  it("replaces the value of an existing API-key connection and clears a pasted key, which would otherwise win", async () => {
    const existing = await createProviderConnection({
      provider: "tinycms-web", authType: "apikey", name: "Existing", apiKey: PASTED, isActive: true, testStatus: "expired",
      providerSpecificData: { proxyPoolId: null, note: "kept" },
    }, { createOnly: true });
    const pairing = await issue({ provider: "tinycms-web", action: "update", connectionId: existing.id });
    const res = await importCredentials(importRequest(pairing.token, { provider: "tinycms-web", origin: ORIGIN, connectionId: existing.id, localStorage: { "app-config-uuid": UUID } }));
    expect(res.status).toBe(200);
    const stored = await getProviderConnectionById(existing.id);
    expect(stored.providerSpecificData).toMatchObject({ "app-config-uuid": UUID, note: "kept" });
    expect(stored.apiKey || null).toBeNull();
    expect(stored.testStatus).toBe("active");
  });

  it("will not pair an update with a connection of another auth type or provider", async () => {
    const cookie = await createProviderConnection({ provider: "tinycms-web", authType: "cookie", name: "Wrong type", apiKey: "sid=synthetic", isActive: true }, { createOnly: true });
    expect((await pair(pairingRequest({ provider: "tinycms-web", action: "update", connectionId: cookie.id }))).status).toBe(409);
    const other = await createProviderConnection({ provider: "blackbox-web", authType: "cookie", name: "Other", apiKey: "next-auth.session-token=synthetic", isActive: true }, { createOnly: true });
    expect((await pair(pairingRequest({ provider: "tinycms-web", action: "update", connectionId: other.id }))).status).toBe(409);
  });

  it("refuses a localStorage value for a cookie provider", async () => {
    const pairing = await issue({ provider: "blackbox-web", action: "create", name: "Box" });
    const res = await importCredentials(importRequest(pairing.token, {
      provider: "blackbox-web", origin: "https://app.blackbox.ai",
      cookies: [{ name: "next-auth.session-token", value: "synthetic", secure: true, domain: "app.blackbox.ai" }],
      localStorage: { "app-config-uuid": UUID },
    }));
    expect(res.status).toBe(400);
    expect(rows()).toHaveLength(0);
  });
});
