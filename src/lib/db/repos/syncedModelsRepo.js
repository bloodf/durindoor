import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { isConnectionScopedSyncProvider } from "../../modelAutoSync/connectionScope.js";

// Model auto-sync catalogs, one kv row per provider id. Each value is the
// entry built by src/lib/modelAutoSync/catalog.js (mergeSyncedCatalog):
// { syncedAt, lastAttemptAt, connectionId, error, newModelIds, models: [...] }.
// Kept out of the settings row so the hot getSettings() path never parses
// hundreds of catalog entries.
const SCOPE = "syncedModels";

// Connection-scoped providers (mlx, opencode-server) keep their model lists
// under per-connection keys. A provider-keyed row with models predates that
// split and cannot be attributed to a connection, so no reader gets its models.
function withoutProviderWideModels(providerId, value) {
  if (!isConnectionScopedSyncProvider(providerId) || !value || !Array.isArray(value.models) || value.models.length === 0) return value;
  return { ...value, models: [] };
}

export async function getSyncedModelCatalogs() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) {
    const value = parseJson(r.value, null);
    if (value) out[r.key] = withoutProviderWideModels(r.key, value);
  }
  return out;
}

export async function getSyncedModelCatalog(providerId) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
  const value = row ? parseJson(row.value, null) : null;
  return withoutProviderWideModels(providerId, value);
}

export async function saveSyncedModelCatalog(providerId, entry) {
  if (!providerId || !entry) return;
  const db = await getAdapter();
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, providerId, stringifyJson(entry)]
  );
}
