// deAPI native text-to-video: POST https://oai.deapi.ai/v1/videos, a bounded
// poll of GET /v1/videos/{id}, then one key-gated GET /v1/videos/{id}/content.
// Staged for /v1/video/generations under the VIDEO_GENERATION_ADAPTERS
// contract and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`deapi`, format "deapi-video-job") and
// open-sse/handlers/videoGeneration/job.ts (preset "deapi-video-job": submit
// body `{ model, prompt, seconds: String(duration), ...extras }` with
// `Content-Type` + `Authorization: Bearer`, job id `id`, poll with the same
// key, status `queued` -> `in_progress` -> `completed` | `failed`, no URL in
// the finished object, the clip downloaded from `/v1/videos/{id}/content` with
// the key and reported as `{ url, format: "mp4" }` on the gateway's media
// store), and tests/unit/deapi-provider.test.ts.
//
// Fork deviations: the key goes only to https://oai.deapi.ai (the source took
// a connection base URL); every request, the content read and the whole job
// are time bounded and abortable; redirects are refused; the fork has no media
// store for re-serving a clip, so the bounded mp4 is returned as `b64_json`
// (response_format `b64_json` only, as the fork's Vertex video adapter does);
// the model must be one of the four catalog ids; `size` must be `WxH` and
// `seconds`/`duration` a whole number of seconds; fields deAPI would not take
// as documented by the source are refused instead of passed through; an
// answer about another job, a missing status, a completed job whose content is
// unreadable, oversized or not an mp4 are unknown outcomes that carry
// `acceptedJob`; nothing is resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEAPI_CONTENT_TIMEOUT_MS, DEAPI_JOB_TIMEOUT_MS, DEAPI_MAX_POLL_RETRIES, DEAPI_MAX_POLLS, DEAPI_MAX_RETRY_DELAY_MS,
  DEAPI_MAX_VIDEO_BYTES, DEAPI_POLL_INTERVAL_MS, DEAPI_PROVIDER_ID, DEAPI_REQUEST_TIMEOUT_MS, DEAPI_SUBMIT_TIMEOUT_MS,
  DEAPI_VIDEO_MODELS, DEAPI_VIDEO_URL, deapiVideoContentUrl, deapiVideoModel, deapiVideoStatusUrl,
} from "./config.js";
import {
  boundedFetch, deapiJsonHeaders, deapiReadHeaders, deapiSecrets, deapiToken, discard, provenUnsent, readBoundedBytes,
  readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MODALITY = "video";
const RESPONSE_FORMATS = Object.freeze(["b64_json"]);
const MAX_PROMPT_CHARS = 32_000;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_SECONDS = 600;
const SIZE_RE = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/;
const SECONDS_RE = /^[1-9]\d{0,2}$/;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACCEPTED_FIELDS = new Set(["model", "prompt", "size", "seconds", "duration", "n", "response_format", "user", "stream"]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// The source's terminal states (preset lists plus its generic fallbacks).
const DONE_STATES = new Set(["completed", "succeeded", "success", "done"]);
const FAILED_STATES = new Set(["failed", "error", "cancelled", "canceled", "expired"]);
const JOB_FAILED = "deAPI video job failed";

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const failedJob = () => Object.assign(new Error(JOB_FAILED), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });

function wholeSeconds(value, field) {
  if (isNumber(value) && Number.isInteger(value) && value >= 1 && value <= MAX_SECONDS) return String(value);
  if (isString(value) && SECONDS_RE.test(value) && Number(value) <= MAX_SECONDS) return value;
  throw reject(`deAPI video ${field} must be a whole number of seconds from 1 to ${MAX_SECONDS}`);
}

/**
 * The deAPI submit body for an OpenAI-style video request. Throws a 400 error
 * for an unknown model or an input this subset cannot honor.
 */
export function buildDeapiVideoRequest(model, body) {
  if (!deapiVideoModel(model)) {
    throw reject(`Unsupported deAPI video model: ${model}. Use one of: ${DEAPI_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("deAPI video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("deAPI video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`deAPI video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("deAPI video generation does not support streaming");
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("deAPI video generation returns one video per request (n=1)");
  if ((body.response_format ?? "b64_json") !== "b64_json") throw reject("deAPI video supports response_format b64_json only");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && body[field] !== undefined && body[field] !== null);
  if (unsupported) throw reject(`deAPI text-to-video does not support ${unsupported}`);

  const request = { model, prompt: body.prompt };
  const fromDuration = body.duration === undefined || body.duration === null ? undefined : wholeSeconds(body.duration, "duration");
  const fromSeconds = body.seconds === undefined || body.seconds === null ? undefined : wholeSeconds(body.seconds, "seconds");
  if (fromDuration !== undefined && fromSeconds !== undefined && fromDuration !== fromSeconds) {
    throw reject("deAPI video seconds and duration disagree");
  }
  const seconds = fromSeconds ?? fromDuration;
  if (seconds !== undefined) request.seconds = seconds;
  if (body.size !== undefined && body.size !== null) {
    if (!isString(body.size) || !SIZE_RE.test(body.size)) throw reject("deAPI video size must look like 768x768");
    request.size = body.size;
  }
  return request;
}

/** The accepted job id, or null when it is missing or of an unsafe shape. */
const jobIdOf = (accepted) => (isString(accepted.id) && JOB_ID_RE.test(accepted.id) ? accepted.id : null);

// "done" | "failed" | "pending". Throws on an answer that cannot be trusted.
function stateOf(answer, id) {
  if (isString(answer.id) && answer.id !== id) throw unknownOutcome("answered about a different video job");
  if (!isString(answer.status) || !answer.status.trim()) throw unknownOutcome("returned a video job without a status");
  const status = answer.status.trim().toLowerCase();
  if (DONE_STATES.has(status)) return "done";
  if (FAILED_STATES.has(status)) return "failed";
  return "pending";
}

async function awaitJob(id, { token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = deapiVideoStatusUrl(id);
  const headers = deapiReadHeaders(token);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let polls = 0;
  for (;;) {
    if (polls >= maxPolls || now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video job did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
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
      if ((status === 429 || status === 503) && retries < DEAPI_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          DEAPI_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    polls += 1;
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "video job status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const state = stateOf(answer, id);
    if (state === "done") return answer;
    if (state === "failed") throw failedJob();
  }
}

// An ISO-BMFF (mp4) file starts with a box whose type is `ftyp`.
const isMp4 = (bytes) => bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;

async function downloadContent(id, { token, proxyOptions, signal, timeoutMs }) {
  const started = Date.now();
  const left = () => Math.max(1, timeoutMs - (Date.now() - started));
  let response;
  try {
    response = await boundedFetch(deapiVideoContentUrl(id), {
      method: "GET",
      headers: deapiReadHeaders(token),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: left() });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error?.name === "TimeoutError") throw unknownOutcome("video content download timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
    throw unknownOutcome("video content download failed");
  }
  if (redirectState(response)) throw unknownOutcome("video content download was redirected");
  if (!response.ok) {
    discard(response);
    throw unknownOutcome(`video content download returned ${response.status}`, PASSED_POLL_STATUSES.has(response.status) ? response.status : 502);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && !type.startsWith("video/") && type !== "application/octet-stream") {
    discard(response);
    throw unknownOutcome("video content is not a video");
  }
  let bytes;
  try {
    bytes = await readBoundedBytes(response, { signal, timeoutMs: left(), maxBytes: DEAPI_MAX_VIDEO_BYTES });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    if (error?.tooLarge) throw unknownOutcome("video content is larger than this gateway returns");
    if (error?.name === "TimeoutError") throw unknownOutcome("video content download timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
    throw unknownOutcome("video content could not be read");
  }
  if (!isMp4(bytes)) throw unknownOutcome("video content is empty or not an mp4");
  return bytes;
}

/**
 * Submit one deAPI video job for the selected connection, follow it, and read
 * the finished clip. Returns `{ success: true, bytes, job, jobId }`, or an
 * error result with `acceptedJob` when deAPI may have taken (and may bill)
 * the job. Nothing is resent and nothing is shared between calls.
 */
export async function runDeapiVideoJob({
  request,
  credentials,
  signal,
  log,
  timeoutMs = DEAPI_JOB_TIMEOUT_MS,
  submitTimeoutMs = DEAPI_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = DEAPI_REQUEST_TIMEOUT_MS,
  contentTimeoutMs = DEAPI_CONTENT_TIMEOUT_MS,
  pollIntervalMs = DEAPI_POLL_INTERVAL_MS,
  maxPolls = DEAPI_MAX_POLLS,
  wait = sleep,
  now = Date.now,
}) {
  const aborted = () => createErrorResult(499, "deAPI video request aborted");
  const token = deapiToken(credentials);
  if (!token) return createErrorResult(401, "deAPI API key is required");
  if (signal?.aborted) return aborted();
  const secrets = deapiSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(DEAPI_VIDEO_URL, {
      method: "POST",
      headers: deapiJsonHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : withAcceptedJob(aborted(), MODALITY, "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `deAPI video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), MODALITY, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("DEAPI_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI video submit redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI video submit was redirected"), MODALITY, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { modality: MODALITY, label: "video submit", signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  let jobState = "accepted";
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "video submit answer" });
    const jobId = jobIdOf(accepted);
    if (!jobId) throw unknownOutcome("did not return a usable video job id");
    const job = await awaitJob(jobId, { token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now });
    jobState = "completed-unread";
    const bytes = await downloadContent(jobId, { token, proxyOptions, signal, timeoutMs: Math.min(contentTimeoutMs, remaining()) });
    return { success: true, bytes, job, jobId };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(aborted(), MODALITY, jobState);
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from deAPI video",
      undefined, undefined, null, secrets
    );
    // A job deAPI reports failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, MODALITY, jobState);
  }
}

/**
 * @param {object} [options] - submit/poll/content bounds and clock, for tests; see runDeapiVideoJob
 */
export function createDeapiVideoAdapter(options = {}) {
  return {
    async: true,
    provider: DEAPI_PROVIDER_ID,
    models: DEAPI_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "b64_json",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ b64_json, format: "mp4", mime_type: "video/mp4" }] }`,
     * or an error result that carries `acceptedJob` when the job may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildDeapiVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runDeapiVideoJob({ ...options, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Seconds only when deAPI reports them; cost is unknown.
      const base = mediaAccounting(null, DEAPI_PROVIDER_ID, MODALITY);
      const accounting = { ...base, nativeUnits: { videos: 1 }, meta: { ...base.meta, nativeUnitsSource: "returned-videos" } };
      const reported = result.job.seconds;
      const seconds = isString(reported) && /^\d+(\.\d+)?$/.test(reported) ? Number(reported) : reported;
      if (isNumber(seconds) && Number.isFinite(seconds) && seconds > 0) {
        accounting.nativeUnits.videoSeconds = seconds;
        accounting.meta.videoSecondsSource = "response-duration";
      }
      const payload = {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: Buffer.from(result.bytes).toString("base64"), format: "mp4", mime_type: "video/mp4" }],
      };
      return {
        success: true,
        accounting,
        response: new Response(JSON.stringify(payload), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    },
  };
}
