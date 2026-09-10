/**
 * Provider-grouping helpers for the Quota Tracker (ProviderLimits).
 *
 * The quota grid renders ONE card per provider instead of one card per
 * connection. This module owns the pure logic behind that layout:
 *
 * - {@link groupConnectionsByProvider} buckets the (already filtered, sorted,
 *   paginated) connection list into provider groups, preserving the incoming
 *   order so expiring-first / remaining-sort semantics are untouched.
 * - {@link mergeAccountQuotas} builds the "merged view" rows that aggregate
 *   the same quota key across a provider's accounts. It is deliberately
 *   honest about units: absolute `used`/`total` values are only summed when
 *   EVERY contributing account reports them; otherwise the row falls back to
 *   the minimum remaining percentage and is labeled as `mergeMode:
 *   "percentage"` so the UI can say "min across N accounts" instead of
 *   fabricating a total.
 * - The per-provider merged/per-account toggle persists in localStorage via
 *   {@link readMergedViewMap} / {@link writeMergedViewPreference}.
 *
 * Everything here is pure and DOM-free except the two storage helpers, which
 * are `isBrowser()`-guarded like the other quota caches in `utils.js`.
 *
 * @module ProviderLimits/grouping
 */

import { getRemainingPercentage } from "./utils.js";
import { isBrowser, isNumber, isObject, isString } from "../../../../../../shared/utils/typeChecks.js";

/** localStorage key holding the `{ [provider]: true }` merged-view map. */
export const QUOTA_MERGED_VIEW_STORAGE_KEY = "quotaMergedProviders";

/** Merged-row aggregation modes. */
export const MERGE_MODE = {
  /** Every contributing account reported absolute used/total; values are summed. */
  ABSOLUTE: "absolute",
  /** At least one account reported only a percentage; row shows the min remaining %. */
  PERCENTAGE: "percentage",
};

/**
 * Bucket connections by provider, preserving first-appearance order.
 *
 * Input order is the visible sort order (expiring-first, codex remaining
 * sort, backend priority), so groups and their account sections inherit it.
 *
 * @param {Array<Object>} [connections=[]] - Visible connections for the page
 * @returns {Array<{ provider: string, connections: Array<Object> }>}
 */
export function groupConnectionsByProvider(connections = []) {
  if (!Array.isArray(connections)) return [];
  const groups = [];
  const groupByProvider = new Map();
  for (const connection of connections) {
    const provider = isString(connection?.provider) ? connection.provider : "";
    const existing = groupByProvider.get(provider);
    if (existing) {
      existing.connections.push(connection);
      continue;
    }
    const group = { provider, connections: [connection] };
    groupByProvider.set(provider, group);
    groups.push(group);
  }
  return groups;
}

/**
 * Stable key identifying "the same quota" across accounts of one provider.
 * Prefers `modelKey` (Antigravity) and falls back to the display name, same
 * convention as `getQuotaVisibilityKey`.
 *
 * @param {Object} quota - Normalized quota row
 * @returns {string} Merge key, or "" when the row carries no identity
 */
export function getQuotaMergeKey(quota) {
  if (!isObject(quota) || quota === null) return "";
  const modelKey = isString(quota.modelKey) ? quota.modelKey.trim() : "";
  if (modelKey) return modelKey;
  return isString(quota.name) ? quota.name.trim() : "";
}

/**
 * Whether a quota row carries trustworthy absolute values that can be summed
 * across accounts. Credit-balance rows (`isCredits`) are excluded: their
 * `remaining` is a balance, not a window total, and `total` is often 0.
 *
 * @param {Object} quota - Normalized quota row
 * @returns {boolean}
 */
function hasSummableAbsolutes(quota) {
  return (
    isObject(quota) &&
    quota !== null &&
    quota.isCredits !== true &&
    isNumber(quota.used) &&
    isNumber(quota.total) &&
    Number.isFinite(quota.used) &&
    Number.isFinite(quota.total) &&
    quota.total > 0
  );
}

/**
 * Parse a reset timestamp to epoch ms; returns null for missing/invalid.
 * @param {*} value - resetAt value from a quota row
 * @returns {number|null}
 */
function parseResetTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Merge quota rows with the same key across a provider's accounts.
 *
 * Rules (kept honest — no fabricated totals):
 * - Absolute mode: when EVERY contributing account row has finite
 *   `used`/`total` (total > 0, not a credits row), the merged row sums them
 *   and the remaining percentage is derived from the sums.
 * - Percentage mode: otherwise the merged row carries the MINIMUM remaining
 *   percentage across contributing accounts (the binding constraint) and is
 *   flagged `mergeMode: "percentage"` so the UI labels it "min across N
 *   accounts" instead of showing absolute numbers.
 * - Reset windows collapse to the SOONEST reset across contributors.
 * - `recurring` is true only when every contributor's window recurs.
 *
 * @param {Array<{ connectionId: string, quotas: Array<Object> }>} [accountEntries=[]]
 *   Per-account quota rows (already visibility-filtered by the caller).
 * @returns {Array<Object>} Merged quota rows in first-seen key order, each
 *   with `mergeMode`, `accountCount`, and `sourceConnectionIds`.
 */
export function mergeAccountQuotas(accountEntries = []) {
  if (!Array.isArray(accountEntries)) return [];
  const buckets = new Map();

  for (const entry of accountEntries) {
    const quotas = Array.isArray(entry?.quotas) ? entry.quotas : [];
    for (const quota of quotas) {
      const key = getQuotaMergeKey(quota);
      if (!key) continue;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, name: quota.name, modelKey: quota.modelKey, rows: [] };
        buckets.set(key, bucket);
      }
      bucket.rows.push({ connectionId: entry.connectionId, quota });
    }
  }

  return [...buckets.values()].map((bucket) => {
    const { rows } = bucket;
    const summable = rows.length > 0 && rows.every(({ quota }) => hasSummableAbsolutes(quota));
    const resetTimes = rows.
    map(({ quota }) => parseResetTime(quota.resetAt)).
    filter((time) => time !== null);
    const soonestReset = resetTimes.length > 0 ? Math.min(...resetTimes) : null;

    const merged = {
      name: bucket.name,
      modelKey: bucket.modelKey,
      resetAt: soonestReset === null ? null : new Date(soonestReset).toISOString(),
      recurring: rows.every(({ quota }) => quota.recurring !== false),
      accountCount: rows.length,
      sourceConnectionIds: [...new Set(rows.map(({ connectionId }) => connectionId))],
    };

    if (summable) {
      return {
        ...merged,
        mergeMode: MERGE_MODE.ABSOLUTE,
        used: rows.reduce((sum, { quota }) => sum + quota.used, 0),
        total: rows.reduce((sum, { quota }) => sum + quota.total, 0),
      };
    }

    return {
      ...merged,
      mergeMode: MERGE_MODE.PERCENTAGE,
      used: 0,
      total: 0,
      remainingPercentage: Math.min(...rows.map(({ quota }) => getRemainingPercentage(quota))),
    };
  });
}

/**
 * Read the persisted merged-view preference map.
 * @returns {Object<string, true>} `{ [provider]: true }` for merged providers
 */
export function readMergedViewMap() {
  if (!isBrowser()) return {};
  try {
    const stored = window.localStorage.getItem(QUOTA_MERGED_VIEW_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!isObject(parsed) || Array.isArray(parsed) || parsed === null) return {};
    return Object.fromEntries(
      Object.keys(parsed).
      filter((provider) => parsed[provider] === true).
      map((provider) => [provider, true])
    );
  } catch (error) {
    console.error("Error reading merged-view preference:", error);
    return {};
  }
}

/**
 * Persist the merged-view toggle for one provider. Disabled entries are
 * removed so the map stays small and falsy-safe.
 *
 * @param {string} provider - Provider id (group key)
 * @param {boolean} merged - Whether merged view is enabled
 */
export function writeMergedViewPreference(provider, merged) {
  if (!isBrowser() || !isString(provider) || provider === "") return;
  try {
    const map = readMergedViewMap();
    if (merged === true) map[provider] = true;else delete map[provider];
    window.localStorage.setItem(QUOTA_MERGED_VIEW_STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.error("Error writing merged-view preference:", error);
  }
}
