// OmniRoute Nov 21 usage-store and backup ports (#19690 shared invariants, #20892 duplicate
// index removal). Offline: temporary on-disk databases only, never the user's data directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SCHEMA_VERSION, TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-nov21-usage-db-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  vi.doUnmock("@/lib/db/backup.js");
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const backupsDir = () => path.join(tempDir, "db", "backups");

/** Backup directories named by age rank: b0 is the newest, the last is the oldest. */
function seedBackupDirs(count) {
  fs.mkdirSync(backupsDir(), { recursive: true });
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const dir = path.join(backupsDir(), `b${i}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "data.sqlite"), "x");
    const when = new Date(Date.now() - (i + 1) * 60_000);
    fs.utimesSync(dir, when, when);
    names.push(`b${i}`);
  }
  return names;
}

const remaining = () => fs.readdirSync(backupsDir()).filter((n) => !n.startsWith(".")).sort();

function deadPid() {
  const child = spawnSync(process.execPath, ["-e", "0"]);
  return child.pid;
}

function writeLease(name, lease, ageMs = 0) {
  const file = path.join(backupsDir(), `.migration-lease-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(lease));
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
  }
  return file;
}

describe("#19690 migration snapshot lease survives pruning", () => {
  it("keeps a leased backup beyond the retention count and prunes it after release", async () => {
    const { acquireSnapshotLease, pruneOldBackups } = await import("@/lib/db/backup.js");
    seedBackupDirs(6); // KEEP_BACKUPS is 3, so b3..b5 are overflow
    const release = acquireSnapshotLease(path.join(backupsDir(), "b5"));

    pruneOldBackups();
    expect(remaining()).toEqual(["b0", "b1", "b2", "b5"]);

    release();
    release(); // releasing twice is harmless
    pruneOldBackups();
    expect(remaining()).toEqual(["b0", "b1", "b2"]);
    expect(fs.readdirSync(backupsDir()).filter((n) => n.includes("lease"))).toEqual([]);
  });

  it("ignores and deletes a lease whose owner process is gone", async () => {
    const { pruneOldBackups } = await import("@/lib/db/backup.js");
    seedBackupDirs(5);
    const lease = writeLease("dead", { pid: deadPid(), base: "b4" });

    pruneOldBackups();
    expect(remaining()).toEqual(["b0", "b1", "b2"]);
    expect(fs.existsSync(lease)).toBe(false);
  });

  it("ignores a day-old lease even when its pid is alive, and a lease with no usable pid", async () => {
    const { pruneOldBackups } = await import("@/lib/db/backup.js");
    seedBackupDirs(6);
    const old = writeLease("old", { pid: process.pid, base: "b4" }, 25 * 60 * 60 * 1000);
    const nopid = writeLease("nopid", { base: "b5" });

    pruneOldBackups();
    expect(remaining()).toEqual(["b0", "b1", "b2"]);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(nopid)).toBe(false);
  });

  it("leaves unreadable lease files alone and still prunes unleased overflow", async () => {
    const { pruneOldBackups } = await import("@/lib/db/backup.js");
    seedBackupDirs(5);
    const bad = path.join(backupsDir(), ".migration-lease-bad.json");
    fs.writeFileSync(bad, "{not json");

    pruneOldBackups();
    expect(remaining()).toEqual(["b0", "b1", "b2"]);
    expect(fs.existsSync(bad)).toBe(true);
  });

  it("a lease on a backup inside the retained set changes nothing", async () => {
    const { acquireSnapshotLease, pruneOldBackups } = await import("@/lib/db/backup.js");
    seedBackupDirs(5);
    const release = acquireSnapshotLease(path.join(backupsDir(), "b0"));
    pruneOldBackups();
    expect(remaining()).toEqual(["b0", "b1", "b2"]);
    release();
  });
});

