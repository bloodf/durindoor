import { MEMORY_CONFIG } from "../../config/runtimeConfig.js";
import { digestMemoryKey } from "../../utils/memoryKey.js";
import { isObject } from "@/shared/utils/typeChecks.js";

const refreshDedupCache = new Map();

function normalizeRouteValue(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function clearEntryTimer(entry) {
  if (entry?.timer) clearTimeout(entry.timer);
}

function deleteEntry(key, expectedEntry = null) {
  const current = refreshDedupCache.get(key);
  if (!current || expectedEntry && current !== expectedEntry) return false;
  clearEntryTimer(current);
  refreshDedupCache.delete(key);
  return true;
}

function scheduleEntryExpiry(key, entry, ttlMs) {
  entry.expiresAt = Date.now() + ttlMs;
  entry.timer = setTimeout(() => {
    deleteEntry(key, entry);
  }, ttlMs);
  entry.timer.unref?.();
}

function pruneExpiredEntries(now = Date.now()) {
  for (const [key, entry] of refreshDedupCache) {
    if (entry.expiresAt <= now) deleteEntry(key, entry);
  }
}

function makeRoomForEntry() {
  pruneExpiredEntries();
  while (refreshDedupCache.size >= MEMORY_CONFIG.refreshDedupMaxSize) {
    const oldestKey = refreshDedupCache.keys().next().value;
    if (oldestKey === undefined) break;
    deleteEntry(oldestKey);
  }
}

function refreshCacheKey(provider, oldToken, proxyOptions) {
  return digestMemoryKey(
    "oauth-refresh-dedup",
    provider,
    oldToken,
    proxyRouteFingerprint(proxyOptions)
  );
}

function providerLogLabel(provider) {
  return String(provider || "unknown").split(":", 1)[0].replace(/[^a-z0-9_-]/gi, "") || "unknown";
}

/**
 * Build a stable, process-local proxy-route fingerprint for refresh de-duplication.
 *
 * OAuth refresh responses can rotate a token, so identical refreshes should still
 * share one request. They may only share when their egress contract is identical:
 * a direct request must never reuse a result obtained through a strict pool (or
 * vice versa). The digest preserves route isolation without retaining proxy URLs,
 * credentials, or pool identifiers in Map keys.
 *
 * @param {object|null} proxyOptions Effective proxy options for the refresh.
 * @returns {string} SHA-256 fingerprint covering every routing-relevant field.
 */
export function proxyRouteFingerprint(proxyOptions = null) {
  const options = proxyOptions || {};
  const oauthProxy = options.oauthProxy && isObject(options.oauthProxy) ?
  options.oauthProxy :
  {};

  const route = JSON.stringify([
  normalizeRouteValue(oauthProxy.mode || options.proxyMode),
  normalizeRouteValue(
    oauthProxy.poolId ||
    options.proxyPoolId ||
    options.connectionProxyPoolId
  ),
  options.enabled === true || options.connectionProxyEnabled === true,
  normalizeRouteValue(options.url ?? options.connectionProxyUrl),
  normalizeRouteValue(options.noProxy ?? options.connectionNoProxy),
  normalizeRouteValue(options.vercelRelayUrl),
  options.strictProxy === true,
  options.disableEnvProxy === true]
  );

  return digestMemoryKey("oauth-proxy-route", route);
}

/**
 * De-duplicate a provider refresh only within the same proxy route.
 *
 * Completed results expire automatically after a short reuse window. In-flight
 * entries also have a stale deadline, and the cache is capped so a stuck or
 * adversarial refresh stream cannot retain unbounded credential-derived state.
 *
 * @param {string} provider Provider identifier.
 * @param {string} oldToken Refresh token (or equivalent stable token).
 * @param {Function} fn Refresh operation.
 * @param {object|null} log Optional logger.
 * @param {object|null} proxyOptions Effective egress contract.
 * @returns {Promise<unknown>} Shared refresh result for this exact route.
 */
export async function dedupRefresh(provider, oldToken, fn, log, proxyOptions = null) {
  if (!oldToken) return fn();

  const key = refreshCacheKey(provider, oldToken, proxyOptions);
  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.expiresAt <= Date.now()) {
      deleteEntry(key, hit);
    } else {
      // Refresh insertion order so the bounded cache evicts the least-recently
      // used route while the entry's identity-bound expiry timer remains valid.
      refreshDedupCache.delete(key);
      refreshDedupCache.set(key, hit);
      if (hit.promise) {
        log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${providerLogLabel(provider)}`);
        return hit.promise;
      }
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${providerLogLabel(provider)}`);
      return hit.result;
    }
  }

  makeRoomForEntry();
  const entry = { promise: null, expiresAt: 0, timer: null };
  const promise = Promise.resolve().
  then(fn).
  then((result) => {
    if (refreshDedupCache.get(key) === entry) {
      deleteEntry(key, entry);
      const resultEntry = { result, expiresAt: 0, timer: null };
      refreshDedupCache.set(key, resultEntry);
      scheduleEntryExpiry(key, resultEntry, MEMORY_CONFIG.refreshDedupResultTtlMs);
    }
    return result;
  }).
  catch((error) => {
    deleteEntry(key, entry);
    throw error;
  });

  entry.promise = promise;
  refreshDedupCache.set(key, entry);
  scheduleEntryExpiry(key, entry, MEMORY_CONFIG.refreshDedupInFlightTtlMs);
  return promise;
}

export function __getRefreshDedupCacheSnapshotForTesting() {
  return {
    keys: [...refreshDedupCache.keys()],
    size: refreshDedupCache.size,
    maxSize: MEMORY_CONFIG.refreshDedupMaxSize,
    resultTtlMs: MEMORY_CONFIG.refreshDedupResultTtlMs,
    inFlightTtlMs: MEMORY_CONFIG.refreshDedupInFlightTtlMs
  };
}

export function __clearRefreshDedupCacheForTesting() {
  for (const [key, entry] of refreshDedupCache) deleteEntry(key, entry);
}