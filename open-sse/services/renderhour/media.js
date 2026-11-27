// RenderHour video and speech jobs: credential check, one bounded submit, the
// shared bounded poll (./job.js) and accepted-job accounting. STAGED: only the
// standalone adapters in handlers/videoProviders/renderhour.js and
// handlers/ttsProviders/renderhour.js import this, and no router imports them.
//
// Ported from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
// open-sse/handlers/mediaGeneration/renderhour.ts (runRenderhourJob) and
// open-sse/config/providers/registry/renderhour/mediaModels.ts.
//
// Images go through the shared image core, which owns the same submit policy.
// Video and speech have no shared core that fits a submit-and-poll job yet, so
// this module carries that policy for them, matching imageGenerationCore.js:
// a redirect is refused, the submit is bounded and never retried, a submit that
// may have been sent counts as a possibly billed job, and a refused submit's
// Retry-After reaches account cooldown. Fork deviations from the source are the
// same as for images: an `rh_` key only, a fixed origin, no uploads, and no
// upstream text in job errors.
import { randomUUID } from "node:crypto";
import { createErrorResult, formatProviderError, parseUpstreamError } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { mediaAccounting } from "../../handlers/mediaAccounting.js";
import { readBounded } from "../../handlers/codexSttAudio.js";
import { resolveCredentialProxyOptions } from "../oauthCredentialManager.js";
import {
  RENDERHOUR_GENERATIONS_URL,
  RENDERHOUR_ID,
  RENDERHOUR_MODELS_BY_TASK,
  RENDERHOUR_STAGED_MEDIA,
  renderHourTaskOf,
} from "../../providers/private/renderhour.js";
import { awaitRenderHourJob, RENDERHOUR_MAX_MEDIA_OUTPUTS, RENDERHOUR_REQUEST_TIMEOUT_MS } from "./job.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

const PROVIDER = RENDERHOUR_ID;
export const RENDERHOUR_API_KEY_RE = /^rh_[\x21-\x7e]{1,512}$/;
// Speech files are downloaded so the speech route can return audio bytes.
export const RENDERHOUR_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const RENDERHOUR_DOWNLOAD_TIMEOUT_MS = 60_000;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
// Ledger modality per task, as the shared video and speech routes name them.
const MODALITY = { video: "video", speech: "tts" };
// Fields that make a request a chat request. RenderHour has no chat.
const CHAT_FIELDS = ["messages", "input_messages", "tools", "tool_choice"];

const reject = (message, status = HTTP_STATUS.BAD_REQUEST) => Object.assign(new Error(message), { status });

/** The Authorization value for an `rh_` key. Throws a 401 error otherwise; the key is never quoted. */
export function renderHourAuthorization(credentials) {
  const key = credentials?.apiKey;
  if (!isString(key) || !RENDERHOUR_API_KEY_RE.test(key)) throw reject("RenderHour needs an rh_ API key", 401);
  return `Bearer ${key}`;
}

/**
 * Refuse a model that is not a `task` model, naming the task it belongs to when
 * RenderHour lists it, and refuse a chat-shaped body. Throws a 400 error.
 */
export function assertRenderHourTask(task, model, body = {}) {
  if (isRecord(body) && CHAT_FIELDS.some((field) => body[field] !== undefined)) {
    throw reject("RenderHour has no chat; send a media request");
  }
  const owner = renderHourTaskOf(model);
  if (owner === task) return;
  if (owner) throw reject(`${model} is a RenderHour ${owner} model, not a ${task} model`);
  throw reject(`Unsupported RenderHour ${task} model`);
}

/**
 * The models this connection may request, by task.
 *
 * Static: the pinned source copies its list from RenderHour's GET /v1/models
 * but ships no client for it and does not document its response, so nothing is
 * fetched. Only the key format of the selected connection is checked; whether
 * that account can use each model is unknown (`accountVerified: false`).
 * Built per call from the given credentials, so no account sees another's result.
 */
