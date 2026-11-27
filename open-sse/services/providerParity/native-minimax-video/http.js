// Transport for the staged MiniMax video adapter: one bounded, abortable fetch
// to the fixed MiniMax origin, redirect refusal, bounded JSON reads,
// `base_resp` refusal mapping that never quotes the upstream body, the result
// URL check and accepted-job accounting. See ./config.js for source attribution.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  MINIMAX_AUTH_HEADER, MINIMAX_AUTH_SCHEME, MINIMAX_ORIGIN, MINIMAX_PROVIDER_ID, MINIMAX_REFUSAL_CODES,
} from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/**
 * The selected connection's key, or null when it is missing or unusable as a
 * header. The source read `apiKey || accessToken`; both are kept.
 */
export function minimaxToken(credentials) {
  const token = [credentials?.apiKey, credentials?.accessToken].find((value) => isString(value) && value.trim());
  return token && !/[\r\n]/.test(token) ? token : null;
}

export const minimaxSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Source create headers: Bearer key and a JSON body. */
export const minimaxSubmitHeaders = (token) => ({ [MINIMAX_AUTH_HEADER]: `${MINIMAX_AUTH_SCHEME} ${token}`, "Content-Type": "application/json" });
/** Source query and file headers: the Bearer key only. */
export const minimaxPollHeaders = (token) => ({ [MINIMAX_AUTH_HEADER]: `${MINIMAX_AUTH_SCHEME} ${token}` });

/** Accounting for work MiniMax may have taken (and may bill) whose outcome is not known. Cost unknown. */
export function minimaxAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, MINIMAX_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: minimaxAcceptedJob(jobState) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`MiniMax ${what}`, status);

/** The numeric `base_resp.status_code`, 0 when absent, or null when present but not an integer. */
export function baseRespCode(answer) {
  const baseResp = isRecord(answer) ? answer.base_resp : undefined;
  if (baseResp === undefined || baseResp === null) return 0;
  if (!isRecord(baseResp)) return null;
  const raw = baseResp.status_code;
  if (raw === undefined || raw === null) return 0;
  const code = isString(raw) && /^\d{1,9}$/.test(raw) ? Number(raw) : raw;
  return Number.isSafeInteger(code) ? code : null;
}

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

/** Whether a failed send provably never reached MiniMax. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused, never followed with the key. An answer from another
 * origin means another host may have seen the work.
 *
 * @returns {null | { refused: true } | { foreign: true }}
 */
export function redirectState(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return { refused: true };
  }
  let answeredBy = MINIMAX_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== MINIMAX_ORIGIN) {
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
 * A refusal MiniMax stated, by HTTP status and/or `base_resp.status_code`.
 * Returns null when neither says the work was refused. Only the status and the
 * numeric code are kept; `status_msg` (which the source quoted) never is.
 */
export function minimaxRefusal({ status = 200, code = 0, retryAfter = null, secrets, now }) {
  const mapped = code ? MINIMAX_REFUSAL_CODES[code] : undefined;
  const suffix = code ? ` (code ${code})` : "";
  if (status === 402 || mapped === 402) {
    // Out of balance on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `MiniMax refused video generation for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403 || mapped === 401) {
    return createErrorResult(status === 403 ? 403 : 401, `MiniMax refused the API key for video generation${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 429 || mapped === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `MiniMax rate limited video generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  if (mapped === 400 || (status >= 400 && status < 500)) {
    return createErrorResult(status >= 400 && status < 500 ? status : 400, `MiniMax refused the video request${status !== 200 ? ` with ${status}` : ""}${suffix}`, undefined, undefined, null, secrets);
  }
  return null;
}

/**
 * A refused (non-2xx, non-redirect) submit answer. A 5xx, or a status without
 * a known refusal, may have come after MiniMax took the task, so its outcome is
 * unknown and it carries `acceptedJob`.
 */
export async function refusedAnswer(response, { signal, timeoutMs, secrets, now }) {
  const { status } = response;
  let code = 0;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: Math.max(1, timeoutMs) });
    code = baseRespCode(JSON.parse(text)) ?? 0;
  } catch {
    discard(response);
  }
  if (status < 500) {
    const refusal = minimaxRefusal({ status, code, retryAfter: response.headers.get("retry-after"), secrets, now });
    if (refusal) return refusal;
  }
  const suffix = code ? ` (code ${code})` : "";
  return withAcceptedJob(
    createErrorResult(HTTP_STATUS.BAD_GATEWAY, `MiniMax video submit failed with ${status}${suffix}; whether it was accepted is unknown`),
    "submit-unknown"
  );
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function minimaxPublicUrl(raw) {
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
