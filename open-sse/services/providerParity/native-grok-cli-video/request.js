// Request builder for the staged Grok CLI video adapter. The source
// (xaiGrokImagineHandler.ts buildXaiVideoPayload) sends
// `{ model, prompt, image?, reference_images?, duration?, aspect_ratio?, resolution? }`:
// a string `image` becomes `{ url }`, an object passes through, the reference
// list and other fields pass through, `duration` goes through Number(), a
// non-string prompt is stringified and every other field is dropped. Here
// each input is checked before anything is sent: a missing or non-string
// prompt, an unknown field, n != 1, streaming, a non-`url` response format, an
// unusable image reference, a non-integer duration and a malformed aspect
// ratio or resolution are a 400. Image references are normalized to `{ url }`
// (the source's comment: a bare string is an upstream 422). The polling knobs
// `timeout_ms`, `poll_interval_ms` and `max_polls` keep the source ranges and
// are never forwarded.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GROK_CLI_JOB_TIMEOUT_MS, GROK_CLI_MAX_JOB_TIMEOUT_MS, GROK_CLI_MAX_POLLS, GROK_CLI_MIN_POLL_INTERVAL_MS,
  GROK_CLI_POLL_INTERVAL_MS, GROK_CLI_VIDEO_MODELS, grokCliVideoModel,
} from "./config.js";

const MAX_PROMPT_CHARS = 8_000;
const MAX_DURATION_SECONDS = 15;
const MAX_REFERENCE_IMAGES = 8;
const MAX_URL_CHARS = 4_096;
const MAX_DATA_URI_CHARS = 20 * 1024 * 1024;
const DATA_URI_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const ASPECT_RE = /^[1-9]\d?:[1-9]\d?$/;
const RESOLUTION_RE = /^[1-9]\d{2,3}p$/;
const ALLOWED = new Set([
  "model", "prompt", "n", "response_format", "user", "stream",
  "image", "reference_images", "duration", "aspect_ratio", "resolution",
  "timeout_ms", "poll_interval_ms", "max_polls",
]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;

/** A public https URL or an inline base64 image data URI, else null. Never fetched here. */
function imageUrlOf(raw) {
  if (!isString(raw)) return null;
  const value = raw.trim();
  if (value.startsWith("data:")) return value.length <= MAX_DATA_URI_CHARS && DATA_URI_RE.test(value) ? value : null;
  if (value.length > MAX_URL_CHARS) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  return url.href;
}

function imageRef(field, value) {
  const raw = isRecord(value) ? value.url : value;
  if (isRecord(value) && Object.keys(value).some((key) => key !== "url")) {
    throw reject(`Grok CLI video ${field} objects take only a url`);
  }
  const url = imageUrlOf(raw);
  if (!url) throw reject(`Grok CLI video ${field} must be a public https URL or a base64 image data URI`);
  return { url };
}

function durationOf(value) {
  const seconds = isString(value) && /^\d{1,2}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_DURATION_SECONDS) {
    throw reject(`Grok CLI video duration must be a whole number of seconds from 1 to ${MAX_DURATION_SECONDS}`);
  }
  return seconds;
}

/** The cli-chat-proxy `/v1/videos/generations` body for an OpenAI-style video request. */
export function buildGrokCliVideoRequest(model, body) {
  if (!grokCliVideoModel(model)) {
    throw reject(`Unsupported Grok CLI video model: ${model}. Use one of: ${GROK_CLI_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("Grok CLI video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Grok CLI video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Grok CLI video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (present(body.n) && body.n !== 1) throw reject("Grok CLI video generation returns one video per request (n=1)");
  if (body.stream) throw reject("Grok CLI video generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "url") throw reject("Grok CLI video supports response_format url only");
  const unsupported = Object.keys(body).find((key) => !ALLOWED.has(key) && present(body[key]));
  if (unsupported) throw reject(`Grok CLI video generation does not support ${unsupported}`);

  const request = { model, prompt: body.prompt };
  if (present(body.image)) request.image = imageRef("image", body.image);
  if (present(body.reference_images)) {
    const list = body.reference_images;
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_REFERENCE_IMAGES) {
      throw reject(`Grok CLI video reference_images must be a list of 1 to ${MAX_REFERENCE_IMAGES} images`);
    }
    request.reference_images = list.map((entry) => imageRef("reference_images", entry));
  }
  if (present(body.duration)) request.duration = durationOf(body.duration);
  if (present(body.aspect_ratio)) {
    if (!isString(body.aspect_ratio) || !ASPECT_RE.test(body.aspect_ratio)) throw reject("Grok CLI video aspect_ratio must look like 16:9");
    request.aspect_ratio = body.aspect_ratio;
  }
  if (present(body.resolution)) {
    if (!isString(body.resolution) || !RESOLUTION_RE.test(body.resolution)) throw reject("Grok CLI video resolution must look like 720p");
    request.resolution = body.resolution;
  }
  return request;
}

/** Source boundedKnob: the default when absent, else a number in [min, max] floored to >= 1. */
function knob(body, field, fallback, min, max, message) {
  const raw = body?.[field];
  if (!present(raw)) return fallback;
  const value = isString(raw) && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw;
  if (!isNumber(value) || !Number.isFinite(value) || value < min || value > max) throw reject(message);
  return Math.max(1, Math.floor(value));
}

/**
 * The job deadline, poll interval and poll cap from the caller's knobs, with
 * the source ranges: timeout_ms in (0, 30 min], poll_interval_ms in
 * [1 s, 30 min], max_polls in [1, 300]. The poll cap never exceeds the
 * number of intervals that fit in the deadline. Never forwarded.
 */
export function resolveGrokCliTiming(body) {
  const timeoutMs = knob(body, "timeout_ms", GROK_CLI_JOB_TIMEOUT_MS, Number.MIN_VALUE, GROK_CLI_MAX_JOB_TIMEOUT_MS,
    `timeout_ms must be a positive number of milliseconds up to ${GROK_CLI_MAX_JOB_TIMEOUT_MS}`);
  const pollIntervalMs = knob(body, "poll_interval_ms", GROK_CLI_POLL_INTERVAL_MS, GROK_CLI_MIN_POLL_INTERVAL_MS, GROK_CLI_MAX_JOB_TIMEOUT_MS,
    `poll_interval_ms must be between ${GROK_CLI_MIN_POLL_INTERVAL_MS} and ${GROK_CLI_MAX_JOB_TIMEOUT_MS}`);
  const clientMaxPolls = knob(body, "max_polls", GROK_CLI_MAX_POLLS, 1, GROK_CLI_MAX_POLLS,
    `max_polls must be a number of polls between 1 and ${GROK_CLI_MAX_POLLS}`);
  return { timeoutMs, pollIntervalMs, maxPolls: Math.min(clientMaxPolls, Math.max(1, Math.ceil(timeoutMs / pollIntervalMs))) };
}
