// Adobe Firefly Services text-to-video job: one bounded submit to the fixed
// generate endpoint, the bounded status poll and accepted-job accounting.
// Used by handlers/videoProviders/adobe-firefly-api.js, which
// /v1/video/generations runs through videoGenerationCore.js.
//
// Written from Adobe's published contract, AdobeDocs/ffs-firefly-api at
// 1027f559cdb1509a61b34e2f2da9618ec431f2cb. No third-party code was ported.
// - static/firefly-api.json (blob 9004da2c5d57850bb72068e6e06b93e04b1bad9e):
//   POST /v3/videos/generate (generateVideoV3; `x-model-version` header; 202
//   AsyncAcceptResponseV3; 403 `x-access-error`; 429 `retry-after`),
//   GET /v3/status/{jobId} (JobResponse / JobPollPayload statuses),
//   PUT /v3/cancel/{jobId}, and the video result schemas AsyncResult and
//   VideoOutput (`result.outputs[].video.url`).
// - src/pages/guides/how-tos/using-async-apis.md: submit, then poll status.
//
// The spec's status operation names JobResponse, whose success schema lists
// image outputs. The only video result schema it publishes is AsyncResult,
// so a succeeded video job is read as `result.outputs[].video.url` and
// anything else is an unknown outcome. This has not been checked against a
// live Adobe account.
//
// The credential is the operator's own Developer Console credential, read
// and minted by ./auth.js with the same per-account in-memory token cache the
// image adapter uses. The token goes only to the fixed Firefly origin: the
// submit answer's statusUrl and cancelUrl are never fetched, redirects are
// refused, and the result URL is returned to the caller without being
// fetched. Upstream text never reaches an error message.
import { createErrorResult, readBoundedResponseText } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { mediaAccounting } from "../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown, readJobBody, sleep } from "../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../oauthCredentialManager.js";
import {
  ADOBE_FIREFLY_API_ID,
  ADOBE_FIREFLY_API_ORIGIN,
  ADOBE_FIREFLY_VIDEO_GENERATE_URL,
  adobeFireflyCancelUrl,
  adobeFireflyStatusUrl,
} from "../../providers/registry/adobe-firefly-api.js";
import { defaultAdobeTokenCache, refreshAdobeFireflyToken, resolveAdobeFireflyAuth } from "./auth.js";
import { describeAdobeFireflySubmitRefusal } from "./refusal.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

const PROVIDER = ADOBE_FIREFLY_API_ID;

// Gateway bounds, not Adobe limits. Video jobs run longer than image jobs, and
// the usage notes' default rate limit is 4 requests per minute per
// organization, so status checks are spaced further apart than for images.
export const ADOBE_FIREFLY_VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
export const ADOBE_FIREFLY_VIDEO_POLL_INTERVAL_MS = 10_000;
export const ADOBE_FIREFLY_VIDEO_POLL_TIMEOUT_MS = 600_000;
export const ADOBE_FIREFLY_VIDEO_REQUEST_TIMEOUT_MS = 30_000;
export const ADOBE_FIREFLY_VIDEO_CANCEL_TIMEOUT_MS = 5_000;
export const ADOBE_FIREFLY_VIDEO_MAX_POLL_RETRIES = 5;
export const ADOBE_FIREFLY_VIDEO_MAX_RETRY_DELAY_MS = 60_000;

const MAX_JSON_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 2083;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const PENDING_STATUSES = new Set(["pending", "running", "cancel_pending"]);
// ColligoErrorCodeAsyncV3 codes that may be repeated, with their HTTP status.
const FAILURE_STATUS = new Map([
  ["validation_error", 422], ["bad_request", 422], ["invalid_content_type", 422], ["empty_input_body", 422],
  ["timeout_error", 504], ["rate_limited", 429], ["access_error", 403], ["runtime_error", 502],
]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`Adobe Firefly ${what}`, status);
const reported = (message, status) => Object.assign(new Error(`Adobe Firefly ${message}`), { status });
const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** Accounting for a video job Adobe may have taken (and may bill) whose outcome is not known. */
export function adobeFireflyVideoAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, PROVIDER, "video"), costSource: "accepted-job", meta: { jobState } };
}

