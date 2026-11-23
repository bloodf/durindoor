import {
  isUsageKeyDigest, LAST_SEEN_DIMENSIONS, upsertUsageLastSeen, usageHistoryKeyIdSql, usageKeyIdentity,
} from "../helpers/apiKeyAttribution.js";
import { tableColumnNames } from "../helpers/tableColumns.js";

const PAGE_SIZE = 100;
const MARKER = "usageLastSeenKeyIdentity";

export default {
  version: 34,
  name: "usage-last-seen-key-identity",
  up(db) {
    if (!tableColumnNames(db, "usageLastSeen").size) return;
    if (db.get("SELECT value FROM _meta WHERE key = ?", [MARKER])) return;
    const hasHistory = tableColumnNames(db, "usageHistory").has("apiKey");
    const hasKeys = tableColumnNames(db, "apiKeys").has("key");
    const retainedId = hasHistory && hasKeys ? `(SELECT ${usageHistoryKeyIdSql(db)}
      FROM usageHistory h WHERE h.timestamp = s.lastUsed AND h.apiKey = s.apiKey
        AND COALESCE(h.provider, '') = s.provider AND COALESCE(h.model, '') = s.model
        AND COALESCE(h.connectionId, '') = s.connectionId AND COALESCE(h.endpoint, '') = s.endpoint
      ORDER BY h.id DESC LIMIT 1)` : "NULL";
    const currentId = hasKeys ? "(SELECT k.id FROM apiKeys k WHERE k.key = s.apiKey)" : "NULL";
    const alreadyId = hasHistory && tableColumnNames(db, "usageHistory").has("apiKeyId")
      ? "EXISTS (SELECT 1 FROM usageHistory h WHERE h.apiKeyId = s.apiKey)" : "FALSE";
    const knownId = hasKeys ? "EXISTS (SELECT 1 FROM apiKeys k WHERE k.id = s.apiKey)" : "FALSE";
    const dims = LAST_SEEN_DIMENSIONS.join(", ");
    const ordered = LAST_SEEN_DIMENSIONS.map((field) => `s.${field}`).join(", ");
    const tuple = "(?, ?, ?, ?, ?, ?)";
    let cursor = null;
    for (;;) {
      const page = db.all(`SELECT s.*, COALESCE(${retainedId}, ${currentId}) AS resolvedId,
        (${alreadyId} OR ${knownId}) AS alreadyId FROM usageLastSeen s
        WHERE s.apiKey <> '' ${cursor ? `AND (${ordered}) > ${tuple}` : ""}
        ORDER BY ${ordered} LIMIT ${PAGE_SIZE}`, cursor || []);
      if (!page.length) break;
      cursor = LAST_SEEN_DIMENSIONS.map((field) => page.at(-1)[field]);
      const sources = [];
      const destinations = new Map();
      for (const row of page) {
        // Keyset traversal can encounter rows already moved by an earlier page.
        if (isUsageKeyDigest(row.apiKey) || row.alreadyId) continue;
        const identity = usageKeyIdentity(row.resolvedId, row.apiKey, row.provider);
        if (identity === row.apiKey) continue;
        sources.push(row);
        const destination = { ...row, apiKey: identity };
        const key = JSON.stringify(LAST_SEEN_DIMENSIONS.map((field) => destination[field]));
        if (!destinations.has(key) || destinations.get(key).lastUsed < row.lastUsed) destinations.set(key, destination);
      }
      if (sources.length) {
        db.run(`DELETE FROM usageLastSeen WHERE (${dims}) IN (${sources.map(() => tuple).join(", ")})`,
          sources.flatMap((row) => LAST_SEEN_DIMENSIONS.map((field) => row[field])));
        upsertUsageLastSeen(db, [...destinations.values()]);
      }
    }
    db.run("INSERT INTO _meta(key, value) VALUES(?, '1')", [MARKER]);
  },
};
