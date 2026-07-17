// Safety follow-up for #180 backup code: fallback/abort path, prune confinement,
// dir-name collision.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  backupDbLite,
  backupFile,
  makeBackupDir,
  pruneOldBackups,
} from "@/lib/db/backup.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-safety-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function writeFile(p, bytes) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}

describe("backupDbLite ATTACH-failure → caller fallback", () => {
  it("returns null when adapter cannot ATTACH; caller falls back to backupFile and copies bytes", () => {
    const src = writeFile(path.join(tempDir, "db", "data.sqlite"), Buffer.from("live-db-bytes"));
    const destDir = path.join(tempDir, "db", "backups", "snap");
    fs.mkdirSync(destDir, { recursive: true });

    // Adapter whose exec rejects ATTACH (e.g. in-memory sql.js has no host fs).
    const adapter = {
      exec(sql) {
        if (/^\s*ATTACH\s+DATABASE/i.test(sql)) throw new Error("ATTACH not supported");
        throw new Error(`unexpected exec: ${sql}`);
      },
      all() { throw new Error("all() should not be reached after ATTACH fails"); },
      transaction() { throw new Error("transaction() should not be reached after ATTACH fails"); },
    };

    const lite = backupDbLite(adapter, destDir);
    expect(lite).toBeNull();

    // Caller fallback path (mirrors migrate.js): null → copy full file.
    const copied = lite ?? backupFile(src, destDir);
    expect(copied).toBe(path.join(destDir, "data.sqlite"));
    expect(fs.readFileSync(copied)).toEqual(Buffer.from("live-db-bytes"));
  });
});

describe("backupDbLite partial-failure cleanup", () => {
  it("cleans up the partial file and returns null when INSERT throws mid-transaction", () => {
    const destDir = path.join(tempDir, "db", "backups", "snap");
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, "data.sqlite");

    // Decode the destination out of `ATTACH DATABASE '<escaped>' AS bak`.
    const attachRe = /ATTACH DATABASE '([^']*)' AS bak/i;
    let insertCount = 0;
    const adapter = {
      exec(sql) {
        const m = attachRe.exec(sql);
        if (m) {
          // Simulate sqlite creating the (now-partial) destination file.
          fs.writeFileSync(m[1].replace(/''/g, "'"), "partial");
          return;
        }
        if (/CREATE TABLE bak\./i.test(sql)) return; // schema recreated in backup
        if (/INSERT INTO bak\./i.test(sql)) {
          insertCount += 1;
          // First INSERT succeeds, second throws mid-transaction.
          if (insertCount >= 2) throw new Error("disk full mid-copy");
          return;
        }
        if (/DETACH DATABASE bak/i.test(sql)) return;
        throw new Error(`unexpected exec: ${sql}`);
      },
      all() {
        return [
          { name: "users", sql: "CREATE TABLE users (id INTEGER)" },
          { name: "settings", sql: "CREATE TABLE settings (k TEXT)" },
        ];
      },
      transaction(fn) {
        // Must actually invoke the body so the INSERT runs and throws.
        fn();
      },
    };

    const result = backupDbLite(adapter, destDir);
    expect(result).toBeNull();
    // Mid-transaction: at least one INSERT ran before the throw.
    expect(insertCount).toBe(2);
    // Partial file must be removed — no orphan backup left behind.
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe("pruneOldBackups confinement", () => {
  it("keeps only the newest KEEP_BACKUPS=3 dirs and never touches files outside the backups dir", () => {
    const backupsDir = path.join(tempDir, "db", "backups");
    fs.mkdirSync(backupsDir, { recursive: true });

    // Five backup dirs with explicit, strictly-increasing mtimes.
    const names = ["b-oldest", "b-older", "b-mid", "b-newer", "b-newest"];
    const base = 1_700_000_000_000;
    for (let i = 0; i < names.length; i++) {
      const dir = path.join(backupsDir, names[i]);
      fs.mkdirSync(dir);
      writeFile(path.join(dir, "data.sqlite"), `payload-${i}`);
      const t = new Date(base + i * 1000);
      fs.utimesSync(dir, t, t);
    }

    // Decoys OUTSIDE the backups dir — prune must never touch these.
    const siblingFile = writeFile(path.join(tempDir, "db", "loose.sqlite"), "keep-me");
    const siblingDir = path.join(tempDir, "db", "not-backups");
    fs.mkdirSync(siblingDir);
    writeFile(path.join(siblingDir, "data.sqlite"), "keep-me-too");

    pruneOldBackups();

    const remaining = fs.readdirSync(backupsDir).sort();
    expect(remaining).toEqual(["b-mid", "b-newer", "b-newest"]);
    expect(fs.existsSync(path.join(backupsDir, "b-oldest"))).toBe(false);
    expect(fs.existsSync(path.join(backupsDir, "b-older"))).toBe(false);

    // Confinement: nothing outside the backups dir was removed.
    expect(fs.readFileSync(siblingFile, "utf-8")).toBe("keep-me");
    expect(fs.readFileSync(path.join(siblingDir, "data.sqlite"), "utf-8")).toBe("keep-me-too");
  });
});

describe("makeBackupDir uniqueness", () => {
  it("two immediate calls produce different directory names (no same-second collision)", () => {
    const a = makeBackupDir("migrate");
    const b = makeBackupDir("migrate");
    expect(a).not.toBe(b);
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
  });
});

describe("backupFile missing source", () => {
  it("returns null for a nonexistent source without throwing", () => {
    const destDir = path.join(tempDir, "out");
    fs.mkdirSync(destDir, { recursive: true });
    expect(() => backupFile(path.join(tempDir, "nope.sqlite"), destDir)).not.toThrow();
    expect(backupFile(path.join(tempDir, "nope.sqlite"), destDir)).toBeNull();
  });
});
