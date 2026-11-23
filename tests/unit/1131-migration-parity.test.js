import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBetterSqliteAdapter } from "../../src/lib/db/adapters/betterSqliteAdapter.js";
import { applyVersionedMigrations } from "../../src/lib/db/migrate.js";
import sqliteMigration from "../../src/lib/db/migrations/031-usage-session-attribution.js";
import pgMigration from "../../src/lib/db/migrations/postgres/031-usage-session-attribution.js";
import { MIGRATIONS, latestVersion } from "../../src/lib/db/migrations/index.js";
import { PG_MIGRATIONS, pgLatestVersion } from "../../src/lib/db/migrations/postgres/index.js";

function fixture(file = ":memory:") {
  const db = createBetterSqliteAdapter(file);
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO _meta VALUES ('schemaVersion', '30'), ('appliedMigrations', '[30]');
    CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL);
    INSERT INTO apiKeys VALUES ('a', 'secret-a'), ('b', 'secret-b');
    CREATE TABLE usageHistory (id INTEGER PRIMARY KEY, apiKeyId TEXT, apiKey TEXT);
    INSERT INTO usageHistory VALUES (1, 'a', 'secret-a'), (2, 'b', 'secret-b');`);
  return db;
}

function pgFacade(db) {
  return {
    ...db, driver: "pg", capabilities: { isPostgres: true },
    all(sql, params) {
      if (sql.includes("information_schema.columns")) {
        expect(params).toEqual(["usageHistory"]);
        return db.all('PRAGMA table_info("usageHistory")');
      }
      return db.all(sql, params);
    },
    get(sql, params) { return db.get(sql.replace(/\$\d+/g, "?"), params); },
    run(sql, params) { return db.run(sql.replace(/\$\d+/g, "?"), params); },
  };
}

const markers = (db) => db.all("SELECT key, value FROM _meta ORDER BY key");

describe("migration 031 parity", () => {
  it("registers migration 031 in both engines", () => {
    expect(latestVersion()).toBe(33);
    expect(pgLatestVersion()).toBe(latestVersion());
    expect(MIGRATIONS.find((migration) => migration.version === 31)).toBe(sqliteMigration);
    expect(PG_MIGRATIONS.find((migration) => migration.version === 31)).toBe(pgMigration);
    expect(pgMigration).toBe(sqliteMigration);
  });

  it.each(["sqlite", "postgres reflection"])("upgrades, retries and preserves scoped data with %s", (engine) => {
    const db = fixture();
    const adapter = engine === "sqlite" ? db : pgFacade(db);
    try {
      const before = markers(db);
      const failing = { ...sqliteMigration, up(target) {
        sqliteMigration.up(target);
        throw new Error("injected 031 failure");
      } };
      expect(() => applyVersionedMigrations(adapter, [failing])).toThrow("injected 031 failure");
      expect(markers(db)).toEqual(before);
      expect(db.all('PRAGMA index_list("usageHistory")')).toEqual([]);
      expect(db.all('PRAGMA table_info("usageHistory")').map((c) => c.name))
        .toEqual(["id", "apiKeyId", "apiKey"]);
      expect(applyVersionedMigrations(adapter, [pgMigration])).toEqual({ applied: 1, from: 30, to: 31 });
      expect(markers(db)).toEqual([{ key: "appliedMigrations", value: "[30,31]" }, { key: "schemaVersion", value: "31" }]);
      expect(db.all('SELECT * FROM "usageHistory" ORDER BY id')).toEqual([
        { id: 1, apiKeyId: "a", apiKey: "secret-a", usageSessionId: null, usageProjectId: null },
        { id: 2, apiKeyId: "b", apiKey: "secret-b", usageSessionId: null, usageProjectId: null },
      ]);
      expect(db.all('SELECT * FROM "apiKeys" ORDER BY id')).toEqual([{ id: "a", key: "secret-a" }, { id: "b", key: "secret-b" }]);
      db.run('UPDATE "usageHistory" SET "usageSessionId" = ?, "usageProjectId" = ? WHERE id = 1', ["session", "project"]);
      sqliteMigration.up(adapter);
      expect(applyVersionedMigrations(adapter, [pgMigration])).toEqual({ applied: 0, from: 31, to: 31 });
      expect(db.get('SELECT "usageSessionId", "usageProjectId" FROM "usageHistory" WHERE id = 1')).toEqual({ usageSessionId: "session", usageProjectId: "project" });
      for (const [index, column] of [["idx_uh_key_session", "usageSessionId"], ["idx_uh_key_project", "usageProjectId"]]) {
        expect(db.all(`PRAGMA index_info(${index})`).map((row) => row.name)).toEqual(["apiKeyId", column]);
      }
    } finally { db.close(); }
  });
  it("reopens a successfully upgraded database without reapplying 031", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-031-"));
    const file = path.join(dir, "data.sqlite");
    let db = fixture(file);
    try {
      expect(applyVersionedMigrations(db, [sqliteMigration])).toEqual({ applied: 1, from: 30, to: 31 });
      db.run('UPDATE "usageHistory" SET "usageSessionId" = ? WHERE id = 1', ["retained"]);
      db.close();
      db = createBetterSqliteAdapter(file);
      expect(applyVersionedMigrations(db, [{ ...sqliteMigration, up() { throw new Error("unexpected replay"); } }]))
        .toEqual({ applied: 0, from: 31, to: 31 });
      expect(markers(db)).toEqual([{ key: "appliedMigrations", value: "[30,31]" }, { key: "schemaVersion", value: "31" }]);
      expect(db.get('SELECT "usageSessionId" FROM "usageHistory" WHERE id = 1').usageSessionId).toBe("retained");
      expect(db.get('SELECT key FROM "apiKeys" WHERE id = ?', ["a"]).key).toBe("secret-a");
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

});
