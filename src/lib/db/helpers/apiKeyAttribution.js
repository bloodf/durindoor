// Stable API-key attribution for usage rows.
//
// Rows written by the current writer carry `usageHistory.apiKeyId`, the key's
// stable row id. Legacy rows predate that column and are attributed through
// the secret they stored. The stable id is what keeps a key's budgets
// attached to the key when its secret later changes: the secret is a
// credential, the id is the account.
//
// Two rules keep this honest:
//   - The id admitted with the request wins over the secret, because only the
//     admitted id survives a secret change between admission and finalization.
//   - A row is counted once. New rows match on the id, legacy rows match on
//     the secret they already carry, and the two branches are disjoint.

import { getMetaSync } from "./metaStore.js";
import { fingerprintApiKey, getOrCreateUsageIdentitySalt } from "./usageKeyIdentity.js";
import { tableColumnNames } from "./apiKeyUsageTotals.js";

const columnsCache = new WeakMap();

/**
 * Column names of the usage history table, cached per adapter.
 *
 * The cache is keyed by the adapter instance, so a migrated or replaced
 * database is re-read instead of reusing a stale answer.
 */
export function usageHistoryColumns(db) {
  const cached = columnsCache.get(db);
  if (cached) return cached;
  let columns = new Set();
  try {
    columns = tableColumnNames(db, "usageHistory");
    columnsCache.set(db, columns);
  } catch {
    // An adapter without a readable usage history reports no columns, so the
    // callers fall back to the secret association alone.
  }
  return columns;
}

/** True when the usage history table carries the stable key id column. */
export function hasStableApiKeyIdColumn(db) {
  return usageHistoryColumns(db).has("apiKeyId");
}

/**
 * Resolve the stable key id of one usage event.
 *
 * @param {object} db - adapter instance (sync context)
 * @param {string|null} apiKey - the stored secret the event was recorded with
 * @param {string|null} [admittedApiKeyId] - the key id carried from admission
 * @returns {string|null} the key's stable id, or null for anonymous/unknown keys
 */
export function resolveUsageApiKeyIdSync(db, apiKey, admittedApiKeyId) {
  if (!db) return null;
  if (admittedApiKeyId) {
    const admitted = db.get(`SELECT id FROM apiKeys WHERE id = ?`, [admittedApiKeyId]);
    if (admitted) return admitted.id;
  }
  if (!apiKey) return null;
  return db.get(`SELECT id FROM apiKeys WHERE key = ?`, [apiKey])?.id || null;
}

/**
 * SQL predicate and parameters selecting the usage rows that belong to one key.
 *
 * Rows carrying the stable id match directly. Legacy rows without an id keep
 * their existing scoped association through the stored secret. Because the
 * legacy branch requires a NULL id, a row that already carries the stable id
 * is never counted a second time through its secret.
 *
 * @param {object} db - adapter instance (sync context)
 * @param {{ apiKeyId?: string|null, apiKey?: string|null }} scope
 * @returns {{ clause: string, params: any[] }}
 */
export function apiKeyUsageScope(db, { apiKeyId = null, apiKey = null } = {}) {
  const columns = usageHistoryColumns(db);
  const hasSecret = columns.has("apiKey");
  const identity = apiKey && Number(getMetaSync(db, "schemaVersion", "0")) >= 33 ?
    fingerprintApiKey(apiKey, getOrCreateUsageIdentitySalt(db)) : apiKey;
  if (columns.has("apiKeyId") && apiKeyId) {
    // A legacy row is only reachable through the secret it still stores.
    if (hasSecret && apiKey) {
      return {
        clause: "(apiKeyId = ? OR (apiKeyId IS NULL AND apiKey = ?))",
        params: [apiKeyId, identity],
      };
    }
    return { clause: "apiKeyId = ?", params: [apiKeyId] };
  }
  if (hasSecret && apiKey) return { clause: "apiKey = ?", params: [identity] };
  return { clause: "1 = 0", params: [] };
}
