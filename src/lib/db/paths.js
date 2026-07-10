import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "data.sqlite");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");

/** Resolve the active data directory at call time for isolated runtimes/tests. */
export function currentDataDir() {
  return process.env.DATA_DIR || DATA_DIR;
}

/** Resolve the active SQLite file without changing legacy snapshot exports. */
export function currentDataFile() {
  return path.join(currentDataDir(), "db", "data.sqlite");
}
export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};
export function ensureDirs() {
  const dataDir = currentDataDir();
  const dbDir = path.join(dataDir, "db");
  for (const dir of [dataDir, dbDir, path.join(dbDir, "backups")]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
