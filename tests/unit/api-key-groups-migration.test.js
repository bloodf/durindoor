/**
 * Migration 018 against a real SQLite database.
 *
 * Two properties matter beyond "the tables exist":
 *  - re-running the migration is safe (upgrade paths may replay it, and fresh
 *    installs already created the tables from the declarative schema);
 *  - deleting a group removes its membership rows and NOTHING else. A grouping
 *    feature that could take a credential with it would be far worse than no
 *    grouping at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import migration from "@/lib/db/migrations/018-api-key-groups.js";
import { MIGRATIONS } from "@/lib/db/migrations/index.js";
import { SCHEMA_VERSION } from "@/lib/db/schema.js";

function adapter(db) {
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, params = []) => db.prepare(sql).all(...params),
  };
}

describe("migration 018 api-key-groups", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(`CREATE TABLE apiKeys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      name TEXT,
      createdAt TEXT NOT NULL
    )`);
  });

  afterEach(() => db.close());

  it("is registered in the migration chain at the declared schema version", () => {
    expect(migration.version).toBe(18);
    expect(MIGRATIONS.some((entry) => entry.version === 18)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
    // Versions must stay unique, or the runner silently skips one.
    const versions = MIGRATIONS.map((entry) => entry.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("creates both tables", () => {
    migration.up(adapter(db));
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((row) => row.name);
    expect(tables).toContain("apiKeyGroups");
    expect(tables).toContain("apiKeyGroupMembers");
  });

  it("is idempotent", () => {
    migration.up(adapter(db));
    expect(() => migration.up(adapter(db))).not.toThrow();
  });

  it("lets one key belong to several groups", () => {
    migration.up(adapter(db));
    db.prepare(`INSERT INTO apiKeys VALUES ('k1','sk-1','ci-deploy','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroups VALUES ('g1','CI',NULL,'now','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroups VALUES ('g2','Staging',NULL,'now','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroupMembers VALUES ('g1','k1','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroupMembers VALUES ('g2','k1','now')`).run();

    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM apiKeyGroupMembers WHERE apiKeyId='k1'`).get().n,
    ).toBe(2);
  });

  it("rejects duplicate group names", () => {
    migration.up(adapter(db));
    db.prepare(`INSERT INTO apiKeyGroups VALUES ('g1','CI',NULL,'now','now')`).run();
    expect(() =>
      db.prepare(`INSERT INTO apiKeyGroups VALUES ('g2','CI',NULL,'now','now')`).run(),
    ).toThrow();
  });

  it("deletes membership but never the key when a group is removed", () => {
    migration.up(adapter(db));
    db.prepare(`INSERT INTO apiKeys VALUES ('k1','sk-1','ci-deploy','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroups VALUES ('g1','CI',NULL,'now','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroupMembers VALUES ('g1','k1','now')`).run();

    db.prepare(`DELETE FROM apiKeyGroups WHERE id='g1'`).run();

    expect(db.prepare(`SELECT COUNT(*) AS n FROM apiKeyGroupMembers`).get().n).toBe(0);
    // The credential survives losing its label.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM apiKeys WHERE id='k1'`).get().n).toBe(1);
  });

  it("drops membership when the key itself is deleted", () => {
    migration.up(adapter(db));
    db.prepare(`INSERT INTO apiKeys VALUES ('k1','sk-1','ci-deploy','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroups VALUES ('g1','CI',NULL,'now','now')`).run();
    db.prepare(`INSERT INTO apiKeyGroupMembers VALUES ('g1','k1','now')`).run();

    db.prepare(`DELETE FROM apiKeys WHERE id='k1'`).run();

    expect(db.prepare(`SELECT COUNT(*) AS n FROM apiKeyGroupMembers`).get().n).toBe(0);
    // The group is a label, not a child of the key.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM apiKeyGroups WHERE id='g1'`).get().n).toBe(1);
  });
});