export function discoverRenderHourModels(credentials, { task } = {}) {
  try {
    renderHourAuthorization(credentials);
  } catch (error) {
    return createErrorResult(error.status, error.message);
  }
  if (task !== undefined && !RENDERHOUR_MODELS_BY_TASK[task]) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Unknown RenderHour task");
  }
  const data = RENDERHOUR_STAGED_MEDIA.models
    .filter((model) => task === undefined || renderHourTaskOf(model.id) === task)
    .map(({ id, name, kind }) => ({ id, name, kind, task: renderHourTaskOf(id), owned_by: PROVIDER }));
  return { success: true, source: "static", accountVerified: false, data };
}

/** Accounting for a job RenderHour took but whose outcome could not be seen. */
export function renderHourAcceptedJob(task, jobState = "accepted") {
  return { ...mediaAccounting(null, PROVIDER, MODALITY[task]), costSource: "accepted-job", meta: { jobState } };
}

const withAcceptedJob = (result, task, jobState) => ({ ...result, acceptedJob: renderHourAcceptedJob(task, jobState) });
const abortedResult = (task) => createErrorResult(499, `RenderHour ${task} request aborted`);
const validStatus = (status) => (Number.isInteger(status) && status >= 400 && status <= 599 ? status : null);

// One POST, torn down on the caller's abort (its reason) or at the deadline (a
// TimeoutError). The wait ends on either even when a transport ignores its
// signal, and an answer that still arrives is cancelled. Same as the image core.
async function sendSubmit(init, { signal, submitTimeoutMs }) {
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
  const pending = fetch(RENDERHOUR_GENERATIONS_URL, { ...init, signal: fetchSignal });
  try {
    return await Promise.race([pending, bound]);
  } catch (error) {
    if (timedOut) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    fetchSignal.removeEventListener("abort", stopWaiting);
    bound.catch(() => {});
    if (fetchSignal.aborted) pending.then((late) => late?.body?.cancel?.().catch(() => {}), () => {});
  }
}

/**
 * Submit one video or speech job and follow it to its files.
 *
 * Results use the media core shape: `{ success: true, files, accounting }`, or an
 * error result from createErrorResult, with `acceptedJob` when RenderHour may
 * have taken (and may bill) the job. Nothing here is shared between calls, so
 * each connection's key, proxy and job stay with that call.
 *
 * @param {object} options
 * @param {"video"|"speech"} options.task
 * @param {object} options.request - the submit body, already validated
 * @param {object} options.credentials - the selected connection
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.count] - most files the job may return
 * @param {number} [options.submitTimeoutMs]
 * @param {object} [options.polling] - poll bounds and clock, for tests; see awaitRenderHourJob
 */
