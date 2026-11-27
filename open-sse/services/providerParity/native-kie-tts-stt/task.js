// Kie job task: one POST /api/v1/jobs/createTask, then a bounded GET
// /api/v1/jobs/recordInfo?taskId= poll until the task settles. Shared by the
// staged speech and transcription adapters. See ./config.js for attribution.
//
// Source behavior kept: Bearer key on both requests, JSON submit body, task id
// from `data.taskId` then `taskId`, an answer without a task id read as a
// synchronous result, recordInfo state from `data.status`, `data.state` or
// `data.successFlag` (normalizeKieTaskState), a 2 s poll interval, and a poll
// deadline (60 s speech, 120 s transcription).
//
// Fork deviations: the key only goes to https://api.kie.ai (connection base
// URLs are ignored); each request and the whole task are time bounded and stop
// on the caller's signal; redirects are refused; bodies are size bounded; Kie's
// text never reaches an error message; a 200 envelope whose `code` is not 200
// is a refusal, not a success; the source's `record.msg` state fallback is
// dropped (its "success" names the API call, not the task); a record about
// another task is an unknown outcome; 429/503 status answers are retried a
// bounded number of times; a submit whose outcome is unknown, and every
// accepted task not seen to fail, carries `acceptedJob` and is never resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  KIE_CREATE_TASK_URL, KIE_MAX_POLL_RETRIES, KIE_MAX_RETRY_DELAY_MS, KIE_POLL_INTERVAL_MS, KIE_PROVIDER_ID,
  KIE_RECORD_INFO_URL, KIE_REQUEST_TIMEOUT_MS, KIE_SUBMIT_TIMEOUT_MS,
} from "./config.js";
import {
  boundedFetch, discard, envelopeCode, kieSecrets, kieStatusHeaders, kieSubmitHeaders, kieToken, provenUnsent,
  readJsonObject, redirectState, refusal, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MAX_JSON_BYTES = 256 * 1024;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const TRANSIENT = new Set([429, 503]);
const PASSED_POLL_STATUSES = new Set([401, 402, 403, 429]);
const TASK_FAILED = "Kie task failed";

const abortedResult = (label) => createErrorResult(499, `Kie ${label} request aborted`);

/**
 * Source normalizeKieTaskState (utils/kieTask.ts) without its `record.msg`
 * fallback: a record without a task state is still pending.
 *
 * @returns {"success" | "failed" | "pending"}
 */
export function normalizeKieTaskState(record) {
  const data = isRecord(record?.data) ? record.data : {};
  const raw = [data.status, data.state, data.successFlag].find((value) => value !== undefined && value !== null);
  if (raw === undefined || isRecord(raw) || Array.isArray(raw)) return "pending";
  const state = String(raw).toUpperCase();
  if (["SUCCESS", "1", "FINISHED", "COMPLETE", "COMPLETED", "FIRST_SUCCESS", "ALL_SUCCESS"].includes(state) || state.includes("SUCCESS")) {
    return "success";
  }
  if (["FAIL", "FAILED", "ERROR", "2", "3"].includes(state) || state.includes("FAIL") || state.includes("ERROR")) return "failed";
  return "pending";
}

/** Source parseKieResultJson: `data.resultJson` as an object, parsing a JSON string. */
export function parseKieResultJson(record) {
  const resultJson = isRecord(record?.data) ? record.data.resultJson : undefined;
  if (isString(resultJson)) {
    try {
      const parsed = JSON.parse(resultJson);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(resultJson) ? resultJson : {};
}

/** Source getKieTaskId: `data.taskId` then `taskId`. Returns undefined when absent, null when unusable. */
function taskIdOf(answer) {
  const data = isRecord(answer.data) ? answer.data : {};
  const raw = data.taskId ?? answer.taskId;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const id = isString(raw) || Number.isInteger(raw) ? String(raw) : "";
  return TASK_ID_RE.test(id) ? id : null;
}

async function awaitTask(id, { label, headers, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = `${KIE_RECORD_INFO_URL}?taskId=${encodeURIComponent(id)}`;
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`${label} status check returned ${rejected}`, rejected === 429 ? 429 : HTTP_STATUS.BAD_GATEWAY)
        : unknownOutcome(`${label} task did not finish in time`, HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    let response;
    try {
      response = await boundedFetch(url, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome(`${label} status check timed out`, HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome(`${label} status check failed`);
    }
    if (redirectState(response)) throw unknownOutcome(`${label} status check was redirected`);
    let status = response.status;
    let retryAfter = response.headers.get("retry-after");
    let record = null;
    if (response.ok) {
      record = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: `${label} status` });
      status = envelopeCode(record) ?? status;
    } else {
      discard(response);
    }
    if (status < 200 || status >= 300) {
      // Transient waits are bounded separately (source #15536 pattern).
      if (TRANSIENT.has(status) && retries < KIE_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(KIE_MAX_RETRY_DELAY_MS, Math.max(retryAfterMs(retryAfter, now()), pollIntervalMs * 2 ** (retries - 1)));
        continue;
      }
      throw unknownOutcome(`${label} status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : HTTP_STATUS.BAD_GATEWAY);
    }
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    retryAfter = null;
    const echoed = isRecord(record.data) ? record.data.taskId : undefined;
    if (echoed !== undefined && echoed !== null && String(echoed) !== id) throw unknownOutcome(`answered about a different ${label} task`);
    const state = normalizeKieTaskState(record);
    if (state === "success") return record;
    if (state === "failed") throw Object.assign(new Error(TASK_FAILED), { status: HTTP_STATUS.BAD_GATEWAY });
  }
}

/**
 * Submit one Kie task for the selected connection and follow it to a settled
 * record. `read(record, { polled })` turns a successful record (or a synchronous submit
 * answer without a task id) into the result value, or returns null when it
 * holds none. Results: `{ success: true, value, taskId, accounting }`, or an
 * error result, with `acceptedJob` when Kie may have taken (and may bill)
 * the task. Nothing is resent and nothing is shared between calls.
 */
export async function runKieTask({
  modality,
  label,
  payload,
  read,
  credentials,
  signal,
  log,
  timeoutMs,
  submitTimeoutMs = KIE_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = KIE_REQUEST_TIMEOUT_MS,
  pollIntervalMs = KIE_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  const token = kieToken(credentials);
  if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Kie API key is required");
  if (signal?.aborted) return abortedResult(label);
  const secrets = kieSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());
  const context = { modality, label, secrets };

  let response;
  try {
    response = await boundedFetch(KIE_CREATE_TASK_URL, {
      method: "POST",
      headers: kieSubmitHeaders(token),
      body: JSON.stringify(payload),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult(label) : withAcceptedJob(abortedResult(label), modality, "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Kie ${label} submit could not connect`);
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Kie ${label} submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), modality, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("KIE_AUDIO", `${label} submit redirect refused`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Kie ${label} submit redirect refused`);
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Kie ${label} submit was redirected`), modality, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { ...context, signal, timeoutMs: Math.min(requestTimeoutMs, remaining()) });
  }

  let taskId = null;
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: `${label} submit answer` });
    const refusedCode = envelopeCode(accepted);
    if (refusedCode !== null) return refusal(refusedCode, context);
    taskId = taskIdOf(accepted);
    if (taskId === null) throw unknownOutcome(`returned an unusable ${label} task id`);
    let record = accepted;
    if (taskId !== undefined) {
      record = await awaitTask(taskId, {
        label, headers: kieStatusHeaders(token), proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now,
      });
    }
    const value = read(record, { polled: taskId !== undefined });
    if (value === null || value === undefined) {
      throw unknownOutcome(taskId ? `${label} task completed without a usable result` : `${label} submit returned neither a task id nor a result`);
    }
    return { success: true, value, taskId: taskId ?? null, accounting: mediaAccounting(null, KIE_PROVIDER_ID, modality) };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(label), modality, "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown ? error.message : error?.message === TASK_FAILED ? `Kie ${label} task failed` : `Invalid response from Kie ${label}`,
      undefined, undefined, null, secrets
    );
    // A task Kie reports as failed is an ordinary failure; anything else may still bill.
    return error?.message === TASK_FAILED ? failed : withAcceptedJob(failed, modality, "accepted");
  }
}
