// Transport for the staged xAI video adapter: the selected connection's
// credential by auth mode, one bounded abortable fetch to the fixed xAI
// origin, redirect refusal, bounded JSON reads, refused-answer mapping that
// never quotes the upstream body, the public result-URL check and
// accepted-job accounting. See ./config.js for source attribution.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { XAI_AUTH_HEADER, XAI_AUTH_SCHEME, XAI_ORIGIN, XAI_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._ -]{0,63}$/;
const QUOTA_CODE_RE = /quota|balance|credit|spend|billing|insufficient/i;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
export const vendorCode = (value) => (isString(value) && CODE_RE.test(value.trim()) ? value.trim() : null);

/**
 * The selected connection's credential and its mode. An API-key connection
 * sends its `apiKey`, an OAuth connection its `accessToken`; a connection
 * without `authType` falls back to the source's `apiKey || accessToken`.
 * Returns null when the credential is missing or unusable as a header.
 *
 * @returns {{ token: string, mode: "apikey"|"oauth" } | null}
 */
export function xaiCredential(credentials) {
  const usable = (value) => (isString(value) && value.trim() && !/[\r\n]/.test(value) ? value.trim() : null);
  const authType = credentials?.authType;
  if (authType === "oauth") {
    const token = usable(credentials?.accessToken);
    return token ? { token, mode: "oauth" } : null;
  }
  if (authType === "apikey") {
    const token = usable(credentials?.apiKey);
    return token ? { token, mode: "apikey" } : null;
  }
  const apiKey = usable(credentials?.apiKey);
  if (apiKey) return { token: apiKey, mode: "apikey" };
  const accessToken = usable(credentials?.accessToken);
  return accessToken ? { token: accessToken, mode: "oauth" } : null;
}

export const xaiSecrets = (credentials) => ({
  apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, refreshToken: credentials?.refreshToken,
});

/** Source create headers: Bearer credential and a JSON body. */
export const xaiSubmitHeaders = (token) => ({ [XAI_AUTH_HEADER]: `${XAI_AUTH_SCHEME} ${token}`, "Content-Type": "application/json" });
/** Source status headers: the Bearer credential only. */
export const xaiPollHeaders = (token) => ({ [XAI_AUTH_HEADER]: `${XAI_AUTH_SCHEME} ${token}` });

/** Accounting for work xAI may have taken (and may bill) whose outcome is not known. Cost unknown. */
export function xaiAcceptedJob(jobState = "accepted", extraMeta = {}) {
  return { ...mediaAccounting(null, XAI_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState, ...extraMeta } };
}

export const withAcceptedJob = (result, jobState, extraMeta) => ({ ...result, acceptedJob: xaiAcceptedJob(jobState, extraMeta) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`xAI ${what}`, status);

const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedFetch(url, init, { signal, timeoutMs }) {
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

/** Whether a failed send provably never reached xAI. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused, never followed with the credential. An answer from
 * another origin means another host may have seen the work.
 *
 * @returns {null | { refused: true } | { foreign: true }}
 */
export function redirectState(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return { refused: true };
  }
  let answeredBy = XAI_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== XAI_ORIGIN) {
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

/** xAI error bodies carry `code` beside an `error` string, or `error: { code }`. */
export const xaiErrorCode = (body) => vendorCode(body?.code) ?? vendorCode(isRecord(body?.error) ? body.error.code : null) ?? vendorCode(body?.error?.type);

/**
 * A refused (non-2xx, non-redirect) create answer. Only the status, a vendor
 * code of a safe shape and a bounded Retry-After are kept; the upstream
 * `error`/`message` text (which the source passed through) is never quoted.
 * A 5xx may have come after xAI took the job, so its outcome is unknown and it
 * carries `acceptedJob`.
 */
export async function refusedAnswer(response, { signal, timeoutMs, secrets, now }) {
  const { status } = response;
  let code = null;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: Math.max(1, timeoutMs) });
    code = xaiErrorCode(JSON.parse(text));
  } catch {
    discard(response);
  }
  const suffix = code ? ` (${code})` : "";
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `xAI video create failed with ${status}${suffix}; whether it was accepted is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402 || ([400, 403, 429].includes(status) && code && QUOTA_CODE_RE.test(code))) {
    // Out of credit on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `xAI refused video generation for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return { ...createErrorResult(status, `xAI refused the credential for video generation${suffix}`, undefined, undefined, null, secrets), authFailed: true };
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `xAI rate limited video generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `xAI refused the video request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function xaiPublicUrl(raw) {
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