export async function runRenderHourMediaJob({
  task,
  request,
  credentials,
  signal,
  log,
  count = RENDERHOUR_MAX_MEDIA_OUTPUTS,
  submitTimeoutMs = RENDERHOUR_REQUEST_TIMEOUT_MS,
  polling = {},
}) {
  if (!MODALITY[task]) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Unknown RenderHour task");
  let authorization;
  try {
    authorization = renderHourAuthorization(credentials);
  } catch (error) {
    return createErrorResult(error.status, error.message);
  }
  // Proven unsent: nothing has been handed to fetch.
  if (signal?.aborted) return abortedResult(task);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: authorization,
    // One key per submit: this module never replays a submit.
    "Idempotency-Key": randomUUID(),
  };
  const proxyOptions = resolveCredentialProxyOptions(credentials);

  let response;
  try {
    response = await sendSubmit(
      { method: "POST", headers, body: JSON.stringify(request), redirect: "manual", proxyOptions },
      { signal, submitTimeoutMs }
    );
  } catch (error) {
    // Certainly unsent only when fetch was never called or no connection was made.
    const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    const aborted = signal?.aborted || error?.name === "AbortError";
    if (aborted) return unsent ? abortedResult(task) : withAcceptedJob(abortedResult(task), task, "submit-unknown");
    if (unsent) {
      const message = formatProviderError(error, PROVIDER, request.model, HTTP_STATUS.BAD_GATEWAY);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, message, undefined, undefined, null, credentials);
    }
    // The transport text can describe the request, so it is not repeated.
    const timedOut = error?.name === "TimeoutError";
    const failed = createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `${PROVIDER} ${task} submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    );
    return withAcceptedJob(failed, task, "submit-unknown");
  }

  // A redirect is refused, never followed with the key. Nothing was accepted.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    void response.body?.cancel().catch(() => {});
    log?.debug?.("RENDERHOUR", `${task} submit redirect refused`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${PROVIDER} ${task} submit redirect refused`);
  }

  if (!response.ok) {
    let upstream;
    try {
      upstream = await parseUpstreamError(response, null, { provider: PROVIDER, signal });
    } catch (error) {
      // Only an abort escapes the bounded error read. The submit was refused either way.
      if (signal?.aborted || error?.name === "AbortError") return abortedResult(task);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `${PROVIDER} ${task} submit was refused`);
    }
    const { statusCode, message } = upstream;
    const evidence = upstream.rateLimitEvidence;
    // RenderHour's own Retry-After on a refused submit is trusted as the reset.
    const reset = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    const errMsg = formatProviderError(new Error(message), PROVIDER, request.model, statusCode);
    // The selected connection's key is redacted from the message.
    return createErrorResult(statusCode, errMsg, reset?.resetAtMs, undefined, reset, credentials);
  }

  let files;
  try {
    files = await awaitRenderHourJob(response, {
      ...polling,
      task,
      authorization,
      credentials,
      count,
      signal,
    });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(task), task, "accepted");
    const failed = createErrorResult(
      validStatus(Number(error?.status)) ?? HTTP_STATUS.BAD_GATEWAY,
      error?.message || `Invalid response from ${PROVIDER}`,
      undefined, undefined, null, credentials
    );
    // A reported job failure is an ordinary failure; a lost observation may still bill.
    return error?.jobOutcomeUnknown ? withAcceptedJob(failed, task, "accepted") : failed;
  }
  return { success: true, files, accounting: mediaAccounting(null, PROVIDER, MODALITY[task]) };
}

// RenderHour's own hosts. A result file anywhere else is not downloaded.
function isRenderHourFileHost(hostname) {
  return hostname === "renderhour.com" || hostname.endsWith(".renderhour.com");
}

/**
 * Download one finished file of an accepted job, without the key.
 *
 * The job already succeeded, so every failure here keeps the accepted job: it
 * may be billed although its file never reached the caller.
 *
 * @returns {Promise<{ success: true, bytes: Buffer } | object>} the bytes, or an error result with acceptedJob
 */
export async function downloadRenderHourFile(file, task, {
  credentials,
  signal,
  maxBytes = RENDERHOUR_MAX_AUDIO_BYTES,
  timeoutMs = RENDERHOUR_DOWNLOAD_TIMEOUT_MS,
}) {
  const lost = (message, status = HTTP_STATUS.BAD_GATEWAY) =>
    withAcceptedJob(createErrorResult(status, `RenderHour ${task} file ${message}`), task, "accepted");
  if (!isRenderHourFileHost(new URL(file.url).hostname)) return lost("is not on a RenderHour host");
  const timeout = AbortSignal.timeout(timeoutMs);
  const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    // No Authorization: the key only ever goes to the generations endpoint.
    response = await fetch(file.url, {
      method: "GET",
      redirect: "error",
      signal: fetchSignal,
      proxyOptions: resolveCredentialProxyOptions(credentials),
    });
  } catch {
    if (signal?.aborted) return withAcceptedJob(abortedResult(task), task, "accepted");
    return timeout.aborted ? lost("download timed out", HTTP_STATUS.GATEWAY_TIMEOUT) : lost("download failed");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return lost(`download returned ${response.status}`);
  }
  let bytes;
  try {
    bytes = await readBounded(response.body, maxBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
  } catch {
    if (signal?.aborted) return withAcceptedJob(abortedResult(task), task, "accepted");
    return timeout.aborted ? lost("download timed out", HTTP_STATUS.GATEWAY_TIMEOUT) : lost("was unreadable or too large");
  }
  if (bytes.length === 0) return lost("was empty");
  return { success: true, bytes };
}
