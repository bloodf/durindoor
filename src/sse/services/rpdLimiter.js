// port(omniroute): per-connection RPD (requests-per-day) override
// (OmniRoute c49ee53bc, #12147). Mirrors the sliding-window admission shape of
// rpmLimiter.js but with a 24h window; only active when a connection sets
// providerSpecificData.rateLimitOverrides.rpd — there is no provider-wide RPD
// default, unlike RPM.
// ponytail: process-local budget, same tradeoff as rpmLimiter.js; move to
// shared storage only for multi-instance routing.

export const RPD_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_CONNECTIONS = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** @type {Map<string, number[]>} */
const hits = new Map();

function boundedLimit(limit) {
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

function pruneConnection(connectionId, now) {
  const timestamps = hits.get(connectionId);
  if (!timestamps) return [];
  const cutoff = now - RPD_WINDOW_MS;
  let firstLive = 0;
  while (firstLive < timestamps.length && timestamps[firstLive] <= cutoff) firstLive += 1;
  if (firstLive === timestamps.length) {
    hits.delete(connectionId);
    return [];
  }
  if (firstLive > 0) timestamps.splice(0, firstLive);
  return timestamps;
}

export function usage(connectionId, now = Date.now()) {
  return pruneConnection(connectionId, now).length;
}

/** True once account has spent its configured positive RPD budget. No cap means never over limit. */
export function isOverLimit(connectionId, limit, now = Date.now()) {
  const cap = boundedLimit(limit);
  return cap > 0 && usage(connectionId, now) >= cap;
}

export function recordRequest(connectionId, limit, now = Date.now()) {
  const cap = boundedLimit(limit);
  if (!connectionId || cap === 0) return;
  const timestamps = pruneConnection(connectionId, now);
  if (timestamps.length >= cap) return;
  timestamps.push(now);
  if (!hits.has(connectionId) && hits.size >= MAX_TRACKED_CONNECTIONS) {
    _pruneIdleConnections(now);
    if (hits.size >= MAX_TRACKED_CONNECTIONS) hits.delete(hits.keys().next().value);
  }
  hits.set(connectionId, timestamps);
}

/** Earliest epoch-ms when this account regains capacity, or null when eligible. */
export function retryAfterMs(connectionId, limit, now = Date.now()) {
  const cap = boundedLimit(limit);
  if (cap === 0 || !isOverLimit(connectionId, cap, now)) return null;
  const timestamps = hits.get(connectionId) || [];
  const oldestRequired = timestamps[Math.max(0, timestamps.length - cap)];
  return oldestRequired == null ? null : oldestRequired + RPD_WINDOW_MS;
}

export function _pruneIdleConnections(now = Date.now()) {
  let removed = 0;
  for (const connectionId of hits.keys()) {
    if (pruneConnection(connectionId, now).length === 0) removed += 1;
  }
  return removed;
}

/** Test-only bounded-state snapshot. */
export function _rpdLimiterState() {
  return {
    connections: hits.size,
    timestamps: [...hits.values()].reduce((total, timestamps) => total + timestamps.length, 0)
  };
}

/** Test-only reset. */
export function _resetRpdLimiter() {
  hits.clear();
}

const cleanup = setInterval(_pruneIdleConnections, CLEANUP_INTERVAL_MS);
cleanup.unref?.();
