// In-memory progressive lockout for dashboard login. Resets on process restart.
import { isIPv4, isIPv6 } from "node:net";
import { isString } from "@/shared/utils/typeChecks";
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

/**
 * Expand an IPv6 literal into 8 hextets, or null if invalid.
 * @param {string} raw
 * @returns {number[] | null}
 */
function parseIpv6Hextets(raw) {
  let host = raw.toLowerCase();
  const v4Tail = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  let v4Hextets = null;
  if (v4Tail) {
    if (!isIPv4(v4Tail[1])) return null;
    const parts = v4Tail[1].split(".").map((p) => Number(p));
    v4Hextets = [((parts[0] << 8) | parts[1]) & 0xffff, ((parts[2] << 8) | parts[3]) & 0xffff];
    host = host.slice(0, host.length - v4Tail[1].length);
    if (!host.endsWith("::") && host.endsWith(":")) host = host.slice(0, -1);
  }

  const sides = host.split("::");
  if (sides.length > 2) return null;

  const parseSide = (side) => {
    if (!side) return [];
    const out = [];
    for (const seg of side.split(":")) {
      if (!seg) return null;
      if (!/^[0-9a-f]{1,4}$/i.test(seg)) return null;
      out.push(parseInt(seg, 16));
    }
    return out;
  };

  let groups;
  if (sides.length === 2) {
    const head = parseSide(sides[0]);
    const tail = parseSide(sides[1]);
    if (head === null || tail === null) return null;
    const v4Len = v4Hextets ? v4Hextets.length : 0;
    const missing = 8 - head.length - tail.length - v4Len;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail, ...(v4Hextets || [])];
  } else {
    const all = parseSide(host);
    if (all === null) return null;
    groups = [...all, ...(v4Hextets || [])];
  }
  return groups.length === 8 ? groups : null;
}

/**
 * Map a peer address to its limiter bucket key. IPv4 stays exact; IPv6 collapses
 * to the containing /64 so an attacker cannot rotate addresses inside one prefix.
 * @param {unknown} ip
 * @returns {string}
 */
export function toLimiterBucket(ip) {
  if (!isString(ip) || !ip || ip === "unknown") return isString(ip) && ip ? ip : "unknown";
  const raw = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  if (isIPv4(raw)) return raw;

  // IPv4-mapped IPv6 → underlying IPv4 bucket.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(raw);
  if (mapped && isIPv4(mapped[1])) return mapped[1];

  if (!isIPv6(raw)) return raw;
  const groups = parseIpv6Hextets(raw);
  if (!groups) return raw;
  // /64: keep the first four hextets, zero the interface identifier.
  const prefix = groups.slice(0, 4).map((g) => g.toString(16)).join(":");
  return `${prefix}::`;
}

function bucket(ip) {
  return toLimiterBucket(ip);
}

function getEntry(ip) {
  const key = bucket(ip);
  const e = attempts.get(key);
  if (!e) return null;
  // Auto reset if window expired and not currently locked
  if (isExpired(e, now())) {
    attempts.delete(key);
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
  const key = bucket(ip);
  const existing = attempts.get(key);
  if (!existing) evictForNewEntry();
  const e = getEntry(key) || { fails: 0, lockUntil: 0, lockLevel: 0, lastFailAt: 0 };
  e.fails += 1;
  e.lastFailAt = now();
  if (e.fails >= MAX_FAILS_BEFORE_LOCK) {
    const step = LOCK_STEPS_MS[Math.min(e.lockLevel, LOCK_STEPS_MS.length - 1)];
    e.lockUntil = now() + step;
    e.lockLevel += 1;
    e.fails = 0;
  }
  attempts.delete(key);
  attempts.set(key, e);
  return { remainingBeforeLock: Math.max(0, MAX_FAILS_BEFORE_LOCK - e.fails) };
}

/**
 * Atomically check the lock and reserve one attempt slot before any credential
 * work. Callers must not evaluate passwords/TOTP when `{ locked: true }`.
 * On a later success path, re-check {@link checkLock} and refuse if locked.
 * @param {string} ip
 * @returns {{ locked: true, retryAfter: number } | { locked: false, remainingBeforeLock: number }}
 */
export function reserveAttempt(ip) {
  const pre = checkLock(ip);
  if (pre.locked) return { locked: true, retryAfter: pre.retryAfter };
  const { remainingBeforeLock } = recordFail(ip);
  const post = checkLock(ip);
  if (post.locked) return { locked: true, retryAfter: post.retryAfter };
  return { locked: false, remainingBeforeLock };
}

/**
 * Drop one reserved attempt without clearing prior failures or lock level.
 * Used when a credential check succeeds but login is not finished (e.g. MFA
 * pending): the reservation must not burn lockout budget, yet prior fails stay.
 * No-op while the bucket is locked.
 * @param {string} ip
 */
export function releaseReservation(ip) {
  const key = bucket(ip);
  const e = getEntry(key);
  if (!e) return;
  if (e.lockUntil && e.lockUntil > now()) return;
  if (e.fails <= 0) return;
  e.fails -= 1;
  attempts.delete(key);
  if (e.fails > 0 || e.lockLevel > 0 || (e.lockUntil && e.lockUntil > now())) {
    attempts.set(key, e);
  }
}

export function recordSuccess(ip) {
  attempts.delete(bucket(ip));
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
    if (realIp) return toLimiterBucket(realIp);
  }
  // Behind a trusted reverse proxy that overwrites XFF with the real client IP.
  // TRUST_PROXY configures proxy semantics; wrapper proof establishes header provenance.
  if (process.env.TRUST_PROXY === "true" && hasTrustedPeerHeaders(request)) {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) return toLimiterBucket(xff.split(",")[0].trim());
  }
  // Direct exposure without custom-server: single bucket so spoofed XFF
  // rotation cannot escape the limiter.
  return "unknown";
}
