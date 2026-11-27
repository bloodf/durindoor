// RenderHour job observation: read the accepted job, poll it within a bound and
// decode its image, video or speech files. One job API serves all three tasks;
// each task has its own fixed bounds and accepted file types.
//
// Ported from cheaper-inference/OmniRoute at
// 9671192011beb2d7f83979f40be488c5da8772b9 (MIT, Copyright (c) 2026 Cheaper
// Inference - Created by Diego Souza):
// open-sse/handlers/mediaGeneration/renderhour.ts, with the poll retry rules of
// open-sse/handlers/videoGeneration/pollRetry.ts.
//
// Fork deviations: fixed origin (no connection base URL override), redirects are
// refused, bodies are size and time bounded, job ids are validated, an unknown
// status ends polling, and upstream text never reaches an error message. Once
// the submit is accepted, anything short of a reported job failure is an unknown
// outcome, so the gateway does not resubmit a job that may still bill.
import { jobOutcomeUnknown, readJobBody, sleep } from "../../handlers/imageProviders/_base.js";
import { RENDERHOUR_GENERATIONS_URL } from "../../providers/private/renderhour.js";
import { resolveCredentialProxyOptions } from "../oauthCredentialManager.js";
import { readBoundedResponseText } from "../../utils/error.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

export const RENDERHOUR_POLL_INTERVAL_MS = 2_000;
export const RENDERHOUR_POLL_TIMEOUT_MS = 300_000;
export const RENDERHOUR_REQUEST_TIMEOUT_MS = 30_000;
export const RENDERHOUR_MAX_POLL_RETRIES = 5;
export const RENDERHOUR_MAX_RETRY_DELAY_MS = 30_000;
export const RENDERHOUR_MAX_IMAGES = 4;
// Video and speech bounds follow the pinned handlers' defaults (renderhourHandler.ts:
// 900 s / 5 s; renderhourSpeech.ts: 180 s / 2 s), fixed here so callers cannot change them.
export const RENDERHOUR_VIDEO_POLL_INTERVAL_MS = 5_000;
export const RENDERHOUR_VIDEO_POLL_TIMEOUT_MS = 900_000;
export const RENDERHOUR_SPEECH_POLL_INTERVAL_MS = 2_000;
export const RENDERHOUR_SPEECH_POLL_TIMEOUT_MS = 180_000;
// The source does not bound how many files a video or speech job returns.
export const RENDERHOUR_MAX_MEDIA_OUTPUTS = 4;

const MAX_JSON_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 4096;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PENDING_STATUSES = new Set(["queued", "running"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
// The source does not document video or audio content types; these are the
// containers a gateway client can play. Anything else rejects the whole result.
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/opus",
  "audio/aac", "audio/flac", "audio/mp4", "audio/webm",
]);
const TASKS = {
  image: { types: IMAGE_TYPES, intervalMs: RENDERHOUR_POLL_INTERVAL_MS, timeoutMs: RENDERHOUR_POLL_TIMEOUT_MS },
  video: { types: VIDEO_TYPES, intervalMs: RENDERHOUR_VIDEO_POLL_INTERVAL_MS, timeoutMs: RENDERHOUR_VIDEO_POLL_TIMEOUT_MS },
  speech: { types: AUDIO_TYPES, intervalMs: RENDERHOUR_SPEECH_POLL_INTERVAL_MS, timeoutMs: RENDERHOUR_SPEECH_POLL_TIMEOUT_MS },
};
// A reported failure reason, as an HTTP status: the request's fault, or a timeout.
// Anything else is a 502, and only these words are ever repeated to the caller.
const FAILURE_STATUS = new Map([["moderation", 422], ["invalid_input", 422], ["timeout", 504], ["expired", 504]]);
// Statuses worth passing on when a poll is rejected, so account health sees them.
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);

const unknownOutcome = (what, status = 502) => jobOutcomeUnknown(`RenderHour ${what}`, status);

// Delta-seconds or HTTP-date, in milliseconds.
function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

