import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "data.sqlite");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");
// Live DATA_FILE based on current process.env.DATA_DIR — used by tests that
// mutate DATA_DIR between cases. Module-level DATA_FILE above is preserved
// for callers that prefer the snapshot.
export function currentDataDir() {
  return process.env.DATA_DIR || DATA_DIR;
}
export function currentDbDir() {
  return path.join(currentDataDir(), "db");
}
export function currentDataFile() {
  return path.join(currentDbDir(), "data.sqlite");
}
export function currentBackupsDir() {
  return path.join(currentDbDir(), "backups");
}

/** Owner-only modes for credential-store artifacts (upstream PR #3381). */
export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;
let permissionWarningEmitted = false;

/**
 * Applies a POSIX mode without making unsupported bind mounts or filesystems
 * fatal during startup (upstream PR #3381). Windows ACLs are intentionally
 * left untouched because chmod does not express this policy there.
 */
export function chmodQuiet(target, mode) {
  if (process.platform === "win32") return;
  try {
    fs.chmodSync(target, mode);
  } catch {
    if (!permissionWarningEmitted) {
      /** Upstream PR #3381: surface best-effort hardening failure once without exposing paths. */
      console.warn("[DB] Unable to harden credential-store permissions; continuing");
      permissionWarningEmitted = true;
    }
  }
}

/**
 * Repairs credential-store modes after SQLite creates its files (upstream
 * PR #3381). Live path helpers preserve DATA_DIR changes across driver resets.
 */
export function hardenPermissions() {
  if (process.platform === "win32") return;
  for (const dir of [currentDataDir(), currentDbDir(), currentBackupsDir()]) {
    if (fs.existsSync(dir)) chmodQuiet(dir, SECRET_DIR_MODE);
  }
  const dataFile = currentDataFile();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${dataFile}${suffix}`;
    if (fs.existsSync(file)) chmodQuiet(file, SECRET_FILE_MODE);
  }
}
export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};
export function currentLegacyFiles() {
  const dir = currentDataDir();
  return {
    main: path.join(dir, "db.json"),
    usage: path.join(dir, "usage.json"),
    disabled: path.join(dir, "disabledModels.json"),
    details: path.join(dir, "request-details.json"),
  };
}
/** Creates or tightens live credential-store directories before DB open (upstream PR #3381). */
export function ensureDirs() {
  // Use live process.env.DATA_DIR so test mutations are honored between cases.
  const dir = currentDataDir();
  for (const d of [dir, currentDbDir(), currentBackupsDir()]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: SECRET_DIR_MODE });
    else chmodQuiet(d, SECRET_DIR_MODE);
  }
}
