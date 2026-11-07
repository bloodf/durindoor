import { parseJson } from "../helpers/jsonCol.js";
import { hasUnknownCostColumn, tableColumnNames, unknownCostEligibilitySql } from "../helpers/apiKeyUsageTotals.js";

/**
 * Rebuild lifetime totals for every current API key from authoritative
 * usageHistory rows. Called after schema-v6 migration and after one-time
 * legacy JSON import.
 *
 * Adapter contract: `exec(sql)`, `all(sql, params?)`, and `run(sql, params?)`
 * must all finish synchronously; Promise-returning adapters are unsupported.
 * This is verified by the native better-sqlite3 API and its wrapper in
 * `adapters/betterSqliteAdapter.js`, which directly returns `db.exec()` and
 * prepared-statement `.all()` / `.run()` results without `await`.
 *
 * Schema contract: `apiKeys(id, key)` and
 * `usageHistory(id, apiKey, promptTokens, completionTokens, cost)` must exist.
 * The helper creates `apiKeyUsageTotals(apiKeyId PRIMARY KEY, totalTokens,
 * totalCost, totalRequests, updatedAt)` when absent, then replaces the row for
 * each current `apiKeys.id`. It intentionally leaves rollups without a current
 * API-key row untouched; pruning those rows is a separate lifecycle decision.
 *
 * The unknown-cost count follows the same rules as the current rebuild helper.
 * It is reconstructed from retained history, which proves only a lower bound,
 * so an existing larger durable count is preserved instead of reset. The row
 * write uses an upsert rather than `INSERT OR REPLACE`, because SQLite's
 * replace drops a column the statement does not name while PostgreSQL's
 * rewritten upsert keeps it. The two engines disagreed on that count.
 */
export function ensureAndBackfillApiKeyUsageTotals(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apiKeyUsageTotals (
      apiKeyId TEXT PRIMARY KEY,
      totalTokens INTEGER DEFAULT 0,
      totalCost REAL DEFAULT 0,
      totalRequests INTEGER DEFAULT 0,
      updatedAt TEXT
    )
  `);
  const updatedAt = new Date().toISOString();
  // Legacy shapes may lack attribution columns. Without both, no row proves
  // an MCP failure; preserve those historical counts rather than dropping them.
  const historyColumns = tableColumnNames(db, "usageHistory");
  const eligibility = unknownCostEligibilitySql(db, "usageHistory");
  const withUnknownCost = hasUnknownCostColumn(db);
  const rows = db.all(`
    SELECT
      apiKeys.id AS apiKeyId,
      COALESCE(SUM(usageHistory.promptTokens + usageHistory.completionTokens), 0) AS totalTokens,
      COALESCE(SUM(usageHistory.cost), 0) AS totalCost,
      COUNT(usageHistory.id) AS totalRequests
    FROM apiKeys
    LEFT JOIN usageHistory ON usageHistory.apiKey = apiKeys.key ${eligibility}
    GROUP BY apiKeys.id
  `);

  // Unpriced requests mirror migration 026: a null cost, or a numeric legacy
  // cost whose metadata marks it unknown. The branches are disjoint, so one
  // row counts once.
  const unknownCostCounts = new Map();
  if (withUnknownCost) {
    for (const row of db.all(`
      SELECT apiKeys.id AS apiKeyId, COUNT(usageHistory.id) AS unknownCostRequests
      FROM apiKeys
      JOIN usageHistory ON usageHistory.apiKey = apiKeys.key
      WHERE usageHistory.cost IS NULL ${eligibility}
      GROUP BY apiKeys.id
    `)) {
      unknownCostCounts.set(row.apiKeyId, Number(row.unknownCostRequests) || 0);
    }
    if (historyColumns.has("meta")) {
      for (const row of db.all(`
        SELECT apiKeys.id AS apiKeyId, usageHistory.meta
        FROM apiKeys
        JOIN usageHistory ON usageHistory.apiKey = apiKeys.key
        WHERE usageHistory.cost IS NOT NULL AND usageHistory.meta IS NOT NULL ${eligibility}
      `)) {
        if (parseJson(row.meta)?.costStatus === "unknown") {
          unknownCostCounts.set(row.apiKeyId, (unknownCostCounts.get(row.apiKeyId) || 0) + 1);
        }
      }
    }
  }

  for (const row of rows) {
    const columns = withUnknownCost
      ? "apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt"
      : "apiKeyId, totalTokens, totalCost, totalRequests, updatedAt";
    const values = withUnknownCost
      ? [
        row.apiKeyId,
        row.totalTokens,
        row.totalCost,
        row.totalRequests,
        unknownCostCounts.get(row.apiKeyId) || 0,
        updatedAt,
      ]
      : [row.apiKeyId, row.totalTokens, row.totalCost, row.totalRequests, updatedAt];
    db.run(
      `INSERT INTO apiKeyUsageTotals(${columns})
       VALUES(${values.map(() => "?").join(", ")})
       ON CONFLICT(apiKeyId) DO UPDATE SET
         totalTokens = excluded.totalTokens,
         totalCost = excluded.totalCost,
         totalRequests = excluded.totalRequests${withUnknownCost
        ? ",\n         unknownCostRequests = CASE WHEN apiKeyUsageTotals.unknownCostRequests < excluded.unknownCostRequests THEN excluded.unknownCostRequests ELSE apiKeyUsageTotals.unknownCostRequests END"
        : ""},
         updatedAt = excluded.updatedAt`,
      values,
    );
  }
}
