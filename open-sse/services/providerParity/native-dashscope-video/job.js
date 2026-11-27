// DashScope video job for one credential variant (#2034): one bounded submit to
// that identity's fixed video-synthesis URL, a bounded task poll on that same
// identity's status URL, and accepted-job accounting under that identity.
//
// Wire contract (OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/handlers/videoGeneration/dashscopeHandler.ts): POST
// {baseUrl}/services/aigc/video-generation/video-synthesis with
// `Authorization: Bearer <key>` and `X-DashScope-Async: enable`, answer
// `output.task_id`; GET {statusUrl}/{task_id} with the same Bearer key,
// `output.task_status` PENDING / RUNNING / SUCCEEDED / FAILED / UNKNOWN_ERROR and
// `output.video_url`; 2.5 s poll interval, 300 s job bound.
//
// The integrated client ../../alibabaVideo/job.js has the same wire contract but
// accepts only the two `alibaba` origins and records usage under `alibaba`, so
// it does not fit these identities; its exported bounds and result URL check
// are reused read-only, and its safety behavior is mirrored here: every fetch
// and the whole job are time bounded and abort on the caller's signal;
// redirects are refused, never followed with the key; bodies are size bounded;
// upstream text never reaches an error message (only a vendor code of a safe
// shape); an unknown submit outcome and every accepted task not seen to fail
// carry `acceptedJob` and are never resent; UNKNOWN_ERROR and unrecognized
// states are unknown outcomes; the result URL is checked and never fetched.
// The source never cancels a task, so neither does this client.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown, readJobBody, sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import {
  ALIBABA_VIDEO_MAX_POLL_RETRIES,
  ALIBABA_VIDEO_MAX_RETRY_DELAY_MS,
  ALIBABA_VIDEO_POLL_INTERVAL_MS,
  ALIBABA_VIDEO_REQUEST_TIMEOUT_MS,
  ALIBABA_VIDEO_SUBMIT_TIMEOUT_MS,
  ALIBABA_VIDEO_TIMEOUT_MS,
  alibabaVideoResultUrl,
} from "../../alibabaVideo/job.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { resolveDashscopeConnectionRegion } from "../native-dashscope-image/regions.js";
import {
  DASHSCOPE_VIDEO_ACCEPTED_REGIONS,
  DASHSCOPE_VIDEO_MAX_CALLER_POLL_INTERVAL_MS,
  DASHSCOPE_VIDEO_MAX_CALLER_TIMEOUT_MS,
  DASHSCOPE_VIDEO_MIN_CALLER_POLL_INTERVAL_MS,
  dashscopeVideoEndpoint,
  dashscopeVideoIdentity,
  dashscopeVideoSubmitUrl,
  dashscopeVideoTaskUrl,
} from "./config.js";

export const DASHSCOPE_VIDEO_POLL_INTERVAL_MS = ALIBABA_VIDEO_POLL_INTERVAL_MS;
export const DASHSCOPE_VIDEO_TIMEOUT_MS = ALIBABA_VIDEO_TIMEOUT_MS;
export const DASHSCOPE_VIDEO_SUBMIT_TIMEOUT_MS = ALIBABA_VIDEO_SUBMIT_TIMEOUT_MS;
export const DASHSCOPE_VIDEO_REQUEST_TIMEOUT_MS = ALIBABA_VIDEO_REQUEST_TIMEOUT_MS;

const MAX_JSON_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CODE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const PENDING = new Set(["PENDING", "RUNNING"]);
// services/accountFallback.js DASHSCOPE_DEAD_ACCOUNT_RE (source accountFallback.ts).
const UNPAID_CODES = new Set(["arrearage", "accessdenied.unpurchased"]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// Transport failures before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const vendorCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/** Accounting for a task the identity's host may have taken (and may bill) whose outcome is not known. */
export function dashscopeVariantAcceptedJob(providerId, jobState = "accepted") {
  return { ...mediaAccounting(null, providerId, "video"), costSource: "accepted-job", meta: { jobState } };
}

// Retry-After as delta-seconds or HTTP-date, in milliseconds.
function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

/**
 * Refusal reason when the connection is bound to another host than the pinned
 * one: a non-global region or a custom base URL (the source would follow them;
 * this staged client does not move the key). Null when the connection fits.
 */
export function dashscopeVariantConnectionMismatch(credentials) {
  const data = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
  if (data.region != null && !DASHSCOPE_VIDEO_ACCEPTED_REGIONS.includes(data.region)) return "region";
  if (data.baseUrl != null && data.baseUrl !== "") return "baseUrl";
  return null;
}

// A whole number of milliseconds >= 1 (source pollBounds.ts positiveWholeMs),
// as a number or a digit string; anything else present is refused, not dropped.
function callerMs(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null) return null;
  const n = isString(value) && /^\s*\d+(\.\d+)?\s*$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.floor(n) < 1) {
    throw Object.assign(new Error(`DashScope video ${field} must be a positive number of milliseconds`), { status: HTTP_STATUS.BAD_REQUEST });
  }
  return Math.floor(n);
}

