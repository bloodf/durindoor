import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-fallback-state-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("atomic provider fallback health state", () => {
  it("persists pristine success watermarks that fence older failures", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { createProviderRateLimitEvidence } = await import(
      "../../src/shared/services/providerRateLimitEvidence.js"
    );
    const db = await getAdapter();
    const base = Date.parse("2026-07-10T12:00:00.000Z");
    const createdAt = new Date(base).toISOString();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-pristine', 'codex', 'oauth', 'Codex', 1, '{}', ?, ?)`,
      [createdAt, createdAt],
    );

    const clear = await database.clearProviderConnectionFallbackState("conn-pristine", {
      model: "gpt-5.4",
      observedAt: base + 300,
    }, { now: base + 10_000 });
    expect(clear.applied).toBe(true);
    expect(clear.connection["modelStateObserved_gpt-5.4"]).toBe(new Date(base + 300).toISOString());

    const oldLegacyFailure = await database.recordProviderConnectionFallbackState("conn-pristine", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 60_000,
      observedAt: base + 250,
    }, { now: base + 10_000 });
    expect(oldLegacyFailure.applied).toBe(false);
    expect(oldLegacyFailure.connection["modelLock_gpt-5.4"]).toBeNull();

    const evidence = createProviderRateLimitEvidence({
      repository: database,
      now: () => base + 10_000,
    });
    const quotaClear = await evidence.clear({
      connectionId: "conn-pristine",
      provider: "codex",
      model: "gpt-5.4",
      attemptStartedAt: base + 500,
    });
    expect(quotaClear.persisted).toBe(true);

    const oldQuotaFailure = await evidence.record({
      connectionId: "conn-pristine",
      provider: "codex",
      model: "gpt-5.4",
      attemptStartedAt: base + 450,
      state: "cooldown",
      resetAtMs: base + 60_000,
    });
    expect(oldQuotaFailure).toMatchObject({ persisted: false, reason: "superseded" });
    await expect(database.listProviderQuotaSnapshots({
      connectionId: "conn-pristine",
      provider: "codex",
      includeStale: true,
      now: base + 10_000,
    })).resolves.toEqual([]);
  });

  it("persists a bounded secret-safe transport failure reason", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const db = await getAdapter();
    const now = Date.now();
    const createdAt = new Date(now - 60_000).toISOString();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-transport', 'openrouter', 'apikey', 'OpenRouter', 1, '{}', ?, ?)`,
      [createdAt, createdAt],
    );
    const failure = new TypeError("fetch failed");
    failure.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
      code: "ECONNREFUSED",
    });
    failure.request = { headers: { authorization: "Bearer request-secret" } };

    await markAccountUnavailable(
      "conn-transport",
      502,
      failure,
      "openrouter",
      "openai/gpt-4o-mini",
      null,
      { attemptStartedAt: now },
    );

    const stored = await database.getProviderConnectionById("conn-transport");
    expect(stored.lastError).toBe("fetch failed (ECONNREFUSED)");
    expect(stored.lastError.length).toBeLessThanOrEqual(100);
    expect(stored.lastError).not.toContain("request-secret");
    expect(stored.lastError).not.toContain("authorization");
  });

  it("never shortens a lock and fences late error/success completions without rewriting credentials", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const base = Date.parse("2026-07-10T12:00:00.000Z");
    const secrets = {
      accessToken: "access-fallback-canary",
      refreshToken: "refresh-fallback-canary",
      apiKey: "api-fallback-canary",
    };
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-state', 'codex', 'oauth', 'Codex', 1, ?, ?, ?)`,
      [JSON.stringify(secrets), new Date(base).toISOString(), new Date(base).toISOString()],
    );

    const first = await database.recordProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 60_000,
      backoffLevel: 1,
      observedAt: base + 100,
    });
    expect(first.applied).toBe(true);
    const firstExpiry = Date.parse(first.connection["modelLock_gpt-5.4"]);

    const shorter = await database.recordProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 1_000,
      backoffLevel: 2,
      observedAt: base + 200,
    });
    expect(shorter.applied).toBe(true);
    expect(Date.parse(shorter.connection["modelLock_gpt-5.4"])).toBe(firstExpiry);
    expect(shorter.connection.backoffLevel).toBe(2);

    const staleError = await database.recordProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 120_000,
      backoffLevel: 3,
      observedAt: base + 150,
    });
    expect(staleError.applied).toBe(false);
    expect(Date.parse(staleError.connection["modelLock_gpt-5.4"])).toBe(firstExpiry);

    const cleared = await database.clearProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      observedAt: base + 300,
    });
    expect(cleared.applied).toBe(true);
    expect(cleared.connection["modelLock_gpt-5.4"]).toBeNull();

    const lateOldError = await database.recordProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 120_000,
      backoffLevel: 4,
      observedAt: base + 250,
    });
    expect(lateOldError.applied).toBe(false);
    expect(lateOldError.connection["modelLock_gpt-5.4"]).toBeNull();

    await database.recordProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 120_000,
      backoffLevel: 4,
      observedAt: base + 500,
    });
    const lateOldSuccess = await database.clearProviderConnectionFallbackState("conn-state", {
      model: "gpt-5.4",
      observedAt: base + 450,
    });
    expect(lateOldSuccess.applied).toBe(false);
    expect(lateOldSuccess.connection["modelLock_gpt-5.4"]).toBeTruthy();

    const stored = await database.getProviderConnectionById("conn-state");
    expect(stored).toMatchObject(secrets);
    expect(stored.updatedAt).toBe(new Date(base).toISOString());
    expect(JSON.stringify(stored)).toContain("access-fallback-canary");
  });

  it("isolates explicit web-fetch locks from chat and account scopes", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const base = Date.now();
    const createdAt = new Date(base - 60_000).toISOString();
    const chatLock = new Date(base + 180_000).toISOString();
    const modelLock = new Date(base + 120_000).toISOString();
    const chatHealth = {
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
    };
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-webfetch', 'ollama', 'apikey', 'Ollama', 1, ?, ?, ?)`,
      [JSON.stringify({
        "modelLock___all": chatLock,
        "modelStateObserved___all": new Date(base - 1_000).toISOString(),
        "modelLock_gpt-oss:120b": modelLock,
        "modelStateObserved_gpt-oss:120b": new Date(base - 1_000).toISOString(),
        ...chatHealth,
      }), createdAt, createdAt],
    );

    await database.recordProviderConnectionFallbackState("conn-webfetch", {
      status: 502,
      reasonCode: "network_error",
      cooldownMs: 60_000,
      backoffLevel: 4,
      observedAt: base + 500,
      webFetch: true,
    }, { now: base + 500 });
    let stored = await database.getProviderConnectionById("conn-webfetch");
    expect(stored["modelLock_webfetch:ollama"]).toBeTruthy();
    expect(stored.modelLock___all).toBe(chatLock);
    expect(stored["modelLock_gpt-oss:120b"]).toBe(modelLock);
    expect(stored).toMatchObject(chatHealth);

    await database.clearProviderConnectionFallbackState("conn-webfetch", {
      observedAt: base + 1_000,
      webFetch: true,
    }, { now: base + 1_000 });
    stored = await database.getProviderConnectionById("conn-webfetch");
    expect(stored["modelLock_webfetch:ollama"]).toBeNull();
    expect(stored).toMatchObject(chatHealth);
    expect(stored.modelLock___all).toBe(chatLock);
    expect(stored["modelLock_gpt-oss:120b"]).toBe(modelLock);
  });

  it("restores chat health while preserving an active web-fetch lock", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const base = Date.now();
    const createdAt = new Date(base - 60_000).toISOString();
    const webFetchLock = new Date(base + 180_000).toISOString();
    const chatLock = new Date(base + 120_000).toISOString();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-chat-success', 'ollama', 'apikey', 'Ollama', 1, ?, ?, ?)`,
      [JSON.stringify({
        "modelLock_webfetch:ollama": webFetchLock,
        "modelLock_gpt-oss:120b": chatLock,
        "modelStateObserved_gpt-oss:120b": new Date(base - 1_000).toISOString(),
        testStatus: "unavailable",
        lastError: "Chat failed",
        lastErrorAt: new Date(base - 1_000).toISOString(),
        errorCode: 503,
        backoffLevel: 3,
      }), createdAt, createdAt],
    );

    const result = await database.clearProviderConnectionFallbackState("conn-chat-success", {
      model: "gpt-oss:120b",
      observedAt: base,
    }, { now: base });

    expect(result.applied).toBe(true);
    expect(result.connection).toMatchObject({
      "modelLock_webfetch:ollama": webFetchLock,
      "modelLock_gpt-oss:120b": null,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
    });
  });

  it("collapses unknown model strings to one bounded account scope and rejects future clocks", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = Date.now();
    const createdAt = new Date(now - 60_000).toISOString();
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-bounded', 'codex', 'oauth', 'Codex', 1, '{}', ?, ?)`,
      [createdAt, createdAt],
    );

    await database.recordProviderConnectionFallbackState("conn-bounded", {
      model: "custom-model-one",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 1_000,
      observedAt: now,
    }, { now });
    await database.recordProviderConnectionFallbackState("conn-bounded", {
      model: "custom-model-two",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 2_000,
      observedAt: now + 1,
    }, { now: now + 1 });
    const stored = await database.getProviderConnectionById("conn-bounded");
    expect(stored.modelLock___all).toBeTruthy();
    expect(Object.keys(stored).filter((key) => key.startsWith("modelLock_"))).toEqual(["modelLock___all"]);
    expect(Object.keys(stored).filter((key) => key.startsWith("modelStateObserved_"))).toEqual(["modelStateObserved___all"]);

    await expect(database.recordProviderConnectionFallbackState("conn-bounded", {
      model: "gpt-5.4",
      status: 429,
      reasonCode: "rate_limited",
      cooldownMs: 1_000,
      observedAt: now + 10 * 60_000,
    }, { now })).rejects.toThrow("timestamp is invalid");
  });
});
