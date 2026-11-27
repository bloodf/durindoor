// Transport for the staged Rev AI transcription adapter: one
// bounded, abortable request to the fixed Rev AI origin through the connection's
// egress policy, redirect refusal, refused-answer mapping that never quotes the
// upstream body, and accepted-job accounting for work whose outcome is not
// known. See ./config.js for the source attribution.
//
// The source (handleRevAiTranscription) sends each request with no deadline
// (besides the 120 s poll window), follows redirects and returns Rev AI's error text to the caller.
// Here every request is bounded by the caller's signal and a deadline, refuses
// redirects, is never retried when it could start billable work, and keeps
// only the HTTP status of a refusal.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { REVAI_MAX_JSON_BYTES, REVAI_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** The selected connection's key, or null when it is missing or unusable as a header. */
export function revaiToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return isString(token) && token.trim() && !/[\r\n]/.test(token) ? token : null;
}

export const revaiSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Accounting for work Rev AI may have done (and may bill) whose outcome is not known. */
export function revaiAcceptedJob(modality, jobState = "accepted", jobId = null) {
  return {
    ...mediaAccounting(null, REVAI_PROVIDER_ID, modality),
    costSource: "accepted-job",
    meta: { jobState, ...(jobId ? { jobId } : null) },
  };
}

export const withAcceptedJob = (result, modality, jobState = "accepted", jobId = null) =>
  ({ ...result, acceptedJob: revaiAcceptedJob(modality, jobState, jobId) });

/** A caller input error: never the account's fault. */
export const invalid = (message) => ({ ...createErrorResult(HTTP_STATUS.BAD_REQUEST, message), local: true });

const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
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

/** Whether a failed send provably never reached Rev AI. */
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
 * Attach accepted-job accounting only when the step could have started
 * billable work (`billable`). Status checks and transcript reads bill nothing.
 */
const maybeAccepted = (result, { billable, modality, jobState = "submit-unknown", jobId = null }) =>
  (billable ? withAcceptedJob(result, modality, jobState, jobId) : result);

/**
 * A refused answer, by HTTP status. Rev AI's text is never quoted. A 5xx other
 * than 503 may have come after Rev AI did the work, so for a billable step its
 * outcome is unknown and it carries `acceptedJob`.
 */
export function refusal(status, { modality, label, secrets, billable = true, retryAfter = null }) {
  if (status >= 500 && status !== 503) {
    return maybeAccepted(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Rev AI ${label} failed with ${status}; whether it was processed is unknown`),
      { billable, modality },
    );
  }
  if (status === 402) {
    // Out of balance on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Rev AI refused ${label}: insufficient balance on this account`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `Rev AI refused the API key for ${label}`, undefined, undefined, null, secrets);
  }
  if (status === 429 || status === 503) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(status, `Rev AI ${status === 429 ? "rate limited" : "is unavailable for"} ${label}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Rev AI refused the ${label} request with ${status}`, undefined, undefined, null, secrets);
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
 * Send one request and classify everything that is not a readable 2xx. Never
 * retried. `billable` says whether an uncertain outcome may have started work
 * Rev AI bills (the job submit) or not (status checks and transcript reads).
 *
 * @returns {Promise<{ response, fetchSignal, clear, timedOut } | { failure: object }>}
 */
export async function sendOnce(url, init, { modality, label, credentials, signal, timeoutMs, fetchImpl, billable = true }) {
  const secrets = revaiSecrets(credentials);
  let sent;
  try {
    sent = await boundedSend(url, init, { fetchImpl, credentials, signal, timeoutMs });
  } catch (error) {
    if (provenUnsent(error)) {
      return { failure: signal?.aborted
        ? { ...createErrorResult(499, `Rev AI ${label} request aborted; nothing was sent`), local: true }
        : createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Rev AI ${label} could not connect`) };
    }
    if (signal?.aborted) {
      return { failure: maybeAccepted(createErrorResult(499, `Rev AI ${label} request aborted after it was sent`), { billable, modality }) };
    }
    if (error?.name === "TimeoutError") {
      return { failure: maybeAccepted(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, `Rev AI ${label} timed out; whether it was processed is unknown`), { billable, modality }) };
    }
    return { failure: maybeAccepted(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Rev AI ${label} failed after it was sent; whether it was processed is unknown`), { billable, modality }) };
  }
  const { response } = sent;
  if (redirected(response)) {
    sent.clear();
    return { failure: maybeAccepted(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Rev AI ${label} was redirected; the redirect was not followed`), { billable, modality }) };
  }
  if (!response.ok) {
    const failure = await refusedAnswer(response, { signal, modality, label, secrets, billable });
    sent.clear();
    return { failure };
  }
  return sent;
}

/** Read a bounded JSON object from a 2xx answer; null when it is not one. Never quotes the body. */
export async function readJsonObject(response, { signal, maxBytes = REVAI_MAX_JSON_BYTES, timeoutMs = 10_000 }) {
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && !/(^application\/json$|\+json$)/.test(type)) {
    discard(response);
    return null;
  }
  let text;
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes, timeoutMs, throwOnTimeout: true });
  } catch {
    discard(response);
    return null;
  }
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    // The parser's message quotes the body, so it is dropped.
    return null;
  }
}

/** A 2xx whose body could not be used: Rev AI did (or is doing) the work, the result is lost. */
export const lostResult = (modality, label, message, status = HTTP_STATUS.BAD_GATEWAY, jobState = "accepted", jobId = null) =>
  withAcceptedJob(createErrorResult(status, `Rev AI ${label} ${message}`), modality, jobState, jobId);
