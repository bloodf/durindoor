/**
 * Regression coverage for upstream PR #3381: credential-store directories and
 * SQLite files must remain private, including repaired installs and backups.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const describePosix = process.platform === "win32" ? describe.skip : describe;
const originalDataDir = process.env.DATA_DIR;
let tempRoot;
let dataDir;

function resetAdapterState() {
  global._dbAdapter ||= { instance: null, initPromise: null, logged: false, file: null };
  Object.assign(global._dbAdapter, { instance: null, initPromise: null, logged: false, file: null });
}

function modeOf(target) {
  return fs.statSync(target).mode & 0o777;
}

beforeEach(async () => {
  try { await global._dbAdapter?.instance?.close?.(); } catch {}
  resetAdapterState();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-db-perms-"));
  dataDir = path.join(tempRoot, "data");
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/db/adapters/bunSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  vi.doUnmock("@/lib/db/migrate.js");
  try { await global._dbAdapter?.instance?.close?.(); } catch {}
  resetAdapterState();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describePosix("DB file permissions", () => {
  it("passes owner-only modes to both directory creators before hardening", async () => {
    const mkdir = vi.spyOn(fs, "mkdirSync");
    await import("@/lib/dataDir.js");
    const { ensureDirs } = await import("@/lib/db/paths.js");
    ensureDirs();

    expect(mkdir).toHaveBeenCalledWith(dataDir, { recursive: true, mode: 0o700 });
    expect(mkdir).toHaveBeenCalledWith(path.join(dataDir, "db"), { recursive: true, mode: 0o700 });
    expect(mkdir).toHaveBeenCalledWith(path.join(dataDir, "db", "backups"), { recursive: true, mode: 0o700 });
  });

  it("tightens existing directories before opening a database driver", async () => {
    const dbDir = path.join(dataDir, "db");
    const backupsDir = path.join(dbDir, "backups");
    const dirs = [dataDir, dbDir, backupsDir];
    fs.mkdirSync(backupsDir, { recursive: true });
    for (const dir of dirs) fs.chmodSync(dir, 0o755);
    let modesAtOpen;
    vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => ({
      createBetterSqliteAdapter: () => {
        modesAtOpen = dirs.map(modeOf);
        return { driver: "permission-order-test" };
      },
    }));
    vi.doMock("@/lib/db/migrate.js", () => ({ runMigrationOnce: vi.fn() }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).resolves.toHaveProperty("driver", "permission-order-test");
    expect(modesAtOpen).toEqual([0o700, 0o700, 0o700]);
  });

  it("creates credential-store directories and SQLite files owner-only", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();

    const dbDir = path.join(dataDir, "db");
    for (const dir of [dataDir, dbDir, path.join(dbDir, "backups")]) {
      expect(modeOf(dir)).toBe(0o700);
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = path.join(dbDir, `data.sqlite${suffix}`);
      expect(fs.existsSync(file)).toBe(true);
      expect(modeOf(file)).toBe(0o600);
    }
  });
  it("creates the sql.js fallback database owner-only", async () => {
    vi.doMock("@/lib/db/adapters/bunSqliteAdapter.js", () => {
      throw new Error("force sql.js fallback");
    });
    vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
      throw new Error("force sql.js fallback");
    });
    vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
      throw new Error("force sql.js fallback");
    });
    const previousUmask = process.umask(0o022);
    try {
      const { getAdapter } = await import("@/lib/db/driver.js");
      const adapter = await getAdapter();
      expect(adapter.driver).toBe("sql.js");
      await adapter.close();
      expect(modeOf(path.join(dataDir, "db", "data.sqlite"))).toBe(0o600);
      resetAdapterState();
    } finally {
      process.umask(previousUmask);
    }
  });

  it("repairs a world-readable existing credential store", async () => {
    const dbDir = path.join(dataDir, "db");
    const backupsDir = path.join(dbDir, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, "data.sqlite"), "");
    for (const dir of [dataDir, dbDir, backupsDir]) fs.chmodSync(dir, 0o755);
    fs.chmodSync(path.join(dbDir, "data.sqlite"), 0o644);

    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();

    for (const dir of [dataDir, dbDir, backupsDir]) expect(modeOf(dir)).toBe(0o700);
    expect(modeOf(path.join(dbDir, "data.sqlite"))).toBe(0o600);
  });

  it("chmods copy and ATTACH backup files owner-only", async () => {
    const { backupDbLite, backupFile, makeBackupDir } = await import("@/lib/db/backup.js");
    const source = path.join(dataDir, "source.sqlite");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(source, "credential data", { mode: 0o644 });

    const copyDir = makeBackupDir("copy-permissions");
    const copied = backupFile(source, copyDir);
    expect(modeOf(copyDir)).toBe(0o700);
    expect(modeOf(copied)).toBe(0o600);

    const attachDir = makeBackupDir("attach-permissions");
    const attachAdapter = {
      exec(sql) {
        const match = /^ATTACH DATABASE '(.+)' AS bak$/.exec(sql);
        if (match) fs.writeFileSync(match[1].replace(/''/g, "'"), "credential data", { mode: 0o644 });
      },
      all: () => [],
      transaction(fn) { fn(); },
    };
    const attached = backupDbLite(attachAdapter, attachDir);
    expect(modeOf(attachDir)).toBe(0o700);
    expect(modeOf(attached)).toBe(0o600);
  });

  it("keeps startup working and warns once when chmod is unsupported", async () => {
    fs.mkdirSync(path.join(dataDir, "db", "backups"), { recursive: true });
    const chmod = vi.spyOn(fs, "chmodSync").mockImplementation(() => {
      throw Object.assign(new Error("operation not supported"), { code: "ENOTSUP" });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getAdapter } = await import("@/lib/db/driver.js");
    await expect(getAdapter()).resolves.toHaveProperty("driver");
    expect(chmod).toHaveBeenCalled();
    expect(warn.mock.calls.filter(([message]) => message === "[DB] Unable to harden credential-store permissions; continuing")).toHaveLength(1);
  });

  it("skips chmod on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const chmod = vi.spyOn(fs, "chmodSync");
    try {
      Object.defineProperty(process, "platform", { ...platform, value: "win32" });
      const { chmodQuiet, hardenPermissions } = await import("@/lib/db/paths.js");
      chmodQuiet(dataDir, 0o700);
      hardenPermissions();
      expect(chmod).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});
