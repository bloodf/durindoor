// Alibaba DashScope video job: one bounded submit to the fixed video-synthesis
// endpoint, a bounded task poll, and accepted-job accounting. Used by
// handlers/videoProviders/alibaba.js; the body comes from ./request.js.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/videoGeneration/dashscopeHandler.ts
// (handleDashscopeVideoGeneration: POST {base}/services/aigc/video-generation/
// video-synthesis with `Authorization: Bearer` and `X-DashScope-Async: enable`,
// `output.task_id`; GET {base}/tasks/{task_id}, `output.task_status` PENDING /
// RUNNING / SUCCEEDED / FAILED / UNKNOWN_ERROR, `output.video_url`; the 2.5 s
// poll interval and 300 s job bound) and open-sse/config/videoRegistry.ts (the
// `alibaba` base https://dashscope-intl.aliyuncs.com/api/v1). Unpaid-account
// codes follow open-sse/services/accountFallback.ts DASHSCOPE_DEAD_ACCOUNT_RE
// (`Arrearage`, `AccessDenied.Unpurchased`), already in services/accountFallback.js.
//
// Fork deviations: every fetch and the whole job are time bounded and abort on
// the caller's signal; redirects are refused; bodies are size bounded; upstream
// text never reaches an error message (only a vendor code of a safe shape);
// a submit whose outcome is unknown, and every accepted task that is not seen
// to fail, is reported with `acceptedJob` and never resent; an UNKNOWN_ERROR or
// unrecognized task status is an unknown outcome, not a failure or a pending
// state; the result URL is checked (https, public literal host, no userinfo)
// and returned without being fetched. The source's region resolver and custom
// base URLs are not ported: the API key goes only to a fixed DashScope origin.
// The source never cancels a task, so neither does this client: an abandoned
// task may still run and bill, which `acceptedJob` records.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { mediaAccounting } from "../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown, readJobBody, sleep } from "../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../oauthCredentialManager.js";
import { isBlockedHost } from "../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

const PROVIDER = "alibaba";

/** The source registry's international DashScope origin. */
export const ALIBABA_DASHSCOPE_INTL_ORIGIN = "https://dashscope-intl.aliyuncs.com";
/** The source resolver's china-beijing DashScope origin. */
export const ALIBABA_DASHSCOPE_CN_ORIGIN = "https://dashscope.aliyuncs.com";
const ORIGINS = new Set([ALIBABA_DASHSCOPE_INTL_ORIGIN, ALIBABA_DASHSCOPE_CN_ORIGIN]);

export const alibabaVideoSubmitUrl = (origin = ALIBABA_DASHSCOPE_INTL_ORIGIN) =>
  `${origin}/api/v1/services/aigc/video-generation/video-synthesis`;
export const alibabaVideoTaskUrl = (id, origin = ALIBABA_DASHSCOPE_INTL_ORIGIN) =>
  `${origin}/api/v1/tasks/${encodeURIComponent(id)}`;

// The source's bounds, plus per-request bounds of the gateway.
export const ALIBABA_VIDEO_POLL_INTERVAL_MS = 2_500;
export const ALIBABA_VIDEO_TIMEOUT_MS = 300_000;
export const ALIBABA_VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
export const ALIBABA_VIDEO_REQUEST_TIMEOUT_MS = 30_000;
export const ALIBABA_VIDEO_MAX_POLL_RETRIES = 5;
export const ALIBABA_VIDEO_MAX_RETRY_DELAY_MS = 30_000;

const MAX_JSON_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const PENDING = new Set(["PENDING", "RUNNING"]);
const UNPAID_CODES = new Set(["arrearage", "accessdenied.unpurchased"]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`Alibaba DashScope ${what}`, status);
const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/** Accounting for a task DashScope may have taken (and may bill) whose outcome is not known. */
export function alibabaVideoAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, PROVIDER, "video"), costSource: "accepted-job", meta: { jobState } };
}

const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: alibabaVideoAcceptedJob(jobState) });
const abortedResult = () => createErrorResult(499, "Alibaba video request aborted");

// Delta-seconds or HTTP-date, in milliseconds.
function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

async function readJson(response, { signal, timeoutMs }) {
  const text = await readJobBody(
    () => readBoundedResponseText(response, { signal, maxBytes: MAX_JSON_BYTES, timeoutMs, throwOnTimeout: true }),
    signal
  );
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (!isRecord(value)) throw unknownOutcome("returned an unreadable video task response");
  return value;
}