const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: adobeFireflyVideoAcceptedJob(jobState) });
const abortedResult = () => createErrorResult(499, "Adobe Firefly video request aborted");
const validStatus = (status) => (Number.isInteger(status) && status >= 400 && status <= 599 ? status : null);

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
  if (!isRecord(value)) throw unknownOutcome("returned an unreadable video job response");
  return value;
}

const sameJob = (reportedId, id) => reportedId === id || id.endsWith(`:${reportedId}`);

function videoUrl(output) {
  const raw = isRecord(output) && isRecord(output.video) ? output.video.url : null;
  if (!isString(raw) || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
}

// null while pending; the one video URL once succeeded. Throws otherwise.
function settle(job) {
  if (PENDING_STATUSES.has(job.status)) return null;
  if (job.status === "succeeded") {
    const outputs = isRecord(job.result) && Array.isArray(job.result.outputs) ? job.result.outputs : [];
    const url = outputs.length === 1 ? videoUrl(outputs[0]) : null;
    if (!url) throw unknownOutcome("video job succeeded without a usable video result");
    return url;
  }
  if (job.status === "failed") {
    const known = FAILURE_STATUS.has(job.error_code);
    throw reported(`video job failed: ${known ? job.error_code : "unknown reason"}`, known ? FAILURE_STATUS.get(job.error_code) : 502);
  }
  if (job.status === "cancelled") throw reported("video job was cancelled", 502);
  if (job.status === "timeout") throw reported("video job timed out upstream", 504);
  throw unknownOutcome("returned an unknown video job status");
}

// Best effort, bounded, on the fixed origin. It never changes an outcome.
async function cancelJob(id, { token, clientId, proxyOptions, timeoutMs }) {
  try {
    const response = await fetch(adobeFireflyCancelUrl(id), {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "x-api-key": clientId, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      proxyOptions,
    });
    discard(response);
  } catch {
    // Ignored: the job is already recorded as an unknown outcome.
  }
}

// A submit answer that arrives after the caller gave up: if it accepted a job,
// cancel that job on the fixed origin; never poll it or return its result.
async function cleanUpLateSubmit(response, auth, { proxyOptions, cancelTimeoutMs }) {
  if (!response?.ok || response.redirected) return discard(response);
  try {
    const text = await readBoundedResponseText(response, { maxBytes: MAX_JSON_BYTES, timeoutMs: cancelTimeoutMs, throwOnTimeout: true });
    const id = JSON.parse(text)?.jobId;
    if (isString(id) && JOB_ID_RE.test(id)) {
      await cancelJob(id, { token: auth.token, clientId: auth.clientId, proxyOptions, timeoutMs: cancelTimeoutMs });
    }
  } catch {
    // Nothing more can be done for a job whose id cannot be read.
  }
}

// One POST, torn down on the caller's abort (its reason) or at the deadline (a
// TimeoutError). The wait ends on either even when a transport ignores its
// signal, and an answer that still arrives is cleaned up.
async function sendSubmit(init, { signal, submitTimeoutMs, onLate }) {
  if (signal?.aborted) throw Object.assign(new Error("aborted before submit"), { name: "AbortError", notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timeoutError = () => Object.assign(new Error("submit timed out"), { name: "TimeoutError" });
  let timedOut = false;
  let stopWaiting;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, submitTimeoutMs);
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(timedOut ? timeoutError() : fetchSignal.reason);
    fetchSignal.addEventListener("abort", stopWaiting, { once: true });
  });
  const pending = fetch(ADOBE_FIREFLY_VIDEO_GENERATE_URL, { ...init, signal: fetchSignal });
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
    // Only an answer this call did not return is cleaned up.
    if (!delivered && fetchSignal.aborted) pending.then((late) => onLate(late), () => {});
  }
}

/**
 * Follow one accepted generateVideoV3 submit to its video URL.
 *
 * @param {Response} submitted - the 2xx answer to POST /v3/videos/generate
 * @returns {Promise<string>} the pre-signed video URL, not fetched
 */
