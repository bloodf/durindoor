// The xAI async video envelope: POST the job to `/v1/videos/generations`
// (or `/edits` / `/extensions`), read `request_id`, then GET
// `/v1/videos/{request_id}` every poll interval until `status` is "done" with
// `video.url` or a failure state. See ./config.js for the source attribution.
//
// Fork deviations from xaiGrokImagineHandler.ts: the credential goes only to
// https://api.x.ai (connection base URLs are ignored); each request is bounded
// as well as the whole job; redirects are refused (`redirect: "manual"`, the
// source used `redirect: "error"`); bodies are bounded at the source's 1 MiB;
// upstream text (`error`, `message`) never reaches an error message, only a
// vendor code of a safe shape; a create whose outcome is unknown, and every
// accepted job not seen to fail, carries `acceptedJob` and is never resent; a
// status answer that is unreadable, lacks a status, has an unknown status or
// names another request is an unknown outcome instead of being polled again; a
// done job without a public https `video.url` ends at once; "expired" is kept
// as accepted work; 429/503 status answers are retried a bounded number of
// times; the result URL is returned, never downloaded.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  XAI_DONE_STATUSES, XAI_FAILED_STATUSES, XAI_JOB_TIMEOUT_MS, XAI_MAX_POLLS, XAI_MAX_POLL_RETRIES,
  XAI_MAX_RESPONSE_BYTES, XAI_MAX_RETRY_DELAY_MS, XAI_PENDING_STATUSES, XAI_POLL_INTERVAL_MS, XAI_PROVIDER_ID,
  XAI_REQUEST_TIMEOUT_MS, XAI_SUBMIT_TIMEOUT_MS, XAI_UNKNOWN_STATUSES, XAI_VIDEO_GENERATIONS_URL, xaiVideoStatusUrl,
} from "./config.js";
import {
  boundedFetch, discard, provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome,
  withAcceptedJob, xaiCredential, xaiErrorCode, xaiPollHeaders, xaiPublicUrl, xaiSecrets, xaiSubmitHeaders,
} from "./http.js";

// Source request_id check, bounded.
export const XAI_REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
const DONE = new Set(XAI_DONE_STATUSES);
const FAILED = new Set(XAI_FAILED_STATUSES);
const UNKNOWN = new Set(XAI_UNKNOWN_STATUSES);
const PENDING = new Set(XAI_PENDING_STATUSES);
const PASSED_POLL_STATUSES = new Set([401, 403, 404, 429]);

const abortedResult = () => createErrorResult(499, "xAI video request aborted");

