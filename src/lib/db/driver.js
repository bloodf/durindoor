import { ensureDirs, hardenPermissions, currentDataFile } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
import { isFunction } from "@/shared/utils/typeChecks.js";if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false, file: null };
const state = global._dbAdapter;

function liveDataFile() {
  return currentDataFile();
}

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(liveDataFile());
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(liveDataFile());
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || maj === 22 && min < 5) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(liveDataFile());
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(liveDataFile());
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter() {
  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

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