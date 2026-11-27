// Transport for the staged ElevenLabs transcription adapter: one bounded,
// abortable POST to the fixed ElevenLabs origin through the connection's
// egress policy, redirect refusal, refused-answer mapping that never quotes
// the upstream body, and accepted-job accounting for answers whose outcome is
// not known. See ./config.js for the source attribution.
//
// The source sends once without a deadline. This stage bounds the request,
// refuses redirects, redacts upstream bodies, and never replays uncertain work.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { ELEVENLABS_PROVIDER_ID } from "./config.js";

const MODALITY = "stt";
const LABEL = "transcription";
const MAX_ERROR_BYTES = 16 * 1024;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** The selected connection's key, or null when it is missing or unusable as a header. */
export function elevenLabsToken(credentials) {
  const token = credentials?.apiKey || credentials?.accessToken;
  return isString(token) && token.trim() && !/[\r\n]/.test(token) ? token : null;
}

const secretsOf = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Accounting for transcription ElevenLabs may have done (and may bill) whose outcome is not known. */
export function elevenLabsSttAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, ELEVENLABS_PROVIDER_ID, MODALITY), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState = "accepted") => ({ ...result, acceptedJob: elevenLabsSttAcceptedJob(jobState) });

/** A caller input error: never the account's fault. */
export const invalid = (message) => ({ ...createErrorResult(HTTP_STATUS.BAD_REQUEST, message), local: true });

const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/**
 * One POST bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
async function boundedSend(url, init, { fetchImpl = proxyAwareFetch, credentials, signal, timeoutMs }) {
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
    fetchImpl(url, { ...init, redirect: "manual", noTransportReplay: true, signal: fetchSignal }, resolveCredentialProxyOptions(credentials)));
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

const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

function redirected(response) {
  if (response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return true;
  }
  return false;
}

/** A `Retry-After` value as rate-limit evidence, or null when absent or unusable. */
function retryAfterEvidence(retryAfter) {
  const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
  return evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
}

const unavailable = (secrets, retryAfter) => {
  const usable = retryAfterEvidence(retryAfter);
  return createErrorResult(503, `ElevenLabs is unavailable for ${LABEL}; whether it was processed is unknown`, usable?.resetAtMs, undefined, usable, secrets);
};

/**
 * A refused answer, by HTTP status. ElevenLabs's text is never quoted.
 *
 * Every post-dispatch 5xx may follow billable work and carries acceptedJob.
 */
export function elevenLabsSttRefusal(status, { secrets, retryAfter = null }) {
  if (status === 503) return withAcceptedJob(unavailable(secrets, retryAfter), "submit-unknown");
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `ElevenLabs ${LABEL} failed with ${status}; whether it was processed is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402) {
    // Billing refusal on this connection's key only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `ElevenLabs refused ${LABEL}: payment required on this account`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401) return createErrorResult(401, `ElevenLabs refused the API key for ${LABEL}`, undefined, undefined, null, secrets);
  if (status === 403) return createErrorResult(403, `ElevenLabs forbade the ${LABEL} request`, undefined, undefined, null, secrets);
  if (status === 429) {
    const usable = retryAfterEvidence(retryAfter);
    return createErrorResult(429, `ElevenLabs rate limited ${LABEL}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `ElevenLabs refused the ${LABEL} request with ${status}`, undefined, undefined, null, secrets);
}

async function refusedAnswer(response, { signal, secrets }) {
  try {
    await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: 2_000 });
  } catch {
    discard(response);
  }
  return elevenLabsSttRefusal(response.status, { secrets, retryAfter: response.headers.get("retry-after") });
}

/**
 * Send one request and classify everything that is not a readable 2xx.
 *
 * @returns {Promise<{ response, fetchSignal, timedOut, clear } | { failure: object }>}
 */
export async function sendOnce(url, init, { credentials, signal, timeoutMs, fetchImpl }) {
  const secrets = secretsOf(credentials);
  let sent;
  try {
    sent = await boundedSend(url, init, { fetchImpl, credentials, signal, timeoutMs });
  } catch (error) {
    if (provenUnsent(error)) {
      return { failure: signal?.aborted
        ? { ...createErrorResult(499, `ElevenLabs ${LABEL} request aborted; nothing was sent`), local: true }
        : createErrorResult(HTTP_STATUS.BAD_GATEWAY, `ElevenLabs ${LABEL} could not connect`) };
    }
    if (signal?.aborted) return { failure: withAcceptedJob(createErrorResult(499, `ElevenLabs ${LABEL} request aborted after it was sent`), "submit-unknown") };
    if (error?.name === "TimeoutError") {
      return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, `ElevenLabs ${LABEL} timed out; whether it was processed is unknown`), "submit-unknown") };
    }
    return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `ElevenLabs ${LABEL} failed after it was sent; whether it was processed is unknown`), "submit-unknown") };
  }
  const { response } = sent;
  if (redirected(response)) {
    sent.clear();
    return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `ElevenLabs ${LABEL} was redirected; the redirect was not followed`), "submit-unknown") };
  }
  if (!response.ok) {
    const failure = await refusedAnswer(response, { signal, secrets });
    sent.clear();
    return { failure };
  }
  return sent;
}

/** A 2xx whose body could not be used: the work was done, the result is lost. */
export const lostResult = (message, status = HTTP_STATUS.BAD_GATEWAY) =>
  withAcceptedJob(createErrorResult(status, `ElevenLabs ${LABEL} ${message}`), "accepted");
