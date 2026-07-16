"use strict";
const net = require("net");

/**
 * CLI readiness probe (port of OmniRoute #6892 / upstream #6800 + #2460).
 *
 * Replaces blind fixed `setTimeout(..., N)` waits AND the earlier raw
 * TCP-accept check for "is the server up yet?". A bare TCP accept is not
 * proof of readiness: a still-booting / CPU-bound Next.js process can bind
 * and accept the port 30-60s before it can answer a single request, and
 * reporting ready then makes the CLI print its "server is running" banner
 * far too early (#6800).
 *
 * Readiness is therefore classified per poll by `pollHealthOnce`:
 * - "ready"        -> resolved true immediately.
 * - "fast-reject"  -> the HTTP server is alive and answering quickly, but
 *                     the health route is not mounted yet (the original
 *                     #2460 Windows cold-start gap). Counts toward a 3s
 *                     consecutive grace window, then resolves true.
 * - "hanging"      -> TCP accepted but the request timed out with no
 *                     response at all: still booting, NOT ready. Resets
 *                     the grace window.
 * - "unhealthy"    -> the server answered quickly with a non-ready HTTP
 *                     status (5xx, 401/403/429, etc.) or an unexpected
 *                     network error. Does NOT count toward the grace window.
 * - "not-listening"-> nothing accepts the port. Resets the grace window.
 *
 * Resolves `false` (never rejects, never hangs) on timeout so callers keep
 * their existing fallback path.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 150;
const HEALTH_PATH = "/api/health";
const PER_REQUEST_TIMEOUT_MS = 2000;
const TCP_FALLBACK_GRACE_MS = 3000;

// Network error codes that mean the HTTP server is alive but the health route
// is not mounted yet. Only these codes plus HTTP 404 earn the fast-reject
// grace window; everything else is treated as unhealthy and keeps the waiter
// unready.
const ROUTE_MISSING_ERROR_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

/**
 * Poll the health endpoint once and classify the outcome.
 * Kept separate (and exported) so tests can drive each classification
 * deterministically with local ephemeral sockets.
 *
 * @param {number} port TCP port on 127.0.0.1 to probe.
 * @param {number} [requestTimeoutMs] cap for this single request; defaults
 *   to PER_REQUEST_TIMEOUT_MS. The waiter passes its remaining deadline so a
 *   hanging peer can never overshoot the overall timeoutMs budget.
 * @returns {Promise<"ready"|"fast-reject"|"hanging"|"unhealthy"|"not-listening">}
 */
async function pollHealthOnce(port, requestTimeoutMs = PER_REQUEST_TIMEOUT_MS) {
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) return "hanging";
  const deadline = Date.now() + requestTimeoutMs;
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
      // Single per-call deadline shared by fetch and the TCP fallback below,
      // so fetch+TCP can never exceed requestTimeoutMs in aggregate.
      signal: AbortSignal.timeout(Math.min(requestTimeoutMs, PER_REQUEST_TIMEOUT_MS)),
    });
  } catch (err) {
    // Timed out waiting for ANY response: socket accepted but the process
    // never answered -> still booting / CPU-bound, not a mounted-route gap.
    if (err && err.name === "TimeoutError") return "hanging";
    // Fast failure (ECONNREFUSED/ECONNRESET/...): distinguish "nothing
    // listening" from "alive but route not mounted yet" with one TCP probe,
    // itself capped at the REMAINING budget so it cannot overshoot.
    const remaining = Math.max(1, deadline - Date.now());
    const listening = await isPortListening(port, remaining).catch(() => false);
    if (!listening) return "not-listening";
    // Only proven route-missing signals (reset/early-close + 404) earn the
    // fast-reject grace. Malformed HTTP responses or explicit 5xx/401/403/429
    // answers mean the server is unhealthy, not merely unmounted.
    const code = err?.cause?.code;
    return ROUTE_MISSING_ERROR_CODES.has(code) ? "fast-reject" : "unhealthy";
  }
  // 2xx means the health route is ready. 404 is the expected route-not-mounted
  // cold-start signal. Any other HTTP status means the endpoint is explicitly
  // unhealthy and must not be counted as ready.
  if (res.ok) return "ready";
  if (res.status === 404) return "fast-reject";
  return "unhealthy";
}

/**
 * Poll until the server is ready on `port`, or `timeoutMs` elapses.
 *
 * @param {number} port TCP port on 127.0.0.1 to probe.
 * @param {{timeoutMs?: number, intervalMs?: number}} [opts]
 * @returns {Promise<boolean>} true if the server became ready within the deadline.
 */
function waitServerReady(port, { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  // Defensive: callers probe an externally-sourced port; never hang or throw.
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.resolve(false);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) intervalMs = DEFAULT_INTERVAL_MS;

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let fastRejectSince = null;
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const poll = async () => {
      if (settled) return;
      if (Date.now() >= deadline) return finish(false);

      let outcome;
      try {
        // Cap this request at the remaining deadline so a hanging peer
        // cannot stretch the overall timeoutMs budget.
        outcome = await pollHealthOnce(port, deadline - Date.now());
      } catch {
        outcome = "not-listening"; // never throw out of the poll loop
      }

      if (outcome === "ready") return finish(true);
      if (outcome === "fast-reject") {
        // Route-not-mounted grace: only a consistently fast-answering
        // server accumulates toward readiness (#2460).
        if (fastRejectSince === null) fastRejectSince = Date.now();
        if (Date.now() - fastRejectSince >= TCP_FALLBACK_GRACE_MS) return finish(true);
      } else {
        // "ready" returns above; "hanging", "unhealthy", or "not-listening":
        // none count toward the grace window, and a hang actively resets it.
        fastRejectSince = null;
      }

      if (Date.now() >= deadline) return finish(false);
      // Cap the inter-poll sleep at the remaining deadline so a large
      // intervalMs cannot overshoot the overall timeoutMs budget.
      setTimeout(poll, Math.min(intervalMs, deadline - Date.now()));
    };

    poll();
  });
}

/**
 * One raw TCP connect probe: does anything accept on 127.0.0.1:`port`?
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortListening(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: Math.min(timeoutMs, 1000) });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {}
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

module.exports = { waitServerReady, pollHealthOnce, DEFAULT_TIMEOUT_MS, DEFAULT_INTERVAL_MS, PER_REQUEST_TIMEOUT_MS, TCP_FALLBACK_GRACE_MS };
