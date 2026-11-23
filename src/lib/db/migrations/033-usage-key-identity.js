import { tableColumnNames } from "../helpers/tableColumns.js";
import { isNumber } from "../../../shared/utils/typeChecks.js";
import { fingerprintApiKey, getOrCreateUsageIdentitySalt } from "../helpers/usageKeyIdentity.js";
import { backfillUsageHistoryApiKeyIds } from "./030-usage-history-api-key-id.js";

// Run only on legacy raw-key data, after account IDs have been backfilled.
export function migrateUsageKeyIdentities(db) {
  const salt = getOrCreateUsageIdentitySalt(db);
  const history = tableColumnNames(db, "usageHistory");
  if (history.has("apiKeyId") && tableColumnNames(db, "apiKeys").has("key")) backfillUsageHistoryApiKeyIds(db);
  let lastId = 0;
  while (history.has("apiKey")) {
    const rows = db.all("SELECT id, apiKey FROM usageHistory WHERE id > ? ORDER BY id LIMIT 500", [lastId]);
    if (!rows.length) break;
    for (const row of rows) if (row.apiKey) db.run("UPDATE usageHistory SET apiKey = ? WHERE id = ?", [fingerprintApiKey(row.apiKey, salt), row.id]);
    lastId = rows[rows.length - 1].id;
  }
  for (const row of tableColumnNames(db, "usageDaily").has("data") ? db.all("SELECT dateKey, data FROM usageDaily") : []) {
    const day = JSON.parse(row.data);
    const groups = {};
    for (const [key, value] of Object.entries(day.byApiKey || {})) {
      const [oldKey, model, provider] = key.split("|");
      const raw = value.apiKey || (oldKey !== "local-no-key" && !oldKey.startsWith("hmac-sha256:") ? oldKey : null);
      const id = raw ? fingerprintApiKey(raw, salt) : oldKey === "local-no-key" ? null : oldKey;
      const nextKey = `${id || "local-no-key"}|${value.rawModel || model || ""}|${value.provider || provider || "unknown"}`;
      const next = { ...value, apiKey: id };
      if (!groups[nextKey]) groups[nextKey] = next;
      else for (const [field, amount] of Object.entries(next)) {
        if (isNumber(amount)) groups[nextKey][field] = (Number(groups[nextKey][field]) || 0) + amount;
      }
    }
    if (day.byApiKey) day.byApiKey = groups;
    db.run("UPDATE usageDaily SET data = ? WHERE dateKey = ?", [JSON.stringify(day), row.dateKey]);
  }
  // Preserve last-seen rows even when their history has already been pruned.
  if (!tableColumnNames(db, "usageLastSeen").has("apiKey")) return;
  const rows = db.all("SELECT dateKey, provider, model, connectionId, apiKey, endpoint, lastUsed FROM usageLastSeen");
  db.run("DELETE FROM usageLastSeen");
  for (const row of rows) db.run(`INSERT INTO usageLastSeen(dateKey, provider, model, connectionId, apiKey, endpoint, lastUsed)
    VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dateKey, provider, model, connectionId, apiKey, endpoint)
    DO UPDATE SET lastUsed = CASE WHEN excluded.lastUsed > usageLastSeen.lastUsed THEN excluded.lastUsed ELSE usageLastSeen.lastUsed END`,
  [row.dateKey, row.provider, row.model, row.connectionId, row.apiKey ? fingerprintApiKey(row.apiKey, salt) : "", row.endpoint, row.lastUsed]);
}

export default { version: 33, name: "usage-key-identity", up: migrateUsageKeyIdentities };
