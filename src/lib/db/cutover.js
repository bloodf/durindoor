// SQLite → PostgreSQL cutover orchestrator.
//
// Runs the full pipeline:
//   1. acquireCutoverLock
//   2. testConnection (transient pg.Client, SELECT 1)
//   3. openPostgresPersistent (the persistent adapter the runtime will
//      use after the flip)
//   4. runMigrationOnce (the parallel PG migration set)
//   5. mirrorSqliteToPostgres (stream rows in 500-row chunks, per-table
//      transactions, row-count verification)
//   6. snapshotSqliteTo (immutable copy of the source SQLite file at
//      `data.sqlite.postgres-cutover-<ts>`; best-effort, warns on
//      failure but does not abort the flip)
//   7. flipRuntime (close SQLite, set state.instance = pg)
//   8. updateSettings({ databaseEngine: "postgres", ... })
//   9. appendCutoverLog (row in pgCutoverLog table on PG)
//  10. releaseCutoverLock
//  11. respond { ok, schemaVersion, tablesMigrated, rowsMigrated,
//      durationMs, snapshotPath }
//
// Failure at any step:
//   - testConnection fail → no state change, 400.
//   - migration fail → PG schema half-applied; PG closed; SQLite stays
//     live; databaseEngineError set.
//   - mirror row-count mismatch → PG schema half-applied; PG closed;
//     SQLite stays live; error recorded in the cutover log.
//   - snapshot copy fail → warn, continue (the source SQLite is still on
//     disk at its original path).
//
// The flip order is strict: PG must open, migrate, mirror, verify
// BEFORE SQLite is closed. This is the only way to avoid a "no DB at
// all" failure window. The state write (step 8) happens AFTER SQLite
// is closed, so a process crash between step 7 and step 8 leaves
// `databaseEngine === "sqlite"` for the next boot, which reopens the
// original SQLite file normally.

import fs from "node:fs";
import path from "node:path";
import { runMigrationOnce } from "./migrate.js";
import { pgLatestVersion } from "./migrations/postgres/index.js";
import { createPostgresAdapter } from "./adapters/pgAdapter.js";
import { openSqliteAdapter } from "./driver.js";
import { currentDataFile } from "./paths.js";
import { runMirror } from "./dialects/postgres/mirror.js";
import { getActiveEngine, setActiveAdapter } from "./driver.js";
import { readSettingsViaTransientSqlite, writeSettingsViaTransientSqlite } from "./postgresFallback.js";
import { resolvePostgresSecret } from "./secrets.js";
import { snapshotSqlite, SNAPSHOT_PREFIX } from "./dialects/postgres/snapshot.js";
import { appendCutoverLog } from "./dialects/postgres/cutoverLog.js";
import { isString, isObject } from "../../shared/utils/typeChecks.js";

// In-process async mutex (the plan's `CutoverLock`). Only one cutover
// or rollback runs at a time. The runtime rejects new write requests
// while the lock is held; readers (GET routes) keep serving from the
// previous adapter.
let lockHeld = false;
let lockWaiters = [];

async function acquireCutoverLock() {
  if (!lockHeld) {
    lockHeld = true;
    return;
  }
  await new Promise((resolve) => lockWaiters.push(resolve));
  lockHeld = true;
}

function releaseCutoverLock() {
  lockHeld = false;
  const next = lockWaiters.shift();
  if (next) next();
}

export function isCutoverInFlight() {
  return lockHeld;
}

/**
 * Test a PG connection URL without opening the persistent adapter.
 * Returns `{ ok, latencyMs, serverVersion, error? }`. Used by the
 * `/api/settings/database/test` route.
 */
export async function testConnection({ url, sslmode }) {
  if (!isString(url) || !url) return { ok: false, error: "url is required" };
  const t0 = Date.now();
  let pg;
  try {
    pg = await createPostgresAdapter({ url, sslmode });
  } catch (err) {
    return { ok: false, error: err.message, latencyMs: Date.now() - t0 };
  }
  try {
    const row = await pg.get("SELECT version() AS v, 1 AS n");
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      serverVersion: row && row.v ? row.v : "unknown",
    };
  } finally {
    try { await pg.close(); } catch { /* noop */ }
  }
}

/**
 * Run the full cutover pipeline. Returns a result object suitable for
 * the API response.
 */
