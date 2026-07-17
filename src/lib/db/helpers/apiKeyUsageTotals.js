import { getCommittedTokenCount } from "./committedTokens.js";

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
export function backfillApiKeyUsageTotals(db, { overwrite = false } = {}) {
  ensureApiKeyUsageTotalsTable(db);
  const keys = db.all(`SELECT id, key FROM apiKeys`);
  for (const key of keys) {
    const history = db.all(
      `SELECT timestamp, promptTokens, completionTokens, tokens, cost FROM usageHistory WHERE apiKey = ?`,
      [key.key],
    );
    const totals = history.reduce((sum, row) => {
      let tokens = {};
      try { tokens = row.tokens ? JSON.parse(row.tokens) : {}; } catch { tokens = {}; }
      sum.totalTokens += getCommittedTokenCount(tokens, row);
      const cost = Number(row.cost);
      sum.totalCost += Number.isFinite(cost) && cost > 0 ? cost : 0;
      sum.totalRequests += 1;
      return sum;
    }, { totalTokens: 0, totalCost: 0, totalRequests: 0 });
    const updatedAt = history.reduce(
      (latest, row) => String(row.timestamp || "") > latest ? String(row.timestamp) : latest,
      "",
    ) || null;
    const conflict = overwrite
      ? `ON CONFLICT(apiKeyId) DO UPDATE SET totalTokens=excluded.totalTokens, totalCost=excluded.totalCost, totalRequests=excluded.totalRequests, updatedAt=excluded.updatedAt`
      : `ON CONFLICT(apiKeyId) DO NOTHING`;
    db.run(
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt)
       VALUES(?, ?, ?, ?, ?)
       ${conflict}`,
      [key.id, totals.totalTokens, totals.totalCost, totals.totalRequests, updatedAt],
    );
  }
}
