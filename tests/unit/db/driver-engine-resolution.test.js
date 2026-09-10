// Regression test for the getAdapter() engine-resolution recursion.
//
// The first cut of the PostgreSQL engine resolved the active engine by
// calling `settingsRepo.getSettings()` at the top of every
// `driver.getAdapter()` invocation. `getSettings()` itself awaits
// `getAdapter()`, so the two functions awaited each other forever —
// an unbounded chain of pending promises that hung every db-touching
// test until the worker exhausted its heap (the CI "Vitest" and
// "Lint & Build" OOM failures on PR #831).
//
// The fix resolves the engine once per (re)initialization through a
// transient SQLite read that never touches the repos. These tests pin
// that contract: getAdapter() resolves promptly, getSettings() works
// on the same adapter afterwards, and a settings row flipped to
// `postgres` with no configured URL falls back to SQLite instead of
// hanging.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let dir;
let savedDataDir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-driver-engine-"));
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("driver — engine resolution does not recurse through settingsRepo", () => {
  it("getAdapter resolves and getSettings works on the returned adapter", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.driver).not.toBe("pg");

    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    expect(settings.databaseEngine).toBe("sqlite");
  });

  it("a postgres engine flag without a URL falls back to SQLite instead of hanging", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    // Boot once on SQLite so the settings table exists, then flip the
    // engine flag directly on the adapter.
    const sqlite = await getAdapter();
    await sqlite.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ databaseEngine: "postgres" })]
    );
    await sqlite.close?.();

    // Cold-boot against the same DB content at a new DATA_DIR: the
    // driver sees the path change, re-initializes, reads the flipped
    // engine flag, finds no PG URL configured, and must fall back to
    // SQLite (recording databaseEngineError) rather than hanging.
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-driver-engine-2-"));
    process.env.DATA_DIR = dir2;
    try {
      fs.mkdirSync(path.join(dir2, "db"), { recursive: true });
      for (const suffix of ["", "-wal", "-shm"]) {
        const src = path.join(dir, "db", `data.sqlite${suffix}`);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir2, "db", `data.sqlite${suffix}`));
      }
      const fresh = await getAdapter();
      expect(fresh.capabilities?.isPostgres).not.toBe(true);

      const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
      const settings = await getSettings();
      expect(settings.databaseEngineError).toMatch(/no connection URL/);
      await fresh.close?.();
    } finally {
      try { fs.rmSync(dir2, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("writePostgresUrlToSettings persists through the sync transaction path", async () => {
    // Regression: an async transaction callback on the sync
    // better-sqlite3 adapter silently dropped the write (the adapter
    // closed before the callback's first await resumed).
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter(); // ensure schema exists
    const { __resetColumnCryptoForTests } = await import("@/lib/crypto/columnCrypto.js");
    __resetColumnCryptoForTests();
    delete process.env.DURINDOOR_PG_URL;
    const { writePostgresUrlToSettings, resolvePostgresSecret } = await import("@/lib/db/secrets.js");
    await writePostgresUrlToSettings("postgres://u:p@h:5432/db");
    expect(await resolvePostgresSecret()).toBe("postgres://u:p@h:5432/db");
  });
});
