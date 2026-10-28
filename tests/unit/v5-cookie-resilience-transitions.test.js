import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth imports the real machineId utility; only its host provider is synthetic.
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const T = Date.parse("2026-10-10T00:00:10.000Z");
const M1 = "gpt-5.4";
const M2 = "gpt-5.4-mini";
let root;
let db;
let auth;
let a;
let b;
let originalA;
let originalB;

beforeEach(async () => {
  const temporaryParent = process.env.TMPDIR;
  if (!temporaryParent || !path.isAbsolute(temporaryParent) || os.tmpdir() !== temporaryParent) {
    throw new Error("Confined runtime must supply an absolute private TMPDIR");
  }
  root = fs.mkdtempSync(path.join(temporaryParent, "resilience-db-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) {
    vi.stubEnv(key, undefined);
  }
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  vi.spyOn(Date, "now").mockReturnValue(T);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External HTTP is forbidden in resilience fixtures"); }));
  db = await import("@/lib/db/index.js");
  auth = await import("../../src/sse/services/auth.js");
  a = await db.createProviderConnection({
    provider: "codex", authType: "oauth", name: "synthetic-A", email: "a@fixture.invalid",
    accessToken: "synthetic-access-A", refreshToken: "synthetic-refresh-A",
    providerSpecificData: { chatgptAccountId: "synthetic-account-A" }, testStatus: "active", isActive: true,
  });
  b = await db.createProviderConnection({
    provider: "codex", authType: "oauth", name: "synthetic-B", email: "b@fixture.invalid",
    accessToken: "synthetic-access-B", refreshToken: "synthetic-refresh-B",
    providerSpecificData: { chatgptAccountId: "synthetic-account-B" }, testStatus: "active", isActive: true,
  });
  originalA = await db.getProviderConnectionById(a.id);
  originalB = await db.getProviderConnectionById(b.id);
});

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fail(at, model = M1, status = 429, message = "rate limit") {
  return auth.markAccountUnavailable(a.id, status, message, "codex", model, null, { attemptStartedAt: at });
}

async function success(at, model = M1, account = a, snapshot = originalA) {
  // Deliberately stale caller snapshot: real atomic repository must reread the row.
  await auth.clearAccountError(account.id, { _connection: snapshot }, model, {
    provider: "codex", attemptStartedAt: at,
  });
}

async function assertCredentialsAndSibling() {
  const row = await db.getProviderConnectionById(a.id);
  expect(row.accessToken).toBe(originalA.accessToken);
  expect(row.refreshToken).toBe(originalA.refreshToken);
  expect(await db.getProviderConnectionById(b.id)).toEqual(originalB);
  return row;
}

async function assertQuarantined() {
  const row = await assertCredentialsAndSibling();
  expect(row).toMatchObject({ testStatus: "reauth_required", isActive: false });
  const eligible = await db.getProviderConnections({ provider: "codex", isActive: true });
  expect(eligible.map((item) => item.id)).toEqual([b.id]);
}

// Real auth, classifier, localDb and SQLite persist all transitions; no state-output mocks.
describe("R-02 fixed-clock account/model completion ordering", () => {
  it.each(["failure-first", "success-first"])("newer failure survives older success: %s", async (order) => {
    const failure = () => fail(T - 1000);
    const clear = () => success(T - 2000);
    if (order === "failure-first") { await failure(); await clear(); }
    else { await clear(); await failure(); }
    const row = await assertCredentialsAndSibling();
    expect(row.testStatus).toBe("unavailable");
    expect(Date.parse(row[`modelLock_${M1}`])).toBeGreaterThan(T);
    expect(row[`modelStateObserved_${M1}`]).toBe(new Date(T - 1000).toISOString());
    expect(row.updatedAt).toBe(originalA.updatedAt);
  });

  it.each(["failure-first", "success-first"])("newer success fences older failure: %s", async (order) => {
    const failure = () => fail(T - 2000);
    const clear = () => success(T - 1000);
    if (order === "failure-first") { await failure(); await clear(); }
    else { await clear(); await failure(); }
    const row = await assertCredentialsAndSibling();
    expect(row).toMatchObject({ testStatus: "active", lastError: null, errorCode: null });
    expect(row[`modelLock_${M1}`]).toBeNull();
    expect(row[`modelStateObserved_${M1}`]).toBe(new Date(T - 1000).toISOString());
    expect(row.updatedAt).toBe(originalA.updatedAt);
  });

  it("rejects an equal-timestamp failure after accepted success", async () => {
    await success(T - 1000);
    await fail(T - 1000);
    const row = await assertCredentialsAndSibling();
    expect(row.testStatus).toBe("active");
    expect(row[`modelLock_${M1}`]).toBeNull();
  });

  it.each(["failure-first", "success-first"])("other-model success preserves future lock: %s", async (order) => {
    if (order === "failure-first") { await fail(T - 2000); await success(T - 1000, M2); }
    else { await success(T - 1000, M2); await fail(T - 2000); }
    const row = await assertCredentialsAndSibling();
    expect(Date.parse(row[`modelLock_${M1}`])).toBeGreaterThan(T);
    expect(row[`modelLock_${M2}`]).toBeNull();
    expect(row.testStatus).toBe("unavailable");
  });

  it("B success does not clear A failure on the same model", async () => {
    await fail(T - 2000);
    await success(T - 1000, M1, b, originalB);
    const row = await db.getProviderConnectionById(a.id);
    expect(row.testStatus).toBe("unavailable");
    expect(Date.parse(row[`modelLock_${M1}`])).toBeGreaterThan(T);
    const sibling = await db.getProviderConnectionById(b.id);
    expect(sibling.testStatus).toBe("active");
    expect(sibling.accessToken).toBe(originalB.accessToken);
    expect(sibling.refreshToken).toBe(originalB.refreshToken);
    expect(sibling[`modelStateObserved_${M1}`]).toBe(new Date(T - 1000).toISOString());
  });

  it.each(["reauth-first", "success-first"])("ordinary success never revives reauth: %s", async (order) => {
    const terminal = () => fail(T - 1000, M1, 401, "refresh_token_invalidated");
    const clear = () => success(T - 2000);
    if (order === "reauth-first") { await terminal(); await clear(); }
    else { await clear(); await terminal(); }
    await assertQuarantined();
  });

  it.each([
    ["reauth-first", M1], ["failure-first", M1],
    ["reauth-first", M2], ["failure-first", M2],
  ])("ordinary failure cannot demote reauth: %s / %s", async (order, model) => {
    const terminal = () => fail(T - 1000, M1, 401, "refresh_token_invalidated");
    const ordinary = () => fail(T - 2000, model, 503, "provider overloaded");
    if (order === "reauth-first") { await terminal(); await ordinary(); }
    else { await ordinary(); await terminal(); }
    await assertQuarantined();
    // A demoted row must not become active after a later ordinary success either.
    await success(T - 500, model);
    await assertQuarantined();
  });

  it.each([413, 499])("terminal client status %s never changes accounts despite transient-looking text", async (status) => {
    expect(await fail(T - 1000, M1, status, "rate limit overloaded")).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(await db.getProviderConnectionById(a.id)).toEqual(originalA);
    expect(await db.getProviderConnectionById(b.id)).toEqual(originalB);
  });
});
