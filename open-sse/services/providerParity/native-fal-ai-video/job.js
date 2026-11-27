// fal queue video job: optional schema discovery, one bounded queue submit,
// a bounded status poll, one result read, and accepted-job accounting.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/mediaGeneration/fal.ts (runFalQueue: POST
// {queue}/{endpoint} with `Authorization: Key <key>`, `request_id`,
// `status_url`, `response_url`, GET status until COMPLETED / IN_QUEUE /
// IN_PROGRESS, GET result, `video.url`, a 1 s poll interval, a local 401
// without a key; normalizeFalMediaResult: `{ created, data: [{ url, format }] }`)
// and open-sse/handlers/fal/client.ts (falTrackingUrl pinning,
// `redirect: "error"`, the `X-Fal-No-Retry: 1` submit header, the fixed
// fal origins, and upstream error bodies withheld).
//
// Fork deviations: every fetch and the whole job are time bounded and abort on
// the caller's signal. A submit redirect is refused, and a submit answered
// from another origin is discarded. Bodies are size bounded. Upstream text
// never reaches an error message. A submit whose outcome is unknown, and
// every accepted request that does not end in a returned video, is reported
// with `acceptedJob` and never resent. A status other than IN_QUEUE,
// IN_PROGRESS or COMPLETED is a lost job here, not a plain 502. The source
// returned the raw fal result (`output`) and every URL in it (`artifacts`).
// This adapter returns only the validated video URL, which must be an
// https URL on a public host. The source never cancels a queued request,
// and neither does this client.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown, readJobBody, sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_API_ORIGIN, FAL_QUEUE_ORIGIN, FAL_VIDEO_PROVIDER_ID, falAuthorization } from "./config.js";
import { discoverFalVideoDefinition, falVideoCompatibilityInput } from "./schema.js";

// The source's 1 s poll interval, plus per-request and per-job bounds of the gateway.
export const FAL_VIDEO_POLL_INTERVAL_MS = 1_000;
export const FAL_VIDEO_TIMEOUT_MS = 600_000;
export const FAL_VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
export const FAL_VIDEO_REQUEST_TIMEOUT_MS = 30_000;
export const FAL_VIDEO_DISCOVERY_TIMEOUT_MS = 15_000;
export const FAL_VIDEO_MAX_POLL_RETRIES = 5;
export const FAL_VIDEO_MAX_RETRY_DELAY_MS = 30_000;
// client.ts retryFalRead: two retries, each honoring a Retry-After of at most 5 s.
const DISCOVERY_RETRIES = 2;
const DISCOVERY_MAX_RETRY_MS = 5_000;

const MAX_JSON_BYTES = 256 * 1024;
const MAX_DISCOVERY_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_URL_LENGTH = 4096;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PENDING = new Set(["IN_QUEUE", "IN_PROGRESS"]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// fal locks an account whose balance is spent and says so in a 403 detail.
const QUOTA_RE = /exhausted balance|insufficient (?:balance|credits?|funds)/i;
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const VIDEO_FORMATS = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`fal video ${what}`, status);
const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const abortedResult = () => createErrorResult(499, "fal video request aborted");

/** Accounting for a request fal may have taken (and may bill) whose outcome is not known. */
export function falVideoAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, FAL_VIDEO_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: falVideoAcceptedJob(jobState) });

/** The key of the selected connection: `apiKey`, else `accessToken` (the source's getToken). */
export function falVideoToken(credentials) {
  const value = credentials?.apiKey || credentials?.accessToken;
  return isString(value) && value.trim() ? value.trim() : "";
}

/**
 * A fal job tracking URL (client.ts falTrackingUrl): on the queue origin,
 * without credentials or a fragment, naming this request. Throws otherwise.
 */
export function falVideoTrackingUrl(value, requestId) {
  if (!isString(value) || value.length > MAX_URL_LENGTH) throw unknownOutcome("returned no usable tracking URL");
  let url;
  try {
    url = new URL(value, FAL_QUEUE_ORIGIN);
  } catch {
    throw unknownOutcome("returned no usable tracking URL");
  }
  const segments = url.pathname.split("/");
  if (
    url.origin !== FAL_QUEUE_ORIGIN || url.username || url.password || url.hash ||
    !segments.some((segment, i) => segment === "requests" && segments[i + 1] === encodeURIComponent(requestId))
  ) {
    throw unknownOutcome("returned a tracking URL off the fal queue");
  }
  return url.href;
}

