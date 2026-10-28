import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth imports the real machineId utility; only its host provider is synthetic.
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

// Delay only the real settings read, which auth reaches after reading its row.
// Classification, row snapshots, transactions, credentials and writes stay real.
const control = { barrier: null };

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

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
  const localDb = await import("@/lib/localDb");
  const getSettings = localDb.getSettings;
  vi.spyOn(localDb, "getSettings").mockImplementation(async (...args) => {
    const settings = await getSettings(...args);
    const barrier = control.barrier;
    if (barrier) {
      control.barrier = null;
      barrier.entered.resolve();
      await barrier.release.promise;
    }
    return settings;
  });
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
  control.barrier = null;
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

describe("R-02 post-auth-read terminal interleaving", () => {
  it.each([M1, M2])("preserves committed reauth against stale in-flight cooldown: %s", async (model) => {
    const barrier = { entered: deferred(), release: deferred() };
    control.barrier = barrier;
    const ordinary = fail(T - 2000, model, 503, "provider overloaded");
    await barrier.entered.promise;
    try {
      expect((await db.getProviderConnectionById(a.id)).testStatus).toBe("active");
      await fail(T - 1000, M1, 401, "refresh_token_invalidated");
      await assertQuarantined();
    } finally {
      barrier.release.resolve();
      await ordinary;
    }
    const afterCooldown = await assertCredentialsAndSibling();
    await success(T - 500, model);
    const afterSuccess = await assertCredentialsAndSibling();
    expect(afterCooldown).toMatchObject({ testStatus: "reauth_required", isActive: false, errorCode: 401 });
    expect(afterSuccess).toMatchObject({ testStatus: "reauth_required", isActive: false, errorCode: 401 });
  });

  it("two concurrent reauth and cooldown writes keep durable reauth on the same connection", async () => {
    // Deterministic interleaving: cooldown has already read an active snapshot
    // (paused after getSettings) while reauth commits; releasing the cooldown
    // must not demote the quarantine via recordProviderConnectionFallbackState.
    const barrier = { entered: deferred(), release: deferred() };
    control.barrier = barrier;
    const cooldownWrite = fail(T - 2000, M1, 503, "provider overloaded");
    await barrier.entered.promise;
    expect((await db.getProviderConnectionById(a.id)).testStatus).toBe("active");
    await fail(T - 1000, M1, 401, "refresh_token_invalidated");
    await assertQuarantined();
    barrier.release.resolve();
    const cooldownResult = await cooldownWrite;
    expect(cooldownResult).toEqual({ shouldFallback: true, cooldownMs: 0 });
    const afterBoth = await assertCredentialsAndSibling();
    expect(afterBoth).toMatchObject({
      testStatus: "reauth_required",
      isActive: false,
      errorCode: 401,
    });
    expect(afterBoth[`modelLock_${M1}`]).toBeFalsy();
    expect(afterBoth.testStatus).not.toBe("unavailable");
    expect(afterBoth.testStatus).not.toBe("active");
  });

  it("negative control: ordinary success reads committed terminal state transactionally", async () => {
    await fail(T - 1000, M1, 401, "refresh_token_invalidated");
    await success(T - 500, M1);
    await assertQuarantined();
  });
});
