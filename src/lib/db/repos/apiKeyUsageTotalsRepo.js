import { getAdapter } from "../driver.js";

/** True when the error is a "table does not exist yet" error for apiKeyUsageTotals. */
function isMissingApiKeyUsageTotalsTable(err) {
  return /no such table:\s*apiKeyUsageTotals/i.test(String(err?.message || err));
}

/**
 * Get lifetime usage totals for a single API key.
 * @param {string} apiKeyId
 * @returns {Promise<{ totalTokens: number, totalCost: number, totalRequests: number, updatedAt: string | null } | null>}
 */
export async function getApiKeyUsageTotals(apiKeyId) {
  const db = await getAdapter();
  let row;
  try {
    row = db.get(`SELECT * FROM apiKeyUsageTotals WHERE apiKeyId = ?`, [apiKeyId]);
  } catch (err) {
    if (isMissingApiKeyUsageTotalsTable(err)) return { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null };
    throw err;
  }
  if (!row) return { totalTokens: 0, totalCost: 0, totalRequests: 0, updatedAt: null };
  return {
    apiKeyId: row.apiKeyId,
    totalTokens: row.totalTokens || 0,
    totalCost: row.totalCost || 0,
    totalRequests: row.totalRequests || 0,
    updatedAt: row.updatedAt || null,
  };
}

/**
 * Get lifetime usage totals for all API keys.
 * @returns {Promise<Array<{ apiKeyId: string, totalTokens: number, totalCost: number, totalRequests: number, updatedAt: string | null }>>}
 */
export async function getAllApiKeyUsageTotals() {
  const db = await getAdapter();
  let rows;
  try {
    rows = db.all(`SELECT * FROM apiKeyUsageTotals ORDER BY updatedAt DESC`);
  } catch (err) {
    if (isMissingApiKeyUsageTotalsTable(err)) return [];
    throw err;
  }
  return rows.map((row) => ({
    apiKeyId: row.apiKeyId,
    totalTokens: row.totalTokens || 0,
    totalCost: row.totalCost || 0,
    totalRequests: row.totalRequests || 0,
    updatedAt: row.updatedAt || null,
  }));
}

/**
 * Increment usage totals for an API key. Called inside the saveRequestUsage transaction.
 * Must be called with a db adapter already obtained (sync context).
 *
 * @param {object} db - adapter instance (from getAdapter())
 * @param {string} apiKeyId
 * @param {{ tokens: number, cost: number }} usage
 */
export function incrementApiKeyUsageSync(db, apiKeyId, { tokens, cost }) {
  if (!apiKeyId) return;
  const now = new Date().toISOString();
  // Heuristic non-chat estimators can produce fractions (characters / 4),
  // while the durable/import contract is integer tokens. Round up centrally
  // so every caller and every exported backup shares the same representation.
  const numericTokens = Number(tokens);
  const normalizedTokens = Number.isFinite(numericTokens) && numericTokens > 0
    ? Math.ceil(numericTokens)
    : 0;
  const numericCost = Number(cost);
  const normalizedCost = Number.isFinite(numericCost) && numericCost > 0 ? numericCost : 0;
  try {
    db.run(
      `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, updatedAt)
       VALUES(?, ?, ?, 1, ?)
       ON CONFLICT(apiKeyId) DO UPDATE SET
         totalTokens = apiKeyUsageTotals.totalTokens + excluded.totalTokens,
         totalCost = apiKeyUsageTotals.totalCost + excluded.totalCost,
         totalRequests = apiKeyUsageTotals.totalRequests + 1,
         updatedAt = excluded.updatedAt`,
      [apiKeyId, normalizedTokens, normalizedCost, now],
    );
  } catch (err) {
    // Table not migrated yet (fresh DB) — degrade gracefully; the migration
    // backfills totals later. Any other error propagates to the transaction.
    if (isMissingApiKeyUsageTotalsTable(err)) return;
    throw err;
  }
}
