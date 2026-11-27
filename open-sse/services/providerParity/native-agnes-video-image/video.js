// Agnes native video generation: one submit to POST /v1/videos, a bounded
// status poll, and a result URL. Staged for /v1/video/generations and not
// registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`agnes`, format "agnes-video-job"),
// open-sse/handlers/videoGeneration.ts (model jobPreset over provider format)
// and open-sse/handlers/videoGeneration/job.ts (presets "agnes-video-job" and
// "agnes-video-2.5-job": Bearer key, submit body `{ model, prompt, ...extras }`,
// task id from `video_id` / `id` then video_id, task_id, id, request_id, poll
// GET /agnesapi?video_id={id}&model_name={model} or GET /v1/videos/{id},
// `status` (then task_status, state), done "completed", failed "failed",
// result `metadata.url`, 2 s interval, 60 polls, 429/503 polls retried).
//
// Fork deviations: the key goes only to https://apihub.agnes-ai.com (connection
// base URLs are ignored); every request and the whole job are time bounded and
// abort on the caller's signal; redirects are refused; bodies are size bounded;
// upstream text never reaches an error message; a submit whose outcome is
// unknown, and every accepted job not seen to fail, carries `acceptedJob` and
// is never resent; `duration`, n > 1 and streaming are refused before submit
// instead of silently dropped; caller `poll_interval_ms` / `max_polls` are not
// honored (fixed bounds) and never forwarded; a status answer without a status
// string or about another job is an unknown outcome; the result URL is read
// from `metadata.url`, `url` or `video_url` only (no payload scan), must be a
// public https URL and is returned without being downloaded.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  AGNES_PROVIDER_ID, AGNES_VIDEO_JOB_PRESETS, AGNES_VIDEO_MAX_POLL_RETRIES, AGNES_VIDEO_MAX_POLLS,
  AGNES_VIDEO_MAX_RETRY_DELAY_MS, AGNES_VIDEO_MODELS, AGNES_VIDEO_POLL_INTERVAL_MS, AGNES_VIDEO_REQUEST_TIMEOUT_MS,
  AGNES_VIDEO_SUBMIT_TIMEOUT_MS, AGNES_VIDEO_SUBMIT_URL, AGNES_VIDEO_TIMEOUT_MS, agnesVideoModel,
} from "./config.js";
import {
  agnesHeaders, agnesPublicUrl, agnesSecrets, agnesToken, boundedFetch, discard, provenUnsent, readJsonObject,
  redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

const MODALITY = "video";
const MAX_REQUEST_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
// Gateway-only fields: never forwarded to Agnes.
const GATEWAY_FIELDS = new Set(["model", "prompt", "duration", "poll_interval_ms", "max_polls", "response_format", "n", "stream"]);
const DONE = new Set(["completed", "succeeded", "success", "done"]);
const FAILED = new Set(["failed", "error", "cancelled", "canceled"]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const abortedResult = () => createErrorResult(499, "Agnes video request aborted");

/**
 * The Agnes submit body for an OpenAI-style video request, and its job preset.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 */
export function buildAgnesVideoRequest(model, body) {
  const entry = agnesVideoModel(model);
  if (!entry) throw reject(`Unsupported Agnes video model: ${model}. Use one of: ${AGNES_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  if (!isRecord(body)) throw reject("Agnes video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Agnes video generation needs a text prompt");
  if (body.duration !== undefined) {
    throw reject("Agnes video does not take duration; use seconds (Agnes Video 2.5) or num_frames and frame_rate (V2.0)");
  }
  if (body.n !== undefined && body.n !== 1) throw reject("Agnes video generation returns one video per request (n=1)");
  if (body.stream) throw reject("Agnes video generation does not support streaming");
  const preset = AGNES_VIDEO_JOB_PRESETS[entry.jobPreset];
  const extras = Object.fromEntries(Object.entries(body).filter(([key]) => !GATEWAY_FIELDS.has(key)));
  const request = { model, prompt: body.prompt, ...extras };
  if (preset.stringSeconds && typeof extras.seconds === "number") request.seconds = String(extras.seconds);
  if (Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES) throw reject("Agnes video request is too large");
  return { request, preset };
}

/** The job id from a submit answer: the preset's documented field first, then the source's fallbacks. */
function taskIdOf(accepted, preset) {
  for (const field of [preset.taskIdPath, "video_id", "task_id", "id", "request_id"]) {
    const value = accepted[field];
    if (isString(value) && value.trim()) return TASK_ID_RE.test(value) ? value : null;
  }
  return null;
}

function resultUrlOf(answer) {
  const metadata = isRecord(answer.metadata) ? answer.metadata : {};
  const candidates = [metadata.url, answer.url, answer.video_url];
  const raw = candidates.find((value) => isString(value) && value.trim());
  return raw ? agnesPublicUrl(raw.trim()) : null;
}

// null while pending; the video URL once completed. Throws otherwise.
function settle(answer, { id, preset }) {
  const echoed = answer[preset.taskIdPath];
  if (isString(echoed) && echoed !== id) throw unknownOutcome("answered about a different video job");
  const status = [answer.status, answer.task_status, answer.state].find(isString);
  if (!status) throw unknownOutcome("returned a video status without a status");
  const normalized = status.trim().toLowerCase();
  if (DONE.has(normalized)) {
    const url = resultUrlOf(answer);
    if (!url) throw unknownOutcome("video job completed without a usable video URL");
    return url;
  }
  if (FAILED.has(normalized)) {
    throw Object.assign(new Error("Agnes video job failed"), { status: HTTP_STATUS.BAD_GATEWAY });
  }
  return null;
}

async function awaitJob(id, { model, preset, headers, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = preset.pollUrl(id, model);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let polls = 0;
  for (;;) {
    if (polls >= maxPolls || now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`video status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video job did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
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
      // Transient waits do not use the poll budget (source #15536).
      if ((status === 429 || status === 503) && retries < AGNES_VIDEO_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          AGNES_VIDEO_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`video status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    polls += 1;
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_JSON_BYTES, what: "video status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const result = settle(answer, { id, preset });
    if (result) return result;
  }
}

/**
 * Submit one Agnes video job for the selected connection and follow it to its
 * video URL. Results use the media core shape: `{ success: true, url, accounting }`,
 * or an error result, with `acceptedJob` when Agnes may have taken (and may
 * bill) the job. Nothing is resent and nothing is shared between calls.
 */
export async function runAgnesVideoJob({
  model,
  request,
  preset,
  credentials,
  signal,
  log,
  timeoutMs = AGNES_VIDEO_TIMEOUT_MS,
  submitTimeoutMs = AGNES_VIDEO_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = AGNES_VIDEO_REQUEST_TIMEOUT_MS,
  pollIntervalMs = AGNES_VIDEO_POLL_INTERVAL_MS,
  maxPolls = AGNES_VIDEO_MAX_POLLS,
  wait = sleep,
  now = Date.now,
}) {
  const token = agnesToken(credentials);
  if (!token) return createErrorResult(401, "Agnes API key is required");
  if (signal?.aborted) return abortedResult();
  const secrets = agnesSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const headers = agnesHeaders(token);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(AGNES_VIDEO_SUBMIT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), MODALITY, "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Agnes video submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Agnes video submit ${timedOut ? "timed out" : "was interrupted"}; whether it was accepted is unknown`
    ), MODALITY, "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("AGNES_VIDEO", "video submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Agnes video submit redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Agnes video submit was redirected"), MODALITY, "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { modality: MODALITY, label: "video submit", signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });
  }

  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: MAX_JSON_BYTES, what: "video submit answer" });
    const id = taskIdOf(accepted, preset);
    if (!id) throw unknownOutcome("did not return a usable video job id");
    const url = await awaitJob(id, {
      model, preset, headers, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now,
    });
    return { success: true, url, accounting: mediaAccounting(null, AGNES_PROVIDER_ID, MODALITY) };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), MODALITY, "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.message === "Agnes video job failed" ? error.message : "Invalid response from Agnes",
      undefined, undefined, null, secrets
    );
    // A job Agnes reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobOutcomeUnknown ? withAcceptedJob(failed, MODALITY, "accepted") : failed;
  }
}

