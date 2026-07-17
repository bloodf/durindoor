import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEncryptedBlob } from "../../src/lib/crypto/columnCrypto.js";
import { QUOTA_MAX_IMPORT_ROWS, QUOTA_MAX_SOURCE_SNAPSHOTS } from "../../src/shared/constants/quota.js";

let tempDir;
let originalDataDir;
let originalHome;

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-backup-"));
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

async function seedPortableState() {
  const database = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const createdAt = "2026-01-01T00:00:00.000Z";
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, isActive, data, createdAt, updatedAt)
     VALUES('conn-1', 'gemini', 'oauth', 'Gemini', 1, ?, ?, ?)`,
    [JSON.stringify({ accessToken: "access-token-canary", refreshToken: "refresh-token-canary" }), createdAt, createdAt],
  );
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedCombos, dailyLimitTokens, policy, expiresAt, createdAt)
     VALUES('key-1', 'sk-deadbeef', 'Key', 'machine-a', 1, '[]', 10, ?, '2030-01-01T00:00:00.000Z', ?)`,
    [JSON.stringify({ allowedModels: ["gemini/model-a"], maxTokens: 100 }), createdAt],
  );
  db.run(
    `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt)
     VALUES('key-1', 5, 0.25, 1, '2026-01-01T00:05:00.000Z')`,
  );
  const snapshot = {
    identity: {
      connectionId: "conn-1",
      provider: "gemini",
      accountKey: "account:stable",
      resourceKey: "model:model-a",
      dimensionKey: "requests:session",
    },
    state: "exhausted",
    amounts: { limitKind: "bounded", limit: 100, used: 100, remaining: 0, remainingRatio: 0, unit: "requests" },
    timing: {
      observedAt: "2026-01-01T00:10:00.000Z",
      staleAt: "2026-01-01T01:10:00.000Z",
      resetAt: null,
      cooldownUntil: null,
    },
    provenance: { sourceType: "provider_api", sourceId: "gemini:quota:v1", reasonCode: null, metadata: { plan: "free", recurring: true, windowSeconds: 3600 } },
  };
  await database.replaceProviderQuotaSnapshotsForSource({
    connectionId: "conn-1",
    provider: "gemini",
    sourceId: "gemini:quota:v1",
    observedAt: snapshot.timing.observedAt,
    snapshots: [snapshot],
    fetchState: {
      connectionId: "conn-1",
      provider: "gemini",
      sourceId: "gemini:quota:v1",
      outcome: "success",
      attemptedAt: snapshot.timing.observedAt,
    },
  });
  return { database, db, snapshot };
}

function clone(value) {
  return structuredClone(value);
}