/**
 * The caller's polling options, honored within the source's ceilings
 * (pollBounds.ts: timeout_ms up to 600 s, poll_interval_ms up to 120 s; a
 * default above a ceiling stays reachable) and the gateway's 1 s interval
 * floor. Refused with 400 before any submit: a non-numeric or non-positive
 * value, `poll_timeout_ms` (the source's DashScope handler does not read it),
 * and an interval that leaves no poll inside the deadline (the task would be
 * created and billed but never checked).
 *
 * @returns {{ timeoutMs: number, pollIntervalMs: number, requested: object }}
 */
export function resolveDashscopeVideoPolling(body, { timeoutMs = DASHSCOPE_VIDEO_TIMEOUT_MS, pollIntervalMs = DASHSCOPE_VIDEO_POLL_INTERVAL_MS } = {}) {
  if (body?.poll_timeout_ms !== undefined && body?.poll_timeout_ms !== null) {
    throw Object.assign(new Error("DashScope video takes timeout_ms, not poll_timeout_ms"), { status: HTTP_STATUS.BAD_REQUEST });
  }
  const timeout = callerMs(body, "timeout_ms");
  const interval = callerMs(body, "poll_interval_ms");
  const resolved = {
    timeoutMs: timeout === null ? timeoutMs : Math.min(timeout, Math.max(DASHSCOPE_VIDEO_MAX_CALLER_TIMEOUT_MS, timeoutMs)),
    pollIntervalMs: interval === null
      ? pollIntervalMs
      : Math.max(DASHSCOPE_VIDEO_MIN_CALLER_POLL_INTERVAL_MS, Math.min(interval, Math.max(DASHSCOPE_VIDEO_MAX_CALLER_POLL_INTERVAL_MS, pollIntervalMs))),
    requested: { timeout_ms: timeout, poll_interval_ms: interval },
  };
  if ((timeout !== null || interval !== null) && resolved.pollIntervalMs >= resolved.timeoutMs) {
    throw Object.assign(new Error("DashScope video poll_interval_ms must be shorter than timeout_ms"), { status: HTTP_STATUS.BAD_REQUEST });
  }
  return resolved;
}

/**
 * Submit one video-synthesis task for the selected connection of `providerId`
 * and follow it to its video URL.
 *
 * @returns {Promise<object>} `{ success: true, url, taskId, accounting }`, or an
 * error result with `acceptedJob` when the task may bill
 */
