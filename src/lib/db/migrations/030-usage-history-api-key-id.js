import { tableColumnNames } from "../helpers/apiKeyUsageTotals.js";

export function backfillUsageHistoryApiKeyIds(db) {
  db.exec(`
    UPDATE "usageHistory"
    SET "apiKeyId" = "apiKeys".id
    FROM "apiKeys"
    WHERE "usageHistory"."apiKeyId" IS NULL
      AND "usageHistory"."apiKey" = "apiKeys".key
  `);
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
