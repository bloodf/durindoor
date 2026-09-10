import fs from "node:fs";
import { ensureDirs, hardenPermissions, currentDataFile } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
import { isFunction } from "../../shared/utils/typeChecks.js";if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false, file: null, cacheKey: null };
const state = global._dbAdapter;

function liveDataFile() {
  return currentDataFile();
}


async function initAdapter(engine = "sqlite") {
  ensureDirs();
  let adapter;
  if (engine === "postgres") {
    // Delegate to the PG fallback wrapper, which handles connection,
    // capability gate, migrations, and the SQLite fallback on failure.
    const { openActiveAdapter } = await import("./postgresFallback.js");
    adapter = await openActiveAdapter();
  } else {
    // Order per runtime enforced by the shared openSqliteAdapter:
    //   Bun:  bun:sqlite → sql.js
    //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
    adapter = await openSqliteAdapter(liveDataFile());
    const dataFile = liveDataFile();
    state.file = dataFile;
    hardenPermissions();
  }
  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | engine: ${engine}`);
    state.logged = true;
  }
  if (engine === "sqlite") {
    try {
      const { runMigrationOnce } = await import("./migrate.js");
      await runMigrationOnce(adapter);
    } catch (error) {
      try { await adapter.close?.(); } catch {}
      throw error;
    }
  }
  return adapter;
}

/**
 * Opens a SQLite adapter at `filePath` using the shared runtime fallback
 * chain (no migration, no global-state caching). Shared by the main DB
 * (`getAdapter`) and the proxy-timeline sidecar so both honor the exact
 * same driver order:
 *   Bun:  bun:sqlite → sql.js
 *   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
 */
export async function openSqliteAdapter(filePath) {
  const tryBun = async () => {
    if (!process.versions.bun) return null;
    try {
      const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
      return await createBunSqliteAdapter(filePath);
    } catch (e) {
      console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
      return null;
    }
  };
  const tryBetter = async () => {
    if (process.versions.bun) return null;
    try {
      const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
      return createBetterSqliteAdapter(filePath);
    } catch (e) {
      console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
      return null;
    }
  };
  const tryNode = async () => {
    if (process.versions.bun) return null;
    const [maj, min] = process.versions.node.split(".").map(Number);
    if (maj < 22 || (maj === 22 && min < 5)) return null;
    try {
      const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
      return await createNodeSqliteAdapter(filePath);
    } catch (e) {
      console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
      return null;
    }
  };
  const trySqlJs = async () => {
    try {
      const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
      return await createSqlJsAdapter(filePath);
    } catch (e) {
      console.warn(`[DB] sql.js unavailable: ${e.message}`);
      return null;
    }
  };

  let adapter = await tryBun();
  if (!adapter) adapter = await tryBetter();
  if (!adapter) adapter = await tryNode();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");
  return adapter;
}


export async function getAdapter() {
  // Tests mutate process.env.DATA_DIR between cases without resetting module
  // state; when the path changes, close the cached instance and re-init.
  // Engine flips do NOT re-read the settings row here: the cutover and
  // rollback pipelines transfer the adapter explicitly via
  // setActiveAdapter(). The engine is resolved once per (re)initialization
  // by readEngineViaTransientSqlite() — routing this through
  // settingsRepo.getSettings() would recurse forever
  // (getAdapter → getSettings → getAdapter) and hang the process until
  // the heap is exhausted.
  const currentFile = liveDataFile();
  if (state.instance && state.file && state.file !== currentFile) {
    try {
      if (isFunction(state.instance.close)) await state.instance.close();
    } catch {/* best-effort */}
    state.instance = null;
    state.initPromise = null;
    state.cacheKey = null;
  }
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = (async () => {
      const engine = await readEngineViaTransientSqlite();
      return initAdapter(engine);
    })().
    then((adapter) => {
      state.instance = adapter;
      state.file = liveDataFile();
      state.cacheKey = `${getActiveEngine()}:${state.file}`;
      return adapter;
    }).
    catch((error) => {
      state.instance = null;
      state.initPromise = null;
      state.cacheKey = null;
      throw error;
    });
  }
  return state.initPromise;
}

/**
 * Read `settings.databaseEngine` through a throwaway SQLite connection
 * (opened and closed inside this call) so the driver never depends on
 * the repos — the repos call back into getAdapter(), which would be a
 * circular wait. On any failure (missing file, missing settings table
 * on a fresh pre-migration DB, unreadable row) the default "sqlite"
 * engine is returned, matching the runtime's SQLite-first contract.
 */
async function readEngineViaTransientSqlite() {
  // A missing data file means a fresh, pre-migration install: default
  // to SQLite without opening anything (the sql.js fallback in the
  // adapter chain would otherwise create an in-memory DB and persist
  // an empty file over the path the real boot is about to migrate).
  if (!fs.existsSync(liveDataFile())) return "sqlite";
  let adapter;
  try {
    adapter = await openSqliteAdapter(liveDataFile());
  } catch {
    return "sqlite";
  }
  try {
    const row = await adapter.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row || !row.data) return "sqlite";
    const parsed = JSON.parse(row.data);
    return parsed && parsed.databaseEngine === "postgres" ? "postgres" : "sqlite";
  } catch {
    return "sqlite";
  } finally {
    try { await adapter.close?.(); } catch { /* noop */ }
  }
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}

/**
 * Returns the active engine (sqlite|postgres). The runtime reads this
 * to decide which `databasePgFeatures` toggles to honor and to surface
 * the engine in the settings UI.
 */
export function getActiveEngine() {
  if (state.instance && state.instance.capabilities && state.instance.capabilities.isPostgres) {
    return "postgres";
  }
  return "sqlite";
}

/**
 * Transfer ownership of an already-open adapter to the driver state.
 * Used by the cutover pipeline to flip the runtime to PG after the
 * mirror + verify succeeds. The next `getAdapter()` call returns this
 * adapter.
 */
export function setActiveAdapter(adapter) {
  if (!adapter) throw new Error("setActiveAdapter: adapter is required");
  state.instance = adapter;
  state.initPromise = Promise.resolve(adapter);
  state.file = liveDataFile();
  state.cacheKey = `${getActiveEngine()}:${state.file}`;
}

