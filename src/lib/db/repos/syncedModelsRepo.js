import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Model auto-sync catalogs, one kv row per provider id. Each value is the
// entry built by src/lib/modelAutoSync/catalog.js (mergeSyncedCatalog):
// { syncedAt, lastAttemptAt, connectionId, error, newModelIds, models: [...] }.
// Kept out of the settings row so the hot getSettings() path never parses
// hundreds of catalog entries.
const SCOPE = "syncedModels";

export async function getSyncedModelCatalogs() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) {
    const value = parseJson(r.value, null);
    if (value) out[r.key] = value;
  }
  return out;
}

export async function getSyncedModelCatalog(providerId) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
  return row ? parseJson(row.value, null) : null;
}

export async function saveSyncedModelCatalog(providerId, entry) {
  if (!providerId || !entry) return;
  const db = await getAdapter();
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, providerId, stringifyJson(entry)]
  );
}
