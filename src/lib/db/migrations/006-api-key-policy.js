// Add `policy` JSON column to apiKeys for per-key model allowlist (and future
// token/cost limits). Additive only — syncSchemaFromTables also handles this
// for existing DBs, but the migration stamps the version for traceability.
// Also backfills lifetime per-key totals from existing usageHistory so new
// limits applied to existing keys start from real usage.
export default {
  version: 6,
  name: "api-key-policy",
  up(db) {
    const cols = db.all(`PRAGMA table_info(apiKeys)`);
    if (!cols.some((c) => c.name === "policy")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN policy TEXT`);
    }

    // Backfill apiKeyUsageTotals from historical usage rows. The counter is
    // normally incremented inside saveRequestUsage; pre-existing databases will
    // have zero totals otherwise, causing per-key limits to under-count history.
    const totalsTable = db.all(`PRAGMA table_info(apiKeyUsageTotals)`);
    if (totalsTable.length === 0) return;

    const rows = db.all(`
      SELECT
        a.id AS apiKeyId,
        COALESCE(SUM(u.promptTokens + u.completionTokens), 0) AS totalTokens,
        COALESCE(SUM(u.cost), 0) AS totalCost,
        COUNT(u.id) AS totalRequests
      FROM apiKeys a
      LEFT JOIN usageHistory u ON u.apiKey = a.key
      GROUP BY a.id
    `);

    for (const r of rows) {
      db.run(
        `INSERT OR REPLACE INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt) VALUES(?, ?, ?, ?, ?)`,
        [r.apiKeyId, r.totalTokens || 0, r.totalCost || 0, r.totalRequests || 0, new Date().toISOString()]
      );
    }
  },
};
