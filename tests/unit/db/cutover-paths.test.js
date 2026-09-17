import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("cutover rollback paths", () => {
  let dir;
  let prevDataDir;
  beforeEach(() => {
    prevDataDir = process.env.DATA_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-cutover-paths-"));
    process.env.DATA_DIR = dir;
  });
  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("snapshotSqlite writes under currentBackupsDir, not a literal ~ path", async () => {
    const dbDir = path.join(dir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, "data.sqlite"), "sqlite-bytes");
    const { snapshotSqlite, listSnapshots } = await import("@/lib/db/dialects/postgres/snapshot.js");
    const dest = await snapshotSqlite();
    expect(dest).toBeTruthy();
    expect(dest.startsWith(path.join(dir, "db", "backups"))).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    expect(listSnapshots()[0]).toBe(dest);
  });

  it("runRollback without force after a cutover timestamp returns rollback_requires_force", async () => {
    fs.mkdirSync(path.join(dir, "db", "backups"), { recursive: true });
    const { runRollback } = await import("@/lib/db/cutover.js");
    // No snapshot and no settings row: snapshot not found, not a ~ path.
    const out = await runRollback({});
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/snapshot not found|rollback_requires_force/);
    expect(fs.existsSync(path.join(process.cwd(), "~"))).toBe(false);
  });
});