async function readJob(response, { signal, timeoutMs }) {
  const text = await readJobBody(
    () => readBoundedResponseText(response, { signal, maxBytes: MAX_JSON_BYTES, timeoutMs, throwOnTimeout: true }),
    signal
  );
  let job;
  try {
    job = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (!isRecord(job)) throw unknownOutcome("returned an unreadable job response");
  return job;
}

// The connection's key must never come back inside a result URL, raw or encoded.
function carriesSecret(href, secret) {
  if (!secret) return false;
  return href.includes(secret) || href.includes(encodeURIComponent(secret));
}

// A usable file: { url, contentType }, or null.
function fileOutput(output, types, secret) {
  if (!isRecord(output) || !isString(output.url) || output.url.length > MAX_URL_LENGTH) return null;
  if (!types.has(output.content_type)) return null;
  let url;
  try {
    url = new URL(output.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (carriesSecret(url.href, secret) || carriesSecret(output.url, secret)) return null;
  return { url: url.href, contentType: output.content_type };
}

// null while the job is pending; the files once it succeeded. Throws otherwise.
function settle(job, task, expectedCount, secret) {
  if (PENDING_STATUSES.has(job.status)) return null;
  if (job.status === "failed") {
    const known = FAILURE_STATUS.has(job.failure_reason);
    throw Object.assign(
      new Error(`RenderHour ${task} job failed: ${known ? job.failure_reason : "unknown reason"}`),
      { status: known ? FAILURE_STATUS.get(job.failure_reason) : 502 }
    );
  }
  if (job.status !== "succeeded") throw unknownOutcome("returned an unknown job status");
  const outputs = Array.isArray(job.outputs) ? job.outputs : [];
  const files = outputs.map((output) => fileOutput(output, TASKS[task].types, secret));
  if (files.length === 0 || files.length > expectedCount || files.includes(null)) {
    throw unknownOutcome(`job succeeded without a usable ${task} result`);
  }
  return files;
}

/**
 * Follow one accepted submit of any task to its files.
 *
 * Everything the poll needs (key, proxy, job id) is local to this call, so
 * concurrent accounts share no state.
 *
 * @param {Response} submitted - the 2xx answer to POST /v1/generations
 * @param {{ task: "image"|"video"|"speech", count: number }} options - plus the key, signal and bounds
 * @returns {Promise<Array<{ url: string, contentType: string }>>}
 */
export async function awaitRenderHourJob(submitted, {
  task,
  authorization,
  credentials,
  count,
  signal,
  pollIntervalMs = TASKS[task]?.intervalMs,
  timeoutMs = TASKS[task]?.timeoutMs,
  requestTimeoutMs = RENDERHOUR_REQUEST_TIMEOUT_MS,
  wait = sleep,
  now = Date.now,
}) {
  if (!TASKS[task]) throw new TypeError("Unknown RenderHour task");
  const deadline = now() + timeoutMs;
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  let job = await readJob(submitted, { signal, timeoutMs: budget() });
  const { id } = job;
  if (!isString(id) || !JOB_ID_RE.test(id)) throw unknownOutcome("did not return a usable job id");
  const statusUrl = `${RENDERHOUR_GENERATIONS_URL}/${id}`;
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  const secret = isString(credentials?.apiKey) ? credentials.apiKey : null;
  let files = settle(job, task, count, secret);

  while (!files) {
    if (now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome(`${task} job did not finish in time`, 504);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    const requestTimeout = AbortSignal.timeout(budget());
    let response;
    try {
      response = await fetch(statusUrl, {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
        proxyOptions,
      });
    } catch {
      signal?.throwIfAborted();
      if (requestTimeout.aborted) throw unknownOutcome("status check timed out", 504);
      // A transport error's text can describe the request, so it is not repeated.
      throw unknownOutcome("status check failed");
    }
    signal?.throwIfAborted();

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const { status } = response;
      if ((status === 429 || status === 503) && retries < RENDERHOUR_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          RENDERHOUR_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }

    job = await readJob(response, { signal, timeoutMs: budget() });
    if (job.id !== id) throw unknownOutcome("answered about a different job");
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    files = settle(job, task, count, secret);
  }
  return files;
}

/**
 * Follow one accepted image submit to its image URLs.
 *
 * @param {Response} submitted - the 2xx answer to POST /v1/generations
 * @returns {Promise<string[]>}
 */
export async function awaitRenderHourImages(submitted, options) {
  const files = await awaitRenderHourJob(submitted, { ...options, task: "image" });
  return files.map((file) => file.url);
}
