import { addLocalCalendarDays, localDateFromKey } from "../../usagePeriods.js";
import { usageKeyIdentity, usageKeyStatsKey } from "../helpers/apiKeyAttribution.js";
import { addToCounter } from "../helpers/usageCounters.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { tableColumnNames } from "../helpers/tableColumns.js";

const PAGE_SIZE = 100;
const contextKey = (secret, provider, model) => JSON.stringify([secret, provider || "", model || ""]);

function migrateDay(db, row, hasHistory, hasKeys) {
  const day = parseJson(row.data, {});
  const buckets = Object.entries(day?.byApiKey || {});
  const legacy = buckets.filter(([key, bucket]) => bucket?.apiKey &&
    key !== usageKeyStatsKey(bucket.apiKey, bucket.rawModel, bucket.provider));
  if (!legacy.length) return;

  const recorded = new Map();
  if (hasHistory) {
    const start = localDateFromKey(row.dateKey);
    const end = addLocalCalendarDays(start, 1);
    // The retained ID can identify a rotated secret. Scope to the original
    // day/model/provider so reuse elsewhere cannot reassign the archived bucket.
    let offset = 0;
    for (;;) {
      const page = db.all(`SELECT apiKey, provider, model, MIN(apiKeyId) AS resolvedId, COUNT(DISTINCT apiKeyId) AS identities
        FROM usageHistory WHERE timestamp >= ? AND timestamp < ? AND apiKey IS NOT NULL AND apiKeyId IS NOT NULL
        GROUP BY apiKey, provider, model ORDER BY apiKey, provider, model LIMIT ${PAGE_SIZE} OFFSET ?`,
      [start.toISOString(), end.toISOString(), offset]);
      for (const item of page) {
        recorded.set(contextKey(item.apiKey, item.provider, item.model), Number(item.identities) === 1 ? item.resolvedId : null);
      }
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  for (const [key, bucket] of legacy) {
    const { apiKey, provider, rawModel } = bucket;
    const context = contextKey(apiKey, provider, rawModel);
    const id = recorded.has(context) ? recorded.get(context)
      : hasKeys && provider !== "mcp-gateway" ? db.get("SELECT id FROM apiKeys WHERE key = ?", [apiKey])?.id : null;
    const identity = usageKeyIdentity(id, apiKey, provider);
    const destination = usageKeyStatsKey(identity, rawModel, provider);
    delete day.byApiKey[key];
    if (Object.hasOwn(day.byApiKey, destination)) {
      addToCounter(day.byApiKey, destination, bucket);
    } else {
      day.byApiKey[destination] = { ...bucket, apiKey: identity };
    }
  }
  db.run("UPDATE usageDaily SET data = ? WHERE dateKey = ?", [stringifyJson(day), row.dateKey]);
}

export default {
  version: 35,
  name: "usage-daily-key-identity",
  up(db) {
    if (!tableColumnNames(db, "usageDaily").size) return;
    const hasHistory = tableColumnNames(db, "usageHistory").has("apiKeyId");
    const hasKeys = tableColumnNames(db, "apiKeys").has("key");
    // A single day's JSON can be large on the PostgreSQL sync bridge.
    let after = "";
    for (;;) {
      const row = db.get("SELECT dateKey, data FROM usageDaily WHERE dateKey > ? ORDER BY dateKey LIMIT 1", [after]);
      if (!row) break;
      migrateDay(db, row, hasHistory, hasKeys);
      after = row.dateKey;
    }
  },
};
