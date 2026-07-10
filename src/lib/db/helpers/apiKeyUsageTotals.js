export function ensureApiKeyUsageTotalsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS apiKeyUsageTotals (
      apiKeyId TEXT PRIMARY KEY REFERENCES apiKeys(id) ON DELETE CASCADE,
      totalTokens INTEGER NOT NULL DEFAULT 0,
      totalCost REAL NOT NULL DEFAULT 0,
      totalRequests INTEGER NOT NULL DEFAULT 0,
      updatedAt TEXT
    )
  `);
}

/**
 * Rebuild durable per-key totals from retained request history. This is safe to
 * call after legacy JSON import or an older backup import and never mutates the
 * API-key secret used for attribution.
 */
export function backfillApiKeyUsageTotals(db) {
  ensureApiKeyUsageTotalsTable(db);
  const rows = db.all(`
    SELECT
      a.id AS apiKeyId,
      COALESCE(SUM(COALESCE(u.promptTokens, 0) + COALESCE(u.completionTokens, 0)), 0) AS totalTokens,
      COALESCE(SUM(COALESCE(u.cost, 0)), 0) AS totalCost,
      COUNT(u.id) AS totalRequests
    FROM apiKeys a
    LEFT JOIN usageHistory u ON u.apiKey = a.key
    GROUP BY a.id
  `);
  const updatedAt = new Date().toISOString();
  for (const row of rows) {
    db.run(
      `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
      [row.apiKeyId, row.totalTokens || 0, row.totalCost || 0, row.totalRequests || 0, updatedAt],
    );
  }
}