/**
 * @param {object} [options] - submit/poll bounds and clock, for tests; see runAgnesVideoJob
 */
export function createAgnesVideoAdapter(options = {}) {
  return {
    async: true,
    provider: AGNES_PROVIDER_ID,
    models: AGNES_VIDEO_MODELS,
    responseFormats: Object.freeze(["url"]),
    defaultResponseFormat: "url",
    /**
     * Generate one video for the selected connection, synchronously.
     *
     * @returns {Promise<object>} `{ success: true, response, accounting }` with
     * `{ created, data: [{ url, format }] }`, or an error result that carries
     * `acceptedJob` when the job may bill
     */
    async generate({ model, body, credentials, signal, log }) {
      const requested = body?.response_format ?? "url";
      if (requested !== "url") return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Agnes video supports response_format url only");
      let built;
      try {
        built = buildAgnesVideoRequest(model, body);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runAgnesVideoJob({ ...options, model, ...built, credentials, signal, log });
      if (!result.success) return result;
      // Usage counts the video returned. Duration and cost are unknown here.
      const accounting = {
        ...result.accounting,
        nativeUnits: { videos: 1 },
        meta: { ...result.accounting.meta, nativeUnitsSource: "returned-videos" },
      };
      const payload = { created: Math.floor(Date.now() / 1000), data: [{ url: result.url, format: "mp4" }] };
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
