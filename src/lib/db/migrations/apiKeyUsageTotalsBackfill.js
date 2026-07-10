/**
 * Reconcile lifetime totals for every registered API key from usageHistory.
 * Replacing registered rows makes the operation idempotent; rollups for keys
 * no longer present in apiKeys are retained for independent lifecycle policy.
 *
 * @param {{ exec: Function, all: Function, run: Function }} db synchronous DB adapter
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
  const rows = db.all(`
    SELECT
      apiKeys.id AS apiKeyId,
      COALESCE(SUM(COALESCE(usageHistory.promptTokens, 0) + COALESCE(usageHistory.completionTokens, 0)), 0) AS totalTokens,
      COALESCE(SUM(usageHistory.cost), 0) AS totalCost,
      COUNT(usageHistory.id) AS totalRequests
    FROM apiKeys
    LEFT JOIN usageHistory ON usageHistory.apiKey = apiKeys.key
    GROUP BY apiKeys.id
  `);

  for (const row of rows) {
    db.run(
      `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [row.apiKeyId, row.totalTokens, row.totalCost, row.totalRequests, updatedAt],
    );
  }
}
