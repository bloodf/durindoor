// The Haiper job envelope shared by image and video: POST the job, read
// `job_id`, then GET {statusUrl}/{job_id} every 5 s until `status` is
// "completed"/"succeeded" with `creation_url` (or `output.image_url` /
// `output.video_url`) or "failed". See ./config.js for the source attribution.
//
// Fork deviations: the key goes only to https://api.haiper.ai; each request and
// the whole job are time bounded and abort on the caller's signal; redirects
// are refused; bodies are size bounded; upstream text never reaches an error
// message; a submit whose outcome is unknown, and every accepted job not seen
// to fail, carries `acceptedJob` and is never resent; a status answer without
// a status string or about another job is an unknown outcome instead of being
// polled again; a completed job without a public https result URL ends at once
// instead of polling until the deadline; 429/503 status answers are retried a
// bounded number of times; the result URL is returned, never downloaded.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  HAIPER_JOB_TIMEOUT_MS, HAIPER_MAX_POLL_RETRIES, HAIPER_MAX_RETRY_DELAY_MS, HAIPER_POLL_INTERVAL_MS,
  HAIPER_PROVIDER_ID, HAIPER_REQUEST_TIMEOUT_MS, HAIPER_STATUS_URL, HAIPER_SUBMIT_TIMEOUT_MS,
} from "./config.js";
import {
  boundedFetch, discard, haiperPublicUrl, haiperSecrets, haiperStatusHeaders, haiperSubmitHeaders, haiperToken,
  provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MAX_JSON_BYTES = 64 * 1024;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const DONE = new Set(["completed", "succeeded"]);
const FAILED = "failed";
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
const JOB_FAILED = "job failed";

const abortedResult = (modality) => createErrorResult(499, `Haiper ${modality} request aborted`);

function resultUrlOf(answer, outputField) {
  const output = isRecord(answer.output) ? answer.output : {};
  const raw = [answer.creation_url, output[outputField]].find((value) => isString(value) && value.trim());
  return raw ? haiperPublicUrl(raw) : null;
}

// null while pending; the result URL once completed. Throws otherwise.
function settle(answer, { id, modality, outputField }) {
  if (answer.job_id !== undefined && answer.job_id !== id) throw unknownOutcome(`answered about a different ${modality} job`);
  if (!isString(answer.status)) throw unknownOutcome(`returned a ${modality} status without a status`);
  const status = answer.status.trim().toLowerCase();
  if (DONE.has(status)) {
    const url = resultUrlOf(answer, outputField);
    if (!url) throw unknownOutcome(`${modality} job completed without a usable result URL`);
    return url;
  }
  if (status === FAILED) throw Object.assign(new Error(`Haiper ${modality} ${JOB_FAILED}`), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
  return null;
}

async function awaitJob(id, { modality, outputField, headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = `${HAIPER_STATUS_URL}/${encodeURIComponent(id)}`;
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`${modality} status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome(`${modality} job did not finish in time`, HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    let response;
    try {
      response = await boundedFetch(url, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome(`${modality} status check timed out`, HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome(`${modality} status check failed`);
    }
    if (redirectState(response)) throw unknownOutcome(`${modality} status check was redirected`);
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < HAIPER_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          HAIPER_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`${modality} status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: `${modality} status` });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const result = settle(answer, { id, modality, outputField });
    if (result) return result;
  }
}

/**
 * Submit one Haiper job for the selected connection and follow it to its result
 * URL. Returns `{ success: true, url, jobId, accounting }`, or an error result,
 * with `acceptedJob` when Haiper may have taken (and may bill) the job. Nothing
 * is resent and nothing is shared between calls.
 *
 * @param {object} job
 * @param {"image"|"video"} job.modality
 * @param {string} job.submitUrl - one of the fixed Haiper submit URLs
 * @param {object} job.request - the JSON submit body
 */
export async function runHaiperJob({
  modality,
  submitUrl,
  request,
  credentials,
  signal,
  log,
  timeoutMs = HAIPER_JOB_TIMEOUT_MS,
  submitTimeoutMs = HAIPER_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = HAIPER_REQUEST_TIMEOUT_MS,
  pollIntervalMs = HAIPER_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  const outputField = modality === "image" ? "image_url" : "video_url";
  const token = haiperToken(credentials);
  if (!token) return createErrorResult(401, "Haiper API key is required");
  if (signal?.aborted) return abortedResult(modality);
  const secrets = haiperSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(submitUrl, {
      method: "POST",
      headers: haiperSubmitHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") {
      return unsent ? abortedResult(modality) : withAcceptedJob(abortedResult(modality), modality, "submit-unknown");
    }
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Haiper ${modality} submit could not connect`);
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Haiper ${modality} submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), modality, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("HAIPER", `${modality} submit redirect refused`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Haiper ${modality} submit redirect refused`);
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Haiper ${modality} submit was redirected`), modality, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { modality, label: `${modality} submit`, signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: `${modality} submit answer` });
    const id = isString(accepted.job_id) && JOB_ID_RE.test(accepted.job_id) ? accepted.job_id : null;
    if (!id) throw unknownOutcome(`did not return a usable ${modality} job id`);
    const url = await awaitJob(id, {
      modality, outputField, headers: haiperStatusHeaders(token), proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now,
    });
    return { success: true, url, jobId: id, accounting: mediaAccounting(null, HAIPER_PROVIDER_ID, modality) };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(modality), modality, "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : `Invalid response from Haiper`,
      undefined, undefined, null, secrets
    );
    // A job Haiper reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, modality, "accepted");
  }
}
