import { getAdapter } from "../driver.js";
import { isNumber } from "../../../shared/utils/typeChecks.js";

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
    if (isMissingApiKeyUsageTotalsTable(err)) return { totalTokens: 0, totalCost: 0, totalRequests: 0, unknownCostRequests: 0, updatedAt: null };
    throw err;
  }
  if (!row) return { totalTokens: 0, totalCost: 0, totalRequests: 0, unknownCostRequests: 0, updatedAt: null };
  return {
    apiKeyId: row.apiKeyId,
    totalTokens: row.totalTokens || 0,
    totalCost: row.totalCost || 0,
    totalRequests: row.totalRequests || 0,
    unknownCostRequests: Number(row.unknownCostRequests),
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
    unknownCostRequests: Number(row.unknownCostRequests),
    updatedAt: row.updatedAt || null,
  }));
}

/**
 * Increment usage totals for an API key. Called inside the saveRequestUsage transaction.
 * Must be called with a db adapter already obtained (sync context).
 * Storage failures, including a missing totals table, must abort the caller's
 * transaction rather than commit history without its lifetime counters.
 *
 * @param {object} db - adapter instance (from getAdapter())
 * @param {string} apiKeyId
 * @param {{ tokens: number, cost: number|null }} usage - Null cost increments durable unknownCostRequests.
 */
export function incrementApiKeyUsageSync(db, apiKeyId, { tokens, cost }) {
  if (!apiKeyId) return;
  const now = new Date().toISOString();
  // Heuristic non-chat estimators can produce fractions (characters / 4),
  // while the durable/import contract is integer tokens. Round up centrally
  // so every caller and every exported backup shares the same representation.
  if (!isNumber(tokens) || !Number.isFinite(tokens) || tokens < 0 || !Number.isSafeInteger(Math.ceil(tokens))) {
    throw new TypeError("Usage token counts must be finite nonnegative numbers");
  }
  if (cost !== null && (!isNumber(cost) || !Number.isFinite(cost) || cost < 0)) {
    throw new TypeError("Usage cost must be null or a finite nonnegative number");
  }
  const normalizedTokens = Math.ceil(tokens);
  const normalizedCost = cost ?? 0;
  db.run(
    `INSERT INTO apiKeyUsageTotals(apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt)
     VALUES(?, ?, ?, 1, ?, ?)
     ON CONFLICT(apiKeyId) DO UPDATE SET
       totalTokens = apiKeyUsageTotals.totalTokens + excluded.totalTokens,
       totalCost = apiKeyUsageTotals.totalCost + excluded.totalCost,
       totalRequests = apiKeyUsageTotals.totalRequests + 1,
       unknownCostRequests = apiKeyUsageTotals.unknownCostRequests + excluded.unknownCostRequests,
       updatedAt = excluded.updatedAt`,
    [apiKeyId, normalizedTokens, normalizedCost, cost === null ? 1 : 0, now],
  );
}