/** An https result URL on a public literal host, or null. Never fetched here. */
export function alibabaVideoResultUrl(raw) {
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

// null while pending; the video URL once succeeded. Throws otherwise.
function settle(output) {
  const status = output.task_status;
  if (PENDING.has(status)) return null;
  if (status === "SUCCEEDED") {
    const url = alibabaVideoResultUrl(output.video_url);
    if (!url) throw unknownOutcome("video task succeeded without a usable video URL");
    return url;
  }
  if (status === "FAILED") {
    const code = vendorCode(output.code);
    throw Object.assign(new Error(`Alibaba DashScope video task failed${code ? ` (${code})` : ""}`), { status: HTTP_STATUS.BAD_GATEWAY });
  }
  // UNKNOWN_ERROR, CANCELED or anything else: whether it billed is not known.
  throw unknownOutcome("reported an unknown video task outcome");
}

// One POST bounded by the caller's signal and a deadline. The wait ends on
// either even when a transport ignores its signal; a late answer is discarded
// (DashScope gives no way here to stop a task this call never saw).
async function sendSubmit(url, init, { signal, timeoutMs }) {
  if (signal?.aborted) throw Object.assign(new Error("aborted before submit"), { name: "AbortError", notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timeoutError = () => Object.assign(new Error("submit timed out"), { name: "TimeoutError" });
  let timedOut = false;
  let stopWaiting;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, timeoutMs);
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

// A refused (non-2xx, non-redirect) submit. Only the status, a vendor code of
// a safe shape and a bounded Retry-After are kept. DashScope answers these
// before it creates a task, except a 5xx, whose outcome is unknown.
async function refusedSubmit(response, { signal, timeoutMs, secrets }) {
  const { status } = response;
  let code = null;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs });
    const body = JSON.parse(text);
    code = vendorCode(body?.code) ?? vendorCode(body?.error?.code);
  } catch {
    discard(response);
  }
  const suffix = code ? ` (${code})` : "";
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Alibaba video submit failed with ${status}${suffix}; whether a task was created is unknown`),
      "submit-unknown"
    );
  }
  if ((status === 400 || status === 403) && code && UNPAID_CODES.has(code.toLowerCase())) {
    // Unpaid or unpurchased: stays true until the owner pays, on this account only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Alibaba DashScope refused video generation for this account${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401) return createErrorResult(401, `Alibaba DashScope refused the API key for video generation${suffix}`, undefined, undefined, null, secrets);
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `Alibaba DashScope rate limited video generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Alibaba DashScope refused the video request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/**
 * Follow one accepted task to its video URL within the job deadline.
 *
 * @returns {Promise<string>} the result URL, not fetched
 */
async function awaitTask(id, { origin, headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = alibabaVideoTaskUrl(id, origin);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`video task check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video task did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    const requestTimeout = AbortSignal.timeout(budget());
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
        proxyOptions,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (requestTimeout.aborted) throw unknownOutcome("video task check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome("video task check failed");
    }
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < ALIBABA_VIDEO_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          ALIBABA_VIDEO_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`video task check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const body = await readJson(response, { signal, timeoutMs: budget() });
    const output = isRecord(body.output) ? body.output : {};
    if (output.task_id !== id) throw unknownOutcome("answered about a different video task");
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const result = settle(output);
    if (result) return result;
  }
}

/**
 * Submit one video-synthesis task for the selected connection and follow it
 * to its video URL.
 *
 * Results use the media core shape: `{ success: true, url, accounting }`, or an
 * error result from createErrorResult, with `acceptedJob` when DashScope may
 * have taken (and may bill) the task. Nothing is resent, and nothing is shared
 * between calls: the key, task id and proxy belong to this call only.
 *
 * @param {object} options
 * @param {object} options.request - the DashScope body from buildAlibabaVideoRequest
 * @param {object} options.credentials - the selected connection (`apiKey`)
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.origin] - one of the two fixed DashScope origins
 */
export async function runAlibabaVideoJob({
  request,
  credentials,
  signal,
  log,
  origin = ALIBABA_DASHSCOPE_INTL_ORIGIN,
  timeoutMs = ALIBABA_VIDEO_TIMEOUT_MS,
  submitTimeoutMs = ALIBABA_VIDEO_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = ALIBABA_VIDEO_REQUEST_TIMEOUT_MS,
  pollIntervalMs = ALIBABA_VIDEO_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  if (!ORIGINS.has(origin)) return createErrorResult(500, "Alibaba video origin is not a DashScope origin");
  const token = credentials?.apiKey || credentials?.accessToken;
  if (!isString(token) || !token.trim() || /[\r\n]/.test(token)) {
    return createErrorResult(401, "Alibaba DashScope API key is required");
  }
  if (signal?.aborted) return abortedResult();
  // Every error below redacts this connection's secrets.
  const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken };
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await sendSubmit(alibabaVideoSubmitUrl(origin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Alibaba DashScope video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Alibaba video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), "submit-unknown");
  }

  // A redirect is refused, never followed with the key. Nothing was accepted.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    log?.debug?.("ALIBABA_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Alibaba video submit redirect refused");
  }
  // A followed redirect would mean another host saw the key and the task.
  let answeredBy = origin;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== origin) {
    discard(response);
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Alibaba video submit was redirected"), "submit-unknown");
  }
  if (!response.ok) return refusedSubmit(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });

  let id;
  try {
    const accepted = await readJson(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()) });
    id = isRecord(accepted.output) ? accepted.output.task_id : null;
    if (!isString(id) || !TASK_ID_RE.test(id)) throw unknownOutcome("did not return a usable video task id");
    const url = await awaitTask(id, {
      origin,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now,
    });
    return { success: true, url, accounting: mediaAccounting(null, PROVIDER, "video") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.message || "Invalid response from Alibaba DashScope",
      undefined, undefined, null, secrets
    );
    // A task DashScope reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobOutcomeUnknown ? withAcceptedJob(failed, "accepted") : failed;
  }
}
