// UC Direct native video generation: POST
// https://api.uncensored.com/api/v1/videos/generations, then a bounded poll of
// the returned status_url on the same origin. Staged for /v1/video/generations
// under the VIDEO_GENERATION_ADAPTERS contract and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/videoGeneration/providers/ucVideo.ts, surface (B)
// handleUcDirectVideo: headers `X-api-key: <uai_ key>` and
// `Content-Type: application/json`; body `{ model, prompt }` plus `size`,
// `aspect_ratio`, `resolution`, `duration` (a number) and `image` (the first
// of image / image_url / input_image / media) when given; the answer is a job
// with `status`, optional `status_url` and `request_id` | `id` | `job_id`; the
// video URL is read from `data[0].url`, `url`, `video_url`, `video.url` or a
// string `output`; statuses complete/completed/succeeded/success/done finish
// and failed/error/canceled/cancelled fail; the status poll is `GET status_url`
// with the key only, 3 s apart for at most 300 s; 429 is retryable. The model
// list is the REST catalog in open-sse/config/videoRegistry.ts (`uc`).
//
// Fork deviations: only the metered REST surface (persona surface (A) is the
// retired `uc` consumer-app path, #1241, and `wan-2.2-spicy` is its model);
// the key must be a `uai_` developer key and goes only to
// https://api.uncensored.com, so a status_url on another origin or outside
// /api/v1/videos/ is never followed; every request and the whole job are time
// bounded and abortable; redirects are refused; the model must be one of the
// 13 REST ids, i2v-* need an input image and t2v-* refuse one; an input image
// must be a bounded data:image URL or a public https URL (bare base64 is
// refused); size, aspect_ratio, resolution and duration are shape checked;
// persona knobs and unknown fields are refused; a callback-only job (job id
// but no status_url) is reported as an accepted job with unknown outcome
// instead of a success without a video; a finished job without a usable public
// https URL, an answer about another job and any lost observation carry
// `acceptedJob`; result URLs are never fetched; nothing is resent.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { MAX_IMAGE_BYTES } from "../../../config/mediaConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  UC_JOB_TIMEOUT_MS, UC_MAX_POLL_RETRIES, UC_MAX_RETRY_DELAY_MS, UC_ORIGIN, UC_POLL_INTERVAL_MS, UC_PROVIDER_ID,
  UC_REQUEST_TIMEOUT_MS, UC_SUBMIT_TIMEOUT_MS, UC_VIDEO_MODELS, UC_VIDEO_STATUS_PATH_PREFIX, UC_VIDEO_URL, ucVideoModel,
} from "./config.js";
import {
  boundedFetch, discard, provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs, ucJsonHeaders,
  ucPublicUrl, ucReadHeaders, ucSecrets, ucToken, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MODALITY = "video";
const RESPONSE_FORMATS = Object.freeze(["url"]);
const MAX_PROMPT_CHARS = 32_000;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_DURATION_SECONDS = 600;
const SIZE_RE = /^([1-9]\d{1,4})x([1-9]\d{1,4})$/;
const ASPECT_RE = /^[1-9]\d?:[1-9]\d?$/;
const RESOLUTION_RE = /^[1-9]\d{2,3}p$/;
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;
const IMAGE_FIELDS = Object.freeze(["image", "image_url", "input_image", "media"]);
const ACCEPTED_FIELDS = new Set([
  "model", "prompt", "size", "aspect_ratio", "resolution", "duration", ...IMAGE_FIELDS, "n", "response_format", "user", "stream",
]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);
// The source's terminal states (isDirectComplete / isDirectFailed).
const DONE_STATES = new Set(["complete", "completed", "succeeded", "success", "done"]);
const FAILED_STATES = new Set(["failed", "error", "canceled", "cancelled"]);
const JOB_FAILED = "UC Direct video job failed";

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const failedJob = () => Object.assign(new Error(JOB_FAILED), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
const decodedBytes = (b64) => Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

/** The one input image of the request, checked; null for text-to-video. */
function inputImage(body) {
  const given = IMAGE_FIELDS.filter((field) => body[field] !== undefined && body[field] !== null);
  if (given.length === 0) return null;
  const values = given.map((field) => body[field]);
  if (values.some((value) => !isString(value) || !value.trim())) throw reject("UC Direct video input image must be a data:image URL or a public https URL");
  const distinct = [...new Set(values.map((value) => value.trim()))];
  if (distinct.length > 1) throw reject(`UC Direct video takes one input image; ${given.join(", ")} disagree`);
  const ref = distinct[0];
  const data = DATA_IMAGE_RE.exec(ref);
  if (data) {
    if (decodedBytes(data[2]) > MAX_IMAGE_BYTES) throw reject("UC Direct video input image is too large");
    return ref;
  }
  const url = ucPublicUrl(ref);
  if (!url) throw reject("UC Direct video input image must be a data:image URL or a public https URL");
  return url;
}

/**
 * The UC Direct submit body for an OpenAI-style video request. Throws a 400
 * error for an unknown model or an input this subset cannot honor.
 */
export function buildUcVideoRequest(model, body) {
  const entry = ucVideoModel(model);
  if (!entry) throw reject(`Unsupported UC Direct video model: ${model}. Use one of: ${UC_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  if (!isRecord(body)) throw reject("UC Direct video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Prompt is required for UC video generation");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`UC Direct video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (body.stream) throw reject("UC Direct video generation does not support streaming");
  if (body.n !== undefined && body.n !== null && body.n !== 1) throw reject("UC Direct video generation returns one video per request (n=1)");
  if ((body.response_format ?? "url") !== "url") throw reject("UC Direct video supports response_format url only");
  const unsupported = Object.keys(body).find((field) => !ACCEPTED_FIELDS.has(field) && body[field] !== undefined && body[field] !== null);
  if (unsupported) throw reject(`UC Direct video generation does not support ${unsupported}`);

  const request = { model: entry.id, prompt: body.prompt.trim() };
  if (body.size !== undefined && body.size !== null) {
    if (!isString(body.size) || !SIZE_RE.test(body.size.trim())) throw reject("UC Direct video size must look like 1280x720");
    request.size = body.size.trim();
  }
  if (body.aspect_ratio !== undefined && body.aspect_ratio !== null) {
    if (!isString(body.aspect_ratio) || !ASPECT_RE.test(body.aspect_ratio.trim())) throw reject("UC Direct video aspect_ratio must look like 16:9");
    request.aspect_ratio = body.aspect_ratio.trim();
  }
  if (body.resolution !== undefined && body.resolution !== null) {
    if (!isString(body.resolution) || !RESOLUTION_RE.test(body.resolution.trim())) throw reject("UC Direct video resolution must look like 720p");
    request.resolution = body.resolution.trim();
  }
  if (body.duration !== undefined && body.duration !== null) {
    const duration = isString(body.duration) && /^\d+(\.\d+)?$/.test(body.duration) ? Number(body.duration) : body.duration;
    if (!isNumber(duration) || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
      throw reject(`UC Direct video duration must be a number of seconds from above 0 to ${MAX_DURATION_SECONDS}`);
    }
    request.duration = duration;
  }
  const image = inputImage(body);
  if (entry.input === "image" && !image) throw reject(`UC Direct ${entry.id} is image-to-video and needs an input image`);
  if (entry.input === "text" && image) throw reject(`UC Direct ${entry.id} is text-to-video and does not take an input image`);
  if (image) request.image = image;
  return request;
}

/** Source extractUcDirectVideo: url, status_url, status and job id from one answer. */
export function extractUcVideo(answer) {
  const out = {};
  if (!isRecord(answer)) return out;
  if (isString(answer.status)) out.status = answer.status;
  if (isString(answer.status_url)) out.statusUrl = answer.status_url;
  const rid = answer.request_id ?? answer.id ?? answer.job_id;
  if (isString(rid) && rid) out.requestId = rid;
  if (Array.isArray(answer.data)) {
    const item = answer.data.find((entry) => isRecord(entry) && isString(entry.url) && entry.url);
    if (item) out.url = item.url;
  }
  if (!out.url && isString(answer.url) && answer.url) out.url = answer.url;
  if (!out.url && isString(answer.video_url) && answer.video_url) out.url = answer.video_url;
  if (!out.url && isRecord(answer.video) && isString(answer.video.url) && answer.video.url) out.url = answer.video.url;
  if (!out.url && isString(answer.output) && answer.output) out.url = answer.output;
  return out;
}

/** A status URL the key may be sent to: https on UC_ORIGIN under /api/v1/videos/, or null. */
export function ucStatusUrl(raw) {
  if (!isString(raw) || !raw.trim() || raw.length > 2048) return null;
  let url;
  try {
    url = new URL(raw.trim(), UC_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== UC_ORIGIN || url.username || url.password || !url.pathname.startsWith(UC_VIDEO_STATUS_PATH_PREFIX)) return null;
  if (url.pathname.split("/").some((segment) => segment === ".." || segment === ".")) return null;
  url.hash = "";
  return url.href;
}

// "done" | "failed" | "pending". Throws on an answer that cannot be trusted.
function stateOf(found, jobId) {
  if (jobId && found.requestId && found.requestId !== jobId) throw unknownOutcome("answered about a different video job");
  const status = (found.status ?? "").trim().toLowerCase();
  if (FAILED_STATES.has(status)) return "failed";
  if (found.url || DONE_STATES.has(status)) return "done";
  return "pending";
}

function finished(found) {
  const url = ucPublicUrl(found.url);
  if (!url) throw unknownOutcome(found.url ? "returned a video URL that is not public https" : "finished a video job without a video URL");
  return url;
}

async function awaitJob(statusUrl, jobId, { token, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const headers = ucReadHeaders(token);
  let delay = 0;
  let retries = 0;
  let rejected = 0;
  for (;;) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video job did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    if (delay > 0) await wait(delay, signal);
    signal?.throwIfAborted();
    let response;
    try {
      response = await boundedFetch(statusUrl, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome("status check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome("status check failed");
    }
    if (redirectState(response)) throw unknownOutcome("status check was redirected");
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < UC_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(UC_MAX_RETRY_DELAY_MS, Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1)));
        continue;
      }
      throw unknownOutcome(`status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "video job status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const found = extractUcVideo(answer);
    const state = stateOf(found, jobId);
    if (state === "failed") throw failedJob();
    if (state === "done") return { url: finished(found), found, answer };
  }
}

/**
 * Submit one UC Direct video job for the selected connection and follow it to
 * a result URL. Returns `{ success: true, url, jobId, answer }`, or an error
 * result with `acceptedJob` when UC may have taken (and may bill) the job.
 * Nothing is resent and nothing is shared between calls.
 */
export async function runUcVideoJob({
  request,
  credentials,
  signal,
  log,
  timeoutMs = UC_JOB_TIMEOUT_MS,
  submitTimeoutMs = UC_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = UC_REQUEST_TIMEOUT_MS,
  pollIntervalMs = UC_POLL_INTERVAL_MS,
  wait = sleep,
  now = Date.now,
}) {
  const aborted = () => createErrorResult(499, "UC Direct video request aborted");
  const token = ucToken(credentials);
  if (!token) return createErrorResult(401, "UC Direct video generation needs a uai_ developer API key");
  if (signal?.aborted) return aborted();
  const secrets = ucSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(UC_VIDEO_URL, {
      method: "POST",
      headers: ucJsonHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? aborted() : withAcceptedJob(aborted(), MODALITY, "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC Direct video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `UC Direct video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), MODALITY, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("UC_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC Direct video submit redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "UC Direct video submit was redirected"), MODALITY, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { modality: MODALITY, label: "video submit", signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  let jobState = "accepted";
  let jobId = null;
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "video submit answer" });
    const found = extractUcVideo(accepted);
    jobId = found.requestId && JOB_ID_RE.test(found.requestId) ? found.requestId : null;
    if (found.requestId && !jobId) throw unknownOutcome("returned a video job id of an unsafe shape");
    const state = stateOf(found, null);
    if (state === "failed") throw failedJob();
    if (state === "done") {
      jobState = "completed-unusable";
      return { success: true, url: finished(found), jobId, answer: accepted };
    }
    if (!found.statusUrl) {
      // Callback-only job: UC took it, but this gateway has no way to observe it.
      throw unknownOutcome(jobId ? `accepted video job ${jobId} without a status URL; its result is not observable here` : "returned no video URL, status URL or job id");
    }
    const statusUrl = ucStatusUrl(found.statusUrl);
    if (!statusUrl) throw unknownOutcome("returned a status URL outside the UC Direct API; it was not followed");
    const done = await awaitJob(statusUrl, jobId, { token, proxyOptions, signal, deadline, pollIntervalMs, requestTimeoutMs, wait, now });
    return { success: true, url: done.url, jobId: jobId ?? (done.found.requestId && JOB_ID_RE.test(done.found.requestId) ? done.found.requestId : null), answer: done.answer };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(aborted(), MODALITY, jobState, jobId);
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from UC Direct video",
      undefined, undefined, null, secrets
    );
    // A job UC reports failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, MODALITY, jobState, jobId);
  }
}

/**
 * @param {object} [options] - submit/poll bounds and clock, for tests; see runUcVideoJob
 */
export function createUcVideoAdapter(options = {}) {
  return {
    async: true,
    provider: UC_PROVIDER_ID,
    models: UC_VIDEO_MODELS,
    responseFormats: RESPONSE_FORMATS,
    defaultResponseFormat: "url",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format: "mp4", request_id? }] }`, or an error
     * result that carries `acceptedJob` when the job may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      let request;
      try {
        request = buildUcVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runUcVideoJob({ ...options, request, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Seconds only when UC reports them; cost is unknown.
      const base = mediaAccounting(null, UC_PROVIDER_ID, MODALITY);
      const accounting = { ...base, nativeUnits: { videos: 1 }, meta: { ...base.meta, nativeUnitsSource: "returned-videos" } };
      const reported = result.answer?.duration ?? result.answer?.seconds;
      const seconds = isString(reported) && /^\d+(\.\d+)?$/.test(reported) ? Number(reported) : reported;
      if (isNumber(seconds) && Number.isFinite(seconds) && seconds > 0) {
        accounting.nativeUnits.videoSeconds = seconds;
        accounting.meta.videoSecondsSource = "response-duration";
      }
      const item = { url: result.url, format: "mp4" };
      if (result.jobId) item.request_id = result.jobId;
      const payload = { created: Math.floor(Date.now() / 1000), data: [item] };
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
