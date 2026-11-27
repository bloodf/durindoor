// Transport for the staged OpenRouter video adapter: one bounded, abortable
// fetch to the fixed OpenRouter origin, bounded body reads, refused-answer
// mapping that never quotes the upstream body, the content URL check and
// accepted-job accounting. Adapted from the staged deAPI video transport
// (../native-deapi-video-image/http.js). See ./config.js for the source.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { OPENROUTER_API_PATH, OPENROUTER_ORIGIN, OPENROUTER_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const QUOTA_CODE_RE = /quota|balance|credit|insufficient|billing|payment/i;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/** The selected connection's key, or null when it is missing or unusable as a header. */
export function openrouterToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return isString(token) && token.trim() && !/[\r\n]/.test(token) ? token : null;
}

export const openrouterSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/**
 * The source's headers (job.ts buildJobHeaders) for every leg: submit, status
 * and content download all carry `Content-Type: application/json` and the
 * bearer key. The content route 401s without the key. The registry's chat
 * `HTTP-Referer` / `X-Title` headers were never sent on video.
 */
export const openrouterHeaders = (token) => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });

/** Accounting for work OpenRouter may have taken (and may bill) whose outcome is not known. */
export function openrouterAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, OPENROUTER_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: openrouterAcceptedJob(jobState) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`OpenRouter ${what}`, status);

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 * `deadlineSignal` is returned so a caller can bound the body read the same way.
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

/** Whether a failed send provably never reached OpenRouter. */
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
  let answeredBy = OPENROUTER_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== OPENROUTER_ORIGIN) {
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

/**
 * Read at most `maxBytes` of a binary body within `timeoutMs`. Throws a
 * TimeoutError, the caller's AbortError, or an Error tagged `tooLarge`; the
 * stream is cancelled in every one of those cases.
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
    timer = setTimeout(() => rejectRead(Object.assign(new Error("body read timed out"), { name: "TimeoutError" })), Math.max(1, timeoutMs));
    onAbort = () => rejectRead(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
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

// Delta-seconds or HTTP-date, in milliseconds.
export function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

/**
 * A refused (non-2xx, non-redirect) submit answer. Only the status, a vendor
 * code of a safe shape (OpenAI-style `error.code`/`error.type`, or a top-level
 * `code`) and a bounded Retry-After are kept; the upstream text is never
 * quoted. A 5xx may have come after OpenRouter took the work, so its outcome is
 * unknown and it carries `acceptedJob`.
 */
export async function refusedAnswer(response, { label, signal, timeoutMs, secrets }) {
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
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `OpenRouter ${label} failed with ${status}${suffix}; whether it was accepted is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402 || ([400, 403, 429].includes(status) && code && QUOTA_CODE_RE.test(code))) {
    // Out of balance on this connection only; stays true until the owner tops up.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `OpenRouter refused ${label} for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `OpenRouter refused the API key for ${label}${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `OpenRouter rate limited ${label}${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `OpenRouter refused the ${label} request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/**
 * The finished clip's content URL, or null. The source fetched the first
 * `unsigned_urls` entry with the key only when it was on the provider origin;
 * here it must also be https without userinfo, on a public host, and exactly
 * `/api/v1/videos/{id}/content` for this job, with at most an `index` query.
 */
export function openrouterContentUrl(raw, jobId) {
  if (!isString(raw) || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.origin !== OPENROUTER_ORIGIN || isBlockedHost(url.hostname)) return null;
  if (url.pathname !== `${OPENROUTER_API_PATH}/videos/${encodeURIComponent(jobId)}/content` || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== "index") || keys.length > 1) return null;
  if (keys.length && !/^\d{1,3}$/.test(url.searchParams.get("index"))) return null;
  return url.href;
}
