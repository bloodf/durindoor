import {
  PROVIDER_QUOTA_DEFAULTS } from
"../../config/providerQuota.js";
import { QUOTA_MAX_RETRY_DELAY_MS } from "../../../src/shared/constants/quota.js";
import { isFunction, isString } from "../../../src/shared/utils/typeChecks.js";

const HTTP_OUTCOMES = Object.freeze({
  401: "unauthenticated",
  403: "forbidden",
  429: "rate_limited"
});

function abortError(reason = "Provider quota request aborted") {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Provider quota request aborted", "AbortError");
}

function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function waitWithSignal(promise, signal, onAbort = null) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || abortError());
  return new Promise((resolve, reject) => {
    const aborted = () => {
      try {onAbort?.();} catch {/* best effort */}
      reject(signal.reason || abortError());
    };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });
}

async function readBoundedBody(response, maxBytes, signal) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    const text = isFunction(response?.text) ?
    await waitWithSignal(Promise.resolve().then(() => response.text()), signal, () => {
      Promise.resolve(response?.body?.cancel?.()).catch(() => {});
    }) :
    "";
    if (new TextEncoder().encode(text).byteLength > maxBytes) return { oversized: true, text: "" };
    return { oversized: false, text };
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await waitWithSignal(reader.read(), signal, () => {
        Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});
      });
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
      total += chunk.byteLength;
      if (total > maxBytes) {
        try {Promise.resolve(reader.cancel()).catch(() => {});} catch {/* best effort */}
        return { oversized: true, text: "" };
      }
      chunks.push(chunk);
    }
  } finally {
    try {reader.releaseLock?.();} catch {/* a cancelled pending read may still own the lock */}
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { oversized: false, text: new TextDecoder().decode(bytes) };
}

function retryAtFromHeader(value, attemptedAt) {
  if (!isString(value) || !value.trim()) return null;
  const attemptedMs = new Date(attemptedAt).getTime();
  let retryMs = Number.NaN;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) retryMs = attemptedMs + Number(trimmed) * 1000;else
  retryMs = new Date(trimmed).getTime();
  if (!Number.isFinite(retryMs) || retryMs < attemptedMs) return null;
  return new Date(Math.min(retryMs, attemptedMs + QUOTA_MAX_RETRY_DELAY_MS)).toISOString();
}

export function classifyQuotaHttpStatus(status) {
  if (status >= 200 && status < 300) return "success";
  return HTTP_OUTCOMES[status] || "provider_error";
}

/**
 * Perform one bounded JSON request without exposing response bodies or URLs in
 * errors. Caller cancellation is thrown; every other failure is structured.
 */
export async function requestQuotaJson({
  url,
  options = {},
  fetchImpl = globalThis.fetch,
  proxyOptions = null,
  signal,
  now = Date.now,
  timeoutMs = PROVIDER_QUOTA_DEFAULTS.timeoutMs,
  maxBytes = PROVIDER_QUOTA_DEFAULTS.maxResponseBytes
} = {}) {
  const safeUrl = validateUrl(url);
  const attemptedAt = new Date(now()).toISOString();
  if (!safeUrl || !isFunction(fetchImpl)) {
    return { ok: false, outcome: "provider_error", attemptedAt, retryAt: null };
  }
  if (signal?.aborted) throw abortError(signal.reason);

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new DOMException("Provider quota request timed out", "TimeoutError"));
  }, timeoutMs);
  timeoutId.unref?.();
  const combinedSignal = signal ?
  AbortSignal.any([signal, timeoutController.signal]) :
  timeoutController.signal;

  try {
    let response;
    try {
      response = await waitWithSignal(
        Promise.resolve().then(() => fetchImpl(safeUrl, {
          ...options,
          redirect: "error",
          signal: combinedSignal
        }, proxyOptions)),
        combinedSignal
      );
    } catch (error) {
      if (signal?.aborted) throw abortError(signal.reason);
      const outcome = timeoutController.signal.aborted ? "timeout" : "network_error";
      return { ok: false, outcome, attemptedAt, retryAt: null };
    }

    const outcome = classifyQuotaHttpStatus(Number(response?.status) || 0);
    if (outcome !== "success") {
      try {Promise.resolve(response?.body?.cancel?.()).catch(() => {});} catch {/* best effort */}
      const retryAt = outcome === "rate_limited" ?
      retryAtFromHeader(response?.headers?.get?.("retry-after"), attemptedAt) :
      null;
      return { ok: false, outcome, attemptedAt, retryAt, status: Number(response?.status) || 0 };
    }

    let body;
    try {
      body = await readBoundedBody(response, maxBytes, combinedSignal);
    } catch {
      if (signal?.aborted) throw abortError(signal.reason);
      if (timeoutController.signal.aborted) {
        return { ok: false, outcome: "timeout", attemptedAt, retryAt: null };
      }
      return { ok: false, outcome: "malformed", attemptedAt, retryAt: null };
    }
    if (body.oversized || !body.text.trim()) {
      return { ok: false, outcome: "malformed", attemptedAt, retryAt: null };
    }

    try {
      return { ok: true, outcome: "success", attemptedAt, data: JSON.parse(body.text) };
    } catch {
      return { ok: false, outcome: "malformed", attemptedAt, retryAt: null };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}