/** An https result URL on a public host without credentials, or null. Never fetched here. */
export function falVideoResultUrl(raw) {
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

/** `{ url, format }` from a fal result's `video` file, or throws an unknown outcome. */
export function falVideoArtifact(payload) {
  const video = isRecord(payload) && isRecord(payload.video) ? payload.video : null;
  if (!video) throw unknownOutcome("result has no video");
  const url = falVideoResultUrl(video.url);
  if (!url) throw unknownOutcome("result video URL is not a public https URL");
  const contentType = isString(video.content_type) ? video.content_type.split(";")[0].trim().toLowerCase() : null;
  if (contentType && !contentType.startsWith("video/")) throw unknownOutcome("result is not a video");
  const extension = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  const format = (contentType && VIDEO_FORMATS[contentType]) ?? (Object.values(VIDEO_FORMATS).includes(extension) ? extension : undefined);
  return format ? { url, format } : { url };
}

function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

async function readJson(response, { signal, timeoutMs, maxBytes, what }) {
  const text = await readJobBody(
    () => readBoundedResponseText(response, { signal, maxBytes, timeoutMs, throwOnTimeout: true }),
    signal
  );
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (!isRecord(value)) throw unknownOutcome(`${what} was unreadable`);
  return value;
}

// One POST bounded by the caller's signal and a deadline. The wait ends on
// either even when a transport ignores its signal; a late answer is discarded.
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

// A bounded, redirect-refusing GET on a fixed fal origin. Throws on transport failure.
async function boundedGet(url, { headers, signal, timeoutMs, proxyOptions }) {
  const requestTimeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  try {
    return await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
      proxyOptions,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw Object.assign(new Error(requestTimeout.aborted ? "timed out" : "failed"), { timedOut: requestTimeout.aborted });
  }
}

// A refused discovery read: the key (401), an unlisted endpoint (404), a rate limit (429), or 502.
const discoveryFailure = (upstream) => Object.assign(new Error(`fal model discovery failed (${upstream})`), {
  status: upstream === 401 || upstream === 403 ? 401 : upstream === 404 || upstream === 429 ? upstream : HTTP_STATUS.BAD_GATEWAY,
});

/**
 * Discover `endpoint`'s definition for this connection (compatibility.ts
 * prepareFalCompatibility). A store, when given, is read and written under
 * this connection's id only.
 */
async function discover(endpoint, { token, credentials, store, signal, timeoutMs, proxyOptions, wait, now }) {
  const connectionId = isString(credentials?.connectionId) ? credentials.connectionId : null;
  const cached = connectionId && store ? store.get(connectionId, endpoint) : null;
  if (cached) return cached;
  const headers = { Authorization: falAuthorization(token), Accept: "application/json" };
  const getJson = async (url) => {
    if (new URL(url).origin !== FAL_API_ORIGIN) throw Object.assign(new Error("Invalid fal discovery URL"), { status: 400 });
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await boundedGet(url, { headers, signal, timeoutMs, proxyOptions });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw Object.assign(new Error(`fal model discovery ${error.message}`), { status: error.timedOut ? 504 : 502 });
      }
      if ((response.status === 429 || response.status === 503) && attempt < DISCOVERY_RETRIES) {
        const delay = retryAfterMs(response.headers.get("retry-after"), now()) || 1_000;
        discard(response);
        if (delay > DISCOVERY_MAX_RETRY_MS) throw discoveryFailure(response.status);
        await wait(delay, signal);
        continue;
      }
      if (!response.ok) {
        discard(response);
        throw discoveryFailure(response.status);
      }
      try {
        return await readBoundedResponseText(response, { signal, maxBytes: MAX_DISCOVERY_BYTES, timeoutMs, throwOnTimeout: true }).then(JSON.parse);
      } catch (error) {
        if (signal?.aborted) throw error;
        throw Object.assign(new Error("fal model discovery returned an unreadable catalog"), { status: 502 });
      }
    }
  };
  const definition = await discoverFalVideoDefinition(endpoint, getJson);
  if (connectionId && store) store.save(connectionId, definition);
  return definition;
}

// A refused (non-2xx, non-redirect) submit. Only a quota match, the status
// and a bounded Retry-After are kept; fal refuses these before it queues
// anything, except a 5xx, whose outcome is unknown.
async function refusedSubmit(response, { signal, timeoutMs, secrets }) {
  const { status } = response;
  if (status >= 500) {
    discard(response);
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `fal video submit failed with ${status}; whether the request was queued is unknown`),
      "submit-unknown"
    );
  }
  let quota = false;
  if (status === 402 || status === 403) {
    try {
      quota = status === 402 || QUOTA_RE.test(await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs }));
    } catch {
      discard(response);
    }
  } else {
    discard(response);
  }
  if (quota) {
    // The balance is spent: true until the owner tops up, on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "fal refused video generation: the account balance is exhausted", undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) return createErrorResult(401, `fal refused the credential for video generation (${status})`, undefined, undefined, null, secrets);
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "fal rate limited video generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 422) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "fal refused the video input (422)", undefined, undefined, null, secrets);
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `fal refused the video request with ${status}`, undefined, undefined, null, secrets);
}

