// Transport for the staged Bedrock embeddings adapter: one bounded, abortable
// request to the fixed Bedrock origin, redirect refusal, refused-answer mapping
// that never quotes the upstream body, and accepted-work accounting. See
// ./config.js for source attribution.
import { createErrorResult, parseRateLimitEvidence } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { BEDROCK_AUTH_HEADER, BEDROCK_AUTH_SCHEME, BEDROCK_ORIGIN, BEDROCK_PROVIDER_ID } from "./config.js";

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** The selected connection's key (source: `apiKey || accessToken`), or null when missing or unusable as a header. */
export function bedrockToken(credentials) {
  const token = [credentials?.apiKey, credentials?.accessToken].find((value) => isString(value) && value.trim());
  return token && !/[\r\n]/.test(token) ? token : null;
}

export const bedrockSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Source headers: JSON body and a Bearer key. */
export const bedrockHeaders = (token) => ({ "Content-Type": "application/json", [BEDROCK_AUTH_HEADER]: `${BEDROCK_AUTH_SCHEME} ${token}` });

/** Accounting for work Bedrock may have done (and may bill) whose result is not usable. Cost unknown. */
export function bedrockAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, BEDROCK_PROVIDER_ID, "embedding"), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: bedrockAcceptedJob(jobState) });

const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedFetch(send, url, init, { signal, timeoutMs }) {
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
  const pending = Promise.resolve().then(() => send(url, { ...init, signal: fetchSignal }));
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

/** Whether a failed send provably never reached Bedrock. */
export const provenUnsent = (error) =>
  error?.notSent === true || error?.name === "OutboundUrlGuardError" || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused, never followed with the key. An answer from another
 * origin means another host may have seen the work.
 *
 * @returns {null | { refused: true } | { foreign: true }}
 */
export function redirectState(response, origin = BEDROCK_ORIGIN) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return { refused: true };
  }
  let answeredBy = origin;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== origin) {
    discard(response);
    return { foreign: true };
  }
  return null;
}

/**
 * A refused (non-2xx, non-redirect) answer. Only the status and a bounded
 * Retry-After are kept; the upstream body is never read into the message (the
 * source relayed it verbatim). A 5xx may have come after the work ran, so its
 * outcome is unknown and it carries `acceptedJob`.
 */
export function refusedAnswer(response, { secrets, now }) {
  const { status } = response;
  const retryAfter = response.headers.get("retry-after") ?? "";
  discard(response);
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Bedrock embeddings failed with ${status}; whether it ran is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402) {
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "Bedrock refused embeddings for this account (payment required)", undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, "Bedrock refused the API key for embeddings", undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter }), now: now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "Bedrock rate limited embeddings", usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Bedrock refused the embeddings request with ${status}`, undefined, undefined, null, secrets);
}
