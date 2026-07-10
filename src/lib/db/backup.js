// DB safety backups — taken before schema changes and app-version upgrades
// (see migrate.js).
//
// ⚠️ AGENT/DEV NOTES:
// - Backups are a safety net taken before schema changes and app-version
//   upgrades. There is NO automated restore path; recovery is manual (copy a
//   backup file back). The migration path treats a failed safety copy as fatal
//   so a schema change never runs against an un-backed-up DB.
// - The lite path (backupDbLite) intentionally EXCLUDES the `requestDetails`
//   table (observability log, auto-pruned, non-critical) so a multi-hundred-MB
//   DB backs up as a few MB. The full-file fallback (backupFile) copies the
//   whole data.sqlite and is used when the adapter cannot ATTACH.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { currentBackupsDir, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  // ponytail: timestampSlug() has 1s resolution; same-second calls collide.
  // Upgrade path: millisecond/microsecond slug. Atomic-mkdir retry keeps callers safe now.
  const base = currentBackupsDir();
  for (let n = 0; ; n += 1) {
    const dir = n === 0 ? path.join(base, slug) : path.join(base, `${slug}-${n}`);
    try {
      fs.mkdirSync(dir); // non-recursive: fails with EEXIST if taken, atomic under concurrency
      return dir;
    } catch (e) {
      if (e?.code === "EEXIST") continue;
      throw e;
    }
  }
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

/**
 * Lightweight DB backup via ATTACH: create an empty sqlite file, copy every
 * table EXCEPT the excluded ones into it. Avoids duplicating the huge
 * observability log, so the backup stays small regardless of DB size.
 *
 * @param {object} adapter Live DB adapter (exec/all/transaction).
 * @param {string} destDir Directory to write the backup into.
 * @param {string} [destName="data.sqlite"] Backup filename.
 * @returns {string|null} Backup path on success, or null when the adapter
 *   cannot ATTACH (e.g. the in-memory sql.js driver has no host filesystem).
 *   Callers MUST fall back to backupFile(currentDataFile(), ...) on null.
 */
export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  const dest = path.join(destDir, destName);
  try { fs.rmSync(dest, { force: true }); } catch {}
  const escaped = dest.replace(/'/g, "''");

  try {
    adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  } catch {
    // Adapter does not support ATTACH (in-memory sql.js). Signal fallback.
    return null;
  }
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    const tables = adapter
      .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .filter((t) => !excluded.has(t.name));

    adapter.transaction(() => {
      for (const t of tables) {
        // Recreate table structure in backup DB, then copy rows.
        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        adapter.exec(`INSERT INTO bak.${t.name} SELECT * FROM main.${t.name}`);
      }
    });
  } catch {
    try { adapter.exec("DETACH DATABASE bak"); } catch {}
    try { fs.rmSync(dest, { force: true }); } catch {}
    return null;
  }
  try { adapter.exec("DETACH DATABASE bak"); } catch {}
  return dest;
}

export function pruneOldBackups() {
  const backupsDir = currentBackupsDir();
  if (!fs.existsSync(backupsDir)) return;
  const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(backupsDir, e.name), mtime: fs.statSync(path.join(backupsDir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
