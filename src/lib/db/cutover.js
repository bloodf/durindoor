// SQLite → PostgreSQL cutover orchestrator.
//
// Pipeline:
//   1. acquireCutoverLock (HTTP writes on the live adapter reject)
//   2. testConnection
//   3. open persistent PG adapter; runMigrationOnce (PG set only)
//   4. checkpoint live SQLite; snapshot to currentBackupsDir()
//   5. mirrorSqliteToPostgres (TRUNCATE, quoted idents, COUNT(*), setval, _meta)
//   6. setActiveAdapter(pg) and close the previous SQLite adapter
//   7. persist databaseEngine on BOTH the live PG adapter and the SQLite file
//   8. appendCutoverLog
//   9. releaseCutoverLock
//
// Snapshot failure aborts the flip. Rollback restores currentDataFile()
// from an allowlisted snapshot and requires `force: true` so the operator
// has confirmed that PG-era writes are discarded.

import fs from "node:fs";
import path from "node:path";
import { runMigrationOnce } from "./migrate.js";
import { pgLatestVersion } from "./migrations/postgres/index.js";
import { createPostgresAdapter } from "./adapters/pgAdapter.js";
import { openSqliteAdapter } from "./driver.js";
import { currentDataFile } from "./paths.js";
import { runMirror } from "./dialects/postgres/mirror.js";
import { setActiveAdapter } from "./driver.js";
import { readSettingsViaTransientSqlite, writeSettingsViaTransientSqlite } from "./postgresFallback.js";
import { snapshotSqlite, listSnapshots, SNAPSHOT_PREFIX } from "./dialects/postgres/snapshot.js";
import { appendCutoverLog } from "./dialects/postgres/cutoverLog.js";
import { acquireCutoverLock, releaseCutoverLock, isCutoverInFlight } from "./cutoverLock.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { isString, isFunction } from "../../shared/utils/typeChecks.js";

export { isCutoverInFlight, SNAPSHOT_PREFIX };

function mergeSettingsOnAdapter(adapter, updates) {
  adapter.transaction(() => {
    const row = adapter.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    const next = { ...current, ...updates };
    adapter.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
}

function resolveSnapshotPath(snapshotPath) {
  const allowed = listSnapshots().map((p) => path.resolve(p));
  if (snapshotPath) {
    const resolved = path.resolve(snapshotPath);
    if (!allowed.includes(resolved)) return null;
    return resolved;
  }
  return allowed[0] || null;
}

/**
 * Test a PG connection URL without opening the persistent adapter.
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
    const row = await Promise.resolve(pg.get("SELECT version() AS v, 1 AS n"));
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
 * Run the full cutover pipeline.
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
    const probe = await testConnection({ url, sslmode });
    if (!probe.ok) {
      try {
        await writeSettingsViaTransientSqlite({ databaseEngineError: probe.error });
      } catch { /* noop */ }
      return { ok: false, error: probe.error, latencyMs: probe.latencyMs };
    }
    pg = await createPostgresAdapter({ url, sslmode });
    await runMigrationOnce(pg);
    schemaVersion = pgLatestVersion();

    const liveSqlite = await openSqliteAdapter(currentDataFile());
    try {
      if (isFunction(liveSqlite.checkpoint)) {
        await liveSqlite.checkpoint();
      } else if (isFunction(liveSqlite.flush)) {
        liveSqlite.flush();
      }
    } finally {
      try { await liveSqlite.close?.(); } catch { /* noop */ }
    }

    snapshotPath = await snapshotSqlite();
    if (!snapshotPath && fs.existsSync(currentDataFile())) {
      throw new Error("cutover snapshot failed");
    }

    const sqlite = await openSqliteAdapter(currentDataFile());
    try {
      const mirrorResult = await runMirror(sqlite, pg, { includeRequestDetails });
      tablesMigrated = mirrorResult.tablesMigrated;
      rowsMigrated = mirrorResult.rowsMigrated;
      if (!mirrorResult.ok) {
        try {
          await writeSettingsViaTransientSqlite({ databaseEngineError: mirrorResult.error });
        } catch { /* noop */ }
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

    const engineUpdates = {
      databaseEngine: "postgres",
      databaseCutoverAt: new Date().toISOString(),
      databaseCutoverSchemaVersion: schemaVersion,
      databaseEngineError: null,
      postgresAuthSource: "settings",
    };
    // Write the engine flag on PG (the live settings row after the flip)
    // and on SQLite (boot still reads the engine from the SQLite file).
    mergeSettingsOnAdapter(pg, engineUpdates);
    await writeSettingsViaTransientSqlite(engineUpdates);

    setActiveAdapter(pg);
    pg = null;

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
    try {
      await writeSettingsViaTransientSqlite({ databaseEngineError: err.message });
    } catch { /* noop */ }
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

const ROLLBACK_WARNING =
  "Rollback restores SQLite as of the cutover snapshot. Writes made while PostgreSQL was live are not copied back.";

/**
 * Rollback to SQLite from PG. Restores an allowlisted cutover snapshot
 * onto currentDataFile(). Requires `force: true` after a successful
 * cutover so the operator has confirmed PG-era writes are discarded.
 */
export async function runRollback({ snapshotPath, force = false } = {}) {
  await acquireCutoverLock();
  const t0 = Date.now();
  try {
    let settings = null;
    try {
      settings = await readSettingsViaTransientSqlite();
    } catch { /* missing SQLite file is fine; snapshot check is next */ }
    if (settings && settings.databaseCutoverAt && !force) {
      return {
        ok: false,
        error: "rollback_requires_force",
        warning: ROLLBACK_WARNING,
        discardedSince: settings.databaseCutoverAt,
        durationMs: Date.now() - t0,
      };
    }
    const target = resolveSnapshotPath(snapshotPath);
    if (!target || !fs.existsSync(target)) {
      return { ok: false, error: "snapshot not found", durationMs: Date.now() - t0 };
    }
    const live = currentDataFile();
    const dir = path.dirname(live);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    if (fs.existsSync(live)) {
      try {
        const openSqlite = await openSqliteAdapter(live);
        try {
          if (isFunction(openSqlite.checkpoint)) {
            try { await openSqlite.checkpoint(); } catch { /* best-effort */ }
          }
        } finally {
          try { await openSqlite.close?.(); } catch { /* noop */ }
        }
      } catch { /* copy over whatever is there */ }
    }

    fs.copyFileSync(target, live);

    const freshSqlite = await openSqliteAdapter(live);
    setActiveAdapter(freshSqlite);
    await writeSettingsViaTransientSqlite({
      databaseEngine: "sqlite",
      databaseEngineError: null,
    });
    return {
      ok: true,
      durationMs: Date.now() - t0,
      warning: ROLLBACK_WARNING,
      discardedSince: settings && settings.databaseCutoverAt,
    };
  } catch (err) {
    return { ok: false, error: err.message, durationMs: Date.now() - t0 };
  } finally {
    releaseCutoverLock();
  }
}