export async function awaitAdobeFireflyVideo(submitted, {
  auth,
  credentials,
  signal,
  cache = defaultAdobeTokenCache,
  pollIntervalMs = ADOBE_FIREFLY_VIDEO_POLL_INTERVAL_MS,
  timeoutMs = ADOBE_FIREFLY_VIDEO_POLL_TIMEOUT_MS,
  requestTimeoutMs = ADOBE_FIREFLY_VIDEO_REQUEST_TIMEOUT_MS,
  cancelTimeoutMs = ADOBE_FIREFLY_VIDEO_CANCEL_TIMEOUT_MS,
  wait = sleep,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  let token = auth.token;
  const headers = () => ({ Authorization: `Bearer ${token}`, "x-api-key": auth.clientId, Accept: "application/json" });

  const accepted = await readJson(submitted, { signal, timeoutMs: budget() });
  const id = accepted.jobId;
  if (!isString(id) || !JOB_ID_RE.test(id)) throw unknownOutcome("did not return a usable video job id");
  const statusUrl = adobeFireflyStatusUrl(id);

  const abandon = async (error) => {
    await cancelJob(id, { token, clientId: auth.clientId, proxyOptions, timeoutMs: cancelTimeoutMs });
    throw error;
  };

  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let reminted = false;
  let url = null;

  while (!url) {
    if (now() + delay > deadline) {
      return abandon(rejected
        ? unknownOutcome(`video status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video job did not finish in time", 504));
    }
    try {
      await wait(delay, signal);
      signal?.throwIfAborted();
    } catch (error) {
      return abandon(error);
    }
    const requestTimeout = AbortSignal.timeout(budget());
    let response;
    try {
      response = await fetch(statusUrl, {
        method: "GET",
        headers: headers(),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
        proxyOptions,
      });
    } catch {
      if (signal?.aborted) return abandon(signal.reason);
      if (requestTimeout.aborted) throw unknownOutcome("video status check timed out", 504);
      throw unknownOutcome("video status check failed");
    }
    if (signal?.aborted) {
      discard(response);
      return abandon(signal.reason);
    }

    if (!response.ok) {
      discard(response);
      const { status } = response;
      if (status === 401 && !reminted && auth.credential.mode === "client_credentials") {
        reminted = true;
        cache.invalidate(auth.credential, token);
        try {
          token = await cache.get(auth.credential, { credentials, signal });
        } catch {
          if (signal?.aborted) return abandon(signal.reason);
          throw unknownOutcome("video status check returned 401", 401);
        }
        delay = pollIntervalMs;
        continue;
      }
      if (status === 401 && auth.credential.mode === "client_credentials") cache.invalidate(auth.credential, token);
      if ((status === 429 || status === 503) && retries < ADOBE_FIREFLY_VIDEO_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          ADOBE_FIREFLY_VIDEO_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`video status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }

    let job;
    try {
      job = await readJson(response, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) return abandon(signal.reason);
      throw error;
    }
    if (!isString(job.jobId) || !sameJob(job.jobId, id)) throw unknownOutcome("answered about a different video job");
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    url = settle(job);
  }
  return url;
}

// The submit's refusal as a gateway error. No upstream text is repeated: only
// the status, a documented `x-access-error` or `x-access-rate-limit-level`
// value, and a bounded Retry-After reset (./refusal.js). A `quota_exhausted`
// 403 is flagged as resetless quota exhaustion for the selected connection.
function refusedSubmit(response) {
  discard(response);
  const refusal = describeAdobeFireflySubmitRefusal(response, "video");
  const evidence = refusal.rateLimitEvidence;
  const failed = createErrorResult(refusal.status, refusal.message, evidence?.resetAtMs, undefined, evidence);
  return refusal.quotaExhausted ? { ...failed, quotaExhausted: true } : failed;
}

/**
 * Submit one text-to-video job for the selected connection and follow it to
 * its video URL.
 *
 * Results use the media core shape: `{ success: true, url, accounting }`, or an
 * error result from createErrorResult, with `acceptedJob` when Adobe may have
 * taken (and may bill) the job. A submit is resent only after a 401, which
 * Adobe answers before accepting anything, and only once with a newly minted
 * token. Nothing is shared between calls except the per-credential token cache.
 *
 * @param {object} options
 * @param {string} options.model - an `x-model-version` value, already validated
 * @param {object} options.request - the GenerateVideoRequestV3 body, already validated
 * @param {object} options.credentials - the selected connection
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.cache] - IMS token cache; one per process by default
 * @param {number} [options.submitTimeoutMs]
 * @param {object} [options.polling] - poll bounds and clock, for tests; see awaitAdobeFireflyVideo
 */
export async function runAdobeFireflyVideoJob({
  model,
  request,
  credentials,
  signal,
  log,
  cache = defaultAdobeTokenCache,
  submitTimeoutMs = ADOBE_FIREFLY_VIDEO_SUBMIT_TIMEOUT_MS,
  polling = {},
}) {
  const now = polling.now ?? Date.now;
  const cancelTimeoutMs = polling.cancelTimeoutMs ?? ADOBE_FIREFLY_VIDEO_CANCEL_TIMEOUT_MS;
  let auth;
  try {
    auth = await resolveAdobeFireflyAuth(credentials, { cache, signal, now });
  } catch (error) {
    if (signal?.aborted) return abortedResult();
    return createErrorResult(validStatus(error?.status) ?? 502, error?.message || "Adobe Firefly Services credential failed");
  }
  // Every error below redacts the connection's secrets and the minted token.
  const secrets = () => ({ apiKey: credentials?.apiKey, accessToken: auth.token });
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const body = JSON.stringify(request);

  let response;
  for (let attempt = 0; ; attempt += 1) {
    const sent = auth;
    try {
      response = await sendSubmit({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${sent.token}`,
          "x-api-key": sent.clientId,
          "x-model-version": model,
        },
        body,
        redirect: "manual",
        proxyOptions,
      }, { signal, submitTimeoutMs, onLate: (late) => cleanUpLateSubmit(late, sent, { proxyOptions, cancelTimeoutMs }) });
    } catch (error) {
      const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
      const aborted = signal?.aborted || error?.name === "AbortError";
      if (aborted) return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
      if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Adobe Firefly Services video submit could not connect");
      // The transport text can describe the request, so it is not repeated.
      const timedOut = error?.name === "TimeoutError";
      const failed = createErrorResult(
        timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
        `Adobe Firefly video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
      );
      return withAcceptedJob(failed, "submit-unknown");
    }

    // A redirect is refused, never followed with the token. Nothing was accepted.
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      log?.debug?.("ADOBE_FIREFLY_API", "video submit redirect refused");
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Adobe Firefly video submit redirect refused");
    }
    // A followed redirect would mean another host saw the token and the job.
    let origin = ADOBE_FIREFLY_API_ORIGIN;
    try {
      if (response.url) origin = new URL(response.url).origin;
    } catch {
      origin = null;
    }
    if (response.redirected || origin !== ADOBE_FIREFLY_API_ORIGIN) {
      discard(response);
      if (auth.credential.mode === "client_credentials") cache.invalidate(auth.credential, auth.token);
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Adobe Firefly video submit was redirected"), "submit-unknown");
    }

    if (response.status === 401 && attempt === 0) {
      discard(response);
      let fresh = false;
      try {
        fresh = await refreshAdobeFireflyToken(auth, { cache, credentials, signal, retry: true });
      } catch {
        return abortedResult();
      }
      if (fresh) {
        try {
          auth = await resolveAdobeFireflyAuth(credentials, { cache, signal, now });
        } catch {
          if (signal?.aborted) return abortedResult();
          return createErrorResult(401, "Adobe Firefly Services refused the access token for video generation");
        }
        continue;
      }
      return createErrorResult(401, "Adobe Firefly Services refused the access token for video generation");
    }
    if (response.status === 401) {
      // The second, newly minted token was refused too: drop it and stop.
      await refreshAdobeFireflyToken(auth, { cache, credentials, signal, retry: false });
    }
    if (!response.ok) return refusedSubmit(response);
    break;
  }

  let url;
  try {
    url = await awaitAdobeFireflyVideo(response, { ...polling, cache, auth, credentials, signal });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const failed = createErrorResult(
      validStatus(Number(error?.status)) ?? HTTP_STATUS.BAD_GATEWAY,
      error?.message || "Invalid response from Adobe Firefly Services",
      undefined, undefined, null, secrets()
    );
    // A reported job failure is an ordinary failure; a lost observation may still bill.
    return error?.jobOutcomeUnknown ? withAcceptedJob(failed, "accepted") : failed;
  }
  return { success: true, url, accounting: mediaAccounting(null, PROVIDER, "video") };
}
