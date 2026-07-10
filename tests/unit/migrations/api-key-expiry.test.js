// Tests for the api-key-expiry migration.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import m004 from "@/lib/db/migrations/004-api-key-expiry.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mig-apikey-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("api-key-expiry migration", () => {
  it("is registered in the migration registry", async () => {
    const { MIGRATIONS } = await import("@/lib/db/migrations/index.js");
    expect(MIGRATIONS.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "initial" },
      { version: 2, name: "mcp gateway" },
      { version: 3, name: "mcp grant tool allowlist" },
      { version: 4, name: "api-key-expiry" },
      { version: 5, name: "add daily token limit to apiKeys" },
      { version: 6, name: "api-key-policy" },
      { version: 7, name: "api-key-usage-totals-repair" },
    ]);
    expect(new Set(MIGRATIONS.map((migration) => migration.version)).size).toBe(MIGRATIONS.length);
  });

  it("v7 repairs already-stamped-v6 totals idempotently", async () => {
    const { MIGRATIONS } = await import("@/lib/db/migrations/index.js");
    const repair = MIGRATIONS.find((migration) => migration.version === 7);
    expect(repair).toBeDefined();

    const db = new Database(path.join(tempDir, "stamped-v6.sqlite3"));
    db.exec(`
      CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL);
      CREATE TABLE usageHistory (
        id INTEGER PRIMARY KEY,
        apiKey TEXT,
        promptTokens INTEGER DEFAULT 0,
        completionTokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0
      );
      CREATE TABLE apiKeyUsageTotals (
        apiKeyId TEXT PRIMARY KEY,
        totalTokens INTEGER DEFAULT 0,
        totalCost REAL DEFAULT 0,
        totalRequests INTEGER DEFAULT 0,
        updatedAt TEXT
      );
      INSERT INTO apiKeys(id, key) VALUES('registered-id', 'sk-12345678');
      INSERT INTO usageHistory(apiKey, promptTokens, completionTokens, cost)
        VALUES('sk-12345678', 10, 5, 0.1), ('sk-12345678', 12, 3, 0.2);
      INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests)
        VALUES('registered-id', 1, 0.01, 1);
    `);
    const adapter = {
      all: (sql, params = []) => db.prepare(sql).all(params),
      run: (sql, params = []) => db.prepare(sql).run(params),
      exec: (sql) => db.exec(sql),
    };

    repair.up(adapter);
    repair.up(adapter);

    const totals = db.prepare(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = ?`).get("registered-id");
    expect(totals).toMatchObject({
      totalTokens: 30,
      totalRequests: 2,
    });
    expect(totals.totalCost).toBeCloseTo(0.3, 12);
    db.close();
  });

  it("up() adds expiresAt to apiKeys when missing", () => {
    const db = new Database(path.join(tempDir, "data.sqlite3"));
    db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL)`);

    m004.up(db);

    const columns = db.prepare(`PRAGMA table_info(apiKeys)`).all().map((row) => row.name);
    expect(columns).toContain("expiresAt");
  });

  it("up() is idempotent", () => {
    const db = new Database(path.join(tempDir, "data.sqlite3"));
    db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL)`);

    m004.up(db);
    m004.up(db);

    const expiresAtCols = db
      .prepare(`PRAGMA table_info(apiKeys)`)
      .all()
      .filter((row) => row.name === "expiresAt");
    expect(expiresAtCols).toHaveLength(1);
  });
});
