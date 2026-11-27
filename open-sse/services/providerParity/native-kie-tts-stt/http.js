// Shared transport for the staged Kie speech and transcription adapters: one
// bounded, abortable fetch to the fixed Kie origin, bounded JSON reads,
// refused-answer mapping that never quotes the upstream body (HTTP status or
// the `code` of Kie's 200 envelope), and accepted-job accounting. See
// ./config.js for the source attribution.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { KIE_ORIGIN, KIE_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** The selected connection's key, or null when it is missing or unusable as a header. */
export function kieToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return isString(token) && token.trim() && !/[\r\n]/.test(token) ? token : null;
}

export const kieSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Source headers (executors/kie.ts): createTask sends JSON, recordInfo only the key. */
export const kieSubmitHeaders = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
export const kieStatusHeaders = (token) => ({ Authorization: `Bearer ${token}` });

/** Accounting for a task Kie may have taken (and may bill) whose outcome is not known. */
export function kieAcceptedJob(modality, jobState = "accepted") {
  return { ...mediaAccounting(null, KIE_PROVIDER_ID, modality), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, modality, jobState) => ({ ...result, acceptedJob: kieAcceptedJob(modality, jobState) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`Kie ${what}`, status);

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedFetch(url, init, { signal, timeoutMs }) {
  if (signal?.aborted) throw Object.assign(new Error("aborted before send"), { name: "AbortError", notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });
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
  const pending = fetch(url, { ...init, signal: fetchSignal });
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

/** Whether a failed send provably never reached Kie. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused, never followed with the key. An answer from any
 * other origin means another host may have seen the work.
 *
 * @returns {null | { refused: true } | { foreign: true }}
 */
export function redirectState(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return { refused: true };
  }
  let answeredBy = KIE_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== KIE_ORIGIN) {
    discard(response);
    return { foreign: true };
  }
  return null;
}

/** Parse a bounded JSON object body. Throws a jobOutcomeUnknown error otherwise. */
export async function readJsonObject(response, { signal, timeoutMs, maxBytes, what }) {
  let text;
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes, timeoutMs: Math.max(1, timeoutMs), throwOnTimeout: true });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    throw unknownOutcome(`${what} could not be read`, error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (!isRecord(value)) throw unknownOutcome(`returned an unreadable ${what}`);
  return value;
}

// Delta-seconds or HTTP-date, in milliseconds.
export function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

/** Kie's envelope `code` when it is an HTTP-like integer other than 200, else null. */
export function envelopeCode(body) {
  const code = isRecord(body) ? body.code : undefined;
  return Number.isInteger(code) && code !== 200 && code >= 100 && code <= 599 ? code : null;
}

/**
 * A refusal by HTTP status or by a 200 envelope's `code`. Only the status and
 * a bounded Retry-After are kept; Kie's text (`msg`) is never quoted. A 5xx
 * may have come after Kie took the task, so its outcome is unknown and it
 * carries `acceptedJob`.
 */
export function refusal(status, { modality, label, secrets, retryAfter = null }) {
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Kie ${label} failed with ${status}; whether it was accepted is unknown`),
      modality,
      "submit-unknown"
    );
  }
  if (status === 402) {
    // Out of credits on this connection only; stays true until the owner tops up.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Kie refused ${label}: insufficient credits on this account`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `Kie refused the API key for ${label}`, undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `Kie rate limited ${label}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Kie refused the ${label} request with ${status}`, undefined, undefined, null, secrets);
}

/** A non-2xx, non-redirect answer. The body is drained unread past a bounded size. */
export async function refusedAnswer(response, { signal, timeoutMs, ...context }) {
  try {
    await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: Math.max(1, timeoutMs) });
  } catch {
    discard(response);
  }
  return refusal(response.status, { ...context, retryAfter: response.headers.get("retry-after") });
}
