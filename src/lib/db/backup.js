import fs from "node:fs";
import path from "node:path";
import { currentDataFile, ensureDirs, resolveDataPaths } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 5;

export function makeBackupDir(label, dataFile = currentDataFile()) {
  ensureDirs(dataFile);
  const { backupsDir } = resolveDataPaths(dataFile);
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = path.join(backupsDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

export function pruneOldBackups(dataFile = currentDataFile()) {
  const { backupsDir } = resolveDataPaths(dataFile);
  if (!fs.existsSync(backupsDir)) return;
  const entries = fs.readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(backupsDir, e.name), mtime: fs.statSync(path.join(backupsDir, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
