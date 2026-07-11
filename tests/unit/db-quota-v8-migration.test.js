import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import m007 from "../../src/lib/db/migrations/007-provider-quota-snapshots.js";
import m008 from "../../src/lib/db/migrations/008-quota-reservations.js";
import { QUOTA_V8_TABLES, buildQuotaV8TableSql } from "../../src/lib/db/migrations/quota-v8-schema.js";
import { verifyQuotaStorageShapes } from "../../src/lib/db/helpers/schemaVerifier.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

function rawAdapter(db) {
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => db.prepare(sql).run(params),
    get: (sql, params = []) => db.prepare(sql).get(params),
    all: (sql, params = []) => db.prepare(sql).all(params),
    transaction: (fn) => db.transaction(fn)(),
  };
}

function shape(db, table) {
  return {
    sql: db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table).sql,
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    indexes: db.prepare(`PRAGMA index_list(${table})`).all().map((index) => ({
      name: index.name,
      unique: index.unique,
      columns: db.prepare(`PRAGMA index_info(${index.name})`).all().map((column) => column.name),
    })).sort((left, right) => left.name.localeCompare(right.name)),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-quota-v8-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("quota reservation schema v8", () => {
  it("locks the published v8 quota DDL to an independent fingerprint", () => {
    const ddl = Object.keys(QUOTA_V8_TABLES)
      .flatMap((name) => [buildQuotaV8TableSql(name), ...QUOTA_V8_TABLES[name].indexes])
      .join("\n");
    expect(createHash("sha256").update(ddl).digest("hex"))
      .toBe("a336347532b0529f97563bcd02f335de1e1ea370ec5fcb0e06fa91673dc4dd07");
  });

  it("produces the same immutable operational schema on fresh and v7-upgrade paths", () => {
    const migrated = new Database(":memory:");
    migrated.pragma("foreign_keys=ON");
    migrated.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    m007.up(rawAdapter(migrated));
    m008.up(rawAdapter(migrated));

    const fresh = new Database(":memory:");
    fresh.pragma("foreign_keys=ON");
    fresh.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    for (const name of ["providerQuotaSnapshots", "quotaFetchStates", "quotaReservations", "quotaReservationItems"]) {
      fresh.exec(buildCreateTableSql(name, TABLES[name]));
      for (const index of TABLES[name].indexes || []) fresh.exec(index);
    }

    for (const name of Object.keys(QUOTA_V8_TABLES)) {
      expect(shape(migrated, name)).toEqual(shape(fresh, name));
      expect(migrated.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name).sql)
        .toContain(name);
    }
    expect(shape(migrated, "quotaReservations").foreignKeys).toContainEqual(expect.objectContaining({ table: "providerConnections", on_delete: "CASCADE" }));
    expect(shape(migrated, "quotaReservationItems").foreignKeys).toContainEqual(expect.objectContaining({ table: "quotaReservations", on_delete: "CASCADE" }));
    expect(() => verifyQuotaStorageShapes(rawAdapter(migrated), { requireComplete: true, useLatest: true })).not.toThrow();
    migrated.close();
    fresh.close();
  });

  it("keeps the published v8 DDL idempotent", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    m008.up(rawAdapter(db));
    const before = Object.keys(QUOTA_V8_TABLES).map((name) => db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name).sql);
    m008.up(rawAdapter(db));
    expect(Object.keys(QUOTA_V8_TABLES).map((name) => db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(name).sql)).toEqual(before);
    db.close();
  });

  it("rejects a malformed pre-created v8 object on a v7 stamp before backup or mutation", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=ON");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      CREATE TABLE quotaReservations (id TEXT PRIMARY KEY, rawSecret TEXT);
    `);
    m007.up(rawAdapter(seeded));
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const error = await getAdapter().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("incompatible table constraints");
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe("7");
    expect(unchanged.prepare(`PRAGMA table_info(quotaReservations)`).all().map((column) => column.name)).toEqual(["id", "rawSecret"]);
    unchanged.close();
    expect(fs.existsSync(path.join(dbDir, "backups")) ? fs.readdirSync(path.join(dbDir, "backups")) : []).toEqual([]);
  });

  it("rejects a globally named v8 index collision before backup or migration", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=ON");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '7');
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      CREATE TABLE collisionTarget (value TEXT);
      CREATE INDEX idx_qr_active_expiry ON collisionTarget(value);
    `);
    m007.up(rawAdapter(seeded));
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const error = await getAdapter().catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("exists without its table");
    const unchanged = new Database(file, { readonly: true });
    expect(unchanged.prepare(`SELECT value FROM _meta WHERE key='schemaVersion'`).get().value).toBe("7");
    expect(unchanged.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='quotaReservations'`).get()).toBeUndefined();
    unchanged.close();
    expect(fs.existsSync(path.join(dbDir, "backups")) ? fs.readdirSync(path.join(dbDir, "backups")) : []).toEqual([]);
  });

  it("repairs a missing stamped-v8 index only after creating a safety backup", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    const file = path.join(dbDir, "data.sqlite");
    const seeded = new Database(file);
    seeded.pragma("foreign_keys=ON");
    seeded.exec(`
      CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO _meta(key, value) VALUES('schemaVersion', '8');
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
    `);
    m007.up(rawAdapter(seeded));
    m008.up(rawAdapter(seeded));
    seeded.exec(`DROP INDEX idx_qr_active_expiry`);
    seeded.close();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    expect(db.all(`PRAGMA index_info(idx_qr_active_expiry)`).map((column) => column.name)).toEqual(["state", "leaseExpiresAt"]);
    expect(fs.readdirSync(path.join(dbDir, "backups"))).toHaveLength(1);
  });

  it("rejects v8 orphan rows without echoing stored identifiers", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=OFF");
    db.exec(`CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL)`);
    m008.up(rawAdapter(db));
    db.prepare(`
      INSERT INTO quotaReservations(
        id, connectionId, provider, routeKeyHash, state, ownerEpoch,
        acquiredAt, leaseExpiresAt, lastHeartbeatAt
      ) VALUES('reservation-canary', 'orphan-secret-canary', 'kiro', ?, 'active', ?, ?, ?, ?)
    `).run("a".repeat(64), "b".repeat(64), new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
    expect(() => verifyQuotaStorageShapes(rawAdapter(db), { requireComplete: false, useLatest: true }))
      .toThrowError(/orphan rows/);
    try {
      verifyQuotaStorageShapes(rawAdapter(db), { useLatest: true });
    } catch (error) {
      expect(error.message).not.toContain("orphan-secret-canary");
    }
    db.close();
  });

  it("rejects a reservation whose provider disagrees with its parent connection", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys=ON");
    db.exec(`
      CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL);
      INSERT INTO providerConnections(id, provider) VALUES('connection-canary', 'codex');
    `);
    m008.up(rawAdapter(db));
    db.prepare(`
      INSERT INTO quotaReservations(
        id, connectionId, provider, routeKeyHash, state, ownerEpoch,
        acquiredAt, leaseExpiresAt, lastHeartbeatAt
      ) VALUES('reservation-canary', 'connection-canary', 'kiro', ?, 'active', ?, ?, ?, ?)
    `).run(
      "a".repeat(64),
      "b".repeat(64),
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
      new Date().toISOString(),
    );

    expect(() => verifyQuotaStorageShapes(rawAdapter(db), { useLatest: true }))
      .toThrowError("Published schema mismatch: quota reservation provider does not match its connection");
    db.close();
  });

  it("exports the frozen helper DDL used by migration", () => {
    for (const name of Object.keys(QUOTA_V8_TABLES)) {
      expect(buildQuotaV8TableSql(name)).toBe(buildCreateTableSql(name, TABLES[name]));
    }
  });
});
