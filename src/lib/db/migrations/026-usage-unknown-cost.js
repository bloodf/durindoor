import { parseJson } from "../helpers/jsonCol.js";
import { TABLES, buildCreateTableSql } from "../schema.js";
import { translateCreateTable } from "../dialects/postgres/translate.js";

// Retained history proves only a lower bound: purged unknown-cost requests
// cannot be recovered. Never reset a larger durable count on retries.
// Rollback keeps this additive column. Older writers omit it and use DEFAULT 0
// for new rows, but cannot track unknown costs; older backup/import code loses
// this field. Keep a current-format backup before downgrading; do not drop it.
export default {
  version: 26,
  name: "usage-unknown-cost",
  up(db) {
    const pg = db.driver === "pg";
    // Versioned migrations run before additive schema repair. Recreate missing
    // source and totals tables first, with keys before their dependent totals.
    // Absent keys or history cannot justify reconstructed charges or counts.
    // Let DDL/query errors abort the migration so version 26 remains retryable.
    for (const name of ["apiKeys", "apiKeyUsageTotals", "usageHistory"]) {
      db.exec(pg ? translateCreateTable(name, TABLES[name]).createSql : buildCreateTableSql(name, TABLES[name]));
    }
    const columns = pg ?
      db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", ["apiKeyUsageTotals"]) :
      db.all("PRAGMA table_info(apiKeyUsageTotals)");
    if (!columns.some((column) => column.name === "unknownCostRequests")) {
      db.exec(`ALTER TABLE "apiKeyUsageTotals" ADD COLUMN "unknownCostRequests" ${pg ? "BIGINT" : "INTEGER"} NOT NULL DEFAULT 0`);
    }

    const counts = new Map(db.all(`
      SELECT k.id AS "apiKeyId", COUNT(h.id) AS "unknownCostRequests"
      FROM "apiKeys" k
      JOIN "usageHistory" h ON h."apiKey" = k.key
      WHERE h.cost IS NULL
      GROUP BY k.id
    `).map((row) => [row.apiKeyId, Number(row.unknownCostRequests)]));
    // Parse legacy metadata tolerantly in JS on both engines. Numeric legacy
    // costs marked unknown still count; NULL costs were counted above only once.
    for (const row of db.all(`
      SELECT k.id AS "apiKeyId", h.meta
      FROM "apiKeys" k
      JOIN "usageHistory" h ON h."apiKey" = k.key
      WHERE h.cost IS NOT NULL AND h.meta IS NOT NULL
    `)) {
      if (parseJson(row.meta)?.costStatus === "unknown") {
        counts.set(row.apiKeyId, (counts.get(row.apiKeyId) || 0) + 1);
      }
    }
    for (const [apiKeyId, count] of counts) {
      db.run(`
        INSERT INTO "apiKeyUsageTotals" ("apiKeyId", "unknownCostRequests") VALUES (?, ?)
        ON CONFLICT ("apiKeyId") DO UPDATE SET "unknownCostRequests" =
          CASE WHEN "apiKeyUsageTotals"."unknownCostRequests" < excluded."unknownCostRequests"
          THEN excluded."unknownCostRequests" ELSE "apiKeyUsageTotals"."unknownCostRequests" END
      `, [apiKeyId, count]);
    }
  },
};
