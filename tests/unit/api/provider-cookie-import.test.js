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
vi.mock("@/models", async () => ({
  ...(await import("../../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [
  { id: "cookie-web", alias: "cookie-web", category: "webCookie", authType: "cookie", display: { name: "Cookie Web" }, webLogin: { origin: "https://provider.example", cookieNames: ["session"], cookiePrefixes: ["session."] } },
  { id: "other-web", alias: "other-web", category: "webCookie", authType: "cookie", display: { name: "Other Web" }, webLogin: { origin: "https://other.example", cookieNames: ["sso"] } },
  { id: "probe-web", alias: "probe-web", category: "webCookie", authType: "cookie", display: { name: "Probe Web" }, webLogin: { origin: "https://probe.example", cookieNames: "*", readyProbe: { url: "https://probe.example/session" } } },
  { id: "plain-http-web", alias: "plain-http-web", category: "webCookie", authType: "cookie", display: { name: "Plain Web" }, webLogin: { origin: "http://plain.example", cookieNames: ["session"] } },
  { id: "no-login-web", alias: "no-login-web", category: "webCookie", authType: "cookie", display: { name: "No Login" } },
] }));

import { POST as pair } from "../../../src/app/api/providers/cookie-import/pairing/route.js";
import { POST as importCookies } from "../../../src/app/api/providers/cookie-import/route.js";
import { getCookieImportContract } from "../../../src/lib/providers/cookieImport/contract.js";
import {
  PAIRING_TTL_MS, MAX_PENDING_PER_OWNER, clearPairings, pendingPairingCount,
} from "../../../src/lib/providers/cookieImport/pairing.js";
import { PAIRING_HEADER, MAX_IMPORT_BODY_BYTES } from "../../../src/lib/providers/cookieImport/handlers.js";
import { getProviderConnectionById, createProviderConnection } from "../../../src/lib/db/repos/connectionsRepo.js";
import { redactHeaders } from "../../../src/lib/observability/redact.js";

const DASHBOARD = "https://dashboard.example";
const PROVIDER_ORIGIN = "https://provider.example";
// Synthetic only: none of these is a real credential.
const FIRST = "synthetic-session-chunk-zero";
const SECOND = "synthetic-session-chunk-one";
const SINGLE = "synthetic-single-session-value";

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
const createPairing = (provider = "cookie-web", name = "Imported") => issue({ provider, action: "create", name });
const updatePairing = (connectionId, provider = "cookie-web") => issue({ provider, action: "update", connectionId });

function importRequest(token, body, { url = `${DASHBOARD}/api/providers/cookie-import`, headers = {}, raw } = {}) {
  const h = { "content-type": "application/json", origin: "chrome-extension://synthetic-extension-id", ...headers };
  if (token !== null) h[PAIRING_HEADER] = token;
  return new NextRequest(url, { method: "POST", headers: h, body: raw ?? JSON.stringify(body) });
}
const goodCookies = () => [
  { name: "session.1", value: SECOND, domain: ".provider.example", secure: true },
  { name: "session.0", value: FIRST, domain: "provider.example", secure: true },
];
const goodBody = (extra = {}) => ({ provider: "cookie-web", origin: PROVIDER_ORIGIN, cookies: goodCookies(), ...extra });
const rows = () => db.all("SELECT * FROM providerConnections");

function seedConnection(overrides = {}) {
  return createProviderConnection({
    provider: "cookie-web", authType: "cookie", name: "Existing", apiKey: "session=synthetic-old-value",
    isActive: true, testStatus: "unknown", ...overrides,
  }, { createOnly: true });
}

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

const loggedText = () => logs.flatMap((spy) => spy.mock.calls).map((call) => call.map(String).join(" ")).join("\n");

describe("pairing issuance authority", () => {
  it("requires management access and an operator, never an API key", async () => {
    state.canAccessManagementApi.mockResolvedValue(false);
    expect((await pair(pairingRequest({ provider: "cookie-web", action: "create", name: "A" }))).status).toBe(403);
    state.canAccessManagementApi.mockResolvedValue(true);
    state.isOperatorRequest.mockResolvedValue(false);
    expect((await pair(pairingRequest({ provider: "cookie-web", action: "create", name: "A" }))).status).toBe(403);
    expect(pendingPairingCount()).toBe(0);
  });

  it("rejects cross-origin and isolated-login-host requests", async () => {
    state.hasExactRequestOrigin.mockReturnValue(false);
    expect((await pair(pairingRequest({ provider: "cookie-web", action: "create", name: "A" }, { headers: { origin: "https://foreign.example" } }))).status).toBe(403);
    state.hasExactRequestOrigin.mockReturnValue(true);
    const login = pairingRequest({ provider: "cookie-web", action: "create", name: "A" }, { url: "https://login.example/api/providers/cookie-import/pairing", headers: { host: "login.example" } });
    expect((await pair(login)).status).toBe(403);
    expect(pendingPairingCount()).toBe(0);
  });

  it("binds a pairing to a supported provider and an explicit action", async () => {
    for (const body of [
      { provider: "nope", action: "create", name: "A" },
      { provider: "probe-web", action: "create", name: "A" }, // no cookie-name allowlist
      { provider: "plain-http-web", action: "create", name: "A" }, // not an HTTPS origin
      { provider: "no-login-web", action: "create", name: "A" },
      { provider: "cookie-web", name: "A" }, // no explicit action
      { provider: "cookie-web", action: "create" },
      { provider: "cookie-web", action: "create", name: "A", connectionId: "x" },
      { provider: "cookie-web", action: "update" },
      { provider: "cookie-web", action: "update", connectionId: "x", name: "A" },
    ]) expect((await pair(pairingRequest(body))).status, JSON.stringify(body)).toBe(400);
    expect(pendingPairingCount()).toBe(0);
  });

  it("checks the target connection at issuance", async () => {
    expect((await pair(pairingRequest({ provider: "cookie-web", action: "update", connectionId: "missing" }))).status).toBe(404);
    const other = await createProviderConnection({ provider: "other-web", authType: "cookie", name: "O", apiKey: "sso=synthetic", isActive: true }, { createOnly: true });
    expect((await pair(pairingRequest({ provider: "cookie-web", action: "update", connectionId: other.id }))).status).toBe(409);
    const apiKeyConn = await createProviderConnection({ provider: "cookie-web", authType: "apikey", name: "K", apiKey: "synthetic", isActive: true }, { createOnly: true });
    expect((await pair(pairingRequest({ provider: "cookie-web", action: "update", connectionId: apiKeyConn.id }))).status).toBe(409);
    expect(pendingPairingCount()).toBe(0);
  });

  it("describes the contract without echoing internal configuration and sets no-store", async () => {
    const res = await pair(pairingRequest({ provider: "cookie-web", action: "create", name: "A" }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { pairing } = await res.json();
    expect(pairing).toMatchObject({
      provider: "cookie-web", action: "create", name: "A", header: PAIRING_HEADER, ttlSeconds: PAIRING_TTL_MS / 1000,
      importUrl: `${DASHBOARD}/api/providers/cookie-import`,
      contract: { origin: PROVIDER_ORIGIN, cookieNames: ["session"], cookiePrefixes: ["session."] },
    });
    expect(pairing.token).toMatch(/^ddpair_[A-Za-z0-9_-]{43}$/);
    expect(pairing).not.toHaveProperty("owner");
  });

  it("supersedes only the same operator's oldest pending pairings", async () => {
    const first = await createPairing();
    const other = await issue({ provider: "cookie-web", action: "create", name: "B" }, { token: "operator-two" });
    for (let i = 0; i < MAX_PENDING_PER_OWNER; i++) await createPairing();
    expect((await importCookies(importRequest(first.token, goodBody()))).status).toBe(401);
    expect((await importCookies(importRequest(other.token, goodBody({ name: "B" })))).status).toBe(201);
  });

  it("requires HTTPS, allowing plain HTTP only for a loopback host", async () => {
    const insecure = pairingRequest({ provider: "cookie-web", action: "create", name: "A" }, { url: "http://203.0.113.9:20128/api/providers/cookie-import/pairing", headers: { host: "203.0.113.9:20128" } });
    expect((await pair(insecure)).status).toBe(403);
    for (const host of ["localhost:20127", "127.0.0.1:20127", "[::1]:20127"]) {
      vi.stubEnv("BASE_URL", "");
      const loopback = pairingRequest({ provider: "cookie-web", action: "create", name: "A" }, { url: `http://${host}/api/providers/cookie-import/pairing`, headers: { host, origin: `http://${host}` } });
      expect((await pair(loopback)).status, host).toBe(201);
    }
  });
});

describe("import authorization", () => {
  it("accepts no credential but a valid pairing and never consults dashboard authority", async () => {
    const attempts = [
      importRequest(null, goodBody(), { headers: { authorization: "Bearer sk-synthetic", "x-api-key": "sk-synthetic", "x-9r-cli-token": "operator-one", cookie: "auth_token=synthetic" } }),
      importRequest("sk-synthetic-api-key", goodBody(), { headers: { authorization: "Bearer sk-synthetic" } }),
      importRequest("ddpair_" + "A".repeat(43), goodBody()),
      importRequest("ddpair_short", goodBody()),
    ];
    for (const attempt of attempts) expect((await importCookies(attempt)).status).toBe(401);
    expect(state.canAccessManagementApi).not.toHaveBeenCalled();
    expect(state.isOperatorRequest).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });

  it("is not a general credential: the pairing secret is the only thing it reads", async () => {
    const pairing = await createPairing();
    // The secret in an Authorization header, not the dedicated header, grants nothing.
    const res = await importCookies(importRequest(null, goodBody(), { headers: { authorization: `Bearer ${pairing.token}` } }));
    expect(res.status).toBe(401);
    expect(rows()).toHaveLength(0);
    // And the header name is treated as a secret by the shared redactor.
    expect(redactHeaders({ [PAIRING_HEADER]: pairing.token })[PAIRING_HEADER]).toBe("[redacted]");
  });

  it("refuses the isolated login host", async () => {
    const pairing = await createPairing();
    const res = await importCookies(importRequest(pairing.token, goodBody(), { url: "https://login.example/api/providers/cookie-import", headers: { host: "login.example" } }));
    expect(res.status).toBe(403);
    expect(pendingPairingCount()).toBe(1);
  });
});

describe("successful import", () => {
  it("creates an encrypted connection from approved chunked cookies without echoing them", async () => {
    const pairing = await createPairing("cookie-web", "Imported");
    const res = await importCookies(importRequest(pairing.token, goodBody()));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(FIRST);
    expect(text).not.toContain(SECOND);
    expect(text).not.toContain(pairing.token);
    const [row] = rows();
    expect(row.data).not.toContain(FIRST);
    expect(JSON.parse(row.data).apiKey).toMatchObject({ v: 2 });
    expect(await getProviderConnectionById(JSON.parse(text).connection.id)).toMatchObject({
      provider: "cookie-web", authType: "cookie", name: "Imported", isActive: true,
      apiKey: `session.0=${FIRST}; session.1=${SECOND}`,
    });
    expect(JSON.parse(text)).toEqual({ ok: true, action: "create", connection: { id: expect.any(String), provider: "cookie-web", name: "Imported" } });
  });

  it("accepts the unchunked cookie and an optional matching name", async () => {
    const pairing = await createPairing("cookie-web", "Single");
    const res = await importCookies(importRequest(pairing.token, goodBody({ name: "Single", cookies: [{ name: "session", value: SINGLE }] })));
    expect(res.status).toBe(201);
    expect(rows()).toHaveLength(1);
    expect((await getProviderConnectionById(rows()[0].id)).apiKey).toBe(`session=${SINGLE}`);
  });

  it("replaces the cookie on the bound connection and clears its reauthentication state", async () => {
    const existing = await seedConnection({ testStatus: "reauth_required", priority: 7, defaultModel: "keep-model" });
    const pairing = await updatePairing(existing.id);
    const res = await importCookies(importRequest(pairing.token, goodBody({ connectionId: existing.id })));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(FIRST);
    expect(rows()).toHaveLength(1);
    expect(await getProviderConnectionById(existing.id)).toMatchObject({
      name: "Existing", defaultModel: "keep-model", testStatus: "active", errorCode: null,
      apiKey: `session.0=${FIRST}; session.1=${SECOND}`,
    });
  });

  it("keeps secrets out of every log line, success or failure", async () => {
    const ok = await createPairing();
    await importCookies(importRequest(ok.token, goodBody()));
    const bad = await createPairing("cookie-web", "Second");
    await importCookies(importRequest(bad.token, goodBody({ cookies: [{ name: "cf_clearance", value: "synthetic-clearance" }] })));
    const failing = await createPairing("cookie-web", "Third");
    state.getAdapter.mockRejectedValueOnce(new Error("fixture adapter failure"));
    const res = await importCookies(importRequest(failing.token, goodBody()));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(FIRST);
    const output = loggedText();
    for (const secret of [FIRST, SECOND, "synthetic-clearance", ok.token, bad.token, failing.token]) expect(output).not.toContain(secret);
  });
});

describe("pairing binding, expiry and replay", () => {
  it("rejects a provider, connection or name mismatch and spends the pairing", async () => {
    const existing = await seedConnection();
    // Issued one at a time: an operator's pending pairings are capped, so earlier ones would be superseded.
    const cases = [
      [() => createPairing(), () => goodBody({ provider: "other-web", origin: "https://other.example", cookies: [{ name: "sso", value: "synthetic-sso" }] })],
      [() => createPairing(), () => goodBody({ connectionId: existing.id })],
      [() => createPairing("cookie-web", "Imported"), () => goodBody({ name: "Different" })],
      [() => updatePairing(existing.id), () => goodBody()],
      [() => updatePairing(existing.id), () => goodBody({ connectionId: "another-connection" })],
    ];
    for (const [makePairing, makeBody] of cases) {
      const pairing = await makePairing();
      expect((await importCookies(importRequest(pairing.token, makeBody()))).status).toBe(409);
      // A rejected presentation cannot be retried with a corrected body.
      expect((await importCookies(importRequest(pairing.token, goodBody(pairing.action === "update" ? { connectionId: existing.id } : {})))).status).toBe(401);
    }
    expect(rows()).toHaveLength(1);
    expect((await getProviderConnectionById(existing.id)).apiKey).toBe("session=synthetic-old-value");
  });

  it("refuses to write when the bound connection disappeared before import", async () => {
    const existing = await seedConnection();
    const pairing = await updatePairing(existing.id);
    db.run("DELETE FROM providerConnections WHERE id = ?", [existing.id]);
    expect((await importCookies(importRequest(pairing.token, goodBody({ connectionId: existing.id })))).status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  it("expires a pairing after its short lifetime", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const live = await createPairing();
    const stale = await createPairing("cookie-web", "Late");
    vi.setSystemTime(Date.now() + PAIRING_TTL_MS - 1);
    expect((await importCookies(importRequest(live.token, goodBody()))).status).toBe(201);
    vi.setSystemTime(Date.now() + 1);
    expect((await importCookies(importRequest(stale.token, goodBody({ name: "Late" })))).status).toBe(401);
    expect(rows()).toHaveLength(1);
    expect(pendingPairingCount()).toBe(0);
  });

  it("lets exactly one of many concurrent presentations succeed", async () => {
    const pairing = await createPairing();
    const results = await Promise.all(Array.from({ length: 12 }, () => importCookies(importRequest(pairing.token, goodBody()))));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401)).toHaveLength(11);
    expect(rows()).toHaveLength(1);
  });

  it("rejects a replay after success without writing again", async () => {
    const pairing = await createPairing();
    expect((await importCookies(importRequest(pairing.token, goodBody()))).status).toBe(201);
    expect((await importCookies(importRequest(pairing.token, goodBody()))).status).toBe(401);
    expect(rows()).toHaveLength(1);
  });
});

describe("origin, cookie-name and transport enforcement", () => {
  it.each([
    ["missing", undefined],
    ["http scheme", "http://provider.example"],
    ["trailing slash", "https://provider.example/"],
    ["suffix host", "https://provider.example.evil.example"],
    ["sibling subdomain", "https://www.provider.example"],
    ["port", "https://provider.example:8443"],
    ["different provider origin", "https://other.example"],
  ])("rejects a non-exact provider origin: %s", async (_label, origin) => {
    const pairing = await createPairing();
    expect((await importCookies(importRequest(pairing.token, { ...goodBody(), origin }))).status).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it.each([
    ["unapproved name", [{ name: "cf_clearance", value: "synthetic" }, ...goodCookies()]],
    ["only unapproved", [{ name: "tracking", value: "synthetic" }]],
    ["prefix without index", [{ name: "session.", value: "synthetic" }]],
    ["chunk gap", [{ name: "session.0", value: "synthetic-a" }, { name: "session.2", value: "synthetic-b" }]],
    ["missing required", [{ name: "session.x", value: "synthetic" }]],
    ["foreign domain", [{ name: "session", value: "synthetic", domain: "evil.example" }]],
    ["parent-looking domain", [{ name: "session", value: "synthetic", domain: "provider.example.evil.example" }]],
    ["public suffix domain", [{ name: "session", value: "synthetic", domain: "example" }]],
    ["insecure cookie", [{ name: "session", value: "synthetic", secure: false }]],
    ["expired", [{ name: "session", value: "synthetic", expirationDate: 1 }]],
    ["duplicate", [{ name: "session", value: "synthetic" }, { name: "session", value: "synthetic-2" }]],
    ["separator in value", [{ name: "session", value: "synthetic; session=forged" }]],
    ["newline in value", [{ name: "session", value: "synthetic\r\nX: y" }]],
    ["empty value", [{ name: "session", value: "" }]],
    ["huge value", [{ name: "session", value: "a".repeat(9000) }]],
    ["wrong value type", [{ name: "session", value: 12 }]],
    ["not an object", ["session=synthetic"]],
    ["empty list", []],
    ["not a list", { session: "synthetic" }],
    ["too many", Array.from({ length: 17 }, (_, i) => ({ name: `session.${i}`, value: "synthetic" }))],
  ])("rejects cookies: %s", async (_label, cookies) => {
    const pairing = await createPairing();
    const res = await importCookies(importRequest(pairing.token, goodBody({ cookies })));
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("synthetic");
    expect(rows()).toHaveLength(0);
  });

  it("requires HTTPS for the import call except on a loopback host", async () => {
    const pairing = await createPairing();
    const insecure = importRequest(pairing.token, goodBody(), { url: "http://203.0.113.9:20128/api/providers/cookie-import", headers: { host: "203.0.113.9:20128" } });
    expect((await importCookies(insecure)).status).toBe(403);
    // Rejected before the pairing was read, so it is still usable on loopback.
    vi.stubEnv("BASE_URL", "");
    const local = importRequest(pairing.token, goodBody(), { url: "http://localhost:20127/api/providers/cookie-import", headers: { host: "localhost:20127" } });
    expect((await importCookies(local)).status).toBe(201);
  });

  it("trusts a TLS-terminated deployment only through its configured public origin", async () => {
    const pairing = await createPairing();
    const proxied = importRequest(pairing.token, goodBody(), { url: "http://dashboard.example/api/providers/cookie-import", headers: { host: "dashboard.example" } });
    expect((await importCookies(proxied)).status).toBe(201);
  });
});

describe("body limits and content type", () => {
  it("rejects an oversized body by declared length or by streamed size without spending the pairing", async () => {
    const pairing = await createPairing();
    const big = JSON.stringify(goodBody({ padding: "x".repeat(MAX_IMPORT_BODY_BYTES) }));
    expect((await importCookies(importRequest(pairing.token, null, { raw: big, headers: { "content-length": String(big.length) } }))).status).toBe(413);
    const streamed = new NextRequest(`${DASHBOARD}/api/providers/cookie-import`, {
      method: "POST",
      headers: { "content-type": "application/json", [PAIRING_HEADER]: pairing.token },
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(big)); controller.close(); } }),
      duplex: "half",
    });
    expect((await importCookies(streamed)).status).toBe(413);
    expect(pendingPairingCount()).toBe(1);
    expect((await importCookies(importRequest(pairing.token, goodBody()))).status).toBe(201);
  });

  it("rejects non-JSON content, invalid JSON and non-object JSON", async () => {
    const pairing = await createPairing();
    expect((await importCookies(importRequest(pairing.token, null, { raw: "x", headers: { "content-type": "text/plain" } }))).status).toBe(415);
    for (const raw of ["{", "[]", "null", "\"text\""]) expect((await importCookies(importRequest(pairing.token, null, { raw }))).status, raw).toBe(400);
    expect(pendingPairingCount()).toBe(1);
  });

  it("bounds the pairing request body too", async () => {
    const res = await pair(pairingRequest({ provider: "cookie-web", action: "create", name: "x".repeat(5000) }));
    expect(res.status).toBe(413);
  });
});

describe("provider cookie-import contract", () => {
  it("derives an importable contract only from an HTTPS origin with explicit cookie names", () => {
    expect(getCookieImportContract("cookie-web")).toMatchObject({ provider: "cookie-web", origin: PROVIDER_ORIGIN, host: "provider.example", cookieNames: ["session"], cookiePrefixes: ["session."] });
    expect(Object.isFrozen(getCookieImportContract("cookie-web"))).toBe(true);
    for (const id of ["probe-web", "plain-http-web", "no-login-web", "missing", "", undefined]) expect(getCookieImportContract(id), String(id)).toBeNull();
  });
});
