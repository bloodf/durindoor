// Tests for the api-key-expiry migration.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import m005 from "@/lib/db/migrations/005-api-key-expiry.js";

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
    expect(MIGRATIONS).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 5, name: "api-key-expiry" })])
    );
  });

  it("up() adds expiresAt to apiKeys when missing", () => {
    const db = new Database(path.join(tempDir, "data.sqlite3"));
    db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL)`);

    m005.up(db);

    const columns = db.prepare(`PRAGMA table_info(apiKeys)`).all().map((row) => row.name);
    expect(columns).toContain("expiresAt");
  });

  it("up() is idempotent", () => {
    const db = new Database(path.join(tempDir, "data.sqlite3"));
    db.exec(`CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT NOT NULL)`);

    m005.up(db);
    m005.up(db);

    const expiresAtCols = db
      .prepare(`PRAGMA table_info(apiKeys)`)
      .all()
      .filter((row) => row.name === "expiresAt");
    expect(expiresAtCols).toHaveLength(1);
  });
});
