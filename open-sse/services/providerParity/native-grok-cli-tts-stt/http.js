// Shared transport for the staged Grok CLI speech and transcription adapters:
// OAuth-only token selection, one bounded, abortable POST to the fixed
// api.x.ai origin through the connection's egress policy, redirect refusal,
// refused-answer mapping that never quotes the upstream body, and accepted-job
// accounting for answers whose outcome is not known. See ./config.js for the
// source attribution.
//
// The source (grokMedia.ts) sends each request once with AbortSignal.timeout,
// `redirect: "error"`, renews the token through a registered refresher and
// reuses a sanitized upstream error message. Here each request is sent once,
// never retried or replayed, is bounded by the caller's signal and a deadline
// that also covers the body, refuses redirects, keeps only the HTTP status of
// a refusal, and never renews: the route refreshes the connection before
// dispatch (see registration.json) and an expired token is refused unsent.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isString } from "../../../../src/shared/utils/typeChecks.js";
import { GROK_CLI_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/**
 * The selected connection's OAuth access token, or a 401 error result. Like
 * the source getGrokMediaToken, an API key is never used in its place, and an
 * expired or unparseable `expiresAt` is refused before anything is sent.
 *
 * @returns {{ token: string } | { failure: object }}
 */
export function grokOAuthToken(credentials, now = Date.now()) {
  const token = credentials?.accessToken;
  if (!isString(token) || !token.trim() || /[\r\n]/.test(token)) {
    return { failure: createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Grok CLI media needs the connection's OAuth access token") };
  }
  const expiresAt = credentials?.expiresAt;
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
    const at = isNumber(expiresAt) ? expiresAt : Date.parse(String(expiresAt));
    if (!Number.isFinite(at) || at <= now) {
      return { failure: createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Grok CLI OAuth access token has expired; refresh the connection") };
    }
  }
  return { token };
}

export const grokSecrets = (credentials) => ({
  apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, refreshToken: credentials?.refreshToken,
});

/** Accounting for work xAI may have done (and may bill) whose outcome is not known. */
export function grokAcceptedJob(modality, jobState = "accepted") {
  return { ...mediaAccounting(null, GROK_CLI_PROVIDER_ID, modality), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, modality, jobState = "accepted") => ({ ...result, acceptedJob: grokAcceptedJob(modality, jobState) });

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

const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

function redirected(response) {
  if (response.type === "opaqueredirect" || response.redirected || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return true;
  }
  return false;
}

/**
 * A refused answer, by HTTP status. xAI's text is never quoted. A 5xx other
 * than 503 may have come after the work was done, so its outcome is unknown
 * and it carries `acceptedJob`.
 */
export function grokRefusal(status, { modality, label, secrets, retryAfter = null }) {
  if (status >= 500 && status !== 503) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Grok CLI ${label} failed with ${status}; whether it was processed is unknown`),
      modality,
      "submit-unknown"
    );
  }
  if (status === 402) {
    // Out of credits on this connection's Grok account only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Grok CLI refused ${label}: insufficient credits on this account`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401) return createErrorResult(401, `Grok CLI refused the OAuth token for ${label}`, undefined, undefined, null, secrets);
  if (status === 403) return createErrorResult(403, `Grok CLI forbade the ${label} request for this account`, undefined, undefined, null, secrets);
  if (status === 429 || status === 503) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(status, `Grok CLI ${status === 429 ? "rate limited" : "is unavailable for"} ${label}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Grok CLI refused the ${label} request with ${status}`, undefined, undefined, null, secrets);
}

async function refusedAnswer(response, { signal, ...context }) {
  try {
    await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: 2_000 });
  } catch {
    discard(response);
  }
  return grokRefusal(response.status, { ...context, retryAfter: response.headers.get("retry-after") });
}

/**
 * Send one request and classify everything that is not a readable 2xx.
 *
 * @returns {Promise<{ response, fetchSignal, timedOut, clear } | { failure: object }>}
 */
export async function sendOnce(url, init, { modality, label, credentials, signal, timeoutMs, fetchImpl }) {
  const secrets = grokSecrets(credentials);
  let sent;
  try {
    sent = await boundedSend(url, init, { fetchImpl, credentials, signal, timeoutMs });
  } catch (error) {
    if (provenUnsent(error)) {
      return { failure: signal?.aborted
        ? { ...createErrorResult(499, `Grok CLI ${label} request aborted; nothing was sent`), local: true }
        : createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Grok CLI ${label} could not connect`) };
    }
    if (signal?.aborted) return { failure: withAcceptedJob(createErrorResult(499, `Grok CLI ${label} request aborted after it was sent`), modality, "submit-unknown") };
    if (error?.name === "TimeoutError") {
      return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, `Grok CLI ${label} timed out; whether it was processed is unknown`), modality, "submit-unknown") };
    }
    return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Grok CLI ${label} failed after it was sent; whether it was processed is unknown`), modality, "submit-unknown") };
  }
  const { response } = sent;
  if (redirected(response)) {
    sent.clear();
    return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Grok CLI ${label} was redirected; the redirect was not followed`), modality, "submit-unknown") };
  }
  if (!response.ok) {
    const failure = await refusedAnswer(response, { signal, modality, label, secrets });
    sent.clear();
    return { failure };
  }
  return sent;
}

/** A 2xx whose body could not be used: the work was done, the result is lost. */
export const lostResult = (modality, label, message, status = HTTP_STATUS.BAD_GATEWAY) =>
  withAcceptedJob(createErrorResult(status, `Grok CLI ${label} ${message}`), modality, "accepted");
