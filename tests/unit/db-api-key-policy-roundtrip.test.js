// Round-trip + freshness tests for the API-key policy / expiresAt /
// apiKeyUsageTotals cluster.
//
// Bug-fix scope:
//   1. apiKeyUsageTotals must be created on fresh DBs AND on upgrades from
//      schemas where the table was never declared. Without it,
//      enforceApiKeyModelPolicy's `getApiKeyUsageTotals` throws on first
//      request that hits a policy with maxTokens/maxCostUsd.
//   2. exportDb must round-trip apiKeys.policy and apiKeys.expiresAt.
//   3. importDb must restore policy (as a parsed object on read) and
//      expiresAt without altering stored key strings.
//
// We exercise the real adapter via @/lib/db/driver against a fresh DATA_DIR.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-policy-rt-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("apiKeyUsageTotals table lifecycle", () => {
  it("is created on fresh DB so policy enforcement can query totals", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const tables = db.all(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).map((r) => r.name);
    expect(tables).toContain("apiKeyUsageTotals");
    // And the table is queryable with the column shape apiKeyUsageTotalsRepo uses.
    db.run(
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      ["seed", 0, 0, 0, new Date().toISOString()]
    );
    const row = db.get(`SELECT totalTokens FROM apiKeyUsageTotals WHERE apiKeyId = ?`, ["seed"]);
    expect(row.totalTokens).toBe(0);
  });

  it("is added when an existing DB upgrades to the current schema version", async () => {
    // 1st boot — fresh DB, full migration.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP TABLE IF EXISTS apiKeyUsageTotals`);
    db.close?.();

    // 2nd boot — process restart; sync should re-create the missing table.
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const tables = db2.all(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).map((r) => r.name);
    expect(tables).toContain("apiKeyUsageTotals");
  });

  it("backfills totals while upgrading a schema-v5 database", async () => {
    const Database = (await import("better-sqlite3")).default;
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const fixture = new Database(path.join(dbDir, "data.sqlite"));
    const keyId = "schema-v5-key-id";
    const key = "sk-schema-v5-key";
    fixture.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT,
        machineId TEXT,
        isActive INTEGER DEFAULT 1,
        allowedCombos TEXT,
        dailyLimitTokens INTEGER,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE usageHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        connectionId TEXT,
        apiKey TEXT,
        endpoint TEXT,
        promptTokens INTEGER DEFAULT 0,
        completionTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        status TEXT,
        tokens TEXT,
        meta TEXT
      );
    `);
    fixture.prepare(`INSERT INTO _meta(key, value) VALUES('schemaVersion', '5')`).run();
    fixture.prepare(`INSERT INTO apiKeys(id, key, createdAt) VALUES(?, ?, ?)`).run(keyId, key, "2026-01-01T00:00:00.000Z");
    fixture.prepare(`INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, cost) VALUES(?, ?, ?, ?, ?)`)
      .run("2026-01-01T00:00:00.000Z", key, 10, 11, 0.25);
    fixture.prepare(`INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, cost) VALUES(?, ?, ?, ?, ?)`)
      .run("2026-01-02T00:00:00.000Z", key, 9, 12, 0.5);
    fixture.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.get(`SELECT value FROM _meta WHERE key = 'schemaVersion'`).value).toBe("6");
    expect(db.get(`SELECT totalTokens, totalCost, totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [keyId])).toEqual({
      totalTokens: 42,
      totalCost: 0.75,
      totalRequests: 2,
    });
  });

  it("backfills totals after importing legacy db.json and usage.json", async () => {
    const keyId = "legacy-json-key-id";
    const key = "sk-legacy-json-key";
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify({
      apiKeys: [{
        id: keyId,
        key,
        name: "Legacy key",
        machineId: "legacy-machine",
        isActive: true,
        allowedCombos: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    }));
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({
      history: [
        {
          timestamp: "2026-01-01T00:00:00.000Z",
          apiKey: key,
          tokens: { prompt_tokens: 10, completion_tokens: 11 },
          cost: 0.25,
        },
        {
          timestamp: "2026-01-02T00:00:00.000Z",
          apiKey: key,
          tokens: { prompt_tokens: 9, completion_tokens: 12 },
          cost: 0.5,
        },
      ],
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.get(`SELECT totalTokens, totalCost, totalRequests FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [keyId])).toEqual({
      totalTokens: 42,
      totalCost: 0.75,
      totalRequests: 2,
    });
  });

  it("does not delete rollups without a current API key", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const orphan = {
      apiKeyId: "deleted-key-id",
      totalTokens: 99,
      totalCost: 1.25,
      totalRequests: 3,
      updatedAt: "2026-01-03T00:00:00.000Z",
    };
    db.run(
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [orphan.apiKeyId, orphan.totalTokens, orphan.totalCost, orphan.totalRequests, orphan.updatedAt]
    );

    const { ensureAndBackfillApiKeyUsageTotals } = await import("@/lib/db/migrations/apiKeyUsageTotalsBackfill.js");
    ensureAndBackfillApiKeyUsageTotals(db);

    expect(db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [orphan.apiKeyId])).toEqual(orphan);
  });
});

describe("exportDb / importDb round-trip of apiKeys.policy + expiresAt", () => {
  it("includes policy (as parsed object) and expiresAt on exported apiKeys", async () => {
    const sqliteDb = await import("@/lib/db/index.js");
    await sqliteDb.initDb();

    const policy = { allowedModels: ["gpt-4o"], maxTokens: 1000, maxCostUsd: 5 };
    const expiresAt = "2030-01-01T00:00:00.000Z";
    await sqliteDb.createApiKey("name1", "machine-1");
    const created = (await sqliteDb.getApiKeys())[0];
    // Round-trip via the only write path that exposes policy+expiresAt.
    await sqliteDb.updateApiKey(created.id, { policy, expiresAt });

    const snap = await sqliteDb.exportDb();
    const row = snap.apiKeys.find((k) => k.id === created.id);
    expect(row).toBeDefined();
    expect(row.policy).toEqual(policy);
    expect(row.expiresAt).toBe(expiresAt);
    // Key string is preserved exactly — no reformatting.
    expect(row.key).toBe(created.key);
  });

  it("imports policy (stored as JSON text) and expiresAt and re-reads them as parsed values", async () => {
    const sqliteDb = await import("@/lib/db/index.js");
    await sqliteDb.initDb();

    const payload = {
      apiKeys: [
        {
          id: "ak-policy-1",
          key: "sk-roundtrip-key-1",
          name: "RT One",
          machineId: "machine-rt",
          isActive: true,
          allowedCombos: [],
          dailyLimitTokens: null,
          policy: { allowedModels: ["claude-3.5-sonnet"], maxTokens: 500 },
          expiresAt: "2030-06-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    await sqliteDb.importDb(payload);
    const row = await sqliteDb.getApiKeyById("ak-policy-1");
    expect(row).not.toBeNull();
    expect(row.key).toBe("sk-roundtrip-key-1");
    expect(row.policy).toEqual(payload.apiKeys[0].policy);
    expect(row.expiresAt).toBe(payload.apiKeys[0].expiresAt);
  });

  it("preserves the original key string through export → import cycle", async () => {
    const sqliteDb = await import("@/lib/db/index.js");
    await sqliteDb.initDb();

    await sqliteDb.createApiKey("rt-key", "machine-rt");
    const original = (await sqliteDb.getApiKeys())[0];
    const policy = { maxTokens: 100 };
    await sqliteDb.updateApiKey(original.id, { policy, expiresAt: "2031-01-01T00:00:00.000Z" });

    const snap = await sqliteDb.exportDb();
    // Wipe the apiKeys table (simulate importing into an empty DB).
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM apiKeyUsageTotals`);
    expect(await sqliteDb.getApiKeyById(original.id)).toBeNull();

    await sqliteDb.importDb(snap);
    const back = await sqliteDb.getApiKeyById(original.id);
    expect(back).not.toBeNull();
    expect(back.key).toBe(original.key);
    expect(back.policy).toEqual(policy);
    expect(back.expiresAt).toBe("2031-01-01T00:00:00.000Z");
  });
});