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
  // Use live process.env.DATA_DIR so test mutations are honored between cases.
  const dir = currentDataDir();
  for (const d of [dir, path.join(dir, "db"), path.join(dir, "db", "backups")]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}