/** Follow one queued request to its video within the job deadline. */
async function awaitResult({ statusUrl, responseUrl, headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const get = async (url, what) => {
    try {
      return await boundedGet(url, { headers, signal, timeoutMs: budget(), proxyOptions });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw unknownOutcome(`${what} ${error.timedOut ? "timed out" : "failed"}`, error.timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY);
    }
  };
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("request did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    const response = await get(statusUrl, "status check");
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < FAL_VIDEO_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(FAL_VIDEO_MAX_RETRY_DELAY_MS, Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1)));
        continue;
      }
      throw unknownOutcome(`status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const state = await readJson(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    if (PENDING.has(state.status)) continue;
    if (state.status !== "COMPLETED") throw unknownOutcome("request reached an unknown state");
    const result = await get(responseUrl, "result read");
    if (!result.ok) {
      discard(result);
      throw unknownOutcome(`result read returned ${result.status}`, PASSED_POLL_STATUSES.has(result.status) ? result.status : 502);
    }
    return falVideoArtifact(await readJson(result, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "result" }));
  }
}

/**
 * Submit one fal queue video request for the selected connection and follow
 * it to its video URL.
 *
 * Results use the media core shape: `{ success: true, video: { url, format? },
 * endpoint, accounting }`, or an error result from createErrorResult, with
 * `acceptedJob` when fal may have queued (and may bill) the request. Nothing
 * is resent and nothing is shared between calls, except a definition `store`
 * the caller supplies, which is keyed by this connection's id.
 *
 * @param {object} options
 * @param {{ endpoint: string, request: object } | null} options.built - from buildFalVideoRequest; null discovers the schema
 * @param {string} options.model - the selected model id
 * @param {object} options.body - the caller's request body (used when `built` is null)
 * @param {object} options.credentials - the selected `fal-ai` connection
 */
export async function runFalVideoJob({
  built,
  model,
  body,
  credentials,
  signal,
  log,
  store = null,
  endpointFor,
  timeoutMs = FAL_VIDEO_TIMEOUT_MS,
  submitTimeoutMs = FAL_VIDEO_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = FAL_VIDEO_REQUEST_TIMEOUT_MS,
  discoveryTimeoutMs = FAL_VIDEO_DISCOVERY_TIMEOUT_MS,
  pollIntervalMs = FAL_VIDEO_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  if (signal?.aborted) return abortedResult();
  const token = falVideoToken(credentials);
  // runFalQueue's missing-credential guard: nothing unauthenticated goes upstream.
  if (!token) return createErrorResult(401, "fal API key is required");
  const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, token };
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let job = built;
  if (!job) {
    try {
      const endpoint = endpointFor(model);
      const definition = await discover(endpoint, {
        token, credentials, store, signal, proxyOptions, wait, now, timeoutMs: Math.min(discoveryTimeoutMs, remaining()),
      });
      job = { endpoint, request: falVideoCompatibilityInput(body, definition) };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return abortedResult();
      const status = Number.isInteger(error?.status) ? error.status : HTTP_STATUS.BAD_GATEWAY;
      return createErrorResult(status, error?.message || "fal model discovery failed", undefined, undefined, null, secrets);
    }
  }

  const queueUrl = `${FAL_QUEUE_ORIGIN}/${job.endpoint}`;
  const headers = { Authorization: falAuthorization(token) };
  let response;
  try {
    response = await sendSubmit(queueUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "X-Fal-No-Retry": "1" },
      body: JSON.stringify(job.request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "fal video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `fal video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was queued is unknown`
    ), "submit-unknown");
  }

  // A redirect is refused, never followed with the key. Nothing was queued.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    log?.debug?.("FAL_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "fal video submit redirect refused");
  }
  let answeredBy = FAL_QUEUE_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== FAL_QUEUE_ORIGIN) {
    discard(response);
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "fal video submit was redirected"), "submit-unknown");
  }
  if (!response.ok) return refusedSubmit(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });

  try {
    const queued = await readJson(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "submit response" });
    let video;
    if (queued.request_id === undefined && isRecord(queued.video)) {
      // runFalQueue: a response without a request id may already be the result.
      video = falVideoArtifact(queued);
    } else {
      const requestId = queued.request_id;
      if (!isString(requestId) || !REQUEST_ID_RE.test(requestId)) throw unknownOutcome("submit returned no usable request id");
      const fallback = `${queueUrl}/requests/${encodeURIComponent(requestId)}`;
      const statusUrl = queued.status_url === undefined ? `${fallback}/status` : falVideoTrackingUrl(queued.status_url, requestId);
      const responseUrl = queued.response_url === undefined ? fallback : falVideoTrackingUrl(queued.response_url, requestId);
      video = await awaitResult({ statusUrl, responseUrl, headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now });
    }
    return { success: true, video, endpoint: job.endpoint, accounting: mediaAccounting(null, FAL_VIDEO_PROVIDER_ID, "video") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown ? error.message : "Invalid response from fal",
      undefined, undefined, null, secrets
    );
    // fal reports no billable failure state here, so every accepted request may bill.
    return withAcceptedJob(failed, "accepted");
  }
}
