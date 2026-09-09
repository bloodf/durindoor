import { getAdapter } from "../driver.js";

// The PG adapter uses `$1, $2, ...` placeholders; the SQLite adapters use
// `?`. We detect the active engine at call time so the metaStore works
// for both without leaking the dialect to callers.
function isPostgresAdapter(adapter) {
  if (!adapter || !adapter.capabilities) return false;
  return Boolean(adapter.capabilities.isPostgres);
}

function getSql(adapter) {
  return isPostgresAdapter(adapter)
    ? `SELECT value FROM _meta WHERE key = $1`
    : `SELECT value FROM _meta WHERE key = ?`;
}

function upsertSql(adapter) {
  return isPostgresAdapter(adapter)
    ? `INSERT INTO _meta(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`
    : `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
}

export async function getMeta(key, fallback = null) {
  const db = await getAdapter();
  const row = db.get(getSql(db), [key]);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const db = await getAdapter();
  db.run(upsertSql(db), [key, String(value)]);
}

// Sync versions for use during migration (adapter passed directly)
export function getMetaSync(adapter, key, fallback = null) {
  const row = adapter.get(getSql(adapter), [key]);
  return row ? row.value : fallback;
}

export function setMetaSync(adapter, key, value) {
  adapter.run(upsertSql(adapter), [key, String(value)]);
}
