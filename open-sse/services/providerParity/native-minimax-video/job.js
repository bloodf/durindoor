// The MiniMax v1 video task envelope: POST the task to `/v1/video_generation`,
// read `task_id`, GET `/v1/query/video_generation?task_id=<id>` every poll
// interval until `status` is `Success` with a `file_id` or `Fail`, then GET
// `/v1/files/retrieve?file_id=<id>` for `file.download_url`. Every step checks
// `base_resp.status_code` as well as the HTTP status. See ./config.js for the
// source attribution.
//
// Fork deviations from minimaxHandler.ts: the key goes only to
// https://api.minimax.io (provider config URLs are fixed); each request and the
// whole job are time bounded and abort on the caller's signal (the source passed
// no signal and left each fetch unbounded); redirects are refused; bodies are
// size bounded; `base_resp.status_msg` never reaches an error message; a submit
// whose outcome is unknown, and every accepted task not seen to fail, carries
// `acceptedJob` and is never resent; a status answer that is unreadable, about
// another task, or carries an unexpected `base_resp` code is an unknown outcome;
// a succeeded task without a usable `file_id` or public https download URL ends
// at once; 429/503 (and code 1002) answers are retried a bounded number of times
// on both the query and the file lookup; the result URL is returned, never
// downloaded.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  MINIMAX_FAILED_STATUSES, MINIMAX_JOB_TIMEOUT_MS, MINIMAX_MAX_POLL_RETRIES, MINIMAX_MAX_RETRY_DELAY_MS,
  MINIMAX_POLL_INTERVAL_MS, MINIMAX_PROVIDER_ID, MINIMAX_RATE_LIMIT_CODE, MINIMAX_REFUSAL_CODES,
  MINIMAX_REQUEST_TIMEOUT_MS, MINIMAX_SUBMIT_TIMEOUT_MS, MINIMAX_SUCCESS_STATUSES, MINIMAX_VIDEO_CREATE_URL,
  minimaxFileUrl, minimaxQueryUrl,
} from "./config.js";
import {
  baseRespCode, boundedFetch, discard, minimaxPollHeaders, minimaxPublicUrl, minimaxRefusal, minimaxSecrets,
  minimaxSubmitHeaders, minimaxToken, provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs,
  unknownOutcome, withAcceptedJob,
} from "./http.js";

const MAX_JSON_BYTES = 64 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DONE = new Set(MINIMAX_SUCCESS_STATUSES);
const FAILED = new Set(MINIMAX_FAILED_STATUSES);
const PASSED_STATUSES = new Set([401, 402, 403, 429]);

const abortedResult = () => createErrorResult(499, "MiniMax video request aborted");

/** A task or file id as a string (MiniMax sends either), or null when unusable. */
function idOf(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return isString(value) && ID_RE.test(value) ? value : null;
}

// The HTTP status a non-zero base_resp code on an accepted task is surfaced with.
const codeStatus = (code) => (PASSED_STATUSES.has(MINIMAX_REFUSAL_CODES[code]) ? MINIMAX_REFUSAL_CODES[code] : HTTP_STATUS.BAD_GATEWAY);

/**
 * One GET to the fixed origin after `delay`, retrying 429/503 and code 1002 a
 * bounded number of times. Returns `{ answer, code }`; throws an unknown outcome
 * on anything else that is not a readable 2xx JSON object.
 */
async function getAnswer(url, what, { headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }, delay) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline || now() >= deadline) {
      throw rejected
        ? unknownOutcome(`${what} returned ${rejected}`, rejected === 429 ? 429 : HTTP_STATUS.BAD_GATEWAY)
        : unknownOutcome("video task did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    if (delay) await wait(delay, signal);
    signal?.throwIfAborted();
    let response;
    try {
      response = await boundedFetch(url, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome(`${what} timed out`, HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome(`${what} failed`);
    }
    if (redirectState(response)) throw unknownOutcome(`${what} was redirected`);
    const backoff = (status) => {
      retries += 1;
      rejected = status;
      delay = Math.min(
        MINIMAX_MAX_RETRY_DELAY_MS,
        Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
      );
    };
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < MINIMAX_MAX_POLL_RETRIES) {
        backoff(status);
        continue;
      }
      throw unknownOutcome(`${what} returned ${status}`, PASSED_STATUSES.has(status) ? status : HTTP_STATUS.BAD_GATEWAY);
    }
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what });
    const code = baseRespCode(answer);
    if (code === MINIMAX_RATE_LIMIT_CODE && retries < MINIMAX_MAX_POLL_RETRIES) {
      backoff(429);
      continue;
    }
    return { answer, code };
  }
}

