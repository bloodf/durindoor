// Rebuild lifetime API-key totals from authoritative usageHistory rows.
// Called after schema-v6 migration and after one-time legacy JSON import.
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
  db.exec(`DELETE FROM apiKeyUsageTotals WHERE apiKeyId NOT IN (SELECT id FROM apiKeys)`);

  const updatedAt = new Date().toISOString();
  const rows = db.all(`
    SELECT
      apiKeys.id AS apiKeyId,
      COALESCE(SUM(usageHistory.promptTokens + usageHistory.completionTokens), 0) AS totalTokens,
      COALESCE(SUM(usageHistory.cost), 0) AS totalCost,
      COUNT(usageHistory.id) AS totalRequests
    FROM apiKeys
    LEFT JOIN usageHistory ON usageHistory.apiKey = apiKeys.key
    GROUP BY apiKeys.id
  `);

  for (const row of rows) {
    db.run(
      `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [row.apiKeyId, row.totalTokens, row.totalCost, row.totalRequests, updatedAt]
    );
  }
}
