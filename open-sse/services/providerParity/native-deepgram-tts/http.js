// Shared transport for the staged Deepgram speech adapter and its model
// discovery: one bounded, abortable request to the fixed Deepgram origin through
// the connection's egress policy, redirect refusal, refused-answer mapping that
// never quotes the upstream body, and accepted-job accounting for answers whose
// outcome is not known. See ./config.js for the source attribution.
//
// The source (handleDeepgramSpeech) sends each request once with no deadline,
// follows redirects and hands Deepgram's JSON error message to the caller. Here
// each request is sent once, never retried or replayed, is bounded by the
// caller's signal and a deadline, refuses redirects, and keeps only the HTTP
// status of a refusal.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { DEEPGRAM_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** The selected connection's key (source: apiKey || accessToken), or null when it is missing or unusable as a header. */
export function deepgramToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return isString(token) && token.trim() && !/[\r\n]/.test(token) ? token : null;
}

export const deepgramSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Accounting for work Deepgram may have done (and may bill) whose outcome is not known. */
export function deepgramAcceptedJob(modality, jobState = "accepted") {
  return { ...mediaAccounting(null, DEEPGRAM_PROVIDER_ID, modality), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, modality, jobState = "accepted") => ({ ...result, acceptedJob: deepgramAcceptedJob(modality, jobState) });

/** acceptedJob only on billable work; a free read (model discovery) never carries one. */
const maybeAccepted = (result, modality, jobState, billable) => (billable ? withAcceptedJob(result, modality, jobState) : result);

/** A caller input error: never the account's fault. */
export const invalid = (message) => ({ ...createErrorResult(HTTP_STATUS.BAD_REQUEST, message), local: true });

const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/**
 * One POST bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedSend(url, init, { fetchImpl = proxyAwareFetch, credentials, signal, timeoutMs }) {
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
  const pending = Promise.resolve().then(() =>
    fetchImpl(url, { ...init, redirect: "manual", signal: fetchSignal }, resolveCredentialProxyOptions(credentials)));
  let delivered = null;
  try {
    delivered = await Promise.race([pending, bound]);
    return { response: delivered, fetchSignal, timedOut: () => timedOut, clear: () => clearTimeout(timer) };
  } catch (error) {
    clearTimeout(timer);
    if (timedOut) throw timeoutError();
    throw error;
  } finally {
    fetchSignal.removeEventListener("abort", stopWaiting);
    bound.catch(() => {});
    if (!delivered) pending.then(discard, () => {});
  }
}

/** Whether a failed send provably never reached Deepgram. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/** A redirect is refused, never followed with the key. */
export function redirected(response) {
  if (response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return true;
  }
  return false;
}

/**
 * A refused answer, by HTTP status. Deepgram's text is never quoted. A 5xx other
 * than 503 may have come after Deepgram did the work, so its outcome is unknown
 * and, for billable work, it carries `acceptedJob`. A 503 keeps its status and a
 * bounded Retry-After for the selected account's health, and for billable work
 * also carries `acceptedJob`: Deepgram's error reference only says a 503 means
 * the server "isn't ready to handle the request" (maintenance or overload) and
 * no Deepgram document says a 503 did no work or is not billed (TTS bills per
 * input character), so it is never treated as safe to replay on another
 * account. Discovery (`billable: false`) stays a plain 503.
 * See internal/docs/port-reports/native-deepgram-tts.md.
 */
export function refusal(status, { modality, label, secrets, retryAfter = null, billable = true }) {
  if (status >= 500 && status !== 503) {
    return maybeAccepted(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Deepgram ${label} failed with ${status}; whether it was processed is unknown`),
      modality,
      "submit-unknown",
      billable
    );
  }
  if (status === 402) {
    // Out of balance on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Deepgram refused ${label}: insufficient balance on this account`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `Deepgram refused the API key for ${label}`, undefined, undefined, null, secrets);
  }
  if (status === 429 || status === 503) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    const failed = createErrorResult(status, `Deepgram ${status === 429 ? "rate limited" : "is unavailable for"} ${label}`, usable?.resetAtMs, undefined, usable, secrets);
    return status === 503 ? maybeAccepted(failed, modality, "submit-unknown", billable) : failed;
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Deepgram refused the ${label} request with ${status}`, undefined, undefined, null, secrets);
}

/** A non-2xx, non-redirect answer. The body is drained unread past a bounded size. */
export async function refusedAnswer(response, { signal, ...context }) {
  try {
    await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: 2_000 });
  } catch {
    discard(response);
  }
  return refusal(response.status, { ...context, retryAfter: response.headers.get("retry-after") });
}

/**
 * Send one request and classify everything that is not a readable 2xx.
 *
 * @returns {Promise<{ response, fetchSignal, clear } | { failure: object }>}
 */
export async function sendOnce(url, init, { modality, label, credentials, signal, timeoutMs, fetchImpl, billable = true }) {
  const secrets = deepgramSecrets(credentials);
  let sent;
  try {
    sent = await boundedSend(url, init, { fetchImpl, credentials, signal, timeoutMs });
  } catch (error) {
    if (provenUnsent(error)) {
      return { failure: signal?.aborted
        ? { ...createErrorResult(499, `Deepgram ${label} request aborted; nothing was sent`), local: true }
        : createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Deepgram ${label} could not connect`) };
    }
    if (signal?.aborted) return { failure: maybeAccepted(createErrorResult(499, `Deepgram ${label} request aborted after it was sent`), modality, "submit-unknown", billable) };
    if (error?.name === "TimeoutError") {
      return { failure: maybeAccepted(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, `Deepgram ${label} timed out; whether it was processed is unknown`), modality, "submit-unknown", billable) };
    }
    return { failure: maybeAccepted(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Deepgram ${label} failed after it was sent; whether it was processed is unknown`), modality, "submit-unknown", billable) };
  }
  const { response } = sent;
  if (redirected(response)) {
    sent.clear();
    return { failure: maybeAccepted(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Deepgram ${label} was redirected; the redirect was not followed`), modality, "submit-unknown", billable) };
  }
  if (!response.ok) {
    const failure = await refusedAnswer(response, { signal, modality, label, secrets, billable });
    sent.clear();
    return { failure };
  }
  return sent;
}

/** A 2xx whose body could not be used: Deepgram did the work, the result is lost. */
export const lostResult = (modality, label, message, status = HTTP_STATUS.BAD_GATEWAY) =>
  withAcceptedJob(createErrorResult(status, `Deepgram ${label} ${message}`), modality, "accepted");
