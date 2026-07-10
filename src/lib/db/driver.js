import { ensureDirs, currentDataFile } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, instances: new Map(), initPromises: new Map(), logged: false, file: null };
const state = global._dbAdapter;
if (!(state.instances instanceof Map)) {
  state.instances = new Map();
  if (state.instance && state.file) state.instances.set(state.file, state.instance);
}
if (!(state.initPromises instanceof Map)) state.initPromises = new Map();

function liveDataFile() {
  return currentDataFile();
}

async function tryBunSqlite(dataFile) {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(dataFile);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite(dataFile) {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(dataFile);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite(dataFile) {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(dataFile);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs(dataFile) {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(dataFile);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter(dataFile) {
  ensureDirs(dataFile);
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite(dataFile);
  if (!adapter) adapter = await tryBetterSqlite(dataFile);
  if (!adapter) adapter = await tryNodeSqlite(dataFile);
  if (!adapter) adapter = await trySqlJs(dataFile);
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${dataFile}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter, dataFile);
  return adapter;
}

export async function getAdapter() {
  const dataFile = liveDataFile();
  const existing = state.instances.get(dataFile);
  if (existing) {
    state.instance = existing;
    state.file = dataFile;
    return existing;
  }

  let initPromise = state.initPromises.get(dataFile);
  if (!initPromise) {
    initPromise = initAdapter(dataFile)
      .then((adapter) => {
        const close = typeof adapter.close === "function" ? adapter.close.bind(adapter) : null;
        if (close) {
          let closed = false;
          adapter.close = () => {
            if (closed) return;
            closed = true;
            try {
              return close();
            } finally {
              if (state.instances.get(dataFile) === adapter) state.instances.delete(dataFile);
              if (state.instance === adapter) {
                state.instance = null;
                state.file = null;
              }
            }
          };
        }
        state.instances.set(dataFile, adapter);
        return adapter;
      })
      .finally(() => {
        state.initPromises.delete(dataFile);
      });
    state.initPromises.set(dataFile, initPromise);
  }

  const adapter = await initPromise;
  state.instance = adapter;
  state.file = dataFile;
  return adapter;
}

export function getAdapterSync() {
  const dataFile = liveDataFile();
  const adapter = state.instances.get(dataFile);
  if (!adapter) throw new Error("[DB] adapter not initialized for active DATA_DIR — await getAdapter() first");
  state.instance = adapter;
  state.file = dataFile;
  return adapter;
}
