/**
 * transientBackendRetry — bounded retry-with-jitter for transient HTTP errors.
 *
 * Only retryable: 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout.
 * 429 is intentionally NOT retryable here — the upstream proxy uses 429 as a
 * per-tenant policy signal (quota, region, credential) and the same retry would
 * just hit the same policy.
 *
 * Strategy: decorrelated full-jitter (AWS pattern). Each attempt picks a random
 * delay in [baseMs, prev*3], capped at capMs. With defaults (baseMs=200, capMs=2000)
 * the worst-case wall-clock for 3 attempts is ~7s.
 *
 * Ported from OmniRoute's transientBackendRetry.ts (#13143), touching only the
 * single-model (non-combo) chat path — the combo loop has its own cooldown/
 * fallback semantics already (open-sse/services/combo.js).
 */
import { isNumber } from "../../src/shared/utils/typeChecks.js";


export const TRANSIENT_BACKEND_STATUS_CODES = new Set([502, 503, 504]);

export function isResponseStatusRetryable(status) {
  if (!isNumber(status)) return false;
  return TRANSIENT_BACKEND_STATUS_CODES.has(status);
}

const DEFAULT_SLEEP = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Run an action that returns a ResponseLike ({ok, status}) or throws. Retries
 * while the response is non-OK with a transient status (502/503/504). Honours
 * AbortSignal between attempts. Returns the last response on exhaustion —
 * never throws on a transient HTTP response (only throws if the action
 * itself throws).
 *
 * Only ever called before the response has started streaming to the client:
 * a non-ok status means the action produced an error response, not bytes
 * already handed off, so re-running it cannot double-send content.
 *
 * @param {() => Promise<{ok: boolean, status: number}>} action
 * @param {{maxAttempts?: number, baseMs?: number, capMs?: number, source?: string,
 *   sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal,
 *   onRetry?: (info: object) => void}} [options]
 */
export async function runWithTransientBackendRetry(action, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseMs = options.baseMs ?? 200;
  const capMs = options.capMs ?? 2000;
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const signal = options.signal;
  const onRetry = options.onRetry;
  const source = options.source;

  let prev = baseMs;
  let lastResult;

  // Decorrelated jitter (AWS pattern): temp = min(cap, random(base, prev*3)); prev = temp.
  // See https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/ — "full jitter"
  // variant of decorrelated jitter produces lower contention under thundering-herd conditions
  // than naive exponential backoff with constant jitter.
  const decorrelatedDelay = () => {
    const upper = Math.max(baseMs, prev * 3);
    const candidate = baseMs + Math.floor(Math.random() * (upper - baseMs + 1));
    return Math.min(capMs, candidate);
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Retry aborted", "AbortError");
    }
    try {
      const result = await action();
      lastResult = result;
      if (result.ok) return result;
      if (!isResponseStatusRetryable(result.status)) return result;
      // Exhausted: return the last result rather than throwing
      if (attempt >= maxAttempts) return result;
      const delayMs = decorrelatedDelay();
      onRetry?.({ attempt, delayMs, status: result.status, source });
      await sleep(delayMs, signal);
      prev = delayMs;
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (attempt >= maxAttempts) throw error;
      const delayMs = decorrelatedDelay();
      onRetry?.({ attempt, delayMs, error, source });
      await sleep(delayMs, signal);
      prev = delayMs;
    }
  }

  // Unreachable, but keeps a defined return shape.
  return lastResult;
}
