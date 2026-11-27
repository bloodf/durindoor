// Vertex Veo long-running job: one bounded `:predictLongRunning` submit, a
// bounded `:fetchPredictOperation` poll, and accepted-job accounting.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/vertexMedia.ts (vertexGenerateVideo: POST
// `{model}:predictLongRunning` with `{ instances, parameters }`, the operation
// `name`; POST `{model}:fetchPredictOperation` with `{ operationName }` every
// 10 s for up to 5 min; `done`, `error`, `response.videos[0]`
// `bytesBase64Encoded`) and open-sse/handlers/videoGeneration.ts
// (handleVertexVeoGeneration: `{ created, data: [{ b64_json, format }] }`).
//
// Fork deviations: every fetch and the whole job are time bounded and abort on
// the caller's signal; redirects are refused and a response from any other
// origin is discarded; bodies are size bounded; upstream text never reaches an
// error message (only a Google status or reason of a safe shape, or an rpc
// code); the operation name must name this model; a submit whose outcome is
// unknown, and every accepted operation that is not seen to fail, is reported
// with `acceptedJob` and never resent; the returned video must be base64 MP4.
// A `gcsUri` result is not returned: this adapter never sets `storageUri`, so
// such a result points into a bucket the caller did not choose, and it is
// reported as an unusable completed job (with `acceptedJob`). The source never
// cancels an operation, so neither does this client.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { jobOutcomeUnknown, readJobBody, sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { VERTEX_VIDEO_PROVIDER_ID } from "./config.js";
import { resolveVertexVideoAuth, vertexVideoAction } from "./auth.js";

// The source's bounds, plus per-request bounds of the gateway.
export const VERTEX_VIDEO_POLL_INTERVAL_MS = 10_000;
export const VERTEX_VIDEO_TIMEOUT_MS = 300_000;
export const VERTEX_VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
export const VERTEX_VIDEO_REQUEST_TIMEOUT_MS = 60_000;
export const VERTEX_VIDEO_TOKEN_TIMEOUT_MS = 15_000;
export const VERTEX_VIDEO_MAX_POLL_RETRIES = 5;
export const VERTEX_VIDEO_MAX_RETRY_DELAY_MS = 30_000;

const MAX_ACCEPT_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
// An inline MP4 is returned in the final poll body, base64 encoded.
export const VERTEX_VIDEO_MAX_RESULT_BYTES = 64 * 1024 * 1024;
const OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const CODE_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
const QUOTA_REASONS = new Set(["BILLING_DISABLED"]);
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
// google.rpc.Code of a finished operation that failed.
const OPERATION_ERROR_STATUS = { 3: 400, 7: 403, 8: 429 };

const unknownOutcome = (what, status = HTTP_STATUS.BAD_GATEWAY) => jobOutcomeUnknown(`Vertex Veo ${what}`, status);
const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const safeCode = (value) => (isString(value) && CODE_RE.test(value) ? value : null);

/** Accounting for an operation Vertex may have taken (and may bill) whose outcome is not known. */
export function vertexVideoAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, VERTEX_VIDEO_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}

const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: vertexVideoAcceptedJob(jobState) });
const abortedResult = () => createErrorResult(499, "Vertex video request aborted");

function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

async function readJson(response, { signal, timeoutMs, maxBytes }) {
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
  if (!isRecord(value)) throw unknownOutcome("returned an unreadable operation response");
  return value;
}

/** Whether `name` is an operation of `model` (and of the scope's location, for Bearer scopes). */
export function isVertexVideoOperationName(name, { model, location }) {
  if (!isString(name) || name.length > 512) return false;
  const parts = name.split("/");
  return parts.length === 10 &&
    parts[0] === "projects" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(parts[1]) &&
    parts[2] === "locations" && (location ? parts[3] === location : /^[a-z0-9-]{1,40}$/.test(parts[3])) &&
    parts[4] === "publishers" && parts[5] === "google" &&
    parts[6] === "models" && parts[7] === model &&
    parts[8] === "operations" && OPERATION_ID_RE.test(parts[9]);
}

