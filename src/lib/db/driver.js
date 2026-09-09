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
  // Tests also flip `databaseEngine` between cases; the bootstrap sees
  // the change and re-inits against the new engine.
  const settings = await readSettingsForDriver();
  const currentFile = liveDataFile();
  const currentEngine = settings ? settings.databaseEngine || "sqlite" : "sqlite";
  const cacheKey = `${currentEngine}:${currentFile}`;
  if (state.instance && state.cacheKey && state.cacheKey !== cacheKey) {
    try {
      if (isFunction(state.instance.close)) await state.instance.close();
    } catch {/* best-effort */}
    state.instance = null;
    state.initPromise = null;
  }
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter(currentEngine).
    then((adapter) => {
      state.instance = adapter;
      state.cacheKey = cacheKey;
      return adapter;
    }).
    catch((error) => {
      state.instance = null;
      state.initPromise = null;
      throw error;
    });
  }
  return state.initPromise;
}

/**
 * Read the settings row just enough to decide which engine to boot.
 * Lazy-imports the settings repo to avoid a circular import (driver
 * is imported by repos, which are imported by settingsRepo).
 */
async function readSettingsForDriver() {
  try {
    const { getSettings } = await import("./repos/settingsRepo.js");
    return await getSettings();
  } catch {
    return null;
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
  state.cacheKey = `${getActiveEngine()}:${liveDataFile()}`;
}