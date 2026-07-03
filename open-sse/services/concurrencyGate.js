/**
 * Per-provider concurrency gate (semaphore).
 *
 * Limits the number of concurrent in-flight upstream requests for a single
 * provider.  When the configured limit is reached, additional requests block
 * (with a timeout) until an in-flight request completes and releases its slot.
 *
 * This is *proactive* — it prevents hitting provider concurrency/rate limits
 * in the first place, complementing the existing reactive 429/cooldown logic
 * in accountFallback.js.
 *
 * The gate is process-local (in-memory).  In a single-process Next.js
 * standalone server this covers 100 % of requests.  If the server is ever
 * scaled horizontally the gate would need to be backed by a shared store
 * (Redis, SQLite), but for the typical 9router deployment this is sufficient.
 */

/** @type {Map<string, {current: number, queue: Array<{resolve, reject, timer}>}>} */
const gates = new Map();

/**
 * Default maximum wait time for a concurrency slot (ms).
 * Env override: CONCURRENCY_GATE_TIMEOUT_MS
 */
const DEFAULT_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.CONCURRENCY_GATE_TIMEOUT_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 120_000; // 2 min default
})();

/**
 * Internal: get or create the gate state for a provider.
 */
function getGate(provider) {
  let g = gates.get(provider);
  if (!g) {
    g = { current: 0, queue: [] };
    gates.set(provider, g);
  }
  return g;
}

/**
 * Get the configured concurrency limit for a provider.
 *
 * @param {string} provider - Provider id (e.g. "umans", "openai")
 * @param {Object<string, number>|undefined} limitsMap - Settings map
 *   { provider: maxConcurrent }
 * @returns {number} 0 = no limit, otherwise the max concurrent slots
 */
export function getConcurrencyLimit(provider, limitsMap) {
  if (!limitsMap || typeof limitsMap !== "object") return 0;
  const limit = limitsMap[provider];
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.floor(limit);
}

/**
 * Acquire a concurrency slot for `provider`.
 *
 * Resolves immediately if the limit hasn't been reached.
 * If the limit is 0 (or provider not in the map), resolves immediately —
 * no limit enforced.
 *
 * If the limit is reached, the promise blocks until a slot is released
 * or `timeoutMs` elapses.  On timeout the promise rejects with a
 * ConcurrencyGateTimeoutError so the caller can return a 503.
 *
 * @param {string} provider - Provider id
 * @param {number} limit - Max concurrent slots (0 = unlimited)
 * @param {number} [timeoutMs] - Max wait time (default 120 000 ms)
 * @returns {Promise<void>}
 * @throws {ConcurrencyGateTimeoutError}
 */
export function acquireSlot(provider, limit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!limit || limit <= 0) return Promise.resolve();

  const gate = getGate(provider);

  // Fast path: slot available
  if (gate.current < limit) {
    gate.current++;
    return Promise.resolve();
  }

  // Slow path: queue and wait
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, timer: null };

    entry.timer = setTimeout(() => {
      const idx = gate.queue.indexOf(entry);
      if (idx !== -1) gate.queue.splice(idx, 1);
      reject(new ConcurrencyGateTimeoutError(provider, limit, timeoutMs));
    }, timeoutMs);

    // Allow the process to exit even if the timer is pending
    entry.timer.unref?.();

    gate.queue.push(entry);
  });
}

/**
 * Release a concurrency slot for `provider`.
 *
 * If there are waiters, the next one is dequeued and its promise resolved.
 * Must be called exactly once for every successful acquireSlot().
 *
 * @param {string} provider - Provider id
 */
export function releaseSlot(provider) {
  const gate = gates.get(provider);
  if (!gate) return;

  // If there's a waiter, transfer the slot instead of decrementing
  if (gate.queue.length > 0) {
    const next = gate.queue.shift();
    clearTimeout(next.timer);
    // current stays the same — slot is handed off
    next.resolve();
    return;
  }

  gate.current = Math.max(0, gate.current - 1);
  if (gate.current === 0) {
    gates.delete(provider);
  }
}

/**
 * Get a snapshot of gate states (for diagnostics / dashboard).
 *
 * @returns {Record<string, {current: number, queued: number}>}
 */
export function getGateStats() {
  const result = {};
  for (const [provider, g] of gates) {
    result[provider] = { current: g.current, queued: g.queue.length };
  }
  return result;
}

/**
 * Reset all gates (for testing).
 */
export function _resetGates() {
  for (const [, g] of gates) {
    for (const entry of g.queue) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Gate reset"));
    }
  }
  gates.clear();
}

/**
 * Error thrown when a request waited too long for a concurrency slot.
 */
export class ConcurrencyGateTimeoutError extends Error {
  constructor(provider, limit, timeoutMs) {
    super(
      `Concurrency limit reached for provider "${provider}" ` +
      `(${limit} concurrent). Request timed out after ${timeoutMs}ms waiting for a slot.`
    );
    this.name = "ConcurrencyGateTimeoutError";
    this.provider = provider;
    this.limit = limit;
    this.timeoutMs = timeoutMs;
  }
}
