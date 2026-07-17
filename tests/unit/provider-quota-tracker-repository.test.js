import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let originalDataDir;
let originalHome;
const require = createRequire(import.meta.url);
const betterSqlitePath = require.resolve("better-sqlite3");
const credentialWriterSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const Database = require(workerData.betterSqlitePath);
  const db = new Database(workerData.file);
  db.pragma("journal_mode=WAL");
  db.pragma("busy_timeout=5000");
  db.exec("BEGIN IMMEDIATE");
  db.prepare("UPDATE providerConnections SET data=?, updatedAt=? WHERE id=?")
    .run(workerData.data, workerData.updatedAt, workerData.id);
  parentPort.postMessage("ready");
  setTimeout(() => {
    db.exec("COMMIT");
    db.close();
    parentPort.postMessage("done");
  }, 50);
`;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-provider-tracker-"));
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

function row(remaining, dimensionKey = "requests:session") {
  return {
    accountKey: null,
    resourceKey: null,
    dimensionKey,
    state: remaining === 0 ? "exhausted" : "available",
    amounts: {
      limitKind: "bounded",
      limit: 100,
      used: 100 - remaining,
      remaining,
      remainingRatio: remaining / 100,
      unit: "requests",
    },
    resetAt: null,
    cooldownUntil: null,
    metadata: { plan: "repository-test" },
  };
}

describe("provider quota tracker with the real repository", () => {
  it("preserves credentials, source history, atomic replacement, export safety, and deletion cascades", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { createProviderQuotaTracker } = await import("../../src/shared/services/providerQuotaTracker.js");
    const db = await getAdapter();
    const secretCanaries = {
      apiKey: "sk-providertrackerkey123456",
      accessToken: "access-providertracker-canary",
      refreshToken: "refresh-providertracker-canary",
      providerSpecificData: { apiKey: "nested-providertracker-canary", accountId: "private-account" },
    };
    const storedData = JSON.stringify(secretCanaries);
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, 'api_key', ?, 1, ?, ?, ?)`,
      ["conn-real", "demo", "Demo", storedData, revision, revision],
    );
    const connection = {
      id: "conn-real",
      provider: "demo",
      authType: "api_key",
      updatedAt: revision,
      ...secretCanaries,
    };
    const clock = { value: Date.parse(revision) };
    let adapterResult = () => ({
      outcome: "success",
      sourceId: "demo:quota:v1",
      rows: [row(75)],
      attemptedAt: new Date(clock.value).toISOString(),
    });
    const adapter = {
      config: { sourceId: "demo:quota:v1", freshnessMs: 60_000 },
      fetchQuota: vi.fn(() => Promise.resolve(adapterResult())),
    };
    const tracker = createProviderQuotaTracker({
      resolveAdapter: () => adapter,
      repository: {
        replaceProviderQuotaSnapshotsForSource: database.replaceProviderQuotaSnapshotsForSource,
        recordQuotaFetchFailure: database.recordQuotaFetchFailure,
      },
      proxyResolver: vi.fn().mockResolvedValue({}),
      credentialRefresher: null,
      now: () => clock.value,
      cacheTtlMs: 0,
    });

    await expect(tracker.refresh(connection)).resolves.toMatchObject({ outcome: "success" });
    expect(db.get(`SELECT data FROM providerConnections WHERE id = ?`, ["conn-real"]).data).toBe(storedData);
    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-real", includeStale: true, now: clock.value })).toMatchObject([
      { amounts: { remaining: 75 }, provenance: { sourceId: "demo:quota:v1" } },
    ]);
    expect(await database.getQuotaFetchState({ connectionId: "conn-real", provider: "demo", sourceId: "demo:quota:v1" }, { now: clock.value }))
      .toMatchObject({ outcome: "success", lastSuccessAt: revision });

    clock.value += 1_000;
    adapterResult = () => ({ outcome: "timeout", sourceId: "demo:quota:v1", attemptedAt: new Date(clock.value).toISOString() });
    await expect(tracker.refresh(connection, { force: true })).resolves.toMatchObject({ outcome: "timeout" });
    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-real", includeStale: true, now: clock.value })).toHaveLength(1);
    expect(await database.getQuotaFetchState({ connectionId: "conn-real", provider: "demo", sourceId: "demo:quota:v1" }, { now: clock.value }))
      .toMatchObject({ outcome: "timeout", lastSuccessAt: revision });

    clock.value += 1_000;
    adapterResult = () => ({
      outcome: "success",
      sourceId: "demo:quota:v1",
      rows: [row(20, "requests:weekly")],
      attemptedAt: new Date(clock.value).toISOString(),
    });
    await tracker.refresh(connection, { force: true });
    const replaced = await database.listProviderQuotaSnapshots({ connectionId: "conn-real", includeStale: true, now: clock.value });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ identity: { dimensionKey: "requests:weekly" }, amounts: { remaining: 20 } });

    clock.value += 1_000;
    adapterResult = () => ({ outcome: "success", sourceId: "demo:quota:v1", rows: [], attemptedAt: new Date(clock.value).toISOString() });
    await tracker.refresh(connection, { force: true });
    expect(await database.listProviderQuotaSnapshots({ connectionId: "conn-real", includeStale: true, now: clock.value })).toEqual([]);
    const exported = await database.exportDb({ now: clock.value });
    expect(JSON.stringify(exported.quota)).not.toContain(secretCanaries.apiKey);
    expect(JSON.stringify(exported.quota)).not.toContain(secretCanaries.accessToken);
    expect(JSON.stringify(exported.quota)).not.toContain(secretCanaries.refreshToken);
    expect(JSON.stringify(exported.quota)).not.toContain(secretCanaries.providerSpecificData.apiKey);
    expect(db.get(`SELECT data FROM providerConnections WHERE id = ?`, ["conn-real"]).data).toBe(storedData);

    clock.value += 1_000;
    adapterResult = () => ({
      outcome: "success",
      sourceId: "demo:quota:v1",
      rows: [row(10)],
      attemptedAt: new Date(clock.value).toISOString(),
    });
    await tracker.refresh(connection, { force: true });
    await database.deleteProviderConnection("conn-real");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(0);
    expect(db.get(`SELECT COUNT(*) AS count FROM quotaFetchStates`).count).toBe(0);
  });

  it("returns repository-current data instead of caching an older competing tracker observation", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { createProviderQuotaTracker } = await import("../../src/shared/services/providerQuotaTracker.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-race', 'demo', 'api_key', 'Demo', 1, '{}', ?, ?)`,
      [revision, revision],
    );
    const connection = { id: "conn-race", provider: "demo", authType: "api_key", updatedAt: revision };
    const repository = {
      replaceProviderQuotaSnapshotsForSource: database.replaceProviderQuotaSnapshotsForSource,
      recordQuotaFetchFailure: database.recordQuotaFetchFailure,
    };
    const makeTracker = (attemptedAt, remaining) => {
      const adapterResult = { outcome: "success", sourceId: "demo:quota:v1", rows: [row(remaining)], attemptedAt };
      return createProviderQuotaTracker({
      resolveAdapter: () => ({
        config: { sourceId: "demo:quota:v1", freshnessMs: 60_000 },
        fetchQuota: vi.fn().mockResolvedValue(adapterResult),
      }),
      repository,
      proxyResolver: null,
      credentialRefresher: null,
      now: () => Date.parse(attemptedAt),
      cacheTtlMs: 60_000,
      });
    };
    const newer = makeTracker("2026-01-01T00:10:00.000Z", 20);
    const older = makeTracker("2026-01-01T00:05:00.000Z", 90);

    await expect(newer.refresh(connection)).resolves.toMatchObject({ outcome: "success" });
    const result = await older.refresh(connection);

    expect(result).toMatchObject({ outcome: "superseded", persisted: false });
    expect(result.snapshots[0].amounts.remaining).toBe(20);
    expect(older.getCacheSize()).toBe(0);
    expect((await database.listProviderQuotaSnapshots({ connectionId: "conn-race", includeStale: true, now: Date.parse("2026-01-01T00:10:00.000Z") }))[0].amounts.remaining).toBe(20);
  });

  it("atomically preserves concurrent metadata while persisting a partial OAuth rotation", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-oauth-real', 'github', 'oauth', 'GitHub', 1, ?, ?, ?)`,
      [JSON.stringify({
        apiKey: "top-level-api-key-must-stay",
        accessToken: "access-old",
        refreshToken: "refresh-old",
        idToken: "id-old",
        providerSpecificData: {
          accountId: "private-account",
          apiKey: "nested-api-key-must-stay",
          keep: "original",
        },
      }), revision, revision],
    );
    const original = await database.getProviderConnectionById("conn-oauth-real");
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async () => {
        await database.updateProviderConnection("conn-oauth-real", {
          displayName: "Concurrent metadata edit",
          providerSpecificData: { keep: "concurrent", unrelated: "preserved" },
        });
        return {
          accessToken: "access-new",
          refreshToken: "refresh-new",
          expiresIn: 60,
          providerSpecificData: {
            profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/accepted",
            apiKey: "attempted-nested-rewrite",
          },
        };
      }),
    };

    const result = await refreshAndUpdateCredentials(original, false, null, {
      getExecutorImpl: () => executor,
      updateProviderConnectionImpl: database.updateProviderConnection,
      now: () => Date.parse(revision),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const stored = await database.getProviderConnectionById("conn-oauth-real");

    expect(result).toMatchObject({ refreshed: true, connection: { accessToken: "access-new", refreshToken: "refresh-new" } });
    expect(stored).toMatchObject({
      displayName: "Concurrent metadata edit",
      apiKey: "top-level-api-key-must-stay",
      accessToken: "access-new",
      refreshToken: "refresh-new",
      idToken: "id-old",
      providerSpecificData: {
        accountId: "private-account",
        apiKey: "nested-api-key-must-stay",
        keep: "concurrent",
        unrelated: "preserved",
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/accepted",
      },
    });
  });

  it("keeps the repository credential winner when a stale refresh loses compare-and-swap", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-oauth-race', 'github', 'oauth', 'GitHub', 1, ?, ?, ?)`,
      [JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old" }), revision, revision],
    );
    const original = await database.getProviderConnectionById("conn-oauth-race");
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async () => {
        await database.updateProviderConnection("conn-oauth-race", {
          accessToken: "access-winner",
          refreshToken: "refresh-winner",
          displayName: "Winner metadata",
        });
        return { accessToken: "access-loser", refreshToken: "refresh-loser" };
      }),
    };

    const result = await refreshAndUpdateCredentials(original, false, null, {
      getExecutorImpl: () => executor,
      updateProviderConnectionImpl: database.updateProviderConnection,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const stored = await database.getProviderConnectionById("conn-oauth-race");

    expect(result).toMatchObject({
      refreshed: false,
      connection: { accessToken: "access-winner", refreshToken: "refresh-winner", displayName: "Winner metadata" },
    });
    expect(stored).toMatchObject({ accessToken: "access-winner", refreshToken: "refresh-winner" });
    expect(JSON.stringify(stored)).not.toContain("loser");
  });

  it("does not bind refreshed tokens to concurrently changed legacy issuer aliases", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    const originalContext = {
      authMethod: "external_idp",
      client_id: "client-old",
      token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      scopes: ["openid", "offline_access"],
      region: "us-east-1",
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/original",
    };
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-context-race', 'kiro', 'oauth', 'Kiro', 1, ?, ?, ?)`,
      [JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old", providerSpecificData: originalContext }), revision, revision],
    );
    const original = await database.getProviderConnectionById("conn-context-race");
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async () => {
        await database.updateProviderConnection("conn-context-race", {
          providerSpecificData: {
            client_id: "client-new",
            token_endpoint: "https://login.microsoftonline.com/new-tenant/oauth2/v2.0/token",
            scopes: ["openid", "offline_access", "new-scope"],
            profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/new-binding",
          },
        });
        return {
          accessToken: "access-stale-result",
          refreshToken: "refresh-stale-result",
          providerSpecificData: originalContext,
        };
      }),
    };

    const result = await refreshAndUpdateCredentials(original, false, null, {
      getExecutorImpl: () => executor,
      updateProviderConnectionImpl: database.updateProviderConnection,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const stored = await database.getProviderConnectionById("conn-context-race");

    expect(result).toMatchObject({ refreshed: false, connection: { providerSpecificData: { client_id: "client-new" } } });
    expect(stored).toMatchObject({
      accessToken: "access-old",
      refreshToken: "refresh-old",
      providerSpecificData: {
        client_id: "client-new",
        token_endpoint: "https://login.microsoftonline.com/new-tenant/oauth2/v2.0/token",
        scopes: ["openid", "offline_access", "new-scope"],
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/new-binding",
      },
    });
    expect(JSON.stringify(stored)).not.toContain("stale-result");
  });

  it("acquires the SQLite writer lock before reading credential compare-and-swap state", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { providerRefreshContext } = await import("../../src/shared/utils/providerCredentialContext.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-process-race', 'github', 'oauth', 'GitHub', 1, ?, ?, ?)`,
      [JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old" }), revision, revision],
    );
    const original = await database.getProviderConnectionById("conn-process-race");
    const worker = new Worker(credentialWriterSource, {
      eval: true,
      workerData: {
        betterSqlitePath,
        file: path.join(process.env.DATA_DIR, "db", "data.sqlite"),
        id: "conn-process-race",
        updatedAt: "2026-01-01T00:00:01.000Z",
        data: JSON.stringify({ accessToken: "access-winner", refreshToken: "refresh-winner" }),
      },
    });
    const nextMessage = () => new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    await expect(nextMessage()).resolves.toBe("ready");

    const commit = await database.updateProviderConnection("conn-process-race", {
      accessToken: "access-loser",
      refreshToken: "refresh-loser",
    }, {
      expectedRefreshContext: providerRefreshContext(original),
      returnCommitResult: true,
    });

    await expect(nextMessage()).resolves.toBe("done");
    await worker.terminate();
    expect(commit).toMatchObject({
      applied: false,
      connection: { accessToken: "access-winner", refreshToken: "refresh-winner" },
    });
    expect(await database.getProviderConnectionById("conn-process-race")).toMatchObject({
      accessToken: "access-winner",
      refreshToken: "refresh-winner",
    });
  });

  it("persists an issued OAuth rotation after the quota subscriber aborts", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-abort-rotation', 'github', 'oauth', 'GitHub', 1, ?, ?, ?)`,
      [JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old" }), revision, revision],
    );
    const original = await database.getProviderConnectionById("conn-abort-rotation");
    let releaseRefresh;
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(() => new Promise((resolve) => { releaseRefresh = resolve; })),
    };
    const controller = new AbortController();
    const pending = refreshAndUpdateCredentials(original, false, null, {
      getExecutorImpl: () => executor,
      getProviderConnectionByIdImpl: database.getProviderConnectionById,
      updateProviderConnectionImpl: database.updateProviderConnection,
      signal: controller.signal,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await vi.waitFor(() => expect(executor.refreshCredentials).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    releaseRefresh({ accessToken: "access-new", refreshToken: "refresh-new" });

    await vi.waitFor(async () => {
      await expect(database.getProviderConnectionById("conn-abort-rotation")).resolves.toMatchObject({
        accessToken: "access-new",
        refreshToken: "refresh-new",
      });
    });
  });

  it("reconciles an invalid_grant loser with the repository's concurrent rotation winner", async () => {
    const database = await import("@/lib/db/index.js");
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { refreshAndUpdateCredentials } = await import("../../src/shared/services/providerCredentials.js");
    const db = await getAdapter();
    const revision = "2026-01-01T00:00:00.000Z";
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
       VALUES('conn-invalid-grant-race', 'github', 'oauth', 'GitHub', 1, ?, ?, ?)`,
      [JSON.stringify({ accessToken: "access-old", refreshToken: "refresh-old" }), revision, revision],
    );
    const original = await database.getProviderConnectionById("conn-invalid-grant-race");
    let winnerWrite;
    const executor = {
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async () => {
        winnerWrite = new Promise((resolve, reject) => {
          setTimeout(() => {
            database.updateProviderConnection("conn-invalid-grant-race", {
              accessToken: "access-winner",
              refreshToken: "refresh-winner",
            }).then(resolve, reject);
          }, 5);
        });
        return { error: "invalid_grant" };
      }),
    };

    const result = await refreshAndUpdateCredentials(original, false, null, {
      getExecutorImpl: () => executor,
      getProviderConnectionByIdImpl: database.getProviderConnectionById,
      updateProviderConnectionImpl: database.updateProviderConnection,
      reconcileDelays: [0, 10, 25],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await winnerWrite;

    expect(result).toMatchObject({
      refreshed: false,
      connection: { accessToken: "access-winner", refreshToken: "refresh-winner" },
    });
  });
});