export async function runDashscopeVariantVideoJob({
  providerId,
  request,
  credentials,
  signal,
  log,
  timeoutMs = DASHSCOPE_VIDEO_TIMEOUT_MS,
  submitTimeoutMs = DASHSCOPE_VIDEO_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = DASHSCOPE_VIDEO_REQUEST_TIMEOUT_MS,
  pollIntervalMs = DASHSCOPE_VIDEO_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
  regional = false,
}) {
  const identity = dashscopeVideoIdentity(providerId);
  if (!identity) return createErrorResult(500, "DashScope video provider is not a staged identity");
  const label = identity.label;
  const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`${label} ${what}`, status);
  const acceptedJob = (jobState) => dashscopeVariantAcceptedJob(providerId, jobState);
  const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: acceptedJob(jobState) });
  const abortedResult = () => createErrorResult(499, `${label} video request aborted`);

  const token = credentials?.apiKey || credentials?.accessToken;
  if (!isString(token) || !token.trim() || /[\r\n]/.test(token)) {
    return createErrorResult(401, `${label} API key is required`);
  }
  // The identity's own fixed endpoints: pinned, or looked up by (identity, region).
  let endpoint = identity;
  let region = "global-sg";
  if (regional) {
    const bound = resolveDashscopeConnectionRegion(providerId, credentials);
    if (bound.error) return createErrorResult(HTTP_STATUS.BAD_REQUEST, `${label} video connection ${bound.error}`);
    endpoint = dashscopeVideoEndpoint(providerId, bound.region);
    region = bound.region;
  } else {
    const mismatch = dashscopeVariantConnectionMismatch(credentials);
    if (mismatch) {
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `${label} video uses only ${identity.origin}; this connection's ${mismatch} is not supported`);
    }
  }
  if (signal?.aborted) return abortedResult();
  const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken };
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  async function readJson(response, timeout) {
    const text = await readJobBody(
      () => readBoundedResponseText(response, { signal, maxBytes: MAX_JSON_BYTES, timeoutMs: timeout, throwOnTimeout: true }),
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
      throw Object.assign(new Error(`${label} video task failed${code ? ` (${code})` : ""}`), { status: HTTP_STATUS.BAD_GATEWAY });
    }
    throw unknownOutcome("reported an unknown video task outcome");
  }

  // One POST bounded by the caller's signal and a deadline, even if the
  // transport ignores its signal. A late answer is discarded.
  async function sendSubmit(init, timeout) {
    if (signal?.aborted) throw Object.assign(new Error("aborted before submit"), { name: "AbortError", notSent: true });
    const stop = new AbortController();
    const fetchSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const timeoutError = () => Object.assign(new Error("submit timed out"), { name: "TimeoutError" });
    let timedOut = false;
    let stopWaiting;
    const timer = setTimeout(() => {
      timedOut = true;
      stop.abort(timeoutError());
    }, timeout);
    const bound = new Promise((_, rejectWait) => {
      stopWaiting = () => rejectWait(timedOut ? timeoutError() : fetchSignal.reason);
      fetchSignal.addEventListener("abort", stopWaiting, { once: true });
    });
    const pending = fetch(dashscopeVideoSubmitUrl(endpoint), { ...init, signal: fetchSignal });
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

  async function refusedSubmit(response) {
    const { status } = response;
    let code = null;
    try {
      const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: Math.min(requestTimeoutMs, remaining()) });
      const body = JSON.parse(text);
      code = vendorCode(body?.code) ?? vendorCode(body?.error?.code);
    } catch {
      discard(response);
    }
    const suffix = code ? ` (${code})` : "";
    if (status >= 500) {
      return withAcceptedJob(
        createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} video submit failed with ${status}${suffix}; whether a task was created is unknown`),
        "submit-unknown"
      );
    }
    if ((status === 400 || status === 403) && code && UNPAID_CODES.has(code.toLowerCase())) {
      const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `${label} refused video generation for this account${suffix}`, undefined, undefined, null, secrets);
      return { ...failed, quotaExhausted: true };
    }
    if (status === 401) return createErrorResult(401, `${label} refused the API key for video generation${suffix}`, undefined, undefined, null, secrets);
    if (status === 429) {
      const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
      const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
      return createErrorResult(429, `${label} rate limited video generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
    }
    const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
    return createErrorResult(passed, `${label} refused the video request with ${status}${suffix}`, undefined, undefined, null, secrets);
  }

  async function awaitTask(id) {
    const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
    const url = dashscopeVideoTaskUrl(endpoint, id);
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
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
      const body = await readJson(response, budget());
      const output = isRecord(body.output) ? body.output : {};
      if (output.task_id !== id) throw unknownOutcome("answered about a different video task");
      delay = pollIntervalMs;
      retries = 0;
      rejected = 0;
      const result = settle(output);
      if (result) return result;
    }
  }

  let response;
  try {
    response = await sendSubmit({
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
    }, Math.min(submitTimeoutMs, remaining()));
  } catch (error) {
    const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} video submit could not connect`);
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `${label} video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), "submit-unknown");
  }

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    log?.debug?.("DASHSCOPE_VIDEO", `${providerId} video submit redirect refused`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} video submit redirect refused`);
  }
  let answeredBy = endpoint.origin;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== endpoint.origin) {
    discard(response);
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${label} video submit was redirected`), "submit-unknown");
  }
  if (!response.ok) return refusedSubmit(response);

  let id;
  try {
    const accepted = await readJson(response, Math.min(requestTimeoutMs, remaining()));
    id = isRecord(accepted.output) ? accepted.output.task_id : null;
    if (!isString(id) || !TASK_ID_RE.test(id)) throw unknownOutcome("did not return a usable video task id");
    const url = await awaitTask(id);
    return { success: true, url, taskId: id, region, accounting: mediaAccounting(null, providerId, "video") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.message || `Invalid response from ${label}`,
      undefined, undefined, null, secrets
    );
    return error?.jobOutcomeUnknown ? withAcceptedJob(failed, "accepted") : failed;
  }
}
