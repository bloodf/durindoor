// decolua/9router#3203: bounded in-process sliding-window RPM admission per account.
// ponytail: process-local budget; move to shared storage only for multi-instance routing.

import { MAX_PROVIDER_RPM } from "@/shared/constants/providers.js";

export const RPM_WINDOW_MS = 60_000;
const MAX_TRACKED_CONNECTIONS = 10_000;
const CLEANUP_INTERVAL_MS = RPM_WINDOW_MS;

/** @type {Map<string, number[]>} */
const hits = new Map();

function boundedLimit(limit) {
  return Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_PROVIDER_RPM) : 0;
}

function pruneConnection(connectionId, now) {
  const timestamps = hits.get(connectionId);
  if (!timestamps) return [];
  const cutoff = now - RPM_WINDOW_MS;
  let firstLive = 0;
  while (firstLive < timestamps.length && timestamps[firstLive] <= cutoff) firstLive += 1;
  if (firstLive === timestamps.length) {
    hits.delete(connectionId);
    return [];
  }
  if (firstLive > 0) timestamps.splice(0, firstLive);
  return timestamps;
}

/** Remove connection counters whose complete windows have expired. */
export function _pruneIdleConnections(now = Date.now()) {
  let removed = 0;
  for (const connectionId of hits.keys()) {
    if (pruneConnection(connectionId, now).length === 0) removed += 1;
  }
  return removed;
}

/** Requests admitted for this account inside current sliding minute. */
export function usage(connectionId, now = Date.now()) {
  return pruneConnection(connectionId, now).length;
}

/** True once account has spent configured positive RPM budget. */
export function isOverLimit(connectionId, limit, now = Date.now()) {
  const cap = boundedLimit(limit);
  return cap > 0 && usage(connectionId, now) >= cap;
}

/**
 * Record only a selected account. Storage remains bounded by validated RPM and
 * global connection caps even if a caller accidentally records sustained traffic.
 */
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
  return oldestRequired == null ? null : oldestRequired + RPM_WINDOW_MS;
}

/** Test-only bounded-state snapshot. */
export function _rpmLimiterState() {
  return {
    connections: hits.size,
    timestamps: [...hits.values()].reduce((total, timestamps) => total + timestamps.length, 0),
  };
}

/** Test-only reset. */
export function _resetRpmLimiter() {
  hits.clear();
}

const cleanup = setInterval(_pruneIdleConnections, CLEANUP_INTERVAL_MS);
cleanup.unref?.();