/** Base64 MP4 bytes (an ISO BMFF `ftyp` box first), or null. */
export function vertexVideoMp4Base64(raw) {
  if (!isString(raw) || raw.length < 16 || raw.length % 4 !== 0 || !BASE64_RE.test(raw)) return null;
  const head = Buffer.from(raw.slice(0, 16), "base64");
  return head.subarray(4, 8).toString("latin1") === "ftyp" ? raw : null;
}

// null while running; the base64 MP4 once done. Throws otherwise.
function settle(operation) {
  if (operation.done !== true) return null;
  if (operation.error !== undefined) {
    const code = isRecord(operation.error) && Number.isInteger(operation.error.code) ? operation.error.code : null;
    throw Object.assign(new Error(`Vertex Veo operation failed${code !== null ? ` (code ${code})` : ""}`), {
      status: OPERATION_ERROR_STATUS[code] ?? HTTP_STATUS.BAD_GATEWAY,
    });
  }
  const result = isRecord(operation.response) ? operation.response : {};
  const videos = Array.isArray(result.videos) ? result.videos : [];
  const video = isRecord(videos[0]) ? videos[0] : null;
  if (!video) {
    const filtered = isNumber(result.raiMediaFilteredCount) && result.raiMediaFilteredCount > 0;
    throw unknownOutcome(filtered ? "operation finished with its video removed by safety filters" : "operation finished without a video");
  }
  if (video.mimeType !== undefined && video.mimeType !== "video/mp4") throw unknownOutcome("operation returned a video that is not MP4");
  if (video.bytesBase64Encoded === undefined && isString(video.gcsUri)) {
    throw unknownOutcome("operation returned a Cloud Storage location instead of video bytes");
  }
  const base64 = vertexVideoMp4Base64(video.bytesBase64Encoded);
  if (!base64) throw unknownOutcome("operation returned unreadable video bytes");
  return base64;
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

// A refused (non-2xx, non-redirect) submit. Only the status, the Google status
// and the first error reason, each of a safe shape, plus a bounded Retry-After
// are kept. Vertex refuses these before an operation exists, except a 5xx,
// whose outcome is unknown.
async function refusedSubmit(response, { signal, timeoutMs, secrets }) {
  const { status } = response;
  let code = null;
  let reason = null;
  try {
    const text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs });
    const error = JSON.parse(text)?.error;
    code = safeCode(error?.status);
    const details = Array.isArray(error?.details) ? error.details : [];
    reason = safeCode(details.find((detail) => isRecord(detail) && safeCode(detail.reason))?.reason);
  } catch {
    discard(response);
  }
  const suffix = code || reason ? ` (${[code, reason].filter(Boolean).join(", ")})` : "";
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Vertex video submit failed with ${status}${suffix}; whether an operation was created is unknown`),
      "submit-unknown"
    );
  }
  if (reason && QUOTA_REASONS.has(reason)) {
    // Billing is off for this project: stays true until the owner enables it, on this connection only.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, `Vertex AI refused video generation for this project${suffix}`, undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401) return createErrorResult(401, `Vertex AI refused the credential for video generation${suffix}`, undefined, undefined, null, secrets);
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `Vertex AI rate limited video generation${suffix}`, usable?.resetAtMs, undefined, usable, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Vertex AI refused the video request with ${status}${suffix}`, undefined, undefined, null, secrets);
}

/**
 * Follow one accepted operation to its video within the job deadline.
 *
 * @returns {Promise<string>} the base64 MP4
 */
