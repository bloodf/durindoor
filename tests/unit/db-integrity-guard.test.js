import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-integrity-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.restoreAllMocks();
});

function migrationArtifacts() {
  const dbDir = path.join(tempDir, "db");
  const backupsDir = path.join(dbDir, "backups");
  return {
    backups: fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).sort() : [],
    marker: fs.existsSync(path.join(dbDir, ".migrated-from-json")),
  };
}

function corruptQuotaFetchStatesPrimaryKey(dbFile) {
  const db = new Database(dbFile);
  const index = db
    .prepare(
      `
        SELECT rootpage FROM sqlite_master
        WHERE type = 'index' AND name = 'sqlite_autoindex_quotaFetchStates_1'
      `,
    )
    .get();
  const pageSize = db.pragma("page_size", { simple: true });
  db.close();

  const bytes = fs.readFileSync(dbFile);
  const cellCountOffset = (index.rootpage - 1) * pageSize + 3;
  bytes.writeUInt16BE(bytes.readUInt16BE(cellCountOffset) + 1, cellCountOffset);
  fs.writeFileSync(dbFile, bytes);
}

describe("SQLite startup integrity guard", () => {
  it("accepts a healthy fresh database", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(db.all("PRAGMA quick_check")).toEqual([{ quick_check: "ok" }]);
  });

  it("rejects a failed full integrity check before migration mutates data or artifacts", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)", ["sync3862", "sentinel", "preserved"]);
    db.run("UPDATE _meta SET value = ? WHERE key = 'appVersion'", ["fixture-old-version"]);
    db.flush?.();
    const before = migrationArtifacts();
    const wrapper = {
      ...db,
      all(sql, params = []) {
        if (sql === "PRAGMA quick_check") {
          return [{ quick_check: "wrong # of entries in index fixture_index" }];
        }
        return db.all(sql, params);
      },
    };
    const { IntegrityCheckFailed } = await import("@/lib/db/helpers/integrityCheck.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");

    await expect(runMigrationOnce(wrapper)).rejects.toBeInstanceOf(IntegrityCheckFailed);
    expect(db.get("SELECT value FROM _meta WHERE key = 'appVersion'")).toEqual({ value: "fixture-old-version" });
    expect(db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", ["sync3862", "sentinel"])).toEqual({ value: "preserved" });
    expect(migrationArtifacts()).toEqual(before);
  });

  it("rethrows a malformed-image freshness read without mutation and retries the same adapter", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)", ["sync3862", "sentinel", "preserved"]);
    db.run("UPDATE _meta SET value = ? WHERE key = 'appVersion'", ["fixture-old-version"]);
    db.flush?.();
    const before = migrationArtifacts();
    const malformed = new Error("database disk image is malformed");
    let injectFailure = true;
    const wrapper = {
      ...db,
      get(sql, params = []) {
        if (injectFailure && sql === "SELECT COUNT(*) as c FROM _meta") throw malformed;
        return db.get(sql, params);
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { getAppVersion } = await import("@/lib/db/version.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");

    await expect(runMigrationOnce(wrapper)).rejects.toBe(malformed);
    expect(db.get("SELECT value FROM _meta WHERE key = 'appVersion'")).toEqual({ value: "fixture-old-version" });
    expect(db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", ["sync3862", "sentinel"])).toEqual({ value: "preserved" });
    expect(migrationArtifacts()).toEqual(before);

    injectFailure = false;
    await expect(runMigrationOnce(wrapper)).resolves.toBeUndefined();
    expect(db.get("SELECT value FROM _meta WHERE key = 'appVersion'")).toEqual({ value: getAppVersion() });
  });

  it("retains fresh-database fallback for unrelated _meta read failures", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const wrapper = {
      ...db,
      get(sql, params = []) {
        if (sql === "SELECT COUNT(*) as c FROM _meta") throw new Error("no such table: _meta");
        return db.get(sql, params);
      },
    };
    const { getAppVersion } = await import("@/lib/db/version.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");

    await expect(runMigrationOnce(wrapper)).resolves.toBeUndefined();
    expect(db.get("SELECT value FROM _meta WHERE key = 'appVersion'")).toEqual({ value: getAppVersion() });
  });

  it("rethrows corruption errors without the disk-image wording", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const corrupt = new Error("database file is corrupt");
    const wrapper = {
      ...db,
      get(sql, params = []) {
        if (sql === "SELECT COUNT(*) as c FROM _meta") throw corrupt;
        return db.get(sql, params);
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");

    await expect(runMigrationOnce(wrapper)).rejects.toBe(corrupt);
  });

  it("refuses real index corruption without creating migration artifacts", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`
      INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt)
      VALUES ('connection', 'test', 'none', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `);
    for (let index = 0; index < 5; index += 1) {
      db.run(
        `
          INSERT INTO quotaFetchStates(connectionId, sourceId, outcome, attemptedAt)
          VALUES (?, ?, 'success', '2026-01-01T00:00:00.000Z')
        `,
        ["connection", `source-${index}`],
      );
    }
    db.close();

    const dbFile = path.join(tempDir, "db", "data.sqlite");
    corruptQuotaFetchStatesPrimaryKey(dbFile);
    const before = migrationArtifacts();
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: restart } = await import("@/lib/db/driver.js");
    await expect(restart()).rejects.toThrow(
      "wrong # of entries in index sqlite_autoindex_quotaFetchStates_1",
    );
    expect(migrationArtifacts()).toEqual(before);
  });

  it("migrates and persists a healthy fresh sql.js database", async () => {
    const dbFile = path.join(tempDir, "sqljs", "data.sqlite");
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const db = await createSqlJsAdapter(dbFile);
    try {
      await runMigrationOnce(db);
      expect(db.get("SELECT value FROM _meta WHERE key = 'schemaVersion'")).toEqual({ value: String(latestVersion()) });
      db.run("INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)", ["sync3862", "sentinel", "persisted"]);
      db.flush();
    } finally {
      db.close();
    }

    const reopened = await createSqlJsAdapter(dbFile);
    try {
      expect(reopened.get("SELECT value FROM kv WHERE scope = ? AND key = ?", ["sync3862", "sentinel"])).toEqual({ value: "persisted" });
    } finally {
      reopened.close();
    }
  });

});
