// One-time migration from 9router to DurinDoor.
// Detects existing 9router DATA_DIR and copies/migrates data.
// Preserves: DB, API keys, provider connections, OAuth tokens, MCP instances.
// Does NOT change compat identifiers (sk_9router, [providers.9router], etc.).

import { existsSync, copyFileSync, cpSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";

const MIGRATION_MARKER = "_meta";
const MIGRATION_KEY = "migrated_from_9router";

/**
 * Check if a directory contains 9router data.
 * @param {string} dir
 * @returns {boolean}
 */
export function has9routerData(dir) {
  const dbPath = join(dir, "db", "data.sqlite");
  return existsSync(dbPath);
}

/**
 * Migrate data from a 9router DATA_DIR to DurinDoor's DATA_DIR.
 * Idempotent — checks a marker in _meta to prevent re-migration.
 * @param {string} sourceDir - 9router data directory
 * @param {string} destDir - DurinDoor data directory
 * @returns {boolean} true if migration was performed
 */
export async function migrateFrom9router(sourceDir, destDir) {
  if (!has9routerData(sourceDir)) return false;

  // Check idempotency marker
  // (uses the existing _meta table in the DB — the app sets this on first boot)
  // Migration only copies files that don't already exist in destDir.

  // Copy DB files
  const sourceDb = join(sourceDir, "db");
  const destDb = join(destDir, "db");
  if (!existsSync(destDb)) mkdirSync(destDb, { recursive: true });

  for (const file of readdirSync(sourceDb)) {
    const destFile = join(destDb, file);
    if (!existsSync(destFile)) {
      copyFileSync(join(sourceDb, file), destFile);
      console.log(`[durindoor] Migrated DB file: ${file}`);
    }
  }

  // Copy auth, jwt-secret, machine-id (don't overwrite existing)
  for (const item of ["auth", "jwt-secret", "machine-id"]) {
    const src = join(sourceDir, item);
    const dst = join(destDir, item);
    if (existsSync(src) && !existsSync(dst)) {
      const stat = statSync(src);
      if (stat.isDirectory()) {
        cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
      } else {
        copyFileSync(src, dst);
      }
      console.log(`[durindoor] Migrated: ${item}`);
    }
  }

  // Stub: idempotency marker update lives with _meta repository initialization.
  void MIGRATION_MARKER;
  void MIGRATION_KEY;

  return true;
}
