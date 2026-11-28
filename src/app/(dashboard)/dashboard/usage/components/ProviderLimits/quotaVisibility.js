import { isObject } from "../../../../../../shared/utils/typeChecks.js";

/**
 * Build a stable key used to identify a quota row for visibility settings.
 *
 * Prefer `quota.modelKey` when present. For positional display names such as
 * "Month 1" / "Month 2", fall back to a composite key that includes the row's
 * 0-based array index so reordering does not collapse distinct rows.
 *
 * @param {Object} quota - Normalized quota row
 * @param {number} [index] - 0-based position of the row in its array
 * @returns {string} Stable visibility key
 */
export function getQuotaVisibilityKey(quota, index) {
  if (!quota || !isObject(quota)) return "";
  if (quota.modelKey) return String(quota.modelKey).trim();
  const name = String(quota.name || "").trim();
  if (name === "") return "";
  if (index === undefined || index === null) return name;
  return `${name}::${index}`;
}

/**
 * Trim hidden quota keys to only those matching currently valid quotas.
 * Stale or obsolete model keys are dropped. Keys are computed with the same
 * modelKey / `name::index` scheme that filter/getHiddenQuotaRows use.
 *
 * @param {Array<string>} [hidden=[]] - Saved hidden keys
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows
 * @returns {Array<string>} Deduplicated hidden keys still present in quotas
 */
export function trimHiddenQuotaKeys(hidden = [], quotas = []) {
  if (!Array.isArray(hidden) || hidden.length === 0) return [];
  const validKeys = new Set(
    quotas.map((quota, index) => getQuotaVisibilityKey(quota, index)).filter(Boolean)
  );
  return [...new Set(hidden.map((k) => String(k).trim()).filter((k) => validKeys.has(k)))];
}

/**
 * Resolve hidden quota keys for a connection, falling back to its provider's
 * legacy entry when no connection-specific preference exists. When the current
 * quota rows are supplied, stale keys that no longer match any row are dropped
 * (upstream f615a83).
 *
 * @param {string} scopeKey - Connection identifier
 * @param {Object} quotaVisibility - Saved visibility settings
 * @param {string} [legacyScopeKey] - Legacy provider identifier
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows for trimming
 * @returns {Set<string>} Normalized hidden quota keys
 */
function getHiddenQuotaSet(scopeKey, quotaVisibility, legacyScopeKey, quotas = []) {
  const scopedHidden = quotaVisibility?.[scopeKey]?.hidden;
  let hidden;
  if (Array.isArray(scopedHidden)) {
    hidden = scopedHidden.map((item) => String(item).trim()).filter(Boolean);
  } else if (legacyScopeKey && legacyScopeKey !== scopeKey) {
    const legacyHidden = quotaVisibility?.[legacyScopeKey]?.hidden;
    hidden = Array.isArray(legacyHidden)
      ? legacyHidden.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } else {
    hidden = [];
  }
  // Builds before the canonical Claude quota ordering persisted rows as
  // `<name>::<index>`; the sort reindexes rows, so keep those settings
  // effective by also matching on the stable name prefix. Claude row names
  // are unique per connection, so the prefix is unambiguous.
  if ((legacyScopeKey || scopeKey) === "claude") {
    for (const key of [...hidden]) {
      const name = key.replace(/::\d+$/, "");
      if (name !== key) hidden.push(name);
    }
  }
  // Prune keys for quotas that no longer exist (after the name-prefix
  // expansion above so stable Claude names are trimmed against live rows).
  if (quotas.length > 0) hidden = trimHiddenQuotaKeys(hidden, quotas);
  return new Set(hidden);
}

/**
 * Update one connection's hidden quota keys. A first connection-scoped write
 * starts from any legacy provider entry so existing preferences remain active.
 *
 * @param {Object} quotaVisibility - Saved visibility settings
 * @param {string} connectionId - Connection identifier
 * @param {string} provider - Legacy provider identifier
 * @param {string} quotaKey - Stable quota row key
 * @param {boolean} hidden - Whether the quota row should be hidden
 * @returns {Object} Updated visibility settings
 */
export function updateQuotaVisibility(
quotaVisibility,
connectionId,
provider,
quotaKey,
hidden)
{
  const connectionVisibility = quotaVisibility[connectionId];
  const legacyVisibility = quotaVisibility[provider];
  const hiddenKeys = new Set(
    connectionVisibility?.hidden || (connectionId !== provider ? legacyVisibility?.hidden : []) || []
  );
  if (hidden) hiddenKeys.add(quotaKey);else
  hiddenKeys.delete(quotaKey);
  // Antigravity now groups text models under the family keys "gemini" and
  // "claude" (upstream f615a83): toggling a family row supersedes any stale
  // per-model keys, which are pruned so they cannot linger invisibly. The
  // Antigravity CLI provider ("agy") shares the same usage handler and
  // grouped rows, so the prune applies to both provider ids.
  if (provider === "antigravity" || provider === "agy") {
    if (quotaKey === "gemini") {
      for (const k of hiddenKeys) {
        if (k.startsWith("gemini-") && !k.includes("image")) hiddenKeys.delete(k);
      }
    } else if (quotaKey === "claude") {
      for (const k of hiddenKeys) {
        if (k.startsWith("claude-")) hiddenKeys.delete(k);
      }
    }
  }
  return {
    ...quotaVisibility,
    [connectionId]: {
      ...connectionVisibility,
      hidden: [...hiddenKeys]
    }
  };
}

/**
 * Return quota rows visible for a connection, with provider-keyed legacy fallback.
 *
 * @param {string} scopeKey - Connection identifier
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows
 * @param {Object} [quotaVisibility={}] - Visibility settings by connection
 * @param {string} [legacyScopeKey] - Legacy provider identifier
 * @returns {Array<Object>} Quota rows that are not hidden
 */
export function filterQuotasByVisibility(
scopeKey,
quotas = [],
quotaVisibility = {},
legacyScopeKey)
{
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getHiddenQuotaSet(scopeKey, quotaVisibility, legacyScopeKey, quotas);
  if (hidden.size === 0) return quotas;
  return quotas.filter((quota, index) => !hidden.has(getQuotaVisibilityKey(quota, index)));
}

/**
 * Return quota rows hidden for a connection, with provider-keyed legacy fallback.
 *
 * @param {string} scopeKey - Connection identifier
 * @param {Array<Object>} [quotas=[]] - Normalized quota rows
 * @param {Object} [quotaVisibility={}] - Visibility settings by connection
 * @param {string} [legacyScopeKey] - Legacy provider identifier
 * @returns {Array<Object>} Hidden quota rows
 */
export function getHiddenQuotaRows(
scopeKey,
quotas = [],
quotaVisibility = {},
legacyScopeKey)
{
  if (!Array.isArray(quotas) || quotas.length === 0) return [];
  const hidden = getHiddenQuotaSet(scopeKey, quotaVisibility, legacyScopeKey, quotas);
  if (hidden.size === 0) return [];
  return quotas.filter((quota, index) => hidden.has(getQuotaVisibilityKey(quota, index)));
}
