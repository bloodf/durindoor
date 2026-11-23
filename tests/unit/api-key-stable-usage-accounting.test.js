import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBetterSqliteAdapter } from "@/lib/db/adapters/betterSqliteAdapter.js";
import { MIGRATIONS } from "@/lib/db/migrations/index.js";
import { PG_MIGRATIONS } from "@/lib/db/migrations/postgres/index.js";
import { applyVersionedMigrations } from "@/lib/db/migrate.js";

const timestamp = "2026-01-01T00:00:00.000Z";
const attribution = MIGRATIONS.find(({ version }) => version === 30);
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-key-id-"));
  vi.stubEnv("DATA_DIR", dir);
});

afterEach(() => {
  global._dbAdapter?.instance?.close();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("backfills exact matches atomically and preserves all legacy fields", () => {
  const db = createBetterSqliteAdapter(path.join(dir, "legacy.sqlite"));
  try {
    db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    applyVersionedMigrations(db, MIGRATIONS.filter(({ version }) => version <= 28));
    // Migration 001 reads the current schema. Remove the new column to model a
    // database created before 030 shipped.
    db.exec(`DROP INDEX idx_uh_key_session; DROP INDEX idx_uh_key_project`);
    db.exec(`ALTER TABLE usageHistory DROP COLUMN apiKeyId`);
    db.run(`INSERT INTO apiKeys(id, key, createdAt) VALUES ('stable-id', 'fixture-match', ?), ('deleted-id', 'fixture-deleted', ?)`,
      [timestamp, timestamp]);
    for (const key of ["fixture-match", "fixture-deleted", "fixture-unknown", null]) {
      db.run(`INSERT INTO usageHistory(timestamp, apiKey, cost, tokens, meta)
        VALUES (?, ?, NULL, ' { "x": 1 } ', ' { "flag": true } ')`, [timestamp, key]);
    }
    db.run(`DELETE FROM apiKeys WHERE id = 'deleted-id'`);
    const before = db.all(`SELECT * FROM usageHistory ORDER BY id`);
    const keys = db.all(`SELECT * FROM apiKeys`);
    const markers = () => db.all(`SELECT * FROM _meta ORDER BY key`);
    const markersBefore = markers();
    db.exec(`CREATE TRIGGER fail_stamp BEFORE UPDATE ON _meta
      WHEN NEW.key = 'schemaVersion' AND NEW.value = '30'
      BEGIN SELECT RAISE(ABORT, 'fixture stamp failure'); END`);

    expect(() => applyVersionedMigrations(db, MIGRATIONS)).toThrow("fixture stamp failure");
    expect(db.all(`PRAGMA table_info(usageHistory)`).map(({ name }) => name)).not.toContain("apiKeyId");
    expect(db.all(`SELECT * FROM usageHistory ORDER BY id`)).toEqual(before);
    expect(markers()).toEqual(markersBefore);

    db.exec(`DROP TRIGGER fail_stamp`);
    expect(applyVersionedMigrations(db, MIGRATIONS)).toEqual({ applied: 4, from: 28, to: 33 });
    const after = before.map((row, index) => ({ ...row, apiKeyId: index === 0 ? "stable-id" : null }));
    expect(db.all(`SELECT * FROM usageHistory ORDER BY id`)).toEqual(after);
    expect(db.all(`SELECT * FROM apiKeys`)).toEqual(keys);

    db.run(`INSERT INTO usageHistory(timestamp, apiKey) VALUES (?, 'fixture-match')`, [timestamp]);
    expect(applyVersionedMigrations(db, MIGRATIONS).applied).toBe(0);
    expect(db.all(`SELECT * FROM usageHistory ORDER BY id LIMIT 4`)).toEqual(after);
    expect(db.get(`SELECT apiKeyId FROM usageHistory ORDER BY id DESC LIMIT 1`).apiKeyId).toBeNull();
  } finally {
    db.close();
  }
});

it("generates nullable PostgreSQL DDL and registers the shared migration", () => {
  const exec = vi.fn();
  PG_MIGRATIONS[0].up({ exec });
  const ddl = exec.mock.calls.map(([sql]) => sql)
    .find((sql) => sql.startsWith('CREATE TABLE IF NOT EXISTS "usageHistory"'));
  expect(ddl).toMatch(/"apiKeyId" TEXT,/);
  expect(PG_MIGRATIONS.find(({ version }) => version === 30)).toBe(attribution);
});

it("excludes usage history from portable export and detaches both associations on restore", async () => {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const { exportDb, importDb } = await import("@/lib/db/index.js");
  const db = await getAdapter();
  db.run(`INSERT INTO usageHistory(timestamp, apiKey, apiKeyId) VALUES
    (?, 'fixture-match', 'stable-id'), (?, NULL, 'id-only')`, [timestamp, timestamp]);
  const backup = await exportDb({ includeSecrets: true });
  expect(backup).not.toHaveProperty("usageHistory");
  await importDb(backup);
  expect(db.all(`SELECT timestamp, apiKey, apiKeyId FROM usageHistory ORDER BY id`)).toEqual([
    { timestamp, apiKey: null, apiKeyId: null },
    { timestamp, apiKey: null, apiKeyId: null },
  ]);
});
