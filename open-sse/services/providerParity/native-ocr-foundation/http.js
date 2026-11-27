// Transport for the staged OCR foundation (#2034): a deadline shared by the
// submit and every poll, abortable sends that refuse redirects, bounded body
// reads, and refusal mapping that never quotes the upstream body.
//
// The source (handleOcr / pollOcrOperation in OmniRoute c71f0065
// open-sse/handlers/ocr.ts) has no deadline, follows submit redirects, reads
// whole bodies, relays sanitized upstream error text and turns every thrown
// error into a 500. Here a request is sent once, never retried, and each
// failure says whether the provider may have accepted (and billed) the work.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { OCR_MODALITY } from "./config.js";

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** Accounting for OCR work the provider may have done (and may bill) whose outcome is not known. */
export function ocrAcceptedJob(provider, jobState = "accepted") {
  return { ...mediaAccounting(null, provider, OCR_MODALITY), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, provider, jobState) => ({ ...result, acceptedJob: ocrAcceptedJob(provider, jobState) });

/** A local refusal: nothing was sent and the account is not at fault. */
export const ocrInvalid = (message, status = HTTP_STATUS.BAD_REQUEST) => ({ ...createErrorResult(status, message), local: true });

const timeoutError = () => Object.assign(new Error("OCR deadline passed"), { name: "TimeoutError" });

/** One deadline for a whole request, linked to the caller's signal. */
export function createOcrDeadline(signal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError());
  }, Math.max(1, timeoutMs));
  const linked = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  return { signal: linked, timedOut: () => timedOut, clear: () => clearTimeout(timer) };
}

/** Wait for `promise` or the signal, whichever comes first, even when the promise ignores the signal. */
export function raceSignal(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason);
  }
  let stop;
  const bound = new Promise((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  return Promise.race([promise, bound]).finally(() => {
    signal.removeEventListener("abort", stop);
    bound.catch(() => {});
  });
}

/** Sleep that ends early (rejecting) when the signal fires. */
export const ocrSleep = (sleepImpl, ms, signal) => raceSignal(Promise.resolve().then(() => sleepImpl(ms)), signal);

/**
 * One fetch bounded by `deadline`. A late answer after the wait ended is discarded.
 * Throws an AbortError tagged `notSent` when the request was abandoned before the send.
 */
export async function sendBounded(fetchImpl, url, init, deadline, proxyOptions = null) {
  if (deadline.signal.aborted) throw Object.assign(new Error("aborted before send"), { name: "AbortError", notSent: true });
  const pending = Promise.resolve().then(() => fetchImpl(url, { ...init, redirect: "manual", signal: deadline.signal }, proxyOptions));
  let delivered = null;
  try {
    delivered = await raceSignal(pending, deadline.signal);
    return delivered;
  } finally {
    if (!delivered) pending.then(discard, () => {});
  }
}

export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

export function isRedirect(response) {
  return response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400);
}

/**
 * Read a body as text within `maxBytes`, ending on the deadline.
 * Throws `{ name: "OcrBodyTooLarge" }` past the cap.
 */
export async function readBoundedText(response, { maxBytes, signal }) {
  const reader = response.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await raceSignal(reader.read(), signal);
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      total += bytes.byteLength;
      if (total > maxBytes) throw Object.assign(new Error("OCR response body too large"), { name: "OcrBodyTooLarge" });
      chunks.push(bytes);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A pending read keeps the lock; cancel above already ended the stream.
    }
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** A `Retry-After` value as rate-limit evidence, or null when absent or unusable. */
function retryAfterEvidence(retryAfter) {
  const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
  return evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
}

/**
 * A refused submit answer, by HTTP status. The provider's text is never quoted.
 * A 5xx arrives after the document was sent and may follow billable work, so
 * it carries `acceptedJob` (`submit-unknown`) and is never replayed.
 */
export function ocrRefusal(status, { provider, label, secrets, retryAfter = null }) {
  if (status === 503) {
    const usable = retryAfterEvidence(retryAfter);
    return withAcceptedJob(
      createErrorResult(503, `${label} OCR is unavailable; whether it was processed is unknown`, usable?.resetAtMs, undefined, usable, secrets),
      provider, "submit-unknown");
  }
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} OCR failed with ${status}; whether it was processed is unknown`),
      provider, "submit-unknown");
  }
  if (status === 402) {
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `${label} refused OCR: payment required on this account`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401) return createErrorResult(401, `${label} refused the OCR credentials`, undefined, undefined, null, secrets);
  if (status === 403) return createErrorResult(403, `${label} forbade the OCR request`, undefined, undefined, null, secrets);
  if (status === 429) {
    const usable = retryAfterEvidence(retryAfter);
    return createErrorResult(429, `${label} rate limited OCR`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `${label} refused the OCR request with ${status}`, undefined, undefined, null, secrets);
}

/** A failure after the provider accepted the job: its work may be billed, the result is lost. */
export const ocrLost = (provider, message, status = HTTP_STATUS.BAD_GATEWAY, jobState = "accepted") =>
  withAcceptedJob(createErrorResult(status, message), provider, jobState);
