import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import m001 from "../../src/lib/db/migrations/001-initial.js";
import m007 from "../../src/lib/db/migrations/007-provider-quota-snapshots.js";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import { canonicalizeSchemaSql, verifyQuotaStorageShapes } from "../../src/lib/db/helpers/schemaVerifier.js";
import { QUOTA_V7_TABLES, buildQuotaV7TableSql } from "../../src/lib/db/migrations/quota-v7-schema.js";

let tempDir;
let originalDataDir;
let originalHome;

function rawAdapter(db) {
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => db.prepare(sql).run(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
    all: (sql, params = []) => db.prepare(sql).all(params),
    transaction: (fn) => db.transaction(fn)(),
  };
}

function normalizedShape(db, table) {
  return {
    columns: db.prepare(`PRAGMA table_info(${table})`).all().map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk })),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(({ table: parent, from, to, on_delete }) => ({ parent, from, to, on_delete })),
    indexes: db.prepare(`PRAGMA index_list(${table})`).all().map(({ name, unique }) => ({ name, unique })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

beforeEach(() => {
  originalDataDir = process.env.DATA_DIR;
  originalHome = process.env.HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-migration-"));
  process.env.DATA_DIR = tempDir;
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

describe("quota schema migration", () => {
  it("locks the published v7 quota DDL to an independent fingerprint", () => {
    const ddl = Object.keys(QUOTA_V7_TABLES)
      .flatMap((name) => [buildQuotaV7TableSql(name), ...QUOTA_V7_TABLES[name].indexes])
      .join("\n");
    expect(createHash("sha256").update(ddl).digest("hex")).toBe("cab05dac45670b24a1f071de57731ed8f28cc0ba5d971a6969a4f5f312f2f43b");
  });

  it("canonicalizes harmless SQLite DDL formatting without folding string literals", () => {
    const formatted = `CREATE TABLE IF NOT EXISTS main."QuotaThing" (
      "State" TEXT CHECK ("State" IN ('Available'))
    );`;
    const compact = `create table quotathing(state text check(state in('Available')))`;
    expect(canonicalizeSchemaSql(formatted)).toBe(canonicalizeSchemaSql(compact));
    expect(canonicalizeSchemaSql(formatted)).not.toBe(canonicalizeSchemaSql(compact.replace("'Available'", "'available'")));
  });

  it("makes fresh and migrated quota storage structurally equivalent and is idempotent", () => {
    const fresh = new Database(":memory:");
    fresh.pragma("foreign_keys=ON");
    m001.up(rawAdapter(fresh));

    const migrated = new Database(":memory:");
    migrated.pragma("foreign_keys=ON");
    migrated.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    const adapter = rawAdapter(migrated);
    m007.up(adapter);
    const firstSql = migrated.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='providerQuotaSnapshots'`).get().sql;
    expect(() => m007.up(adapter)).not.toThrow();
    expect(migrated.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='providerQuotaSnapshots'`).get().sql).toBe(firstSql);

    for (const table of ["providerQuotaSnapshots", "quotaFetchStates"]) {
      expect(normalizedShape(migrated, table)).toEqual(normalizedShape(fresh, table));
    }
    expect(normalizedShape(fresh, "providerQuotaSnapshots").foreignKeys).toContainEqual({
      parent: "providerConnections",
      from: "connectionId",
      to: "id",
      on_delete: "CASCADE",
    });
    fresh.close();
    migrated.close();
  });

  it("rolls back both quota tables when the migration transaction fails", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    const adapter = rawAdapter(db);
    expect(() => adapter.transaction(() => {
      m007.up(adapter);
      throw new Error("injected migration failure");
    })).toThrow("injected migration failure");
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('providerQuotaSnapshots','quotaFetchStates')`).all()).toEqual([]);
    db.close();
  });

  it("upgrades a frozen v6 database without rewriting connection or API-key secrets", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE providerConnections (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, authType TEXT NOT NULL,
        name TEXT, email TEXT, priority INTEGER, isActive INTEGER DEFAULT 1,
        data TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT,
        isActive INTEGER DEFAULT 1, allowedCombos TEXT, dailyLimitTokens INTEGER,
        policy TEXT, expiresAt TEXT, createdAt TEXT NOT NULL
      );
      CREATE TABLE apiKeyUsageTotals (
        apiKeyId TEXT PRIMARY KEY REFERENCES apiKeys(id) ON DELETE CASCADE,
        totalTokens INTEGER NOT NULL DEFAULT 0, totalCost REAL NOT NULL DEFAULT 0,
        totalRequests INTEGER NOT NULL DEFAULT 0, updatedAt TEXT
      );
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '6');
      INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt)
      VALUES('conn-1', 'gemini', 'oauth', '{"accessToken":"token-canary"}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO apiKeys(id, key, allowedCombos, createdAt)
      VALUES('key-1', 'sk-deadbeef', '[]', '2026-01-01T00:00:00.000Z');
    `);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value).toBe("8");
    expect(db.get(`SELECT data FROM providerConnections WHERE id='conn-1'`).data).toBe('{"accessToken":"token-canary"}');
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe("sk-deadbeef");
    expect(db.all(`PRAGMA table_info(providerQuotaSnapshots)`)).not.toHaveLength(0);
    expect(db.all(`PRAGMA table_info(quotaFetchStates)`)).not.toHaveLength(0);

    const [backupDir] = fs.readdirSync(path.join(dbDir, "backups"));
    const backup = new Database(path.join(dbDir, "backups", backupDir, "data.sqlite"), { readonly: true });
    expect(backup.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe("6");
    expect(backup.prepare(`SELECT data FROM providerConnections WHERE id='conn-1'`).get().data).toBe('{"accessToken":"token-canary"}');
    expect(backup.prepare(`SELECT key FROM apiKeys WHERE id='key-1'`).get().key).toBe("sk-deadbeef");
    expect(backup.prepare(`PRAGMA table_info(providerQuotaSnapshots)`).all()).toHaveLength(0);
    backup.close();
  });

  it("repairs a stamped v7 database whose quota tables are absent", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const seeded = new Database(path.join(dbDir, "data.sqlite"));
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
    `);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.all(`PRAGMA table_info(providerQuotaSnapshots)`)).not.toHaveLength(0);
    expect(db.all(`PRAGMA table_info(quotaFetchStates)`)).not.toHaveLength(0);
    expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value).toBe("8");
    expect(fs.readdirSync(path.join(dbDir, "backups"))).toHaveLength(1);
  });

  it("rejects an incompatible partial quota table before backup or mutation", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE providerQuotaSnapshots (connectionId TEXT, rawData TEXT);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '6');
    `);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow("Published schema mismatch");
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe("6");
    expect(unchanged.prepare(`PRAGMA table_info(providerQuotaSnapshots)`).all().map((column) => column.name)).toEqual(["connectionId", "rawData"]);
    unchanged.close();
    expect(fs.existsSync(path.join(dbDir, "backups")) ? fs.readdirSync(path.join(dbDir, "backups")) : []).toEqual([]);
  });

  it("rejects near-shape tables with altered constraint vocabularies", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    db.exec(buildCreateTableSql("providerQuotaSnapshots", TABLES.providerQuotaSnapshots)
      .replace("'available'", "'attacker_only'"));
    expect(() => verifyQuotaStorageShapes(rawAdapter(db))).toThrow("incompatible table constraints");
    db.close();

    const fetchDb = new Database(":memory:");
    fetchDb.pragma("foreign_keys=ON");
    fetchDb.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    fetchDb.exec(buildQuotaV7TableSql("quotaFetchStates").replace("'success'", "'attacker_only'"));
    expect(() => verifyQuotaStorageShapes(rawAdapter(fetchDb))).toThrow("incompatible table constraints");
    fetchDb.close();
  });

  it("accepts case-insensitive quoted quota table identifiers", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    for (const name of Object.keys(QUOTA_V7_TABLES)) {
      const quotedName = `"${name.toUpperCase()}"`;
      db.exec(buildQuotaV7TableSql(name).replaceAll(name, quotedName));
      for (const indexSql of QUOTA_V7_TABLES[name].indexes) db.exec(indexSql.replaceAll(name, quotedName));
    }
    expect(() => verifyQuotaStorageShapes(rawAdapter(db), { requireComplete: true })).not.toThrow();
    db.close();
  });

  it("rejects a fetch-only orphan from a case-variant quota table at startup", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=OFF");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
    `);
    m007.up(rawAdapter(seeded));
    seeded.exec(`
      ALTER TABLE quotaFetchStates RENAME TO quotaFetchStatesCaseBridge;
      ALTER TABLE quotaFetchStatesCaseBridge RENAME TO QUOTAFETCHSTATES;
      INSERT INTO QUOTAFETCHSTATES(connectionId, sourceId, outcome, attemptedAt, retryAt, reasonCode)
      VALUES('uppercase-orphan-canary', 'test:orphan:v1', 'timeout', '2026-01-01T00:00:00.000Z', NULL, 'timeout');
    `);
    expect(seeded.prepare(`PRAGMA foreign_key_check`).all()).toEqual([
      expect.objectContaining({ table: "QUOTAFETCHSTATES" }),
    ]);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const error = await getAdapter().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("orphan rows");
    expect(error.message).not.toContain("uppercase-orphan-canary");
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.prepare(`SELECT COUNT(*) AS count FROM QUOTAFETCHSTATES`).get().count).toBe(1);
    unchanged.close();
    expect(fs.existsSync(path.join(dbDir, "backups")) ? fs.readdirSync(path.join(dbDir, "backups")) : []).toEqual([]);
  });

  it("rejects a required index name bound to the wrong columns and extra uniqueness", () => {
    const wrongColumns = new Database(":memory:");
    wrongColumns.pragma("foreign_keys=ON");
    wrongColumns.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    m007.up(rawAdapter(wrongColumns));
    wrongColumns.exec(`DROP INDEX idx_pqs_stale; CREATE INDEX idx_pqs_stale ON providerQuotaSnapshots(observedAt)`);
    expect(() => verifyQuotaStorageShapes(rawAdapter(wrongColumns), { requireComplete: true })).toThrow("incompatible index definition");
    wrongColumns.close();

    const extraUnique = new Database(":memory:");
    extraUnique.pragma("foreign_keys=ON");
    extraUnique.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    m007.up(rawAdapter(extraUnique));
    extraUnique.exec(`CREATE UNIQUE INDEX injected_unique_source ON quotaFetchStates(sourceId)`);
    expect(() => verifyQuotaStorageShapes(rawAdapter(extraUnique), { requireComplete: true })).toThrow("unexpected unique index");
    extraUnique.close();
  });

  it("repairs a missing required quota index and verifies the final definition", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=ON");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
    `);
    m007.up(rawAdapter(seeded));
    seeded.exec(`DROP INDEX idx_pqs_stale`);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.all(`PRAGMA index_info(idx_pqs_stale)`).map((column) => column.name)).toEqual(["staleAt"]);
    expect(() => verifyQuotaStorageShapes(db, { requireComplete: true })).not.toThrow();
    expect(fs.readdirSync(path.join(dbDir, "backups"))).toHaveLength(1);
  });

  it("rejects orphaned quota rows at startup before backup or mutation", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=OFF");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
    `);
    m007.up(rawAdapter(seeded));
    seeded.prepare(`
      INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, attemptedAt, retryAt, reasonCode)
      VALUES('orphan-secret-canary', 'test:orphan:v1', 'timeout', '2026-01-01T00:00:00.000Z', NULL, 'timeout')
    `).run();
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const error = await getAdapter().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("orphan rows");
    expect(error.message).not.toContain("orphan-secret-canary");
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe("7");
    expect(unchanged.prepare(`SELECT COUNT(*) AS count FROM quotaFetchStates`).get().count).toBe(1);
    unchanged.close();
    expect(fs.existsSync(path.join(dbDir, "backups")) ? fs.readdirSync(path.join(dbDir, "backups")) : []).toEqual([]);
  });

  it("rejects an orphaned snapshot even when fetch-state storage is clean", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=OFF");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
    `);
    m007.up(rawAdapter(seeded));
    seeded.prepare(`
      INSERT INTO providerQuotaSnapshots(
        connectionId, accountKey, resourceKey, dimensionKey, state, limitKind,
        observedAt, staleAt, sourceType, sourceId, metadataJson
      ) VALUES('orphan-snapshot-canary', 'scope:connection', 'scope:account', 'requests:orphan',
        'unknown', 'unknown', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z',
        'import', 'test:orphan:v1', '{}')
    `).run();
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const error = await getAdapter().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("orphan rows");
    expect(error.message).not.toContain("orphan-snapshot-canary");
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.prepare(`SELECT COUNT(*) AS count FROM providerQuotaSnapshots`).get().count).toBe(1);
    unchanged.close();
    expect(fs.existsSync(path.join(dbDir, "backups")) ? fs.readdirSync(path.join(dbDir, "backups")) : []).toEqual([]);
  });
});
