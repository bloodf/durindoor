// Transport for the staged Grok CLI video adapter: the selected connection's
// OAuth token and the source Grok media headers, one bounded and abortable
// fetch to the fixed cli-chat-proxy origin, redirect refusal, bounded JSON
// reads, refused-answer mapping that never quotes the upstream body, the result
// URL check and accepted-job accounting. See ./config.js for the source
// attribution.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER, GROK_CLI_CLIENT_MODE, GROK_CLI_CLIENT_VERSION, GROK_CLI_ORIGIN, GROK_CLI_PROVIDER_ID,
  GROK_CLI_TOKEN_AUTH, GROK_CLI_USER_AGENT,
} from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const QUOTA_CODE_RE = /quota|balance|credit|insufficient|spending|limit-reached/i;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/**
 * The selected connection's OAuth access token, as the source's
 * getGrokMediaToken required it: present, usable as a header, and not past a
 * readable `expiresAt`. Refresh belongs to the route (before dispatch), so the
 * selected connection stays the one that is billed. `apiKey` is never read.
 *
 * @returns {{ token: string } | { error: string }}
 */
export function grokCliToken(credentials, now = Date.now()) {
  const token = credentials?.accessToken;
  if (!isString(token) || !token.trim() || /[\r\n]/.test(token)) return { error: "Grok OAuth access token is required" };
  if (credentials?.expiresAt !== undefined && credentials?.expiresAt !== null) {
    const expiresAt = isString(credentials.expiresAt) ? Date.parse(credentials.expiresAt) : Number(credentials.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return { error: "Grok OAuth access token could not be renewed" };
  }
  return { token };
}

export const grokCliSecrets = (credentials) => ({
  accessToken: credentials?.accessToken, refreshToken: credentials?.refreshToken, apiKey: credentials?.apiKey,
});

/** Source grokMediaHeaders(token): Grok Build client identity, token-auth marker and Bearer token. */
export const grokCliMediaHeaders = (token) => ({
  "x-grok-client-version": GROK_CLI_CLIENT_VERSION,
  "x-grok-client-identifier": GROK_CLI_CLIENT_IDENTIFIER,
  "x-grok-client-mode": GROK_CLI_CLIENT_MODE,
  "User-Agent": GROK_CLI_USER_AGENT,
  "X-XAI-Token-Auth": GROK_CLI_TOKEN_AUTH,
  Authorization: `Bearer ${token}`,
});
/** Source create headers: media headers plus a JSON body. */
export const grokCliSubmitHeaders = (token) => ({ ...grokCliMediaHeaders(token), "Content-Type": "application/json" });
/** Source poll headers: the media headers only. */
export const grokCliPollHeaders = (token) => grokCliMediaHeaders(token);

/** Accounting for work the proxy may have taken (and may bill) whose outcome is not known. Cost unknown. */
export function grokCliAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, GROK_CLI_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: grokCliAcceptedJob(jobState) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`Grok CLI ${what}`, status);

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

/** Whether a failed send provably never reached the proxy. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused, never followed with the token. An answer from another
 * origin means another host may have seen the work.
 *
 * @returns {null | { refused: true } | { foreign: true }}
 */
export function redirectState(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return { refused: true };
  }
  let answeredBy = GROK_CLI_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== GROK_CLI_ORIGIN) {
    discard(response);
    return { foreign: true };
  }
  return null;
}

/** Parse a bounded JSON object body. Throws a jobOutcomeUnknown error otherwise. */
export async function readJsonObject(response, { signal, timeoutMs, maxBytes, what }) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response);
    throw unknownOutcome(`${what} exceeded ${maxBytes} bytes`);
  }
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
 * A refused (non-2xx, non-redirect) create answer. Only the status, a vendor
 * `code` of a safe shape and a bounded Retry-After are kept; the upstream
 * `error.message` / `message` (which the source returned, sanitized) is never
 * quoted. A 5xx may have come after the proxy took the job, so its outcome is
 * unknown and it carries `acceptedJob`. A 402 (the chat executor's
 * `personal-team-blocked:spending-limit`) is quota on this connection only.
 */
export async function refusedAnswer(response, { signal, timeoutMs, secrets, now }) {
  const { status } = response;
  let code = null;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: Math.max(1, timeoutMs) });
    const body = JSON.parse(text);
    code = vendorCode(body?.code) ?? vendorCode(body?.error?.code) ?? vendorCode(body?.error?.type);
  } catch {
    discard(response);
  }
  const suffix = code ? ` (${code})` : "";
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Grok CLI video create failed with ${status}${suffix}; whether it was accepted is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402 || ([400, 403, 429].includes(status) && code && QUOTA_CODE_RE.test(code))) {
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Grok CLI refused video generation for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `Grok CLI refused the OAuth token for video generation${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `Grok CLI rate limited video generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Grok CLI refused the video request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function grokCliPublicUrl(raw) {
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
