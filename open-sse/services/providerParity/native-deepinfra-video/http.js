// Transport for the staged DeepInfra video adapter: one bounded, abortable
// fetch to the fixed DeepInfra origin, redirect refusal, bounded body reads,
// refused-answer mapping that never quotes the upstream body, result URL
// checks and accepted-work accounting. See ./config.js for source attribution.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { DEEPINFRA_AUTH_HEADER, DEEPINFRA_AUTH_SCHEME, DEEPINFRA_ORIGIN, DEEPINFRA_PROVIDER_ID } from "./config.js";

const MAX_URL_LENGTH = 4096;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/**
 * The selected connection's key, or null when it is missing or unusable as a
 * header. The source read `apiKey || accessToken`; both are kept.
 */
export function deepinfraToken(credentials) {
  const token = [credentials?.apiKey, credentials?.accessToken].find((value) => isString(value) && value.trim());
  return token && !/[\r\n]/.test(token) ? token : null;
}

export const deepinfraSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Source headers: Bearer key and a JSON body. */
export const deepinfraHeaders = (token) => ({ [DEEPINFRA_AUTH_HEADER]: `${DEEPINFRA_AUTH_SCHEME} ${token}`, "Content-Type": "application/json" });

/** Accounting for work DeepInfra may have done (and may bill) whose result is not usable. Cost unknown. */
export function deepinfraAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, DEEPINFRA_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: deepinfraAcceptedJob(jobState) });

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

/** Whether a failed send provably never reached DeepInfra. */
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
  let answeredBy = DEEPINFRA_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== DEEPINFRA_ORIGIN) {
    discard(response);
    return { foreign: true };
  }
  return null;
}

/**
 * A refused (non-2xx, non-redirect) answer. Only the status and a bounded
 * Retry-After are kept; the upstream body (DeepInfra's `detail`) is never read
 * into the message. A 5xx may have come after the render, so its outcome is
 * unknown and it carries `acceptedJob`.
 */
export function refusedAnswer(response, { secrets, now }) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `DeepInfra video generation failed with ${status}; whether it ran is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402) {
    // Out of balance on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "DeepInfra refused video generation for this account (payment required)", undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, "DeepInfra refused the API key for video generation", undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "DeepInfra rate limited video generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `DeepInfra refused the video request with ${status}`, undefined, undefined, null, secrets);
}

/** An https result URL on a public literal host without userinfo, or null. Never fetched here. */
export function deepinfraPublicUrl(raw) {
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
