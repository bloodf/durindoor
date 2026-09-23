// Learn hard request caps stated in 429 prose ("Maximum 5 requests within 1
// minute") and pace future selection under them. Providers such as
// TokenRouter reject bursts this way and send no rate-limit headers, so
// rpmLimiter.js never learns the ceiling on its own and keeps racing into it
// (#13594 / #13895 upstream).
//
// Deliberately per-connection and in-process only, mirroring rpmLimiter.js's
// own storage shape: one account's learned prose cap never pins a sibling
// account on the same provider, and nothing here needs to survive a restart
// (a fresh 429 relearns it quickly if it still applies).
// ponytail: process-local, TTL-expired only; move to shared storage only if
// multi-instance routing needs the same cap honoured across processes.

import { parseRequestCapFromBody } from "./rateLimitManager/requestCap.js";

export const LEARNED_CAP_WINDOW_MS = 60_000;
const LEARNED_CAP_TTL_MS = 60 * 60_000;
const MAX_TRACKED_CONNECTIONS = 10_000;

/** @type {Map<string, {rpm: number, learnedAt: number}>} */
const learnedCaps = new Map();

/**
 * Parse a 429 body for a stated request cap and record it for this
 * connection, normalized to requests-per-minute so it composes with
 * rpmLimiter's fixed 60s window. Returns the learned RPM, or null when the
 * body carries no parseable cap.
 */
export function learnRequestCapFromBody(connectionId, body, now = Date.now()) {
  if (!connectionId) return null;
  const cap = parseRequestCapFromBody(body);
  if (!cap) return null;
  const rpm = Math.max(1, Math.floor((cap.requests * LEARNED_CAP_WINDOW_MS) / cap.windowMs));
  if (!learnedCaps.has(connectionId) && learnedCaps.size >= MAX_TRACKED_CONNECTIONS) {
    learnedCaps.delete(learnedCaps.keys().next().value);
  }
  learnedCaps.set(connectionId, { rpm, learnedAt: now });
  return rpm;
}

/** Learned RPM for this connection, or 0 when none is recorded or it has gone stale. */
export function getLearnedRpmCap(connectionId, now = Date.now()) {
  if (!connectionId) return 0;
  const entry = learnedCaps.get(connectionId);
  if (!entry) return 0;
  if (now - entry.learnedAt > LEARNED_CAP_TTL_MS) {
    learnedCaps.delete(connectionId);
    return 0;
  }
  return entry.rpm;
}

/** Forget a connection's learned cap (e.g. the operator cleared its cooldown/limits). */
export function clearLearnedRequestCap(connectionId) {
  learnedCaps.delete(connectionId);
}

/** Test-only bounded-state snapshot. */
export function _learnedRequestCapState() {
  return { connections: learnedCaps.size };
}

/** Test-only reset. */
export function _resetLearnedRequestCaps() {
  learnedCaps.clear();
}
