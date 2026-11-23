import { randomUUID } from "node:crypto";
import {
  LAST_SEEN_DIMENSIONS, lockUsageIdentityRewrite, upsertUsageLastSeen, usageHistoryKeyIdSql, usageKeyIdentity,
} from "../helpers/apiKeyAttribution.js";
import { tableColumnNames } from "../helpers/tableColumns.js";

const PAGE_SIZE = 100;
const MARKER = "usageLastSeenKeyIdentity";

const migration = {
  version: 34,
  name: "usage-last-seen-key-identity",
  up(db) {
    if (!tableColumnNames(db, "usageLastSeen").size) return;
    lockUsageIdentityRewrite(db);
    if (db.get("SELECT value FROM _meta WHERE key = ?", [MARKER])) return;
    rewriteLastSeenKeyIdentities(db);
    db.run("INSERT INTO _meta(key, value) VALUES(?, '1')", [MARKER]);
  },
};

export default migration;

/** Rewrite raw last-seen dimensions inside the caller’s transaction. */
export function rewriteLastSeenKeyIdentities(db) {
  const hasHistory = tableColumnNames(db, "usageHistory").has("apiKey");
  const hasKeys = tableColumnNames(db, "apiKeys").has("key");
  const retainedId = hasHistory && hasKeys ? `(SELECT ${usageHistoryKeyIdSql(db)}
    FROM usageHistory h WHERE h.timestamp = s.lastUsed AND h.apiKey = s.apiKey
      AND COALESCE(h.provider, '') = s.provider AND COALESCE(h.model, '') = s.model
      AND COALESCE(h.connectionId, '') = s.connectionId AND COALESCE(h.endpoint, '') = s.endpoint
    ORDER BY h.id DESC LIMIT 1)` : "NULL";
  const currentId = hasKeys ? "(SELECT k.id FROM apiKeys k WHERE k.key = s.apiKey)" : "NULL";
  const dims = LAST_SEEN_DIMENSIONS.join(", ");
  const ordered = LAST_SEEN_DIMENSIONS.map((field) => `s.${field}`).join(", ");
  const tuple = "(?, ?, ?, ?, ?, ?)";
  // Keep destinations out of the source pass even if a legacy secret happens
  // to equal a key ID. The prefix exists only inside this transaction.
  let prefix;
  do { prefix = `migrate:${randomUUID()}:`; }
  while (db.get("SELECT 1 FROM usageLastSeen WHERE apiKey LIKE ? LIMIT 1", [`${prefix}%`]));
  const pattern = `${prefix}%`;
  const paged = (where, projection) => {
    let cursor = [];
    return function nextPage() {
      const rows = db.all(`SELECT ${projection} FROM usageLastSeen s WHERE ${where}
        ${cursor.length ? `AND (${ordered}) > ${tuple}` : ""}
        ORDER BY ${ordered} LIMIT ${PAGE_SIZE}`, [pattern, ...cursor]);
      if (rows.length) cursor = LAST_SEEN_DIMENSIONS.map((field) => rows.at(-1)[field]);
      return rows;
    };
  };
  const rawPage = paged("s.apiKey <> '' AND s.apiKey NOT LIKE ?", `s.*, COALESCE(${retainedId}, ${currentId}) AS resolvedId`);
  for (let rows = rawPage(); rows.length; rows = rawPage()) {
    const destinations = new Map();
    for (const row of rows) {
      const apiKey = prefix + usageKeyIdentity(row.resolvedId, row.apiKey, row.provider);
      const destination = { ...row, apiKey };
      const key = JSON.stringify(LAST_SEEN_DIMENSIONS.map((field) => destination[field]));
      if (!destinations.has(key) || destinations.get(key).lastUsed < row.lastUsed) destinations.set(key, destination);
    }
    db.run(`DELETE FROM usageLastSeen WHERE (${dims}) IN (${rows.map(() => tuple).join(", ")})`,
      rows.flatMap((row) => LAST_SEEN_DIMENSIONS.map((field) => row[field])));
    upsertUsageLastSeen(db, [...destinations.values()]);
  }
  const stagedPage = paged("s.apiKey LIKE ?", ordered);
  for (let rows = stagedPage(); rows.length; rows = stagedPage()) {
    db.run(`UPDATE usageLastSeen SET apiKey = SUBSTR(apiKey, ?) WHERE (${dims}) IN (${rows.map(() => tuple).join(", ")})`,
      [prefix.length + 1, ...rows.flatMap((row) => LAST_SEEN_DIMENSIONS.map((field) => row[field]))]);
  }
}
