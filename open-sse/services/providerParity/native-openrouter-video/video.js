// OpenRouter native text-to-video: POST https://openrouter.ai/api/v1/videos,
// a bounded poll of GET /api/v1/videos/{id}, then one key-gated GET of the
// finished job's `unsigned_urls[0]` (/api/v1/videos/{id}/content). Staged for
// /v1/video/generations under the VIDEO_GENERATION_ADAPTERS contract and not
// registered (see ./registration.json). See ./config.js for the source.
//
// Source behavior kept: submit body `{ model, prompt, duration?, ...extras }`
// with `duration` a plain integer; `Content-Type` + `Authorization: Bearer` on
// every leg; job id `id`; poll with the same key; `completed` is done and
// `failed` / `cancelled` / `expired` (plus the generic error / canceled) are
// terminal failures; the clip is read from the first `unsigned_urls` entry
// only when it is on the provider origin; 180 polls x 2 s by default with the
// caller's `max_polls` / `poll_interval_ms` bounded by a 600 s window.
//
// Fork deviations: the key goes only to https://openrouter.ai (the source took
// a connection base URL); every request, the content read and the whole job
// are time bounded and abortable; redirects are refused; the fork has no media
// store for re-serving a clip (the source stored it and returned a gateway
// URL), so the bounded mp4 is returned as `b64_json` (response_format
// `b64_json` only, as the staged deAPI and the fork's Vertex video adapters
// do); the model must be one of the 14 source slugs; `seconds` is read as an
// alias of `duration`; only `aspect_ratio` survives as an extra (the one extra
// the source test exercises) and every other field is refused instead of
// passed through; an answer about another job, a missing status, a completed
// job without a same-origin content URL, or unreadable, oversized or non-mp4
// content are unknown outcomes that carry `acceptedJob`; nothing is resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  OPENROUTER_CONTENT_TIMEOUT_MS, OPENROUTER_JOB_TIMEOUT_MS, OPENROUTER_MAX_POLL_INTERVAL_MS, OPENROUTER_MAX_POLL_RETRIES,
  OPENROUTER_MAX_POLLS, OPENROUTER_MAX_RETRY_DELAY_MS, OPENROUTER_MAX_VIDEO_BYTES, OPENROUTER_MIN_POLL_INTERVAL_MS,
  OPENROUTER_POLL_INTERVAL_MS, OPENROUTER_PROVIDER_ID, OPENROUTER_REQUEST_TIMEOUT_MS, OPENROUTER_SUBMIT_TIMEOUT_MS,
  OPENROUTER_VIDEO_MODELS, OPENROUTER_VIDEO_URL, openrouterVideoModel, openrouterVideoStatusUrl,
} from "./config.js";
import {
  boundedFetch, discard, openrouterContentUrl, openrouterHeaders, openrouterSecrets, openrouterToken, provenUnsent,
  readBoundedBytes, readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const RESPONSE_FORMATS = Object.freeze(["b64_json"]);
const MAX_PROMPT_CHARS = 32_000;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_SECONDS = 60;
const ASPECT_RE = /^[1-9]\d?:[1-9]\d?$/;
const SECONDS_RE = /^[1-9]\d{0,1}$/;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACCEPTED_FIELDS = new Set([
  "model", "prompt", "duration", "seconds", "aspect_ratio", "n", "response_format", "user", "stream", "poll_interval_ms", "max_polls",
]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// The source's terminal states (preset lists plus its generic fallbacks).
const DONE_STATES = new Set(["completed", "succeeded", "success", "done"]);
const FAILED_STATES = new Set(["failed", "error", "cancelled", "canceled", "expired"]);
const JOB_FAILED = "OpenRouter video job failed";

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const failedJob = () => Object.assign(new Error(JOB_FAILED), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
const present = (value) => value !== undefined && value !== null;

function wholeSeconds(value, field) {
  if (isNumber(value) && Number.isInteger(value) && value >= 1 && value <= MAX_SECONDS) return value;
  if (isString(value) && SECONDS_RE.test(value) && Number(value) <= MAX_SECONDS) return Number(value);
  throw reject(`OpenRouter video ${field} must be a whole number of seconds from 1 to ${MAX_SECONDS}`);
}

/**
 * The OpenRouter submit body for an OpenAI-style video request. Throws a 400
 * error for an unknown model or an input this subset cannot honor.
 */
export function buildOpenrouterVideoRequest(model, body) {
  if (!openrouterVideoModel(model)) {
    throw reject(`Unsupported OpenRouter video model: ${model}. Use one of: ${OPENROUTER_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("OpenRouter video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("OpenRouter video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`OpenRouter video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("OpenRouter video generation does not support streaming");
  if (present(body.n) && body.n !== 1) throw reject("OpenRouter video generation returns one video per request (n=1)");
  if ((body.response_format ?? "b64_json") !== "b64_json") throw reject("OpenRouter video supports response_format b64_json only");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && present(body[field]));
  if (unsupported) throw reject(`OpenRouter text-to-video does not support ${unsupported}`);

  const request = { model, prompt: body.prompt };
  const fromDuration = present(body.duration) ? wholeSeconds(body.duration, "duration") : undefined;
  const fromSeconds = present(body.seconds) ? wholeSeconds(body.seconds, "seconds") : undefined;
  if (fromDuration !== undefined && fromSeconds !== undefined && fromDuration !== fromSeconds) {
    throw reject("OpenRouter video seconds and duration disagree");
  }
  const duration = fromDuration ?? fromSeconds;
  if (duration !== undefined) request.duration = duration;
  if (present(body.aspect_ratio)) {
    if (!isString(body.aspect_ratio) || !ASPECT_RE.test(body.aspect_ratio)) throw reject("OpenRouter video aspect_ratio must look like 16:9");
    request.aspect_ratio = body.aspect_ratio;
  }
  return request;
}

function callerWhole(body, field) {
  if (!present(body?.[field])) return null;
  const value = body[field];
  if (!isNumber(value) || !Number.isFinite(value) || value < 1) throw reject(`OpenRouter video ${field} must be a positive number`);
  return Math.floor(value);
}

/**
 * The poll interval and poll budget: the source preset (2 s x 180), or the
 * caller's values with the interval clamped to 1 s-120 s and the budget to the
 * 600 s window. Never forwarded.
 */
export function resolveOpenrouterTiming(body) {
  const interval = callerWhole(body, "poll_interval_ms");
  const polls = callerWhole(body, "max_polls");
  const pollIntervalMs = interval === null
    ? OPENROUTER_POLL_INTERVAL_MS
    : Math.min(OPENROUTER_MAX_POLL_INTERVAL_MS, Math.max(OPENROUTER_MIN_POLL_INTERVAL_MS, interval));
  const ceiling = Math.max(1, Math.floor(OPENROUTER_JOB_TIMEOUT_MS / pollIntervalMs));
  return { pollIntervalMs, maxPolls: Math.min(polls ?? OPENROUTER_MAX_POLLS, ceiling) };
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
  const url = openrouterVideoStatusUrl(id);
  const headers = openrouterHeaders(token);
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
      if ((status === 429 || status === 503) && retries < OPENROUTER_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          OPENROUTER_MAX_RETRY_DELAY_MS,
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

/** The first `unsigned_urls` entry when it is this job's content route; throws otherwise. */
function contentUrlOf(job, id) {
  const first = Array.isArray(job.unsigned_urls) ? job.unsigned_urls[0] : null;
  const url = openrouterContentUrl(first, id);
  if (!url) throw unknownOutcome("video job completed without a usable content URL");
  return url;
}

async function downloadContent(url, { token, proxyOptions, signal, timeoutMs }) {
  const started = Date.now();
  const left = () => Math.max(1, timeoutMs - (Date.now() - started));
  let response;
  try {
    response = await boundedFetch(url, {
      method: "GET",
      headers: openrouterHeaders(token),
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
    bytes = await readBoundedBytes(response, { signal, timeoutMs: left(), maxBytes: OPENROUTER_MAX_VIDEO_BYTES });
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
 * Submit one OpenRouter video job for the selected connection, follow it, and
 * read the finished clip. Returns `{ success: true, bytes, job, jobId }`, or
 * an error result with `acceptedJob` when OpenRouter may have taken (and may
 * bill) the job. Nothing is resent and nothing is shared between calls.
 */
export async function runOpenrouterVideoJob({
  request,
  credentials,
  signal,
  log,
  timeoutMs = OPENROUTER_JOB_TIMEOUT_MS,
  submitTimeoutMs = OPENROUTER_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = OPENROUTER_REQUEST_TIMEOUT_MS,
  contentTimeoutMs = OPENROUTER_CONTENT_TIMEOUT_MS,
  pollIntervalMs = OPENROUTER_POLL_INTERVAL_MS,
  maxPolls = OPENROUTER_MAX_POLLS,
  wait = sleep,
  now = Date.now,
}) {
  const aborted = () => createErrorResult(499, "OpenRouter video request aborted");
  const token = openrouterToken(credentials);
  if (!token) return createErrorResult(401, "OpenRouter API key is required");
  if (signal?.aborted) return aborted();
  const secrets = openrouterSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(OPENROUTER_VIDEO_URL, {
      method: "POST",
      headers: openrouterHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : withAcceptedJob(aborted(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "OpenRouter video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `OpenRouter video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("OPENROUTER_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "OpenRouter video submit redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "OpenRouter video submit was redirected"), "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { label: "video submit", signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  let jobState = "accepted";
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "video submit answer" });
    const jobId = jobIdOf(accepted);
    if (!jobId) throw unknownOutcome("did not return a usable video job id");
    const job = await awaitJob(jobId, { token, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now });
    jobState = "completed-unread";
    const url = contentUrlOf(job, jobId);
    const bytes = await downloadContent(url, { token, proxyOptions, signal, timeoutMs: Math.min(contentTimeoutMs, remaining()) });
    return { success: true, bytes, job, jobId };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(aborted(), jobState);
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from OpenRouter video",
      undefined, undefined, null, secrets
    );
    // A job OpenRouter reports failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, jobState);
  }
}

/**
 * @param {object} [options] - submit/poll/content bounds and clock, for tests; see runOpenrouterVideoJob.
 *   Explicit options win over the caller's `poll_interval_ms` / `max_polls`.
 */
export function createOpenrouterVideoAdapter(options = {}) {
  return {
    async: true,
    provider: OPENROUTER_PROVIDER_ID,
    models: OPENROUTER_VIDEO_MODELS,
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
      let timing;
      try {
        request = buildOpenrouterVideoRequest(model, body);
        timing = resolveOpenrouterTiming(body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runOpenrouterVideoJob({ ...timing, ...options, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. The requested duration is not billed; cost is unknown.
      const base = mediaAccounting(null, OPENROUTER_PROVIDER_ID, "video");
      const accounting = {
        ...base,
        nativeUnits: { videos: 1 },
        meta: { ...base.meta, jobId: result.jobId, nativeUnitsSource: "returned-videos" },
      };
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
