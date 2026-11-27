// Vendor transport for the staged upscale adapters: one bounded, abortable
// fetch with manual redirects, bounded body reads, and the shared accepted-job
// / refused-answer mapping. Same contract as the other staged native adapters
// (native-topaz-image/http.js); kept local so this staging has no
// cross-staging import.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { UPSCALE_MODALITY } from "./config.js";

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
export const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });
export const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

/** Whether a failed send provably never reached the upstream. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/** Accounting for work the vendor may have run (and may bill) whose outcome is not known. */
export function acceptedJob(provider, jobState = "submit-unknown", meta = {}) {
  return { ...mediaAccounting(null, provider, UPSCALE_MODALITY), costSource: "accepted-job", meta: { jobState, ...meta } };
}
export const withAcceptedJob = (result, provider, jobState, meta) => ({ ...result, acceptedJob: acceptedJob(provider, jobState, meta) });

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedFetch(fetchImpl, url, init, { signal, timeoutMs }) {
  if (signal?.aborted) throw Object.assign(new Error("aborted before send"), { name: "AbortError", notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let timedOut = false;
  let stopWaiting;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, Math.max(1, timeoutMs));
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(timedOut ? timeoutError() : fetchSignal.reason);
    fetchSignal.addEventListener("abort", stopWaiting, { once: true });
  });
  const pending = Promise.resolve().then(() => fetchImpl(url, { ...init, signal: fetchSignal }));
  let delivered = null;
  try {
    delivered = await Promise.race([pending, bound]);
    return delivered;
  } catch (error) {
    if (timedOut) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    fetchSignal.removeEventListener("abort", stopWaiting);
    bound.catch(() => {});
    if (!delivered) pending.then(discard, () => {});
  }
}

/** True for a redirect answer (followed or not) or an answer from another origin. */
export function offOrigin(response, origin) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) || response.redirected) return true;
  if (!response.url) return false;
  try {
    return new URL(response.url).origin !== origin;
  } catch {
    return true;
  }
}

/**
 * Read at most `maxBytes` of a body within `timeoutMs`. Throws a
 * TimeoutError, an AbortError, or an Error tagged `tooLarge`; the stream is
 * cancelled in every one of those cases.
 */
export async function readBoundedBytes(response, { signal, timeoutMs, maxBytes }) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response);
    throw Object.assign(new Error("body too large"), { tooLarge: true });
  }
  const reader = response.body?.getReader?.();
  if (!reader) return new Uint8Array(0);
  let timer;
  let onAbort;
  const stop = new Promise((_, rejectRead) => {
    timer = setTimeout(() => rejectRead(timeoutError()), Math.max(1, timeoutMs));
    onAbort = () => rejectRead(abortError());
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  stop.catch(() => {});
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      total += chunk.byteLength;
      if (total > maxBytes) throw Object.assign(new Error("body too large"), { tooLarge: true });
      chunks.push(chunk);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** A bounded JSON body; throws `{ invalidJson: true }` for anything unparseable. */
export async function readBoundedJson(response, options) {
  const bytes = await readBoundedBytes(response, options);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid JSON"), { invalidJson: true });
  }
}

/**
 * Map a refused (non-2xx, non-redirect) vendor answer. The upstream body is
 * never quoted. A 5xx on a billable submit carries `acceptedJob`.
 */
export function refusedAnswer(response, { provider, label, credentials, billable = true }) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status === 401 || status === 403) {
    return createErrorResult(status, `${label} credential rejected`, undefined, undefined, null, credentials);
  }
  if (status === 402) {
    return {
      ...createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `${label} refused the upscale for this account (insufficient credits)`, undefined, undefined, null, credentials),
      quotaExhausted: true,
    };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `${label} rate limited the upscale`, usable?.resetAtMs, undefined, usable, credentials);
  }
  if (status >= 500) {
    const result = createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} upscale failed with ${status}; whether it ran is unknown`, undefined, undefined, null, credentials);
    return billable ? withAcceptedJob(result, provider, "submit-unknown") : result;
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `${label} refused the upscale request with ${status}`, undefined, undefined, null, credentials);
}

/**
 * Map a thrown send. `billable` marks a request the vendor may run and bill:
 * a timeout / disconnect after send is then `submit-unknown`, never resent.
 */
export function sendFailure(error, { provider, label, signal, billable = true }) {
  const unsent = provenUnsent(error);
  const aborted = signal?.aborted || error?.name === "AbortError";
  if (aborted) {
    const result = createErrorResult(499, `${label} upscale request aborted`);
    return unsent || !billable ? result : withAcceptedJob(result, provider, "submit-unknown");
  }
  if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} upscale request could not connect`);
  const timedOut = error?.name === "TimeoutError";
  const result = createErrorResult(
    timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
    billable ? `${label} upscale request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
      : `${label} upscale request ${timedOut ? "timed out" : "was interrupted"}`,
  );
  return billable ? withAcceptedJob(result, provider, "submit-unknown") : result;
}

/** Sleep that ends early (rejecting with AbortError) when the signal fires. */
export function abortableSleep(ms, signal) {
  return new Promise((resolve, rejectSleep) => {
    if (signal?.aborted) {
      rejectSleep(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      rejectSleep(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