/** Response-measured seconds only; requested duration is never billed. */
export function xaiVideoSeconds(answer) {
  const raw = answer?.video?.duration ?? answer?.duration;
  const n = isString(raw) && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  return isNumber(n) && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Classify one status answer for `requestId`.
 *
 * @returns {{ state: "pending", status: string } | { state: "done", url: string, answer: object }}
 * @throws a jobFailed error for a reported failure, a jobOutcomeUnknown error otherwise
 */
export function settleXaiStatus(answer, requestId) {
  const echoed = answer.request_id ?? answer.id;
  if (echoed !== undefined && echoed !== requestId) throw unknownOutcome("answered about a different video request");
  if (!isString(answer.status) || !answer.status.trim()) {
    // A body with only an error object is a reported failure; anything else is unreadable.
    if (answer.error !== undefined) throw Object.assign(new Error(`xAI video job failed${codeSuffix(answer)}`), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
    throw unknownOutcome("returned a video status without a status");
  }
  const status = answer.status.trim().toLowerCase();
  if (DONE.has(status)) {
    const url = xaiPublicUrl(isRecord(answer.video) ? answer.video.url : undefined);
    if (!url) throw unknownOutcome("video job finished without a usable video URL");
    return { state: "done", url, answer };
  }
  if (FAILED.has(status)) throw Object.assign(new Error(`xAI video job failed${codeSuffix(answer)}`), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
  if (UNKNOWN.has(status)) throw unknownOutcome(`video job ${status}`);
  if (PENDING.has(status)) return { state: "pending", status };
  throw unknownOutcome("returned an unknown video status");
}

function codeSuffix(answer) {
  const code = xaiErrorCode(answer);
  return code ? ` (${code})` : "";
}

/**
 * One status GET for an accepted request. Returns the parsed answer or throws a
 * jobOutcomeUnknown error carrying `httpStatus` for non-2xx answers.
 */
export async function fetchXaiVideoStatus(requestId, { token, proxyOptions, signal, timeoutMs }) {
  let response;
  try {
    response = await boundedFetch(xaiVideoStatusUrl(requestId), {
      method: "GET", headers: xaiPollHeaders(token), redirect: "manual", proxyOptions,
    }, { signal, timeoutMs });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error?.name === "TimeoutError") throw unknownOutcome("video status check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
    throw unknownOutcome("video status check failed");
  }
  if (redirectState(response)) throw unknownOutcome("video status check was redirected");
  if (!response.ok) {
    discard(response);
    const { status } = response;
    throw Object.assign(
      unknownOutcome(`video status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : HTTP_STATUS.BAD_GATEWAY),
      { httpStatus: status, retryAfter: response.headers.get("retry-after") }
    );
  }
  return readJsonObject(response, { signal, timeoutMs, maxBytes: XAI_MAX_RESPONSE_BYTES, what: "video status" });
}

async function awaitRequest(requestId, { token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  let delay = pollIntervalMs;
  let retries = 0;
  let polls = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline || polls >= maxPolls) {
      throw rejected
        ? unknownOutcome(`video status check returned ${rejected}`, rejected === 429 ? 429 : HTTP_STATUS.BAD_GATEWAY)
        : unknownOutcome(`video job did not finish in time (${polls} polls)`, HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    polls += 1;
    let answer;
    try {
      answer = await fetchXaiVideoStatus(requestId, { token, proxyOptions, signal, timeoutMs: budget() });
    } catch (error) {
      if ((error?.httpStatus === 429 || error?.httpStatus === 503) && retries < XAI_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = error.httpStatus;
        delay = Math.min(XAI_MAX_RETRY_DELAY_MS, Math.max(retryAfterMs(error.retryAfter, now()), pollIntervalMs * 2 ** (retries - 1)));
        continue;
      }
      throw error;
    }
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const settled = settleXaiStatus(answer, requestId);
    if (settled.state === "done") return settled;
  }
}

/**
 * Create one xAI video job. Returns `{ requestId }` or an error result, with
 * `acceptedJob` when xAI may have taken (and may bill) the job. Never resent.
 */
export async function submitXaiVideoJob({ url = XAI_VIDEO_GENERATIONS_URL, request, token, proxyOptions, signal, timeoutMs, requestTimeoutMs, secrets, log, now }) {
  let response;
  try {
    response = await boundedFetch(url, {
      method: "POST", headers: xaiSubmitHeaders(token), body: JSON.stringify(request), redirect: "manual", proxyOptions,
    }, { signal, timeoutMs });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "xAI video create could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `xAI video create ${timedOut ? "did not respond in time" : "was interrupted"}; the job was not resubmitted and whether it was accepted is unknown`
    ), "submit-unknown");
  }
  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("XAI", "video create redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "xAI video create redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "xAI video create was redirected"), "submit-unknown");
  if (!response.ok) return refusedAnswer(response, { signal, timeoutMs: requestTimeoutMs, secrets, now });
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: requestTimeoutMs, maxBytes: XAI_MAX_RESPONSE_BYTES, what: "video create answer" });
    const requestId = isString(accepted.request_id) && XAI_REQUEST_ID_RE.test(accepted.request_id) ? accepted.request_id : null;
    if (!requestId) throw unknownOutcome("video create did not return a usable request_id");
    return { requestId, answer: accepted };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "submit-unknown");
    const status = Number(error?.status);
    return withAcceptedJob(createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown ? error.message : "Invalid response from xAI", undefined, undefined, null, secrets
    ), "submit-unknown");
  }
}

/**
 * Submit one xAI video job for the selected connection and follow it to its
 * result URL. Returns `{ success: true, url, requestId, answer, accounting }`,
 * or an error result, with `acceptedJob` when xAI may have taken (and may bill)
 * the job. Nothing is resent and nothing is shared between calls.
 */
export async function runXaiVideoJob({
  request,
  credentials,
  signal,
  log,
  submitUrl = XAI_VIDEO_GENERATIONS_URL,
  timeoutMs = XAI_JOB_TIMEOUT_MS,
  submitTimeoutMs = XAI_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = XAI_REQUEST_TIMEOUT_MS,
  pollIntervalMs = XAI_POLL_INTERVAL_MS,
  maxPolls = XAI_MAX_POLLS,
  wait = sleep,
  now = Date.now,
}) {
  const credential = xaiCredential(credentials);
  if (!credential) return createErrorResult(401, "xAI API key or OAuth access token is required");
  if (signal?.aborted) return abortedResult();
  const secrets = xaiSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());
  const identity = { authMode: credential.mode, connectionId: credentials?.connectionId ?? null };

  const created = await submitXaiVideoJob({
    url: submitUrl, request, token: credential.token, proxyOptions, signal, secrets, log, now,
    timeoutMs: Math.min(submitTimeoutMs, remaining()),
    requestTimeoutMs: Math.min(requestTimeoutMs, remaining()),
  });
  if (!created.requestId) {
    return created.acceptedJob ? { ...created, acceptedJob: { ...created.acceptedJob, meta: { ...created.acceptedJob.meta, ...identity } } } : created;
  }
  const { requestId } = created;
  try {
    const done = await awaitRequest(requestId, {
      token: credential.token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now,
    });
    const accounting = mediaAccounting(done.answer, XAI_PROVIDER_ID, "video");
    return { success: true, url: done.url, requestId, answer: done.answer, accounting, identity };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted", { jobId: requestId, ...identity });
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from xAI",
      undefined, undefined, null, secrets
    );
    // A job xAI reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, "accepted", { jobId: requestId, ...identity });
  }
}
