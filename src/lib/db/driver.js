import { ensureDirs, hardenPermissions, currentDataFile } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
import { isFunction } from "../../shared/utils/typeChecks.js";if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false, file: null };
const state = global._dbAdapter;

function liveDataFile() {
  return currentDataFile();
}


async function initAdapter() {
  ensureDirs();
  // Order per runtime enforced by the shared openSqliteAdapter:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  const adapter = await openSqliteAdapter(liveDataFile());
  const dataFile = liveDataFile();
  state.file = dataFile;
  /** Upstream PR #3381: repair DB/WAL/SHM modes only after SQLite creates them. */
  hardenPermissions();
  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${dataFile}`);
    state.logged = true;
  }

  try {
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    return adapter;
  } catch (error) {
    try {await adapter.close?.();} catch {}
    throw error;
  }
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
  const currentFile = liveDataFile();
  if (state.instance && state.file && state.file !== currentFile) {
    try {
      if (isFunction(state.instance.close)) await state.instance.close();
    } catch {/* best-effort */}
    state.instance = null;
    state.initPromise = null;
  }
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter().
    then((adapter) => {
      state.instance = adapter;
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

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}