// null while pending; the file id once succeeded. Throws otherwise.
function settle({ answer, code }, taskId) {
  if (answer.task_id !== undefined && idOf(answer.task_id) !== taskId) throw unknownOutcome("answered about a different video task");
  const status = isString(answer.status) ? answer.status.trim().toLowerCase() : "";
  if (FAILED.has(status)) {
    // MiniMax reports the task as failed; the reason text is not quoted.
    throw Object.assign(new Error(`MiniMax video task failed${code ? ` (code ${code})` : ""}`), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
  }
  if (code === null) throw unknownOutcome("returned a video status with an unreadable base_resp");
  if (code !== 0) throw unknownOutcome(`video status check failed (code ${code})`, codeStatus(code));
  if (!status) throw unknownOutcome("returned a video status without a status");
  if (DONE.has(status)) {
    const fileId = idOf(answer.file_id);
    if (!fileId) throw unknownOutcome("video task succeeded without a usable file_id");
    return fileId;
  }
  return null;
}

function downloadUrlOf({ answer, code }, fileId) {
  if (code === null) throw unknownOutcome("returned a video file with an unreadable base_resp");
  if (code !== 0) throw unknownOutcome(`video file lookup failed (code ${code})`, codeStatus(code));
  const file = isRecord(answer.file) ? answer.file : null;
  if (!file) throw unknownOutcome("video file lookup returned no file");
  if (file.file_id !== undefined && idOf(file.file_id) !== fileId) throw unknownOutcome("video file lookup answered about a different file");
  const url = minimaxPublicUrl(file.download_url);
  if (!url) throw unknownOutcome("video file lookup returned no usable download URL");
  return url;
}

/**
 * Submit one MiniMax video task for the selected connection, follow it, and
 * resolve its file to a download URL. Returns `{ success: true, url, taskId,
 * fileId, accounting }`, or an error result, with `acceptedJob` when MiniMax
 * may have taken (and may bill) the task. Nothing is resent and nothing is
 * shared between calls.
 */
export async function runMinimaxVideoTask({
  request,
  credentials,
  signal,
  log,
  timeoutMs = MINIMAX_JOB_TIMEOUT_MS,
  submitTimeoutMs = MINIMAX_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = MINIMAX_REQUEST_TIMEOUT_MS,
  pollIntervalMs = MINIMAX_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  const token = minimaxToken(credentials);
  if (!token) return createErrorResult(401, "MiniMax API key is required");
  if (signal?.aborted) return abortedResult();
  const secrets = minimaxSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(MINIMAX_VIDEO_CREATE_URL, {
      method: "POST",
      headers: minimaxSubmitHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `MiniMax video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("MINIMAX", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax video submit redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "MiniMax video submit was redirected"), "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets, now });
  }

  let taskId = null;
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "video submit answer" });
    const code = baseRespCode(accepted);
    if (code !== 0 && code !== null) {
      // HTTP 200 with a refusal code: MiniMax did not take the task.
      const refusal = minimaxRefusal({ code, retryAfter: response.headers.get("retry-after"), secrets, now });
      if (refusal) return refusal;
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `MiniMax video submit failed (code ${code}); whether it was accepted is unknown`), "submit-unknown");
    }
    if (code === null) throw unknownOutcome("returned a video submit answer with an unreadable base_resp");
    taskId = idOf(accepted.task_id);
    if (!taskId) throw unknownOutcome("did not return a usable video task id");
    const ctx = { headers: minimaxPollHeaders(token), proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now };
    let fileId = null;
    while (!fileId) fileId = settle(await getAnswer(minimaxQueryUrl(taskId), "video status check", ctx, pollIntervalMs), taskId);
    const url = downloadUrlOf(await getAnswer(minimaxFileUrl(fileId), "video file lookup", ctx, 0), fileId);
    return { success: true, url, taskId, fileId, accounting: mediaAccounting(null, MINIMAX_PROVIDER_ID, "video") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from MiniMax",
      undefined, undefined, null, secrets
    );
    // A task MiniMax reports as failed is an ordinary failure; anything else may still bill.
    if (error?.jobFailed) return failed;
    const withJob = withAcceptedJob(failed, "accepted");
    if (taskId) withJob.acceptedJob.meta.jobId = taskId;
    return withJob;
  }
}
