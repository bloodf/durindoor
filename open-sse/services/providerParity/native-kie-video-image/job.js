// One KIE task: a createTask submit and a bounded recordInfo poll, shared by
// the staged image and video adapters.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/kie.ts (createTask: POST JSON with Bearer key and
// Content-Type; pollTask: GET {statusUrl}?taskId={id} with the Bearer key only,
// until the state leaves "pending" or the deadline passes) and
// open-sse/utils/kieTask.ts (getKieTaskId: data.taskId then taskId;
// normalizeKieTaskState over data.status ?? data.state ?? data.successFlag;
// parseKieResultJson: data.resultJson as a JSON string or object).
//
// Fork deviations: the key goes only to https://api.kie.ai; every request and
// the whole task are time bounded and abort on the caller's signal; redirects
// are refused; bodies are size bounded; the envelope `code` is honored (a 4xx
// code refuses, anything else non-200 is an unknown outcome); upstream `msg`,
// `failMsg` and `errorMessage` text never reaches an error message; a status
// answer without a state field (the source fell back to the envelope `msg`,
// which reads "success" on every answer) or about another task is an unknown
// outcome; 429/503 status checks are retried a bounded number of times; a
// submit whose outcome is unknown, and every accepted task not seen to fail,
// carries `acceptedJob` and is never resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  KIE_JOB_TIMEOUT_MS, KIE_MAX_POLL_RETRIES, KIE_MAX_POLLS, KIE_MAX_RETRY_DELAY_MS, KIE_POLL_INTERVAL_MS,
  KIE_PROVIDER_ID, KIE_REQUEST_TIMEOUT_MS, KIE_SUBMIT_TIMEOUT_MS,
} from "./config.js";
import {
  boundedFetch, discard, envelopeRefusal, kiePollHeaders, kiePublicUrl, kieSecrets, kieSubmitHeaders, kieToken,
  provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs, safeCode, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_RESULT_JSON_CHARS = 128 * 1024;
const MAX_RESULT_URLS = 16;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PASSED_POLL_STATUSES = new Set([401, 402, 403, 429]);
// The source's normalizeKieTaskState sets, upper-cased.
const SUCCESS_STATES = new Set(["SUCCESS", "1", "FINISHED", "COMPLETE", "COMPLETED", "FIRST_SUCCESS", "ALL_SUCCESS"]);
const FAILED_STATES = new Set(["FAIL", "FAILED", "ERROR", "2", "3", "CREATE_TASK_FAILED", "GENERATE_FAILED"]);

const label = (modality) => `${modality} task`;
const abortedResult = (modality) => createErrorResult(499, `KIE ${modality} request aborted`);

/** The source's normalizeKieTaskState, without its envelope `msg` fallback: null when no state field exists. */
export function kieTaskState(record) {
  const data = isRecord(record?.data) ? record.data : {};
  const raw = data.status ?? data.state ?? data.successFlag;
  if (raw === undefined || raw === null || (!isString(raw) && !Number.isFinite(raw))) return null;
  const state = String(raw).trim().toUpperCase();
  if (SUCCESS_STATES.has(state) || state.includes("SUCCESS")) return "success";
  if (FAILED_STATES.has(state) || state.includes("FAIL") || state.includes("ERROR")) return "failed";
  return "pending";
}

/** getKieTaskId: data.taskId, then a top-level taskId. */
function taskIdOf(answer) {
  const data = isRecord(answer.data) ? answer.data : {};
  for (const value of [data.taskId, answer.taskId]) {
    if (value === undefined || value === null || value === "") continue;
    const id = String(value);
    return (isString(value) || Number.isInteger(value)) && TASK_ID_RE.test(id) ? id : null;
  }
  return null;
}

/** parseKieResultJson: an object, or a bounded JSON string of one; {} otherwise. */
export function kieResultJson(record) {
  const resultJson = isRecord(record?.data) ? record.data.resultJson : undefined;
  if (isString(resultJson)) {
    if (resultJson.length > MAX_RESULT_JSON_CHARS) return {};
    try {
      const parsed = JSON.parse(resultJson);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(resultJson) ? resultJson : {};
}

/** Public https URLs from the given candidates (strings or arrays of strings), de-duplicated, bounded. */
export function collectPublicUrls(candidates) {
  const urls = new Set();
  let unsafe = 0;
  const add = (value) => {
    if (!isString(value) || !value.trim()) return;
    const url = kiePublicUrl(value.trim());
    if (url) urls.add(url);
    else unsafe += 1;
  };
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) candidate.slice(0, MAX_RESULT_URLS).forEach(add);
    else add(candidate);
  }
  return { urls: [...urls].slice(0, MAX_RESULT_URLS), unsafe };
}

function failureMessage(modality, record) {
  const data = isRecord(record?.data) ? record.data : {};
  const code = safeCode(data.failCode) ?? safeCode(data.errorCode);
  return `KIE ${modality} task failed${code ? ` (${code})` : ""}`;
}

// null while pending; the record once successful. Throws otherwise.
function settle(record, { id, modality }) {
  const code = record.code;
  if (code !== undefined && code !== null && code !== 200 && code !== "200") {
    const status = Number(code);
    throw unknownOutcome(`${modality} status check answered code ${Number.isInteger(status) ? status : "unknown"}`,
      PASSED_POLL_STATUSES.has(status) ? status : HTTP_STATUS.BAD_GATEWAY);
  }
  const data = isRecord(record.data) ? record.data : null;
  if (!data) throw unknownOutcome(`returned a ${modality} status without data`);
  if (data.taskId !== undefined && String(data.taskId) !== id) throw unknownOutcome(`answered about a different ${modality} task`);
  const state = kieTaskState(record);
  if (!state) throw unknownOutcome(`returned a ${modality} status without a state`);
  if (state === "failed") throw Object.assign(new Error(failureMessage(modality, record)), { status: HTTP_STATUS.BAD_GATEWAY, kieTaskFailed: true });
  return state === "success" ? record : null;
}

async function awaitTask(id, { modality, statusUrl, headers, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = `${statusUrl}?taskId=${encodeURIComponent(id)}`;
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let polls = 0;
  for (;;) {
    if (polls >= maxPolls || now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`${modality} status check returned ${rejected}`, rejected === 429 ? 429 : HTTP_STATUS.BAD_GATEWAY)
        : unknownOutcome(`${modality} task did not finish in time`, HTTP_STATUS.GATEWAY_TIMEOUT);
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
      if ((status === 429 || status === 503) && retries < KIE_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(KIE_MAX_RETRY_DELAY_MS, Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1)));
        continue;
      }
      throw unknownOutcome(`${modality} status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : HTTP_STATUS.BAD_GATEWAY);
    }
    polls += 1;
    const record = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: `${modality} status` });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const done = settle(record, { id, modality });
    if (done) return done;
  }
}

/**
 * Submit one KIE task for the selected connection and follow it until it
 * succeeds. `extractUrls(record)` turns the successful record into candidate
 * result URLs (strings or arrays). Results: `{ success: true, urls, taskId,
 * accounting }` or an error result, with `acceptedJob` when KIE may have taken
 * (and may bill) the task. Nothing is resent and nothing is shared between calls.
 */
export async function runKieTask({
  modality,
  createUrl,
  statusUrl,
  request,
  extractUrls,
  credentials,
  signal,
  log,
  timeoutMs = KIE_JOB_TIMEOUT_MS,
  submitTimeoutMs = KIE_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = KIE_REQUEST_TIMEOUT_MS,
  pollIntervalMs = KIE_POLL_INTERVAL_MS,
  maxPolls = KIE_MAX_POLLS,
  wait = sleep,
  now = Date.now,
}) {
  const token = kieToken(credentials);
  if (!token) return createErrorResult(401, "KIE API key is required");
  if (signal?.aborted) return abortedResult(modality);
  const secrets = kieSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(createUrl, {
      method: "POST",
      headers: kieSubmitHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") {
      return unsent ? abortedResult(modality) : withAcceptedJob(abortedResult(modality), modality, "submit-unknown");
    }
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `KIE ${modality} submit could not connect`);
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `KIE ${modality} submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), modality, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("KIE", `${modality} submit redirect refused`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `KIE ${modality} submit redirect refused`);
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, `KIE ${modality} submit was redirected`), modality, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { modality, label: `${modality} submit`, signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  let accepted;
  try {
    accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: `${modality} submit answer` });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(modality), modality, "submit-unknown");
    return withAcceptedJob(createErrorResult(error?.status ?? HTTP_STATUS.BAD_GATEWAY, error.message), modality, "submit-unknown");
  }
  const refused = envelopeRefusal(accepted, { modality, label: label(modality), secrets });
  if (refused) return refused;

  try {
    const id = taskIdOf(accepted);
    if (!id) throw unknownOutcome(`did not return a usable ${modality} task id`);
    const record = await awaitTask(id, {
      modality, statusUrl, headers: kiePollHeaders(token), proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now,
    });
    const { urls, unsafe } = collectPublicUrls(extractUrls(record));
    if (urls.length === 0) {
      throw unknownOutcome(`${modality} task succeeded without a usable ${unsafe ? "public https " : ""}result URL`);
    }
    return { success: true, urls, taskId: id, accounting: mediaAccounting(null, KIE_PROVIDER_ID, modality) };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(modality), modality, "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.kieTaskFailed ? error.message : `Invalid response from KIE`,
      undefined, undefined, null, secrets
    );
    // A task KIE reports as failed is an ordinary failure; anything else may still bill.
    return error?.kieTaskFailed ? failed : withAcceptedJob(failed, modality, "accepted");
  }
}
