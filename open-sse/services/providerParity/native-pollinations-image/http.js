// Shared transport for the staged Pollinations image adapter: one bounded,
// abortable fetch to the fixed Pollinations origin, bounded body reads, refused-answer
// mapping that never quotes the upstream body, result URL checks, and
// accepted-job accounting. See ./config.js for the source attribution.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown } from "../../../handlers/imageProviders/_base.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { POLLINATIONS_ORIGIN, POLLINATIONS_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const QUOTA_CODE_RE = /quota|balance|credit|insufficient|arrear/i;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

// Routing placeholders that stand for "no key", never an upstream secret: the
// public no-auth credential (src/sse/services/auth.js buildNoAuthCredential)
// and the same set open-sse/executors/pollinations.js skips for chat.
const PLACEHOLDER_KEYS = new Set(["public", "sk_durindoor"]);

/**
 * How the selected connection authenticates.
 *
 * @returns {{ mode: "apikey", token: string } | { mode: "anonymous" } | { mode: "invalid" }}
 */
export function pollinationsAuth(credentials) {
  const publicFallback = credentials?.id === "noauth" || credentials?.connectionId === "noauth";
  const token = credentials?.apiKey || credentials?.accessToken;
  if (publicFallback || token === undefined || token === null || token === "" || PLACEHOLDER_KEYS.has(token)) return { mode: "anonymous" };
  if (!isString(token) || !token.trim() || /[\r\n]/.test(token)) return { mode: "invalid" };
  return { mode: "apikey", token };
}

export const pollinationsSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/**
 * The source's header set: JSON body, and the selected key as a Bearer token
 * when there is one. A keyless request carries no Authorization header.
 */
export const pollinationsHeaders = (auth) =>
  auth.mode === "apikey" ? { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` } : { "Content-Type": "application/json" };

/** Accounting for work Pollinations may have taken (and may bill) whose outcome is not known. */
export function pollinationsAcceptedJob(modality, jobState = "accepted", authScope = "apikey") {
  return { ...mediaAccounting(null, POLLINATIONS_PROVIDER_ID, modality), costSource: "accepted-job", meta: { jobState, authScope } };
}

export const withAcceptedJob = (result, modality, jobState, authScope) => ({ ...result, acceptedJob: pollinationsAcceptedJob(modality, jobState, authScope) });

export const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`Pollinations ${what}`, status);

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

/** Whether a failed send provably never reached Pollinations. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused, never followed with the key (nothing was accepted).
 * An answer from any other origin means another host may have seen the work.
 *
 * @returns {null | { refused: true } | { foreign: true }}
 */
export function redirectState(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return { refused: true };
  }
  let answeredBy = POLLINATIONS_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== POLLINATIONS_ORIGIN) {
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
 * A refused (non-2xx, non-redirect) answer. Only the status, a vendor code of
 * a safe shape and a bounded Retry-After are kept; the upstream text is never
 * quoted. A 5xx may have come after Pollinations took the work, so its outcome is
 * unknown and it carries `acceptedJob`.
 */
export async function refusedAnswer(response, { modality, label, signal, timeoutMs, secrets, anonymous = false }) {
  const authScope = anonymous ? "anonymous" : "apikey";
  const { status } = response;
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
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Pollinations ${label} failed with ${status}${suffix}; whether it was accepted is unknown`),
      modality,
      "submit-unknown",
      authScope
    );
  }
  if (anonymous && [401, 402, 403].includes(status)) {
    // Keyless traffic has no account to exhaust or rotate; a key is the only fix.
    return createErrorResult(401, `Pollinations requires an API key for ${label}${suffix}`);
  }
  if (!anonymous && (status === 402 || ([403, 429].includes(status) && code && QUOTA_CODE_RE.test(code)))) {
    // Out of pollen on this connection only; stays true until the owner tops up.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Pollinations refused ${label} for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `Pollinations refused the API key for ${label}${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `Pollinations rate limited ${label}${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Pollinations refused the ${label} request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function pollinationsPublicUrl(raw) {
  if (!isString(raw) || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  return url.href;
}
