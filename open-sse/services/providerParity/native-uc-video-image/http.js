// Shared transport for the staged UC Direct image and video adapters: one
// bounded, abortable fetch to the fixed UC Direct origin, manual redirect
// refusal, bounded body reads, refused-answer mapping that never quotes the
// upstream body, result URL checks, and accepted-job accounting. Source
// attribution is in ./config.js.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { UC_AUTH_HEADER, UC_KEY_PREFIX, UC_ORIGIN, UC_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const QUOTA_CODE_RE = /quota|balance|credit|funds|insufficient|billing|payment/i;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/**
 * The selected connection's developer key, or null. The source routes only a
 * `uai_` key to the metered REST surface; any other credential would go to the
 * persona surface, which is not staged. `accessToken` is never used: UC Direct
 * has no OAuth mode.
 */
export function ucToken(credentials) {
  const token = isString(credentials?.apiKey) ? credentials.apiKey.trim() : "";
  return token.startsWith(UC_KEY_PREFIX) && token.length > UC_KEY_PREFIX.length && !/[\s\r\n]/.test(token) ? token : null;
}

export const ucSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Source submit headers: `X-api-key` (exact casing) plus JSON; never Bearer. */
export const ucJsonHeaders = (token) => ({ [UC_AUTH_HEADER]: token, "Content-Type": "application/json" });
/** Source status-poll headers: the key only. */
export const ucReadHeaders = (token) => ({ [UC_AUTH_HEADER]: token });

/** Accounting for work UC may have taken (and may bill) whose outcome is not known. */
export function ucAcceptedJob(modality, jobState = "accepted", jobId = null) {
  const base = mediaAccounting(null, UC_PROVIDER_ID, modality);
  return { ...base, costSource: "accepted-job", meta: { jobState, ...(jobId ? { jobId } : {}) } };
}

export const withAcceptedJob = (result, modality, jobState, jobId) => ({ ...result, acceptedJob: ucAcceptedJob(modality, jobState, jobId) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`UC Direct ${what}`, status);

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

/** Whether a failed send provably never reached UC. */
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
  let answeredBy = UC_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== UC_ORIGIN) {
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

/**
 * A refused (non-2xx, non-redirect) submit answer, mapped per the source REST
 * error contract: 402 out of funds (this connection only), 403 moderation or
 * key scope, 429 rate limit with Retry-After. Only the status, a vendor code
 * of a safe shape and a bounded Retry-After are kept; the upstream text is
 * never quoted. A 5xx may have come after UC took the work, so its outcome is
 * unknown and it carries `acceptedJob`.
 */
export async function refusedAnswer(response, { modality, label, signal, timeoutMs, secrets }) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  let code = null;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: Math.max(1, timeoutMs) });
    const body = JSON.parse(text);
    code = vendorCode(body?.error?.code) ?? vendorCode(body?.code) ?? vendorCode(body?.error?.type);
  } catch {
    discard(response);
  }
  const suffix = code ? ` (${code})` : "";
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `UC Direct ${label} failed with ${status}${suffix}; whether it was accepted is unknown`),
      modality,
      "submit-unknown"
    );
  }
  if (status === 402 || ([400, 403, 429].includes(status) && code && QUOTA_CODE_RE.test(code))) {
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `UC Direct refused ${label} for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401) {
    return createErrorResult(401, `UC Direct refused the API key for ${label}${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 403) {
    return createErrorResult(403, `UC Direct refused ${label} (moderation or key scope)${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `UC Direct rate limited ${label}${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `UC Direct refused the ${label} request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/** An https URL on a public literal host without userinfo, or null. Never fetched here. */
export function ucPublicUrl(raw) {
  if (!isString(raw) || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  return url.href;
}
