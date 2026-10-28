import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Narrow audit of recordProviderConnectionFallbackState's reauth write guard.
 * Production callers of that function (aside from re-exports) are only
 * src/sse/services/auth.js. These cases exercise the repository directly so a
 * demotion cannot hide behind auth.js early returns.
 */

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-cookie-machine-id" }));

const T = Date.parse("2026-10-10T00:00:10.000Z");
const M1 = "gpt-5.4";

let root;
let database;

beforeEach(async () => {
  const temporaryParent = process.env.TMPDIR;
  if (!temporaryParent || !path.isAbsolute(temporaryParent) || os.tmpdir() !== temporaryParent) {
    throw new Error("Confined runtime must supply an absolute private TMPDIR");
  }
  root = fs.mkdtempSync(path.join(temporaryParent, "reauth-guard-"));
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
  database = await import("@/lib/db/index.js");
});

afterEach(async () => {
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

async function seedActive() {
  return database.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    name: "synthetic-guard",
    email: "guard@fixture.invalid",
    accessToken: "synthetic-access-guard",
    refreshToken: "synthetic-refresh-guard",
    providerSpecificData: { chatgptAccountId: "synthetic-account-guard" },
    testStatus: "active",
    isActive: true,
  });
}

async function pinReauth(id, at = T - 1000) {
  await database.updateProviderConnection(id, {
    testStatus: "reauth_required",
    isActive: false,
    errorCode: 401,
    lastError: "refresh_token_invalidated",
    lastErrorAt: new Date(at).toISOString(),
    backoffLevel: 0,
  });
  return database.getProviderConnectionById(id);
}

describe("recordProviderConnectionFallbackState reauth write guard", () => {
  it("refuses an ordinary cooldown write against durable reauth (guard conflict)", async () => {
    const row = await seedActive();
    const pinned = await pinReauth(row.id);
    const result = await database.recordProviderConnectionFallbackState(row.id, {
      model: M1,
      status: 503,
      reasonCode: "provider_error",
      reason: "provider overloaded",
      cooldownMs: 60_000,
      observedAt: T - 500,
    });
    expect(result).toEqual({ applied: false, connection: expect.objectContaining({
      id: row.id,
      testStatus: "reauth_required",
      isActive: false,
      errorCode: 401,
      accessToken: pinned.accessToken,
      refreshToken: pinned.refreshToken,
    }) });
    const stored = await database.getProviderConnectionById(row.id);
    expect(stored).toMatchObject({
      testStatus: "reauth_required",
      isActive: false,
      errorCode: 401,
      lastError: "refresh_token_invalidated",
    });
    expect(stored[`modelLock_${M1}`]).toBeFalsy();
    expect(stored.accessToken).toBe(pinned.accessToken);
    expect(stored.refreshToken).toBe(pinned.refreshToken);
  });

  it("missing row fails closed with no return payload and no throw side effects", async () => {
    const result = await database.recordProviderConnectionFallbackState("missing-connection-id", {
      model: M1,
      status: 503,
      reasonCode: "provider_error",
      cooldownMs: 60_000,
      observedAt: T - 500,
    });
    expect(result).toBeNull();
    expect(await database.getProviderConnectionById("missing-connection-id")).toBeNull();
  });

  it("aborted transaction fails closed without demoting reauth or writing locks", async () => {
    const row = await seedActive();
    const pinned = await pinReauth(row.id);
    const signal = AbortSignal.abort();
    await expect(database.recordProviderConnectionFallbackState(row.id, {
      model: M1,
      status: 503,
      reasonCode: "provider_error",
      cooldownMs: 60_000,
      observedAt: T - 500,
    }, { signal })).rejects.toMatchObject({ name: "AbortError" });
    const stored = await database.getProviderConnectionById(row.id);
    expect(stored).toMatchObject({
      testStatus: "reauth_required",
      isActive: false,
      errorCode: 401,
      lastError: pinned.lastError,
      accessToken: pinned.accessToken,
      refreshToken: pinned.refreshToken,
    });
    expect(stored[`modelLock_${M1}`]).toBeFalsy();
  });

  it("unrelated active-connection cooldown caller still applies unavailable state", async () => {
    const row = await seedActive();
    const result = await database.recordProviderConnectionFallbackState(row.id, {
      model: M1,
      status: 503,
      reasonCode: "provider_error",
      reason: "provider overloaded",
      cooldownMs: 60_000,
      observedAt: T - 500,
    });
    expect(result.applied).toBe(true);
    expect(result.connection).toMatchObject({
      testStatus: "unavailable",
      errorCode: 503,
      lastError: "provider overloaded",
    });
    expect(Date.parse(result.connection[`modelLock_${M1}`])).toBe(T - 500 + 60_000);
    const stored = await database.getProviderConnectionById(row.id);
    expect(stored.testStatus).toBe("unavailable");
    expect(stored.isActive).toBe(true);
  });

  it("does not reactivate an ordinary cooldown row when a later failure records", async () => {
    const row = await seedActive();
    const first = await database.recordProviderConnectionFallbackState(row.id, {
      model: M1,
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 120_000,
      observedAt: T - 2000,
    });
    expect(first.applied).toBe(true);
    expect(first.connection.testStatus).toBe("unavailable");
    const second = await database.recordProviderConnectionFallbackState(row.id, {
      model: M1,
      status: 503,
      reasonCode: "provider_error",
      reason: "provider overloaded",
      cooldownMs: 30_000,
      observedAt: T - 1000,
    });
    expect(second.applied).toBe(true);
    expect(second.connection.testStatus).toBe("unavailable");
    expect(second.connection.testStatus).not.toBe("active");
    const stored = await database.getProviderConnectionById(row.id);
    expect(stored).toMatchObject({ testStatus: "unavailable", isActive: true });
    expect(stored.testStatus).not.toBe("active");
    // Longer first expiry wins; later shorter cooldown must not shrink or clear it.
    expect(Date.parse(stored[`modelLock_${M1}`])).toBe(T - 2000 + 120_000);
  });
});
