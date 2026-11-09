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
  const columns = new Set(db.all(db.driver === "pg"
    ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'usageHistory'`
    : `PRAGMA table_info(usageHistory)`).map((column) => column.name));
  const eligibility = columns.has("provider") && columns.has("status")
    ? `AND NOT (COALESCE(usageHistory.provider, '') = 'mcp-gateway' AND COALESCE(usageHistory.status, '') = 'error')`
    : "";
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

  for (const row of rows) {
    db.run(
      `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [row.apiKeyId, row.totalTokens, row.totalCost, row.totalRequests, updatedAt]
    );
  }
}