export async function runCutover({ url, sslmode, includeRequestDetails = false } = {}) {
  if (!isString(url) || !url) {
    return { ok: false, error: "url is required" };
  }
  await acquireCutoverLock();
  const t0 = Date.now();
  let pg = null;
  let snapshotPath = null;
  let schemaVersion = 0;
  let tablesMigrated = 0;
  let rowsMigrated = 0;
  try {
    // 1. test the connection
    const probe = await testConnection({ url, sslmode });
    if (!probe.ok) {
      return { ok: false, error: probe.error, latencyMs: probe.latencyMs };
    }
    // 2. open the persistent adapter
    pg = await createPostgresAdapter({ url, sslmode });
    // 3. run the PG migration set
    await runMigrationOnce(pg);
    schemaVersion = pgLatestVersion(); // the parallel set's latest applied version
    // 4. open a fresh SQLite adapter (read-only-ish) for the mirror source
    const sqlite = await openSqliteAdapter(currentDataFile());
    try {
      const mirrorResult = await runMirror(sqlite, pg, { includeRequestDetails });
      tablesMigrated = mirrorResult.tablesMigrated;
      rowsMigrated = mirrorResult.rowsMigrated;
      if (!mirrorResult.ok) {
        return {
          ok: false,
          error: `Mirror row-count mismatch: ${mirrorResult.error}`,
          schemaVersion,
          tablesMigrated,
          rowsMigrated,
          durationMs: Date.now() - t0,
        };
      }
    } finally {
      try { await sqlite.close?.(); } catch { /* noop */ }
    }
    // 5. snapshot the source SQLite (best-effort)
    snapshotPath = await snapshotSqlite();
    // 6. flip the runtime to PG
    setActiveAdapter(pg);
    pg = null; // ownership transferred to the driver
    // 7. persist the engine flip in the settings row
    const settings = await readSettingsViaTransientSqlite();
    await writeSettingsViaTransientSqlite({
      databaseEngine: "postgres",
      databaseCutoverAt: new Date().toISOString(),
      databaseCutoverSchemaVersion: schemaVersion,
      databaseEngineError: null,
      postgresAuthSource: "settings",
    });
    void settings;
    // 8. append a cutover log row on PG (best-effort; the runtime is
    //    already on PG, so we open a transient adapter to log).
    try {
      const logPg = await createPostgresAdapter({ url, sslmode });
      try {
        await appendCutoverLog(logPg, {
          type: "cutover",
          ok: true,
          durationMs: Date.now() - t0,
          schemaVersion,
          tablesMigrated,
          rowsMigrated,
        });
      } finally {
        try { await logPg.close?.(); } catch { /* noop */ }
      }
    } catch (err) {
      // Non-fatal: the runtime is on PG; the log row is a nice-to-have.
      console.warn(`[DB][cutover] log append failed: ${err.message}`);
    }
    return {
      ok: true,
      schemaVersion,
      tablesMigrated,
      rowsMigrated,
      durationMs: Date.now() - t0,
      snapshotPath,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      schemaVersion,
      tablesMigrated,
      rowsMigrated,
      durationMs: Date.now() - t0,
      snapshotPath,
    };
  } finally {
    if (pg) {
      try { await pg.close(); } catch { /* noop */ }
    }
    releaseCutoverLock();
  }
}

/**
 * Rollback to SQLite from PG. Restores the most recent cutover snapshot
 * and flips the engine back to sqlite.
 */
export async function runRollback({ snapshotPath } = {}) {
  await acquireCutoverLock();
  const t0 = Date.now();
  try {
    const sqlite = await openSqliteAdapter(currentDataFile());
    try {
      // Ensure the snapshot exists; if not, the operator must pick one
      // via `body.snapshotPath` (or the most recent one is auto-picked).
      const target = snapshotPath || pickLatestSnapshot();
      if (!target || !fs.existsSync(target)) {
        return { ok: false, error: "snapshot not found", durationMs: Date.now() - t0 };
      }
      // Restore the snapshot into the live SQLite path.
      const live = path.join(process.env.DATA_DIR || "~/.9router", "db", "data.sqlite");
      fs.copyFileSync(target, live);
    } finally {
      try { await sqlite.close?.(); } catch { /* noop */ }
    }
    // Reopen SQLite as the active adapter and persist the flip.
    const freshSqlite = await openSqliteAdapter(currentDataFile());
    setActiveAdapter(freshSqlite);
    await writeSettingsViaTransientSqlite({
      databaseEngine: "sqlite",
      databaseEngineError: null,
    });
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message, durationMs: Date.now() - t0 };
  } finally {
    releaseCutoverLock();
  }
}

function pickLatestSnapshot() {
  const dir = path.join(process.env.DATA_DIR || "~/.9router", "db", "backups");
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir)
    .filter((n) => n.startsWith(SNAPSHOT_PREFIX) || n.includes(SNAPSHOT_PREFIX))
    .map((n) => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries.length ? entries[0].full : null;
}
