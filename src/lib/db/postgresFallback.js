// Boot-time fallback wrapper for the opt-in PostgreSQL engine.
//
// The runtime is SQLite by default. When `settings.databaseEngine ===
// "postgres"`, this module opens a PG adapter, reads the cluster's
// `server_version_num` and per-feature GUCs, evaluates the capability
// gate, and either returns the PG adapter or falls back to SQLite on
// any failure (PG unreachable, auth rejected, migrations fail, etc.).
//
// The fallback is one-shot per process: the first successful PG boot
// wins, and the first failure sticks. Repeated PG outages do not loop;
// the operator sees `databaseEngineError` in the settings page and acts.
//
// IMPORTANT: this module deliberately avoids the full `getAdapter()`
// path on the read side, because the driver calls back into this module
// during init. Instead, it opens a transient SQLite adapter just to
// read the `settings` row, then closes it.

import { openSqliteAdapter } from "./driver.js";
import { currentDataFile } from "./paths.js";
import { createPostgresAdapter } from "./adapters/pgAdapter.js";
import { evaluateCapabilities } from "./postgresCapabilityGate.js";
import { runMigrationOnce } from "./migrate.js";
import { resolvePostgresSecret } from "./secrets.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";

/**
 * Test seam: when set, `openActiveAdapter()` skips the live PG path
 * and goes straight to SQLite. The `noPgImportWhenSqlite` guard the
 * plan calls for uses this hook in a test that asserts the `pg` module
 * is never imported under SQLite-only boots.
 */
let sqliteOnlyOverride = false;
export function __setSqliteOnlyForTests(value) {
  sqliteOnlyOverride = Boolean(value);
}

/**
 * Read the settings row via a transient SQLite adapter. Returns the
 * merged settings object (defaults + persisted overrides) or `null` on
 * any failure. The transient adapter is closed before this function
 * returns so it does not hold the file lock.
 *
 * Exported for `cutover.js`, which reuses the same transient-read path
 * when persisting the engine flip after a successful cutover.
 */
export async function readSettingsViaTransientSqlite() {
  const adapter = await openSqliteAdapter(currentDataFile());
  try {
    const row = await adapter.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return null;
    return parseJson(row.data, {});
  } finally {
    try { await adapter.close?.(); } catch { /* noop */ }
  }
}

/**
 * Persist a partial settings update via a transient SQLite adapter.
 * Atomic CAS write: read, merge, write, all inside a single
 * transaction on the transient connection.
 *
 * The callback MUST stay synchronous: the SQLite adapters implement
 * `transaction(fn)` as better-sqlite3's sync `db.transaction(fn)()`,
 * which does not await a promise returned by `fn` — an async callback
 * would still be running (against a closed handle) when the `finally`
 * below closes the adapter.
 *
 * Exported for `cutover.js` (persisting the engine flip / recording
 * `databaseEngineError` from the cutover and rollback pipelines).
 */
export async function writeSettingsViaTransientSqlite(updates) {
  const adapter = await openSqliteAdapter(currentDataFile());
  try {
    await adapter.transaction(() => {
      const row = adapter.get(`SELECT data FROM settings WHERE id = 1`);
      const current = row ? parseJson(row.data, {}) : {};
      const next = { ...current, ...updates };
      adapter.run(
        `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        [stringifyJson(next)]
      );
    });
  } finally {
    try { await adapter.close?.(); } catch { /* noop */ }
  }
}

/**
 * Read the cluster's relevant GUCs via a transient query, returning
 * `null` on failure.
 */
async function readClusterInfo(adapter) {
  try {
    const versionNum = await adapter.get("SHOW server_version_num");
    const versionStr = await adapter.get("SHOW server_version");
    const ioMethod = await adapter.get("SHOW io_method");
    const walLevel = await adapter.get("SHOW wal_level");
    const logLockWaits = await adapter.get("SHOW log_lock_waits");
    return {
      serverVersionNum: versionNum ? versionNum.server_version_num : 0,
      serverVersion: versionStr ? versionStr.server_version : "unknown",
      ioMethod: ioMethod ? ioMethod.io_method : null,
      walLevel: walLevel ? walLevel.wal_level : null,
      logLockWaits: logLockWaits ? logLockWaits.log_lock_waits : null,
    };
  } catch {
    return null;
  }
}

/**
 * Open the active adapter. Reads `settings.databaseEngine` and either
 * returns a PG adapter (with migrations applied) or a SQLite adapter
 * (the default). On PG failure, records `databaseEngineError` and falls
 * back to SQLite.
 */
export async function openActiveAdapter() {
  let settings = null;
  try {
    settings = await readSettingsViaTransientSqlite();
  } catch {
    // Settings row unreadable; fall through to the default SQLite path.
  }
  const engine = settings && settings.databaseEngine === "postgres" ? "postgres" : "sqlite";
  if (engine !== "postgres" || sqliteOnlyOverride) {
    return openSqliteAdapter(currentDataFile());
  }
  const url = await resolvePostgresSecret();
  if (!url) {
    try {
      await writeSettingsViaTransientSqlite({
        databaseEngineError: "PG engine is on but no connection URL is configured",
      });
    } catch { /* noop */ }
    return openSqliteAdapter(currentDataFile());
  }
  let pg;
  try {
    pg = await createPostgresAdapter({ url, sslmode: settings.postgresSslmode });
  } catch (err) {
    try {
      await writeSettingsViaTransientSqlite({
        databaseEngineError: `PG connect failed: ${err.message}`,
      });
    } catch { /* noop */ }
    return openSqliteAdapter(currentDataFile());
  }
  const clusterInfo = await readClusterInfo(pg);
  if (!clusterInfo) {
    try { await pg.close(); } catch { /* noop */ }
    try {
      await writeSettingsViaTransientSqlite({
        databaseEngineError: "PG cluster reachable but version query failed",
      });
    } catch { /* noop */ }
    return openSqliteAdapter(currentDataFile());
  }
  const cap = settings.databasePgVersion || 18;
  const features = settings.databasePgFeatures || {};
  const gate = evaluateCapabilities(clusterInfo, cap, features);
  if (gate.versionMismatch) {
    try {
      await writeSettingsViaTransientSqlite({
        databaseEngineError:
          `PG version cap is ${cap} but cluster reports ${gate.clusterMajor}; ` +
          `${cap}-only features disabled`,
      });
    } catch { /* noop */ }
  }
  try {
    await runMigrationOnce(pg);
  } catch (err) {
    try { await pg.close(); } catch { /* noop */ }
    try {
      await writeSettingsViaTransientSqlite({
        databaseEngineError: `PG migration failed: ${err.message}`,
      });
    } catch { /* noop */ }
    return openSqliteAdapter(currentDataFile());
  }
  // Clear the engine error on a clean boot.
  try {
    await writeSettingsViaTransientSqlite({ databaseEngineError: null });
  } catch { /* noop */ }
  return pg;
}

/**
 * Sync variant used during the cutover pipeline. Returns the PG adapter
 * directly; the caller (cutover.js) is responsible for closing it on
 * failure and for flipping the global `state.instance`.
 */
export async function openPostgresPersistent({ url, sslmode } = {}) {
  if (!url) throw new Error("openPostgresPersistent: url is required");
  return createPostgresAdapter({ url, sslmode });
}

export { resolvePostgresSecret };
