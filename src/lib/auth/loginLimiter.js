// In-memory progressive lockout for dashboard login. Resets on process restart.
import { hasTrustedPeerHeaders } from "./trustedPeer.js";

const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000]; // 30s, 2m, 10m, 30m
const FAIL_WINDOW_MS = 60 * 60 * 1000; // 1h since last fail → auto reset
// Bounds memory against an attacker cycling through many spoofed IPs faster
// than FAIL_WINDOW_MS would naturally expire their entries.
export const MAX_TRACKED_IPS = 5000;

const attempts = new Map(); // ip → { fails, lockUntil, lockLevel, lastFailAt }

function now() { return Date.now(); }

function isExpired(e, t) {
  return e.lastFailAt && t - e.lastFailAt > FAIL_WINDOW_MS && (!e.lockUntil || t >= e.lockUntil);
}

function getEntry(ip) {
  const e = attempts.get(ip);
  if (!e) return null;
  // Auto reset if window expired and not currently locked
  if (isExpired(e, now())) {
    attempts.delete(ip);
    return null;
  }
  return e;
}

// Proactively drops stale entries so IPs that never come back for a retry
// (and so never hit the lazy per-IP check in getEntry) don't sit in memory
// forever. Deterministic: full pass in Map insertion order.
export function sweepExpiredAttempts() {
  const t = now();
  for (const [ip, e] of attempts) {
    if (isExpired(e, t)) attempts.delete(ip);
  }
}

export function getTrackedIpCount() {
  return attempts.size;
}

export function resetLoginLimiter() {
  attempts.clear();
}

export function checkLock(ip) {
  const e = getEntry(ip);
  if (!e || !e.lockUntil) return { locked: false };
  const remaining = e.lockUntil - now();
  if (remaining <= 0) return { locked: false };
  return { locked: true, retryAfter: Math.ceil(remaining / 1000) };
}

// Deterministic eviction: sweep expired entries first; if still at the cap,
// drop the single oldest-by-last-failure entry (first in Map iteration order
// among the remaining, since inserts/re-inserts always move an IP to the end).
function evictForNewEntry() {
  if (attempts.size < MAX_TRACKED_IPS) return;
  sweepExpiredAttempts();
  if (attempts.size < MAX_TRACKED_IPS) return;
  const oldestIp = attempts.keys().next().value;
  if (oldestIp !== undefined) attempts.delete(oldestIp);
}

export function recordFail(ip) {
  const existing = attempts.get(ip);
  if (!existing) evictForNewEntry();
  const e = getEntry(ip) || { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  e.fails += 1;
  e.lastFailAt = now();
  if (e.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step = LOCK_STEPS_MS[Math.min(e.lockLevel, LOCK_STEPS_MS.length - 1)];
    e.lockUntil = now() + step;
    e.lockLevel += 1;
    e.fails = 0;
  }
  attempts.delete(ip);
  attempts.set(ip, e);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - e.fails) };
}

export function recordSuccess(ip) {
  attempts.delete(ip);
}

/**
 * Resolves the limiter bucket from wrapper-authenticated peer metadata only.
 * Forwarding headers remain attacker-controlled until custom-server proves it handled the socket.
 */
export function getClientIp(request) {
  // Trusted only when custom-server.js proves it stamped the header from the TCP socket;
  // otherwise a client could rotate the value to escape its own lockout bucket.
  if (hasTrustedPeerHeaders(request)) {
    const realIp = request.headers.get("x-9r-real-ip");
    if (realIp) return realIp;
  }
  // Behind a trusted reverse proxy that overwrites XFF with the real client IP.
  // TRUST_PROXY configures proxy semantics; wrapper proof establishes header provenance.
  if (process.env.TRUST_PROXY === "true" && hasTrustedPeerHeaders(request)) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0].trim();
  }
  // Direct exposure without custom-server: single bucket so spoofed XFF
  // rotation cannot escape the limiter.
  return "unknown";
}
