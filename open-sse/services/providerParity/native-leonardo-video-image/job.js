// Leonardo generation job: one submit, then a bounded poll of
// GET /api/rest/v1/generations/{generationId} until COMPLETE or FAILED.
// Both kinds share it; they differ in the submit URL, the job field of the
// submit answer and how the result URL is read from the finished generation.
//
// Source (OmniRoute c71f0065, see ./config.js): leonardo.ts and
// leonardoHandler.ts submit with `Content-Type` + `Authorization: Bearer`,
// read `sdGenerationJob.generationId` / `motionVideoGenerationJob.generationId`,
// poll with `Authorization: Bearer` only, read `generations_by_pk || answer`,
// and stop on `status` "COMPLETE" (with a result) or "FAILED".
//
// Fork deviations: fixed origin, manual redirects, every request and the whole
// job are time bounded and abortable; a submit whose outcome is unknown, and
// every accepted job not seen to fail, carries `acceptedJob` and is never
// resent; poll 429/503 answers are retried within bounds, other poll errors,
// unreadable answers, an answer about another generation, a missing status,
// and a COMPLETE generation without a usable result are unknown outcomes
// (the source kept polling or threw).
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  LEONARDO_JOB_TIMEOUT_MS, LEONARDO_MAX_POLL_RETRIES, LEONARDO_MAX_POLLS, LEONARDO_MAX_RETRY_DELAY_MS,
  LEONARDO_POLL_INTERVAL_MS, LEONARDO_REQUEST_TIMEOUT_MS, LEONARDO_SUBMIT_TIMEOUT_MS, leonardoStatusUrl,
} from "./config.js";
import {
  boundedFetch, discard, leonardoPollHeaders, leonardoSecrets, leonardoSubmitHeaders, leonardoToken, provenUnsent,
  readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MAX_JSON_BYTES = 256 * 1024;
const GENERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
const JOB_FAILED = "Leonardo generation failed";

const failedJob = () => Object.assign(new Error(JOB_FAILED), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });

/** The accepted generation id, or null when it is missing or of an unsafe shape. */
function generationIdOf(accepted, jobField) {
  const job = accepted[jobField];
  const id = isRecord(job) ? job.generationId : undefined;
  return isString(id) && GENERATION_ID_RE.test(id) ? id : null;
}

// null while pending; the extracted result once COMPLETE. Throws otherwise.
function settle(answer, { id, extract }) {
  const generation = "generations_by_pk" in answer ? answer.generations_by_pk : answer;
  if (!isRecord(generation)) throw unknownOutcome("status answer has no generation");
  if (isString(generation.id) && generation.id !== id) throw unknownOutcome("answered about a different generation");
  if (!isString(generation.status)) throw unknownOutcome("returned a generation without a status");
  const status = generation.status.trim().toUpperCase();
  if (status === "COMPLETE") {
    const result = extract(generation);
    if (!result) throw unknownOutcome("generation completed without a usable result");
    return result;
  }
  if (status === "FAILED") throw failedJob();
  return null;
}

async function awaitGeneration(id, { extract, token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = leonardoStatusUrl(id);
  const headers = leonardoPollHeaders(token);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let polls = 0;
  for (;;) {
    if (polls >= maxPolls || now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("generation did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    let response;
    try {
      response = await boundedFetch(url, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome("status check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome("status check failed");
    }
    if (redirectState(response)) throw unknownOutcome("status check was redirected");
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < LEONARDO_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          LEONARDO_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    polls += 1;
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "generation status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const result = settle(answer, { id, extract });
    if (result) return result;
  }
}

/**
 * Submit one Leonardo generation for the selected connection and follow it
 * to its result. Returns `{ success: true, result, generationId }`, or an
 * error result, with `acceptedJob` when Leonardo may have taken (and may
 * bill) the job. Nothing is resent and nothing is shared between calls.
 *
 * @param {object} job
 * @param {"image"|"video"} job.modality
 * @param {string} job.submitUrl - fixed Leonardo submit URL
 * @param {object} job.request - submit body
 * @param {string} job.jobField - `sdGenerationJob` or `motionVideoGenerationJob`
 * @param {(generation: object) => any} job.extract - usable result of a COMPLETE generation, or null
 */
export async function runLeonardoJob({
  modality,
  label,
  submitUrl,
  request,
  jobField,
  extract,
  credentials,
  signal,
  log,
  timeoutMs = LEONARDO_JOB_TIMEOUT_MS,
  submitTimeoutMs = LEONARDO_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = LEONARDO_REQUEST_TIMEOUT_MS,
  pollIntervalMs = LEONARDO_POLL_INTERVAL_MS,
  maxPolls = LEONARDO_MAX_POLLS,
  wait = sleep,
  now = Date.now,
}) {
  const aborted = () => createErrorResult(499, `Leonardo ${label} request aborted`);
  const token = leonardoToken(credentials);
  if (!token) return createErrorResult(401, "Leonardo API key is required");
  if (signal?.aborted) return aborted();
  const secrets = leonardoSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(submitUrl, {
      method: "POST",
      headers: leonardoSubmitHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : withAcceptedJob(aborted(), modality, "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Leonardo ${label} submit could not connect`);
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Leonardo ${label} submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), modality, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("LEONARDO", `${label} submit redirect refused`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Leonardo ${label} submit redirect refused`);
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Leonardo ${label} submit was redirected`), modality, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { modality, label: `${label} submit`, signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: `${label} submit answer` });
    const generationId = generationIdOf(accepted, jobField);
    if (!generationId) throw unknownOutcome(`did not return a usable ${label} generation id`);
    const result = await awaitGeneration(generationId, {
      extract, token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now,
    });
    return { success: true, result, generationId };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(aborted(), modality, "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : `Invalid response from Leonardo ${label}`,
      undefined, undefined, null, secrets
    );
    // A generation Leonardo reports FAILED is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, modality, "accepted");
  }
}
