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
});

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

  it("refuses startup when quotaFetchStates primary-key index is corrupt", async () => {
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
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: restart } = await import("@/lib/db/driver.js");
    await expect(restart()).rejects.toThrow(
      "wrong # of entries in index sqlite_autoindex_quotaFetchStates_1",
    );
  });
});
