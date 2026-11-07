import { getCommittedTokenCount } from "./committedTokens.js";
import { parseJson } from "./jsonCol.js";

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
 * Column names of one table, engine aware. SQLite reflects with PRAGMA,
 * PostgreSQL with information_schema for the current schema.
 */
export function tableColumnNames(db, table) {
  const rows = db.driver === "pg"
    ? db.all("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", [table])
    : db.all(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

/**
 * The MCP failure exemption for a usageHistory alias.
 *
 * Only an explicit failed MCP call is exempt: the exact lowercase
 * provider/status pair. Other providers' errors and rows without a provider
 * or status keep counting. History shapes without both attribution columns
 * cannot prove an exemption, so they keep their counts as well.
 */
export function unknownCostEligibilitySql(db, alias = "usageHistory") {
  const columns = tableColumnNames(db, "usageHistory");
  if (!columns.has("provider") || !columns.has("status")) return "";
  return `AND NOT (COALESCE(${alias}.provider, '') = 'mcp-gateway' AND COALESCE(${alias}.status, '') = 'error')`;
}

/**
 * True when the durable totals table carries the unknown-cost column. Older
 * databases reach the rebuild helpers before migration 026 adds it.
 */
export function hasUnknownCostColumn(db) {
  return tableColumnNames(db, "apiKeyUsageTotals").has("unknownCostRequests");
}

/**
 * True when a retained history row represents an unpriced request.
 *
 * Mirrors migration 026: a null cost, or a numeric legacy cost whose
 * metadata marks it unknown. The branches are disjoint, so one row counts
 * once. Malformed metadata is tolerated and counts as a priced request.
 */
export function isUnknownCostRow(row, { hasMeta = true } = {}) {
  if (row.cost === null || row.cost === undefined) return true;
  if (!hasMeta) return false;
  return parseJson(row.meta)?.costStatus === "unknown";
}

/**
 * Rebuild durable per-key totals from retained request history. This is safe to
 * call after legacy JSON import or an older backup import and never mutates the
 * API-key secret used for attribution. Failed MCP calls remain in history for
 * attribution but do not consume key policy totals, including after rebuilds.
 *
 * The unknown-cost count is a lifetime disclosure counter. Retained history
 * proves only a lower bound of it, because pruning and history resets delete
 * rows without touching the durable totals. A rebuild therefore raises that
 * count to the reconstructed bound and never lowers it. The token, cost and
 * request totals keep their existing rebuild-and-replace behaviour.
 */
export function backfillApiKeyUsageTotals(db, { overwrite = false } = {}) {
  ensureApiKeyUsageTotalsTable(db);
  const historyColumns = tableColumnNames(db, "usageHistory");
  const hasAttribution = historyColumns.has("provider") && historyColumns.has("status");
  const hasMeta = historyColumns.has("meta");
  const selected = ["timestamp", "promptTokens", "completionTokens", "tokens", "cost"];
  if (hasAttribution) selected.push("provider", "status");
  if (hasMeta) selected.push("meta");
  const eligibility = hasAttribution
    ? `AND NOT (COALESCE(provider, '') = 'mcp-gateway' AND COALESCE(status, '') = 'error')`
    : "";
  const withUnknownCost = hasUnknownCostColumn(db);
  const keys = db.all(`SELECT id, key FROM apiKeys`);
  for (const key of keys) {
    const history = db.all(
      `SELECT ${selected.join(", ")} FROM usageHistory WHERE apiKey = ? ${eligibility}`,
      [key.key],
    );
    const totals = history.reduce((sum, row) => {
      let tokens = {};
      try { tokens = row.tokens ? JSON.parse(row.tokens) : {}; } catch { tokens = {}; }
      sum.totalTokens += getCommittedTokenCount(tokens, row);
      const cost = Number(row.cost);
      sum.totalCost += Number.isFinite(cost) && cost > 0 ? cost : 0;
      sum.totalRequests += 1;
      if (isUnknownCostRow(row, { hasMeta })) sum.unknownCostRequests += 1;
      return sum;
    }, { totalTokens: 0, totalCost: 0, totalRequests: 0, unknownCostRequests: 0 });
    const updatedAt = history.reduce(
      (latest, row) => String(row.timestamp || "") > latest ? String(row.timestamp) : latest,
      "",
    ) || null;
    const columns = withUnknownCost
      ? "apiKeyId, totalTokens, totalCost, totalRequests, unknownCostRequests, updatedAt"
      : "apiKeyId, totalTokens, totalCost, totalRequests, updatedAt";
    const values = withUnknownCost
      ? [key.id, totals.totalTokens, totals.totalCost, totals.totalRequests, totals.unknownCostRequests, updatedAt]
      : [key.id, totals.totalTokens, totals.totalCost, totals.totalRequests, updatedAt];
    const conflict = overwrite
      ? `ON CONFLICT(apiKeyId) DO UPDATE SET totalTokens=excluded.totalTokens, totalCost=excluded.totalCost, totalRequests=excluded.totalRequests${
        // The portable monotonic form. A two-argument max() exists in SQLite
        // but not in PostgreSQL, where the column is a bigint.
        withUnknownCost ? ", unknownCostRequests=CASE WHEN apiKeyUsageTotals.unknownCostRequests < excluded.unknownCostRequests THEN excluded.unknownCostRequests ELSE apiKeyUsageTotals.unknownCostRequests END" : ""
      }, updatedAt=excluded.updatedAt`
      : `ON CONFLICT(apiKeyId) DO NOTHING`;
    db.run(
      `INSERT INTO apiKeyUsageTotals(${columns})
       VALUES(${values.map(() => "?").join(", ")})
       ${conflict}`,
      values,
    );
  }
}