describe("portable quota backup", () => {
  it("round-trips normalized quota and zeroes without duplicating credentials", async () => {
    const { database, db, snapshot } = await seedPortableState();
    // SEC-B-02: credentials scrubbed from default export; round-trip tests
    // explicitly opt in with includeSecrets so existing semantics hold.
    const exported = await database.exportDb({ includeSecrets: true });

    expect(exported.quota).toEqual({
      version: 1,
      snapshots: [snapshot],
      fetchStates: [{
        connectionId: "conn-1",
        provider: "gemini",
        sourceId: "gemini:quota:v1",
        outcome: "success",
        lastObservedAt: "2026-01-01T00:10:00.000Z",
        attemptedAt: "2026-01-01T00:10:00.000Z",
        retryAt: null,
        lastSuccessAt: "2026-01-01T00:10:00.000Z",
        reasonCode: null,
      }],
    });
    const quotaJson = JSON.stringify(exported.quota);
    for (const secret of ["access-token-canary", "refresh-token-canary", "sk-deadbeef", "authorization", "cookie"]) {
      expect(quotaJson.toLowerCase()).not.toContain(secret.toLowerCase());
    }

    db.run(`UPDATE providerConnections SET data = '{"accessToken":"changed"}' WHERE id = 'conn-1'`);
    db.run(`UPDATE apiKeys SET key = 'sk-feedface' WHERE id = 'key-1'`);
    db.run(`DELETE FROM quotaFetchStates`);
    db.run(`DELETE FROM providerQuotaSnapshots`);
    await database.importDb(JSON.parse(JSON.stringify(exported)));

    const connData = JSON.parse(db.get(`SELECT data FROM providerConnections WHERE id='conn-1'`).data);
    expect(isEncryptedBlob(connData.accessToken)).toBe(true);
    expect(isEncryptedBlob(connData.refreshToken)).toBe(true);
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(await database.getProviderQuotaSnapshot(snapshot.identity, { includeStale: true })).toEqual(snapshot);
    expect(await database.getQuotaFetchState({ connectionId: "conn-1", provider: "gemini", sourceId: "gemini:quota:v1" })).toMatchObject({ outcome: "success" });
  });

  it("accepts an older payload without quota and treats an explicit empty v1 payload as a clear", async () => {
    const { database, db } = await seedPortableState();
    const oldPayload = await database.exportDb();
    delete oldPayload.quota;
    await expect(database.importDb(oldPayload)).resolves.toBeDefined();
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(0);
    expect(db.get(`SELECT COUNT(*) AS count FROM quotaFetchStates`).count).toBe(0);

    const current = await database.exportDb();
    current.quota = { version: 1, snapshots: [], fetchStates: [] };
    await expect(database.importDb(current)).resolves.toBeDefined();
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(0);
  });

  it.each([
    ["missing version", (payload) => { delete payload.quota.version; }],
    ["future version", (payload) => { payload.quota.version = 2; }],
    ["duplicate snapshot", (payload) => { payload.quota.snapshots.push(clone(payload.quota.snapshots[0])); }],
    ["duplicate fetch state", (payload) => { payload.quota.fetchStates.push(clone(payload.quota.fetchStates[0])); }],
    ["dangling connection", (payload) => { payload.quota.snapshots[0].identity.connectionId = "missing"; }],
    ["provider mismatch", (payload) => { payload.quota.snapshots[0].identity.provider = "codex"; }],
    ["malformed amount", (payload) => { payload.quota.snapshots[0].amounts.remaining = Number.NaN; }],
    ["secret metadata", (payload) => { payload.quota.snapshots[0].provenance.metadata = { plan: "Bearer abcdefghijklmnop" }; }],
    ["secret-shaped unit", (payload) => { payload.quota.snapshots[0].amounts.unit = "sk-secret-unit-123456"; }],
    ["missing source watermark", (payload) => { payload.quota.fetchStates = []; }],
    ["newer empty-source watermark with an old row", (payload) => {
      payload.quota.fetchStates[0].lastObservedAt = "2026-01-01T00:20:00.000Z";
      payload.quota.fetchStates[0].lastSuccessAt = "2026-01-01T00:20:00.000Z";
      payload.quota.fetchStates[0].attemptedAt = "2026-01-01T00:20:00.000Z";
    }],
  ])("rejects %s before destructive replacement", async (_label, mutate) => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    mutate(payload);
    await expect(database.importDb(payload)).rejects.toThrow();
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
  });

  it("rolls back the complete import when quota insertion fails", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    payload.settings = { imported: true };
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, [JSON.stringify({ original: true })]);
    db.exec(`
      CREATE TRIGGER fail_quota_insert BEFORE INSERT ON providerQuotaSnapshots
      BEGIN SELECT RAISE(ABORT, 'injected quota import failure'); END;
    `);

    await expect(database.importDb(payload)).rejects.toThrow("injected quota import failure");
    expect(JSON.parse(db.get(`SELECT data FROM settings WHERE id=1`).data)).toEqual({ original: true });
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
  });

  it("applies one aggregate portable row limit before normalization or deletion", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    payload.quota.snapshots = new Array(QUOTA_MAX_IMPORT_ROWS);
    payload.quota.fetchStates = new Array(1);
    await expect(database.importDb(payload)).rejects.toThrow("row safety limit");
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
  });

  it("allows the exact aggregate row boundary to reach normal validation", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    payload.quota.snapshots = Array.from({ length: QUOTA_MAX_IMPORT_ROWS });
    payload.quota.fetchStates = [];
    const error = await database.importDb(payload).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("quota.snapshots[0] is invalid");
    expect(error.message).not.toContain("row safety limit");
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
  });

  it("applies the per-source portable row limit before destructive replacement", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    payload.quota.snapshots = Array.from(
      { length: QUOTA_MAX_SOURCE_SNAPSHOTS + 1 },
      () => payload.quota.snapshots[0],
    );
    await expect(database.importDb(payload)).rejects.toThrow("per-source row safety limit");
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
  });

  it("rejects future-poisoned quota imports before destructive replacement", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    payload.quota.snapshots[0].timing.observedAt = "2026-01-01T00:05:00.001Z";
    payload.quota.snapshots[0].timing.staleAt = "2026-01-01T01:05:00.001Z";
    payload.quota.fetchStates[0].lastObservedAt = "2026-01-01T00:05:00.001Z";
    payload.quota.fetchStates[0].lastSuccessAt = "2026-01-01T00:05:00.001Z";
    payload.quota.fetchStates[0].attemptedAt = "2026-01-01T00:05:00.001Z";
    await expect(database.importDb(payload, { now: "2026-01-01T00:00:00.000Z" })).rejects.toThrow("too far in the future");
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).count).toBe(1);
  });

  it("does not echo secret-bearing quota identities from rejected imports", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    const canary = "account:sk-secretcanary1234";
    payload.quota.snapshots[0].identity.accountKey = canary;
    const error = await database.importDb(payload).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(canary);
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
  });

  it("does not echo secret-bearing unknown quota field names", async () => {
    const { database, db } = await seedPortableState();
    const payload = await database.exportDb();
    const canary = "sk-secretkeycanary123456";
    payload.quota[canary] = true;
    const error = await database.importDb(payload).catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("quota contains an unsupported field");
    expect(error.message).not.toContain(canary);
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
  });

  it("uses one injected clock for a successful import and its response export", async () => {
    const { database } = await seedPortableState();
    const payload = await database.exportDb();
    const observedAt = "2030-01-01T00:00:00.000Z";
    payload.quota.snapshots[0].timing.observedAt = observedAt;
    payload.quota.snapshots[0].timing.staleAt = "2030-01-01T01:00:00.000Z";
    payload.quota.fetchStates[0].lastObservedAt = observedAt;
    payload.quota.fetchStates[0].lastSuccessAt = observedAt;
    payload.quota.fetchStates[0].attemptedAt = observedAt;
    const restored = await database.importDb(payload, { now: observedAt });
    expect(restored.quota.snapshots[0].timing.observedAt).toBe(observedAt);
    expect(restored.quota.fetchStates[0].lastObservedAt).toBe(observedAt);
  });

  it("round-trips quota and credential bytes through a genuinely fresh database", async () => {
    const { database, db } = await seedPortableState();
    const first = await database.exportDb({ includeSecrets: true });
    db.close();
    delete global._dbAdapter;
    process.env.DATA_DIR = path.join(tempDir, "fresh-data");
    process.env.HOME = path.join(tempDir, "fresh-home");
    fs.mkdirSync(process.env.HOME, { recursive: true });
    vi.resetModules();

    const freshDatabase = await import("@/lib/db/index.js");
    await freshDatabase.importDb(first);
    const second = await freshDatabase.exportDb({ includeSecrets: true });
    expect(second.quota).toEqual(first.quota);
    expect(second.providerConnections[0].accessToken).toBe("access-token-canary");
    expect(second.providerConnections[0].refreshToken).toBe("refresh-token-canary");
    expect(second.apiKeys[0].key).toBe("sk-deadbeef");
    expect(second.apiKeys[0].policy).toEqual(first.apiKeys[0].policy);
  });

  it("exports connections and quota from one WAL read snapshot", async () => {
    const { database, db } = await seedPortableState();
    const writer = new Database(db.raw.name);
    writer.pragma("journal_mode=WAL");
    writer.pragma("foreign_keys=ON");
    writer.pragma("busy_timeout=5000");
    const originalAll = db.all;
    let injected = false;
    db.all = (sql, params = []) => {
      const rows = originalAll(sql, params);
      if (!injected && /SELECT \* FROM providerConnections/i.test(sql)) {
        injected = true;
        writer.transaction(() => {
          const timestamp = "2026-01-01T00:20:00.000Z";
          writer.prepare(`INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt) VALUES(?, ?, 'oauth', '{}', ?, ?)`)
            .run("conn-2", "gemini", timestamp, timestamp);
          writer.prepare(`
            INSERT INTO providerQuotaSnapshots(
              connectionId, accountKey, resourceKey, dimensionKey, state, limitKind,
              limitValue, usedValue, remainingValue, remainingRatio, unit, resetAt,
              cooldownUntil, observedAt, staleAt, sourceType, sourceId, reasonCode, metadataJson
            ) VALUES(?, ?, ?, ?, 'available', 'bounded', 100, 50, 50, 0.5, 'requests', NULL, NULL, ?, ?, 'provider_api', ?, NULL, '{}')
          `).run("conn-2", "scope:connection", "scope:account", "requests:session", timestamp, "2026-01-01T01:20:00.000Z", "gemini:quota:v1");
          writer.prepare(`
            INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, lastObservedAt, attemptedAt, retryAt, lastSuccessAt, reasonCode)
            VALUES(?, ?, 'success', ?, ?, NULL, ?, NULL)
          `).run("conn-2", "gemini:quota:v1", timestamp, timestamp, timestamp);
        })();
      }
      return rows;
    };

    let exported;
    try {
      exported = await database.exportDb();
    } finally {
      db.all = originalAll;
      writer.close();
    }
    expect(injected).toBe(true);
    expect(exported.providerConnections.map((connection) => connection.id)).not.toContain("conn-2");
    expect(exported.quota.snapshots.map((snapshot) => snapshot.identity.connectionId)).not.toContain("conn-2");
    expect(exported.quota.fetchStates.map((state) => state.connectionId)).not.toContain("conn-2");
    expect(db.get(`SELECT COUNT(*) AS count FROM providerConnections WHERE id='conn-2'`).count).toBe(1);
    expect(db.get(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots WHERE connectionId='conn-2'`).count).toBe(1);
  });

  it("fails export closed when quota rows have orphaned foreign keys", async () => {
    const { database, db } = await seedPortableState();
    db.raw.pragma("foreign_keys=OFF");
    const timestamp = "2026-01-01T00:20:00.000Z";
    db.run(`
      INSERT INTO providerQuotaSnapshots(
        connectionId, accountKey, resourceKey, dimensionKey, state, limitKind,
        observedAt, staleAt, sourceType, sourceId, metadataJson
      ) VALUES('secret-orphan-id', 'scope:connection', 'scope:account', 'requests:orphan',
        'unknown', 'unknown', ?, ?, 'import', 'test:orphan:v1', '{}')
    `, [timestamp, "2026-01-01T01:20:00.000Z"]);
    db.run(`
      INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, lastObservedAt, attemptedAt, lastSuccessAt)
      VALUES('secret-orphan-id', 'test:orphan:v1', 'success', ?, ?, ?)
    `, [timestamp, timestamp, timestamp]);
    db.raw.pragma("foreign_keys=ON");
    const error = await database.exportDb().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Stored quota state has an invalid provider-connection reference");
    expect(error.message).not.toContain("secret-orphan-id");
  });

  it("fails export closed for a fetch-only orphan in a case-variant quota table", async () => {
    const { database, db } = await seedPortableState();
    db.raw.pragma("foreign_keys=OFF");
    db.raw.exec(`
      ALTER TABLE quotaFetchStates RENAME TO quotaFetchStatesCaseBridge;
      ALTER TABLE quotaFetchStatesCaseBridge RENAME TO QUOTAFETCHSTATES;
      INSERT INTO QUOTAFETCHSTATES(connectionId, sourceId, outcome, attemptedAt, retryAt, reasonCode)
      VALUES('uppercase-orphan-canary', 'test:orphan:v1', 'timeout', '2026-01-01T00:20:00.000Z', NULL, 'timeout');
    `);
    expect(db.all(`PRAGMA foreign_key_check`)).toEqual([
      expect.objectContaining({ table: "QUOTAFETCHSTATES" }),
    ]);
    db.raw.pragma("foreign_keys=ON");

    const error = await database.exportDb().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Stored quota state has an invalid provider-connection reference");
    expect(error.message).not.toContain("uppercase-orphan-canary");
  });

  it("fails closed on corrupt stored metadata without exposing account or secret values", async () => {
    const { database, db } = await seedPortableState();
    db.run(`UPDATE providerQuotaSnapshots SET metadataJson = '{bad-json'`);
    const error = await database.exportDb().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Stored quota snapshot is invalid");
    expect(error.message).not.toContain("account:stable");
    expect(error.message).not.toContain("sk-deadbeef");
  });

  it("includes quota rows and composite identity constraints in lite safety backups", async () => {
    const { db } = await seedPortableState();
    const { backupDbLite } = await import("@/lib/db/backup.js");
    const destination = path.join(tempDir, "backup");
    fs.mkdirSync(destination, { recursive: true });
    const backupPath = backupDbLite(db, destination);
    expect(backupPath).toBeTruthy();

    const backup = new Database(backupPath, { readonly: true });
    expect(backup.prepare(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).get().count).toBe(1);
    expect(backup.prepare(`SELECT COUNT(*) AS count FROM quotaFetchStates`).get().count).toBe(1);
    expect(backup.prepare(`PRAGMA table_info(providerQuotaSnapshots)`).all().filter((column) => column.pk > 0).map((column) => column.name)).toEqual([
      "connectionId", "accountKey", "resourceKey", "dimensionKey",
    ]);
    expect(backup.prepare(`PRAGMA index_list(providerQuotaSnapshots)`).all().some((index) => index.name.startsWith("sqlite_autoindex") && index.unique === 1)).toBe(true);
    backup.close();
  });
});
