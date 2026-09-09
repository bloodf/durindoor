// SQLite snapshot helper used by the cutover pipeline.
//
// Copies `DATA_DIR/db/data.sqlite` to a timestamped sibling under
// `DATA_DIR/db/backups/` with the prefix `data.sqlite.postgres-cutover-`.
// The snapshot is best-effort: if the copy fails, the cutover pipeline
// logs a warning and continues (the source SQLite is still on disk at
// its original path; rollback can use the live file as a fallback).
//
// The snapshot is intentionally NOT a safety copy for migration
// upgrades — those are handled by `src/lib/db/backup.js` with the
// `backup-<label>-<version>-<ts>` shape. The cutover snapshot has its
// own prefix so operators can distinguish it from the migration safety
// net at a glance.

import fs from "node:fs";
import path from "node:path";
import { currentDataDir } from "../../paths.js";
import { getAppVersion } from "../../version.js";
import { chmodQuiet } from "../../paths.js";

export const SNAPSHOT_PREFIX = "data.sqlite.postgres-cutover-";

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export async function snapshotSqlite() {
  const dataDir = currentDataDir();
  const src = path.join(dataDir, "db", "data.sqlite");
  if (!fs.existsSync(src)) return null;
  const backupsDir = path.join(dataDir, "db", "backups");
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const dest = path.join(backupsDir, `${SNAPSHOT_PREFIX}${ts()}-${getAppVersion()}.sqlite`);
  fs.copyFileSync(src, dest);
  try { chmodQuiet(dest, 0o600); } catch { /* noop on win32 */ }
  return dest;
}

export function listSnapshots() {
  const dataDir = currentDataDir();
  const backupsDir = path.join(dataDir, "db", "backups");
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((n) => n.startsWith(SNAPSHOT_PREFIX))
    .map((n) => path.join(backupsDir, n))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}
