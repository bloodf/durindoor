import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

/** Resolve the active data directory at call time for isolated runtimes/tests. */
export function currentDataDir() {
  return path.resolve(process.env.DATA_DIR || DATA_DIR);
}

/** Resolve the active SQLite file at call time. */
export function currentDataFile() {
  return path.join(currentDataDir(), "db", "data.sqlite");
}

/** Derive every DB-adjacent path from one resolved SQLite file. */
export function resolveDataPaths(dataFile = currentDataFile()) {
  const resolvedDataFile = path.resolve(dataFile);
  const dbDir = path.dirname(resolvedDataFile);
  const dataDir = path.dirname(dbDir);
  return {
    dataDir,
    dbDir,
    dataFile: resolvedDataFile,
    backupsDir: path.join(dbDir, "backups"),
    migratedMarker: path.join(dbDir, ".migrated-from-json"),
    legacyFiles: {
      main: path.join(dataDir, "db.json"),
      usage: path.join(dataDir, "usage.json"),
      disabled: path.join(dataDir, "disabledModels.json"),
      details: path.join(dataDir, "request-details.json"),
    },
  };
}

export function ensureDirs(dataFile = currentDataFile()) {
  const { dataDir, dbDir, backupsDir } = resolveDataPaths(dataFile);
  for (const dir of [dataDir, dbDir, backupsDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
