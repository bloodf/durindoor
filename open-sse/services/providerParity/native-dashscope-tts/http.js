// Transport for the staged Qwen Cloud Token Plan (DashScope) speech adapter:
// one bounded, abortable POST to the fixed SpeechSynthesizer URL through the
// connection's egress policy, redirect refusal, refused-answer mapping that
// keeps only the HTTP status and a vendor code of a safe shape, and
// accepted-job accounting for answers whose outcome is not known. Same
// contract as the staged Xiaomi MiMo speech transport
// (native-xiaomi-tts/http.js). See ./config.js for the source attribution.
//
// The source (handleDashscopeTtsSpeech) sends the request once with a bare
// fetch, no deadline, follows redirects, honors a connection-supplied base URL
// and region, and forwards a sanitized upstream error body. Here the request is
// sent once, never retried or replayed, is bounded by the caller's signal and
// a deadline, refuses redirects, and never quotes upstream text.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import { DASHSCOPE_TTS_PROVIDER_ID } from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
/** DashScope unpaid-account codes (services/accountFallback.js DASHSCOPE_UNPAID_CODES). */
const UNPAID_CODES = new Set(["arrearage", "accessdenied.unpurchased"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** A DashScope vendor code of a safe shape, or null. Never a message. */
export const dashscopeVendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);
export const isUnpaidCode = (code) => isString(code) && UNPAID_CODES.has(code.toLowerCase());

/** The selected connection's API key, or null when it is missing or unusable as a header. */
export function dashscopeTtsToken(credentials) {
  const token = credentials?.apiKey;
  return isString(token) && token.trim() && !/[\r\n]/.test(token) ? token : null;
}

export const dashscopeTtsSecrets = (credentials) => ({ apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });

/** Accounting for speech DashScope may have produced (and may bill) whose outcome is not known. */
export function dashscopeTtsAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, DASHSCOPE_TTS_PROVIDER_ID, "tts"), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, jobState = "accepted") => ({ ...result, acceptedJob: dashscopeTtsAcceptedJob(jobState) });

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

/** Whether a failed send provably never reached DashScope. */
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
 * A refused answer, by HTTP status and vendor code. DashScope's text is never
 * quoted. A 5xx other than 503 may have come after the speech was produced,
 * so its outcome is unknown and it carries `acceptedJob`.
 */
export function refusal(status, { code = null, secrets, retryAfter = null }) {
  const suffix = code ? ` (${code})` : "";
  if (status >= 500 && status !== 503) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `DashScope speech failed with ${status}${suffix}; whether it was processed is unknown`),
      "submit-unknown"
    );
  }
  if (status === 402 || ((status === 400 || status === 403) && isUnpaidCode(code))) {
    // Unpaid, unpurchased or out of balance: this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `DashScope refused speech for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(status, `DashScope refused the API key for speech${suffix}`, undefined, undefined, null, secrets);
  }
  if (status === 429 || status === 503) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": retryAfter ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(status, `DashScope ${status === 429 ? "rate limited" : "is unavailable for"} speech${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `DashScope refused the speech request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/** A non-2xx, non-redirect answer: a bounded read for the vendor code only. */
export async function refusedAnswer(response, { signal, secrets }) {
  let code = null;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: 2_000 });
    const body = JSON.parse(text);
    code = dashscopeVendorCode(body?.code) ?? dashscopeVendorCode(body?.error?.code);
  } catch {
    discard(response);
  }
  return refusal(response.status, { code, secrets, retryAfter: response.headers.get("retry-after") });
}

/**
 * Send one request and classify everything that is not a readable 2xx.
 *
 * @returns {Promise<{ response, fetchSignal, clear, timedOut } | { failure: object }>}
 */
export async function sendOnce(url, init, { credentials, signal, timeoutMs, fetchImpl }) {
  const secrets = dashscopeTtsSecrets(credentials);
  let sent;
  try {
    sent = await boundedSend(url, init, { fetchImpl, credentials, signal, timeoutMs });
  } catch (error) {
    if (provenUnsent(error)) {
      return { failure: signal?.aborted
        ? { ...createErrorResult(499, "DashScope speech request aborted; nothing was sent"), local: true }
        : createErrorResult(HTTP_STATUS.BAD_GATEWAY, "DashScope speech could not connect") };
    }
    if (signal?.aborted) return { failure: withAcceptedJob(createErrorResult(499, "DashScope speech request aborted after it was sent"), "submit-unknown") };
    if (error?.name === "TimeoutError") {
      return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "DashScope speech timed out; whether it was processed is unknown"), "submit-unknown") };
    }
    return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "DashScope speech failed after it was sent; whether it was processed is unknown"), "submit-unknown") };
  }
  const { response } = sent;
  if (redirected(response)) {
    sent.clear();
    return { failure: withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "DashScope speech was redirected; the redirect was not followed"), "submit-unknown") };
  }
  if (!response.ok) {
    const failure = await refusedAnswer(response, { signal, secrets });
    sent.clear();
    return { failure };
  }
  return sent;
}

/** A 2xx whose audio could not be delivered: DashScope did the work, the result is lost. */
export const lostResult = (message, status = HTTP_STATUS.BAD_GATEWAY) =>
  withAcceptedJob(createErrorResult(status, `DashScope speech ${message}`), "accepted");
