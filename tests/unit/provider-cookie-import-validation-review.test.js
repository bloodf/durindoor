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
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cookie-import-"));
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
// Only the adapter is a fixture: creation, update, transaction and encryption are the real repository.
vi.mock("@/lib/localDb", async () => ({
  ...(await import("../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));


import { POST as pair } from "../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../src/app/api/providers/cookie-import/route.js";
import { getCookieImportContract } from "../../src/lib/providers/cookieImport/contract.js";
import {
  clearPairings,
} from "../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER, MAX_IMPORT_BODY_BYTES } from "../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../src/lib/db/repos/connectionsRepo.js";

const DASHBOARD = "https://dashboard.example";
const PROVIDER_ORIGIN = "https://chatgpt.com";
// Synthetic only: none of these is a real credential.
const FIRST = "synthetic-session-chunk-zero";
const SECOND = "synthetic-session-chunk-one";

let db;
let logs;

function pairingRequest(body, { token = "operator-one", url = `${DASHBOARD}/api/providers/cookie-import/pairing`, headers = {} } = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-9r-cli-token": token, origin: DASHBOARD, ...headers },
    body: JSON.stringify(body),
  });
}
async function issue(body, options) {
  const res = await pair(pairingRequest(body, options));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()).pairing;
}
const createPairing = (provider = "chatgpt-web", name = "Imported") => issue({ provider, action: "create", name });
const updatePairing = (connectionId, provider = "chatgpt-web") => issue({ provider, action: "update", connectionId });

function importRequest(token, body, { url = `${DASHBOARD}/api/providers/cookie-import`, headers = {}, raw } = {}) {
  const h = { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", ...headers };
  if (token !== null) h[PAIRING_HEADER] = token;
  return new NextRequest(url, { method: "POST", headers: h, body: raw ?? JSON.stringify(body) });
}
const goodCookies = () => [
  { name: "__Secure-next-auth.session-token.1", value: SECOND, domain: ".chatgpt.com", secure: true },
  { name: "__Secure-next-auth.session-token.0", value: FIRST, domain: "chatgpt.com", secure: true },
];
const goodBody = (extra = {}) => ({ provider: "chatgpt-web", origin: PROVIDER_ORIGIN, cookies: goodCookies(), ...extra });
const rows = () => db.all("SELECT * FROM providerConnections");

beforeEach(() => {
  clearPairings();
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:");
  // The whole chain: connection updates take the quota write lock created by later migrations.
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
  vi.useRealTimers();
  db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.originalDataDir;
  fs.rmSync(state.dataDir, { recursive: true, force: true });
});

describe("cookie import validation review", () => {
  it("rejects duplicate and concurrent creates atomically, while allowing other providers and credential types", async () => {
    const first = await createPairing("chatgpt-web", "Shared");
    const second = await createPairing("chatgpt-web", "Shared");
    const responses = await Promise.all([first, second].map((pairing) => importCookies(importRequest(pairing.token, goodBody()))));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const again = await createPairing("chatgpt-web", "Shared");
    expect((await importCookies(importRequest(again.token, goodBody()))).status).toBe(409);
    expect(rows()).toHaveLength(1);
    const other = await createPairing("grok-web", "Shared");
    expect((await importCookies(importRequest(other.token, { provider: "grok-web", origin: "https://grok.com", cookies: [{ name: "sso", value: "synthetic" }] }))).status).toBe(201);
    await createProviderConnection({ provider: "chatgpt-web", authType: "apikey", name: "Different type", apiKey: "synthetic" }, { createOnly: true });
    const differentType = await createPairing("chatgpt-web", "Different type");
    expect((await importCookies(importRequest(differentType.token, goodBody()))).status).toBe(201);
    expect(rows()).toHaveLength(4);
  });

  it("rejects unsafe values before writing and preserves an explicitly targeted existing cookie", async () => {
    const created = await createPairing();
    const response = await importCookies(importRequest(created.token, goodBody()));
    const { connection } = await response.json();
    const before = await getProviderConnectionById(connection.id);
    for (const value of ["synthetic-\u0100", "synthetic-\ud83d\ude00", "synthetic-\u0000", "synthetic-\n", "synthetic;other=value", " synthetic", "synthetic "]) {
      const pairing = await updatePairing(connection.id, "chatgpt-web");
      const result = await importCookies(importRequest(pairing.token, goodBody({ connectionId: connection.id, cookies: [{ name: "__Secure-next-auth.session-token", value }] })));
      expect(result.status).toBe(400);
      const text = await result.text();
      expect(text).toBe('{"error":"Cookie value is not acceptable"}');
      expect(text).not.toContain(value);
      expect(await getProviderConnectionById(connection.id)).toEqual(before);
    }
    const pairing = await updatePairing(connection.id, "chatgpt-web");
    expect((await importCookies(importRequest(pairing.token, goodBody({ connectionId: connection.id })))).status).toBe(200);
  });

  it.each(["chatgpt-web", "perplexity-web", "grok-web", "muse-spark-web", "adapta-web", "yuanbao-web"])("checks wire safety and valid token syntax for %s", async (provider) => {
    const contract = getCookieImportContract(provider);
    const cookies = contract.cookieNames.map((name) => ({ name, value: "synthetic+/=_-.~%:token" }));
    for (const value of ["synthetic-\u0100", "synthetic-\u007f", "synthetic;other=x"]) {
      const pairing = await createPairing(provider, "Unsafe");
      const result = await importCookies(importRequest(pairing.token, { provider, origin: contract.origin, cookies: [{ ...cookies[0], value }, ...cookies.slice(1)] }));
      expect(result.status).toBe(400);
      expect(await result.json()).toEqual({ error: "Cookie value is not acceptable" });
      expect(rows()).toHaveLength(0);
    }
    const pairing = await createPairing(provider, "Valid");
    const result = await importCookies(importRequest(pairing.token, { provider, origin: contract.origin, cookies }));
    expect(result.status).toBe(201);
    const { connection } = await result.json();
    expect((await getProviderConnectionById(connection.id)).apiKey).toBe(cookies.map(({ name, value }) => `${name}=${value}`).join("; "));
  });
});
