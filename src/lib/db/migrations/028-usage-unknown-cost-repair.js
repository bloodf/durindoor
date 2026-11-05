import { parseJson } from "../helpers/jsonCol.js";
import { hasUnknownCostColumn, tableColumnNames, unknownCostEligibilitySql } from "../helpers/apiKeyUsageTotals.js";

/**
 * Repair the durable unknown-cost count for keys whose count a historical
 * rebuild dropped.
 *
 * The rebuild helpers wrote their totals without the unknown-cost column, so a
 * missing totals row started at zero and the legacy replacement reset an
 * existing count to zero on SQLite. Migration 026 seeds the count once, but a
 * database that already recorded version 26 never runs it again, so the lost
 * count stays lost without a forward repair.
 *
 * What this migration does:
 *   - reconstructs the count from retained history with the same two disjoint
 *     branches migration 026 uses, a null cost or a numeric legacy cost whose
 *     metadata marks it unknown;
 *   - excludes the exact failed MCP pair, the exemption PR #1653 established,
 *     and only when the history shape can prove it;
 *   - raises the durable count to the reconstructed bound and never lowers it;
 *   - writes only the unknown-cost column, so the token, cost and request
 *     totals keep their existing values.
 *
 * Retained history proves only a lower bound of the lifetime count. Pruning
 * and history resets delete rows without touching the durable totals, and a
 * restored backup carries a count its retained history cannot explain. The
 * count is therefore never corrected downward here.
 */
export default {
  version: 28,
  name: "usage-unknown-cost-repair",
  up(db) {
    // Migration 026 owns creating the column and seeding the count. Without it
    // there is nothing to repair yet.
    if (!hasUnknownCostColumn(db)) return;

    const historyColumns = tableColumnNames(db, "usageHistory");
    const eligibility = unknownCostEligibilitySql(db, "h");
    const counts = new Map();

    // Branch one: a null cost.
    for (const row of db.all(`
      SELECT k.id AS "apiKeyId", COUNT(h.id) AS "unknownCostRequests"
      FROM "apiKeys" k
      JOIN "usageHistory" h ON h."apiKey" = k.key
      WHERE h.cost IS NULL ${eligibility}
      GROUP BY k.id
    `)) {
      counts.set(row.apiKeyId, Number(row.unknownCostRequests) || 0);
    }

    // Branch two: a numeric legacy cost whose metadata marks it unknown. The
    // current writer cannot produce that shape, so it only covers imported and
    // legacy rows. Malformed metadata is tolerated and counts as priced.
    if (historyColumns.has("meta")) {
      for (const row of db.all(`
        SELECT k.id AS "apiKeyId", h.meta
        FROM "apiKeys" k
        JOIN "usageHistory" h ON h."apiKey" = k.key
        WHERE h.cost IS NOT NULL AND h.meta IS NOT NULL ${eligibility}
      `)) {
        if (parseJson(row.meta)?.costStatus === "unknown") {
          counts.set(row.apiKeyId, (counts.get(row.apiKeyId) || 0) + 1);
        }
      }
    }

    for (const [apiKeyId, unknownCostRequests] of counts) {
      db.run(`
        INSERT INTO "apiKeyUsageTotals" ("apiKeyId", "unknownCostRequests") VALUES (?, ?)
        ON CONFLICT ("apiKeyId") DO UPDATE SET "unknownCostRequests" =
          CASE WHEN "apiKeyUsageTotals"."unknownCostRequests" < excluded."unknownCostRequests"
          THEN excluded."unknownCostRequests" ELSE "apiKeyUsageTotals"."unknownCostRequests" END
      `, [apiKeyId, unknownCostRequests]);
    }
  },
};
