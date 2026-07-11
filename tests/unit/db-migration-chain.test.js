// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "apiKeyUsageTotals", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
    ]));
  });

  it.each([3, 4, 5])(
    "upgrades schema v%i without reinterpreting v4 or rewriting API-key secrets",
    async (schemaVersion) => {
      const dbDir = path.join(tempDir, "db");
      fs.mkdirSync(dbDir, { recursive: true });
      const seeded = new Database(path.join(dbDir, "data.sqlite"));
      const apiKeyColumns = [
        "id TEXT PRIMARY KEY",
        "key TEXT UNIQUE NOT NULL",
        "name TEXT",
        "machineId TEXT",
        "isActive INTEGER DEFAULT 1",
        "allowedCombos TEXT",
        ...(schemaVersion >= 4 ? ["dailyLimitTokens INTEGER"] : []),
        ...(schemaVersion >= 5 ? ["expiresAt TEXT"] : []),
        "createdAt TEXT NOT NULL",
      ];
      seeded.exec(`
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE apiKeys (${apiKeyColumns.join(", ")});
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
      seeded.prepare(`INSERT INTO _meta(key, value) VALUES('schemaVersion', ?)`).run(String(schemaVersion));
      const secret = "sk-deadbeef";
      const insertColumns = ["id", "key", "name", "isActive", "allowedCombos", ...(schemaVersion >= 4 ? ["dailyLimitTokens"] : []), ...(schemaVersion >= 5 ? ["expiresAt"] : []), "createdAt"];
      const insertValues = ["key-1", secret, "Existing", 1, "[]", ...(schemaVersion >= 4 ? [9000] : []), ...(schemaVersion >= 5 ? ["2030-01-01T00:00:00.000Z"] : []), "2026-01-01T00:00:00.000Z"];
      seeded.prepare(`INSERT INTO apiKeys(${insertColumns.join(", ")}) VALUES(${insertColumns.map(() => "?").join(", ")})`).run(...insertValues);
      seeded.prepare(`
        INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
        VALUES(?, 'openai', 'gpt-test', ?, 11, 7, 0.25, 'ok', '{}', '{}')
      `).run("2026-01-02T00:00:00.000Z", secret);
      // Seed a large observability row to prove the lite backup EXCLUDES
      // requestDetails while preserving critical tables.
      seeded.exec(`
        CREATE TABLE requestDetails (
          id TEXT PRIMARY KEY, timestamp TEXT, provider TEXT, model TEXT,
          connectionId TEXT, status TEXT, data TEXT
        );
      `);
      seeded.prepare(
        `INSERT INTO requestDetails(id, timestamp, provider, model, status, data) VALUES(?,?,?,?,?,?)`
      ).run("rd-1", "2026-01-02T00:00:00.000Z", "openai", "gpt-test", "ok", "x".repeat(2048));
      seeded.close();

      delete global._dbAdapter;
      vi.resetModules();
      const { getAdapter } = await import("@/lib/db/driver.js");
      const db = await getAdapter();

      expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value).toBe("6");
      expect(db.get(`SELECT value FROM _meta WHERE key='appVersion'`)?.value).toBeTruthy();
      const key = db.get(`SELECT * FROM apiKeys WHERE id = 'key-1'`);
      expect(key.key).toBe(secret);
      expect(key.dailyLimitTokens).toBe(schemaVersion >= 4 ? 9000 : null);
      expect(key.expiresAt).toBe(schemaVersion >= 5 ? "2030-01-01T00:00:00.000Z" : null);
      expect(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name)).toContain("policy");
      expect(db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = 'key-1'`)).toMatchObject({
        totalTokens: 18,
        totalCost: 0.25,
        totalRequests: 1,
      });

      const backupDirs = fs.readdirSync(path.join(tempDir, "db", "backups"));
      expect(backupDirs).toHaveLength(1);
      const backupPath = path.join(tempDir, "db", "backups", backupDirs[0], "data.sqlite");
      const backup = new Database(backupPath, { readonly: true });
      expect(backup.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe(String(schemaVersion));
      expect(backup.prepare(`SELECT key FROM apiKeys WHERE id='key-1'`).get().key).toBe(secret);
      expect(backup.prepare(`PRAGMA table_info(apiKeys)`).all().map((row) => row.name)).not.toContain("policy");
      // Lite backup excludes the requestDetails observability log.
      const backupTables = backup.prepare(
        `SELECT name FROM sqlite_master WHERE type='table'`
      ).all().map((row) => row.name);
      expect(backupTables).not.toContain("requestDetails");
      // Critical table still backed up with its row.
      expect(backupTables).toContain("apiKeys");
      backup.close();
    },
  );

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("repairs a stamped v6 database whose old migration omitted lifetime totals", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const seeded = new Database(path.join(dbDir, "data.sqlite"));
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT,
        isActive INTEGER DEFAULT 1, allowedCombos TEXT, dailyLimitTokens INTEGER,
        expiresAt TEXT, policy TEXT, createdAt TEXT NOT NULL
      );
      CREATE TABLE usageHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT,
        model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT,
        promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT
      );
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '6');
    `);
    const secret = "sk-deadbeef";
    seeded.prepare(`INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt) VALUES('key-1', ?, 'Existing', 1, '[]', '2026-01-01T00:00:00.000Z')`).run(secret);
    seeded.prepare(`INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, cost, tokens, meta) VALUES('2026-01-02T00:00:00.000Z', ?, 10, 6, 0.4, '{}', '{}')`).run(secret);
    seeded.close();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId='key-1'`)).toMatchObject({
      totalTokens: 16,
      totalCost: 0.4,
      totalRequests: 1,
    });
    expect(db.get(`SELECT key FROM apiKeys WHERE id='key-1'`).key).toBe(secret);
    const [backupDir] = fs.readdirSync(path.join(tempDir, "db", "backups"));
    const backup = new Database(path.join(tempDir, "db", "backups", backupDir, "data.sqlite"), { readonly: true });
    expect(backup.prepare(`PRAGMA table_info(apiKeyUsageTotals)`).all()).toHaveLength(0);
    expect(backup.prepare(`SELECT key FROM apiKeys WHERE id='key-1'`).get().key).toBe(secret);
    backup.close();
  });

  it("fresh DB + legacy db.json → imports data automatically", async () => {
    // Simulate user upgrading: place legacy JSON in DATA_DIR before first boot
    const legacy = {
      settings: { foo: "legacy-value" },
      apiKeys: [{
        id: "k1",
        key: "sk-deadbeef",
        name: "test",
        policy: { allowedModels: ["openai/gpt-test"] },
        expiresAt: "2030-01-01T03:30:00+03:30",
        createdAt: new Date().toISOString(),
      }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({
      history: [{
        timestamp: "2026-01-02T00:00:00.000Z",
        provider: "openai",
        model: "gpt-test",
        apiKey: "sk-deadbeef",
        cost: 0.5,
        tokens: { prompt_tokens: 9, completion_tokens: 4 },
      }],
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "legacy-value" });

    const keys = db.all(`SELECT * FROM apiKeys`);
    expect(keys).toHaveLength(1);
    expect(keys[0].key).toBe("sk-deadbeef");
    expect(JSON.parse(keys[0].policy)).toEqual({ allowedModels: ["openai/gpt-test"] });
    expect(keys[0].expiresAt).toBe("2030-01-01T00:00:00.000Z");
    expect(db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = 'k1'`)).toMatchObject({
      totalTokens: 13,
      totalCost: 0.5,
      totalRequests: 1,
    });

    const aliases = db.all(`SELECT * FROM kv WHERE scope='modelAliases'`);
    expect(aliases).toHaveLength(1);
  });

  it("rejects malformed legacy expiry before schema mutation and retries after correction", async () => {
    const legacyPath = path.join(tempDir, "db.json");
    const legacy = {
      apiKeys: [{
        id: "legacy-key",
        key: "sk-deadbeef",
        name: "Legacy",
        expiresAt: "2030-01-01T00:00:00",
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    };
    fs.writeFileSync(legacyPath, JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toMatchObject({ code: "INVALID_API_KEY_EXPIRY" });

    const physical = new Database(path.join(tempDir, "db", "data.sqlite"));
    expect(physical.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_meta'`).get()).toBeUndefined();
    physical.close();
    expect(fs.existsSync(legacyPath)).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "db", ".migrated-from-json"))).toBe(false);

    legacy.apiKeys[0].expiresAt = "2030-01-01T03:30:00+03:30";
    fs.writeFileSync(legacyPath, JSON.stringify(legacy));
    const db = await getAdapter();
    expect(db.get(`SELECT key, expiresAt FROM apiKeys WHERE id='legacy-key'`)).toEqual({
      key: "sk-deadbeef",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it.each([
    ["expiresAt INTEGER", "incompatible type"],
    ["expiresAt TEXT NOT NULL", "incompatible nullability"],
  ])("rejects a stamped partial v5 schema before backup or mutation: %s", async (column, _label) => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const seeded = new Database(path.join(dbDir, "data.sqlite"));
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT,
        isActive INTEGER DEFAULT 1, allowedCombos TEXT, dailyLimitTokens INTEGER,
        ${column}, createdAt TEXT NOT NULL
      );
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '5');
    `);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).rejects.toThrow("Published schema mismatch");

    const unchanged = new Database(path.join(dbDir, "data.sqlite"), { readonly: true });
    expect(unchanged.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe("5");
    expect(unchanged.prepare(`PRAGMA table_info(apiKeys)`).all().map((row) => row.name)).not.toContain("policy");
    unchanged.close();
    const backupDir = path.join(dbDir, "backups");
    expect(fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : []).toHaveLength(0);
  });

  it("recovers a stamped v5 database whose expiry column is missing", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const seeded = new Database(path.join(dbDir, "data.sqlite"));
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT,
        isActive INTEGER DEFAULT 1, allowedCombos TEXT, dailyLimitTokens INTEGER,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE usageHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT,
        model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT,
        promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT
      );
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '5');
      INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, createdAt)
      VALUES('key-1', 'sk-deadbeef', 'Existing', 1, '[]', '2026-01-01T00:00:00.000Z');
    `);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value).toBe("6");
    expect(db.all(`PRAGMA table_info(apiKeys)`).map((row) => row.name)).toContain("expiresAt");
    expect(db.get(`SELECT key, expiresAt FROM apiKeys WHERE id='key-1'`)).toEqual({
      key: "sk-deadbeef",
      expiresAt: null,
    });
  });

  it("accepts and preserves a compatible expiry column left by a partial v4 migration", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const seeded = new Database(path.join(dbDir, "data.sqlite"));
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE apiKeys (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT,
        isActive INTEGER DEFAULT 1, allowedCombos TEXT, dailyLimitTokens INTEGER,
        expiresAt TEXT, createdAt TEXT NOT NULL
      );
      CREATE TABLE usageHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT,
        model TEXT, connectionId TEXT, apiKey TEXT, endpoint TEXT,
        promptTokens INTEGER DEFAULT 0, completionTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT
      );
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '4');
      INSERT INTO apiKeys(id, key, name, isActive, allowedCombos, expiresAt, createdAt)
      VALUES('key-1', 'sk-deadbeef', 'Existing', 1, '[]', '2030-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value).toBe("6");
    expect(db.get(`SELECT key, expiresAt FROM apiKeys WHERE id='key-1'`)).toEqual({
      key: "sk-deadbeef",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(db.all(`PRAGMA table_info(apiKeys)`).filter((row) => row.name === "expiresAt")).toHaveLength(1);
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_type");
  });
});