// Seeds a database at schema v27 whose upgrade takes a pre-migration backup, with the
// duplicate indexes older schema versions declared still present.
async function seedVersion27() {
  const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
  const { applyVersionedMigrations } = await import("@/lib/db/migrate.js");
  const { MIGRATIONS } = await import("@/lib/db/migrations/index.js");
  const dbDir = path.join(tempDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });
  const db = createBetterSqliteAdapter(path.join(dbDir, "data.sqlite"));
  try {
    db.exec(buildCreateTableSql("_meta", TABLES._meta));
    applyVersionedMigrations(db, MIGRATIONS.filter((migration) => migration.version <= 27));
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

async function reopen() {
  global._dbAdapter?.instance?.close();
  delete global._dbAdapter;
  vi.resetModules();
  return (await import("@/lib/db/driver.js")).getAdapter();
}

const indexNames = (db) => new Set(db.all("SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name));

describe("#19690 the upgrade holds a lease on its restore point until it ends", () => {
  it("pins the backup directory while pruning runs and releases every lease afterwards", async () => {
    const seeded = await seedVersion27();
    seeded.close();

    const seen = [];
    vi.doMock("@/lib/db/backup.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        pruneOldBackups: () => {
          const dir = backupsDir();
          const leases = fs.readdirSync(dir).filter((n) => n.startsWith(".migration-lease-") && n.endsWith(".json"));
          seen.push(leases.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"))));
          return actual.pruneOldBackups();
        },
      };
    });

    const db = await reopen();
    expect(db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value).toBe(String(SCHEMA_VERSION));

    expect(seen.length).toBeGreaterThan(0);
    const backupNames = fs.readdirSync(backupsDir()).filter((n) => !n.startsWith("."));
    expect(backupNames.length).toBeGreaterThan(0);
    for (const leases of seen) {
      expect(leases).toHaveLength(1);
      expect(leases[0].pid).toBe(process.pid);
      expect(backupNames).toContain(leases[0].base);
    }
    expect(fs.readdirSync(backupsDir()).filter((n) => n.startsWith(".migration-lease-"))).toEqual([]);
  });

  it("releases the lease when the upgrade throws", async () => {
    const seeded = await seedVersion27();
    seeded.run(`INSERT INTO apiKeys(id, key, name, createdAt) VALUES('a', 'secret-a', 'a', '2026-01-01T00:00:00.000Z')`);
    seeded.exec(`CREATE TRIGGER fail_028 BEFORE UPDATE OF unknownCostRequests ON apiKeyUsageTotals
      BEGIN SELECT RAISE(ABORT, 'forced failure after the backup'); END`);
    seeded.run(`INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt)
      VALUES('a', 1, 1, 1, 0, '2026-01-03T00:00:00.000Z')`);
    seeded.run(`INSERT INTO usageHistory(timestamp, apiKey, provider, status, cost) VALUES('2026-01-02T00:00:00.000Z', 'secret-a', 'openai', 'ok', NULL)`);
    seeded.close();

    await expect(reopen()).rejects.toThrow("forced failure after the backup");
    expect(fs.readdirSync(backupsDir()).filter((n) => !n.startsWith(".")).length).toBeGreaterThan(0);
    expect(fs.readdirSync(backupsDir()).filter((n) => n.startsWith(".migration-lease-"))).toEqual([]);
  });
});

describe("#20892 duplicate indexes of a unique index are removed at startup", () => {
  const DUPLICATES = [
    "CREATE INDEX idx_ak_key ON apiKeys(key)",
    "CREATE INDEX idx_combo_name ON combos(name)",
    "CREATE INDEX idx_mcp_inst_slug ON mcpInstances(slug)",
    "CREATE INDEX idx_mcp_gwkey ON mcpGatewayKeys(key)",
  ];
  // Same columns as a unique index, but not an exact duplicate: collation, order, partial, extra column.
  const PRESERVED = [
    "CREATE INDEX idx_combo_name_desc ON combos(name DESC)",
    "CREATE INDEX idx_combo_name_partial ON combos(name) WHERE kind IS NOT NULL",
    "CREATE INDEX idx_combo_name_kind ON combos(name, kind)",
    "CREATE INDEX idx_ak_name_only ON apiKeys(name)",
  ];

  it("fresh databases never create the duplicates and keep the nocase indexes", async () => {
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    const names = indexNames(db);
    for (const sql of DUPLICATES) expect(names.has(sql.split(" ")[2])).toBe(false);
    for (const name of ["idx_combo_name_nocase", "idx_akg_name", "idx_cg_name"]) expect(names.has(name)).toBe(true);
  });

  it("drops exact duplicates of an existing unique index and preserves every mismatched index", async () => {
    const seeded = await seedVersion27();
    for (const sql of [...DUPLICATES, ...PRESERVED]) seeded.exec(sql);
    const before = indexNames(seeded);
    for (const sql of DUPLICATES) expect(before.has(sql.split(" ")[2])).toBe(true);
    seeded.close();

    const db = await reopen();
    const after = indexNames(db);
    for (const sql of DUPLICATES) expect(after.has(sql.split(" ")[2])).toBe(false);
    for (const sql of PRESERVED) expect(after.has(sql.split(" ")[2])).toBe(true);
    expect(after.has("idx_combo_name_nocase")).toBe(true); // declared by the schema itself
    // The UNIQUE constraints that the duplicates repeated are still enforced and indexed.
    const plan = db.all("EXPLAIN QUERY PLAN SELECT id FROM apiKeys WHERE key = 'x'").map((r) => r.detail).join(" | ");
    expect(plan).toMatch(/sqlite_autoindex_apiKeys_\d+/);
    db.run(`INSERT INTO apiKeys(id, key, name, createdAt) VALUES('a', 'dup', 'a', '2026-01-01T00:00:00.000Z')`);
    expect(() => db.run(`INSERT INTO apiKeys(id, key, name, createdAt) VALUES('b', 'dup', 'b', '2026-01-01T00:00:00.000Z')`)).toThrow(/UNIQUE/i);
  });

  it("is idempotent across repeated startups and leaves unrelated indexes alone", async () => {
    const seeded = await seedVersion27();
    for (const sql of DUPLICATES) seeded.exec(sql);
    seeded.close();

    const first = indexNames(await reopen());
    const second = indexNames(await reopen());
    const third = indexNames(await reopen());
    expect([...second].sort()).toEqual([...first].sort());
    expect([...third].sort()).toEqual([...first].sort());
    for (const name of ["idx_uh_ts", "idx_kv_scope", "idx_mcp_inst_enabled", "idx_combo_name_nocase", "idx_uh_usage_event"]) {
      expect(third.has(name)).toBe(true);
    }
  });

  it("only drops a plain index when the unique index it repeats actually exists", async () => {
    const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
    const { dropExactDuplicateUniqueIndexes } = await import("@/lib/db/migrate.js");
    fs.mkdirSync(path.join(tempDir, "db"), { recursive: true });
    const db = createBetterSqliteAdapter(path.join(tempDir, "db", "scratch.sqlite"));
    try {
      db.exec(`
        CREATE TABLE t_unique (id INTEGER PRIMARY KEY, a TEXT UNIQUE NOT NULL, b TEXT, c TEXT);
        CREATE INDEX dup_a ON t_unique(a);
        CREATE UNIQUE INDEX uq_bc ON t_unique(b, c);
        CREATE INDEX dup_bc ON t_unique(b, c);
        CREATE INDEX only_c ON t_unique(c);
        CREATE TABLE t_plain (id INTEGER PRIMARY KEY, a TEXT, b TEXT);
        CREATE INDEX plain_a ON t_plain(a);
        CREATE INDEX plain_a_again ON t_plain(a);
        CREATE UNIQUE INDEX uq_partial ON t_plain(b) WHERE b IS NOT NULL;
        CREATE INDEX plain_b ON t_plain(b);
        CREATE UNIQUE INDEX uq_expr ON t_plain(lower(a));
        CREATE INDEX plain_expr ON t_plain(lower(a));
      `);
      expect(dropExactDuplicateUniqueIndexes(db).sort()).toEqual(["dup_a", "dup_bc"]);
      const names = indexNames(db);
      for (const name of ["dup_a", "dup_bc"]) expect(names.has(name)).toBe(false);
      // Two plain copies of each other are not a unique-index duplicate; partial/expression stay.
      for (const name of ["only_c", "uq_bc", "plain_a", "plain_a_again", "plain_b", "uq_partial", "plain_expr", "uq_expr"]) {
        expect(names.has(name)).toBe(true);
      }
      expect(dropExactDuplicateUniqueIndexes(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
