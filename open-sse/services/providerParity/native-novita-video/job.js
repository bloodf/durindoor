// The Novita async task envelope: POST the task to `/v3/async/{model}`, read
// `task_id`, then GET `/v3/async/task-result?task_id=<id>` every poll interval
// until `task.status` is a success state with `videos[0].video_url` or a
// failure state. See ./config.js for the source attribution.
//
// Fork deviations from novitaHandler.ts: the key goes only to
// https://api.novita.ai (connection base URLs are ignored); each request and
// the whole job are time bounded and abort on the caller's signal (the source
// left the submit unbounded and unabortable); redirects are refused; bodies
// are size bounded; upstream text (`message`, `task.reason`) never reaches an
// error message; a submit whose outcome is unknown, and every accepted task not
// seen to fail, carries `acceptedJob` and is never resent; a status answer
// that is unreadable, lacks a status or is about another task is an unknown
// outcome instead of being polled again; a succeeded task without a public
// https video URL ends at once; `UNKNOWN_ERROR` is kept as accepted work, not
// an ordinary failure; 429/503 status answers are retried a bounded number of
// times; the result URL is returned, never downloaded.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NOVITA_FAILED_STATUSES, NOVITA_JOB_TIMEOUT_MS, NOVITA_MAX_POLL_RETRIES, NOVITA_MAX_RETRY_DELAY_MS,
  NOVITA_POLL_INTERVAL_MS, NOVITA_PROVIDER_ID, NOVITA_REQUEST_TIMEOUT_MS, NOVITA_SUBMIT_TIMEOUT_MS,
  NOVITA_SUCCESS_STATUSES, NOVITA_UNKNOWN_STATUSES, novitaTaskResultUrl,
} from "./config.js";
import {
  boundedFetch, discard, novitaPollHeaders, novitaPublicUrl, novitaSecrets, novitaSubmitHeaders, novitaToken,
  provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MAX_JSON_BYTES = 64 * 1024;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DONE = new Set(NOVITA_SUCCESS_STATUSES);
const FAILED = new Set(NOVITA_FAILED_STATUSES);
const UNKNOWN = new Set(NOVITA_UNKNOWN_STATUSES);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);

const abortedResult = () => createErrorResult(499, "Novita video request aborted");

// The source read only `videos[0].video_url`.
function resultUrlOf(answer) {
  const first = Array.isArray(answer.videos) ? answer.videos[0] : null;
  return isRecord(first) ? novitaPublicUrl(first.video_url) : null;
}

// null while pending; the result URL once succeeded. Throws otherwise.
function settle(answer, id) {
  const task = isRecord(answer.task) ? answer.task : null;
  if (!task) throw unknownOutcome("returned a video status without a task");
  if (task.task_id !== undefined && task.task_id !== id) throw unknownOutcome("answered about a different video task");
  if (!isString(task.status) || !task.status.trim()) throw unknownOutcome("returned a video status without a status");
  const status = task.status.trim();
  if (DONE.has(status)) {
    const url = resultUrlOf(answer);
    if (!url) throw unknownOutcome("video task succeeded without a usable video URL");
    return url;
  }
  if (FAILED.has(status)) throw Object.assign(new Error("Novita video task failed"), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
  if (UNKNOWN.has(status)) throw unknownOutcome("video task ended with an unknown error");
  return null;
}

async function awaitTask(id, { headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = novitaTaskResultUrl(id);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`video status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video task did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    let response;
    try {
      response = await boundedFetch(url, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome("video status check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome("video status check failed");
    }
    if (redirectState(response)) throw unknownOutcome("video status check was redirected");
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < NOVITA_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          NOVITA_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`video status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "video status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const result = settle(answer, id);
    if (result) return result;
  }
}

/**
 * Submit one Novita video task for the selected connection and follow it to
 * its result URL. Returns `{ success: true, url, taskId, accounting }`, or an
 * error result, with `acceptedJob` when Novita may have taken (and may bill)
 * the task. Nothing is resent and nothing is shared between calls.
 */
export async function runNovitaVideoTask({
  submitUrl,
  request,
  credentials,
  signal,
  log,
  timeoutMs = NOVITA_JOB_TIMEOUT_MS,
  submitTimeoutMs = NOVITA_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = NOVITA_REQUEST_TIMEOUT_MS,
  pollIntervalMs = NOVITA_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  const token = novitaToken(credentials);
  if (!token) return createErrorResult(401, "Novita AI API key is required");
  if (signal?.aborted) return abortedResult();
  const secrets = novitaSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(submitUrl, {
      method: "POST",
      headers: novitaSubmitHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Novita video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Novita video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("NOVITA", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Novita video submit redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Novita video submit was redirected"), "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets, now });
  }

  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "video submit answer" });
    const id = isString(accepted.task_id) && TASK_ID_RE.test(accepted.task_id) ? accepted.task_id : null;
    if (!id) throw unknownOutcome("did not return a usable video task id");
    const url = await awaitTask(id, {
      headers: novitaPollHeaders(token), proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now,
    });
    return { success: true, url, taskId: id, accounting: mediaAccounting(null, NOVITA_PROVIDER_ID, "video") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from Novita",
      undefined, undefined, null, secrets
    );
    // A task Novita reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, "accepted");
  }
}
