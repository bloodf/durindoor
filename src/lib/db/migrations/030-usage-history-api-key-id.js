import { tableColumnNames } from "../helpers/apiKeyUsageTotals.js";

const BATCH_SIZE = 500;

export function backfillUsageHistoryApiKeyIds(db) {
  const columns = tableColumnNames(db, "usageHistory");
  if (!columns.has("id") || !columns.has("apiKey") || !columns.has("apiKeyId")) return 0;

  let lastId = 0;
  let updated = 0;
  for (;;) {
    const rows = db.all(
      `SELECT usageHistory.id AS id, apiKeys.id AS apiKeyId
         FROM usageHistory JOIN apiKeys ON apiKeys.key = usageHistory.apiKey
        WHERE usageHistory.apiKeyId IS NULL AND usageHistory.id > ?
        ORDER BY usageHistory.id LIMIT ${BATCH_SIZE}`,
      [lastId]
    );
    if (!rows.length) break;
    for (const row of rows) {
      db.run('UPDATE usageHistory SET apiKeyId = ? WHERE id = ? AND apiKeyId IS NULL', [row.apiKeyId, row.id]);
      updated += 1;
    }
    lastId = rows[rows.length - 1].id;
  }
  return updated;
}

export default {
  version: 30,
  name: "usage-history-api-key-id",
  up(db) {
    const columns = tableColumnNames(db, "usageHistory");
    // SQLite additive sync recreates missing tables after versioned migrations.
    if (columns.size === 0) return;
    if (!columns.has("apiKeyId")) {
      db.exec('ALTER TABLE "usageHistory" ADD COLUMN "apiKeyId" TEXT');
    }
    const keyColumns = tableColumnNames(db, "apiKeys");
    if (keyColumns.has("id") && keyColumns.has("key") && columns.has("apiKey")) {
      backfillUsageHistoryApiKeyIds(db);
    }
  },
};
