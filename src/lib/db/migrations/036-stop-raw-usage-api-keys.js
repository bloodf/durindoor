import { lockUsageIdentityRewrite, usageKeyIdentity } from "../helpers/apiKeyAttribution.js";
import { tableColumnNames } from "../helpers/tableColumns.js";

// Rewrite bounded pages; existing identity digests are stable on repeated runs.
export default {
  version: 36,
  name: "stop-raw-usage-api-keys",
  up(db) {
    const columns = tableColumnNames(db, "usageHistory");
    if (!columns.has("apiKey") || !columns.has("apiKeyId")) return;
    lockUsageIdentityRewrite(db);
    const hasKeys = tableColumnNames(db, "apiKeys").has("key");
    let after = 0;
    for (;;) {
      const rows = db.all("SELECT id, apiKey, apiKeyId, provider FROM usageHistory WHERE id > ? AND apiKey IS NOT NULL ORDER BY id LIMIT 500", [after]);
      if (!rows.length) break;
      for (const row of rows) {
        const id = row.apiKeyId || (hasKeys && row.provider !== "mcp-gateway" ? db.get("SELECT id FROM apiKeys WHERE key = ?", [row.apiKey])?.id : null);
        const identity = id && row.provider !== "mcp-gateway" ? null : (usageKeyIdentity(null, row.apiKey, row.provider) || null);
        db.run("UPDATE usageHistory SET apiKey = ?, apiKeyId = ? WHERE id = ?", [identity, id || null, row.id]);
      }
      after = rows.at(-1).id;
    }
  },
};