async function awaitOperation(operationName, { auth, model, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, maxResultBytes, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const { url, headers } = vertexVideoAction(auth, model, "fetchPredictOperation");
  const body = JSON.stringify({ operationName });
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`operation check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("operation did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    const requestTimeout = AbortSignal.timeout(budget());
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
        proxyOptions,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (requestTimeout.aborted) throw unknownOutcome("operation check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome("operation check failed");
    }
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < VERTEX_VIDEO_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          VERTEX_VIDEO_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`operation check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const operation = await readJson(response, { signal, timeoutMs: budget(), maxBytes: maxResultBytes });
    if (operation.name !== undefined && operation.name !== operationName) throw unknownOutcome("answered about a different operation");
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const result = settle(operation);
    if (result) return result;
  }
}

/**
 * Submit one Veo operation for the selected connection and follow it to its
 * video bytes.
 *
 * Results use the media core shape: `{ success: true, base64, accounting }`,
 * or an error result from createErrorResult, with `acceptedJob` when Vertex
 * may have taken (and may bill) the operation. Nothing is resent, and nothing
 * is shared between calls: the credential, token, operation and proxy belong
 * to this call only.
 *
 * @param {object} options
 * @param {string} options.model - a validated Veo model id
 * @param {object} options.request - the body from buildVertexVideoRequest
 * @param {object} options.credentials - the selected `vertex` connection
 * @param {AbortSignal} [options.signal]
 * @param {Function} [options.mintToken] - Service Account / ADC token minter, for tests
 */
export async function runVertexVideoJob({
  model,
  request,
  credentials,
  signal,
  log,
  mintToken,
  timeoutMs = VERTEX_VIDEO_TIMEOUT_MS,
  submitTimeoutMs = VERTEX_VIDEO_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = VERTEX_VIDEO_REQUEST_TIMEOUT_MS,
  tokenTimeoutMs = VERTEX_VIDEO_TOKEN_TIMEOUT_MS,
  pollIntervalMs = VERTEX_VIDEO_POLL_INTERVAL_MS,
  maxResultBytes = VERTEX_VIDEO_MAX_RESULT_BYTES,
  wait = sleep,
  now = Date.now,
}) {
  if (signal?.aborted) return abortedResult();
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let auth;
  try {
    auth = await resolveVertexVideoAuth(credentials, { mintToken, log, proxyOptions, signal, timeoutMs: Math.min(tokenTimeoutMs, remaining()) });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return abortedResult();
    return createErrorResult(error?.status ?? 401, error?.message || "Vertex credential could not be used", undefined, undefined, null, { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken });
  }
  // Every error below redacts this connection's secrets and the minted token.
  const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, token: auth.token };
  const submit = vertexVideoAction(auth, model, "predictLongRunning");
  const origin = auth.origin;

  let response;
  try {
    response = await sendSubmit(submit.url, {
      method: "POST",
      headers: submit.headers,
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Vertex video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Vertex video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), "submit-unknown");
  }

  // A redirect is refused, never followed with the credential. Nothing was accepted.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    log?.debug?.("VERTEX_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Vertex video submit redirect refused");
  }
  // A followed redirect would mean another host saw the credential and the request.
  let answeredBy = origin;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== origin) {
    discard(response);
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Vertex video submit was redirected"), "submit-unknown");
  }
  if (!response.ok) return refusedSubmit(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });

  try {
    const accepted = await readJson(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_ACCEPT_BYTES });
    const operationName = accepted.name;
    if (!isVertexVideoOperationName(operationName, { model, location: auth.location })) {
      throw unknownOutcome("did not return a usable operation name");
    }
    const base64 = await awaitOperation(operationName, {
      auth, model, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, maxResultBytes, wait, now,
    });
    return { success: true, base64, accounting: mediaAccounting(null, VERTEX_VIDEO_PROVIDER_ID, "video") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.status ? error.message : "Invalid response from Vertex AI",
      undefined, undefined, null, secrets
    );
    // An operation Vertex reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobOutcomeUnknown ? withAcceptedJob(failed, "accepted") : failed;
  }
}
