// Request builder for the staged MiniMax video adapter. The source
// (minimaxHandler.ts buildMinimaxVideoRequestBody) sends
// `{ model, prompt, duration?, resolution?, first_frame_image?, prompt_optimizer?,
// fast_pretreatment? }`, takes the first frame from `first_frame_image`,
// `image_url` or `image`, accepts 6 or 10 s and 720P/768P/1080P for every model
// and silently drops every other field. Here unknown fields, a duration or
// resolution the model does not offer, a first frame on a text-only model and a
// first frame that is not a public https URL or an image data URL are refused
// with a 400 before anything is sent. The caller's `timeout_ms` /
// `poll_interval_ms` are read as in the source (same ceilings) and never forwarded.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  MINIMAX_JOB_TIMEOUT_MS, MINIMAX_MAX_JOB_TIMEOUT_MS, MINIMAX_MAX_POLL_INTERVAL_MS, MINIMAX_MIN_POLL_INTERVAL_MS,
  MINIMAX_POLL_INTERVAL_MS, MINIMAX_VIDEO_MODELS, minimaxVideoModel,
} from "./config.js";
import { minimaxPublicUrl } from "./http.js";

/** Source MAX_PROMPT_CHARACTERS. */
export const MINIMAX_MAX_PROMPT_CHARS = 2_000;
/** MiniMax's documented default duration when none is sent. */
const DEFAULT_DURATION = 6;
// MiniMax documents a 20 MB first-frame limit; base64 adds a third.
const MAX_DATA_URL_CHARS = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 64;
const DATA_URL_RE = /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const FRAME_FIELDS = ["first_frame_image", "image_url", "image"];
// Gateway fields the adapter reads itself plus the source's body fields.
const ALLOWED = new Set([
  "model", "prompt", "n", "response_format", "user", "stream",
  "duration", "seconds", "resolution", ...FRAME_FIELDS, "prompt_optimizer", "fast_pretreatment",
  "timeout_ms", "poll_interval_ms",
]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;

function durationOf(field, value) {
  const seconds = isString(value) && /^\d{1,3}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(seconds)) throw reject(`MiniMax video ${field} must be a whole number of seconds`);
  return seconds;
}

function firstFrameOf(body) {
  const given = FRAME_FIELDS.filter((field) => present(body[field]));
  if (!given.length) return null;
  const values = given.map((field) => {
    const value = body[field];
    if (!isString(value) || !value.trim()) throw reject(`MiniMax video ${field} must be a non-empty string`);
    return value.trim();
  });
  if (new Set(values).size > 1) throw reject(`MiniMax video ${given.join(" and ")} disagree; send one first frame`);
  const frame = values[0];
  if (frame.startsWith("data:")) {
    if (frame.length > MAX_DATA_URL_CHARS || !DATA_URL_RE.test(frame)) {
      throw reject("MiniMax video first frame must be a base64 JPEG, PNG or WebP data URL of at most 20 MB");
    }
    return frame;
  }
  const url = minimaxPublicUrl(frame);
  if (!url) throw reject("MiniMax video first frame must be a public https URL or an image data URL");
  return url;
}

/** The MiniMax `/v1/video_generation` body for an OpenAI-style video request. */
export function buildMinimaxVideoRequest(model, body) {
  const entry = minimaxVideoModel(model);
  if (!entry) {
    throw reject(`Unsupported MiniMax video model: ${model}. Use one of: ${MINIMAX_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("MiniMax video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("MiniMax video generation requires a prompt");
  const prompt = body.prompt.trim();
  if (prompt.length > MINIMAX_MAX_PROMPT_CHARS) {
    throw reject(`MiniMax video generation prompts must not exceed ${MINIMAX_MAX_PROMPT_CHARS} characters`);
  }
  if (present(body.n) && body.n !== 1) throw reject("MiniMax video generation returns one video per request (n=1)");
  if (body.stream) throw reject("MiniMax video generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "url") throw reject("MiniMax video supports response_format url only");
  const unsupported = Object.keys(body).find((key) => !ALLOWED.has(key) && present(body[key]));
  if (unsupported) throw reject(`MiniMax video generation does not support ${unsupported}`);

  const request = { model: entry.id, prompt };
  const firstFrame = firstFrameOf(body);
  if (firstFrame && !entry.imageToVideo) throw reject(`MiniMax ${entry.id} is text-to-video only and does not take a first frame`);
  const table = firstFrame ? entry.imageToVideo : entry.textToVideo;

  const duration = present(body.duration) ? durationOf("duration", body.duration) : null;
  const seconds = present(body.seconds) ? durationOf("seconds", body.seconds) : null;
  if (duration !== null && seconds !== null && duration !== seconds) {
    throw reject("MiniMax video duration and seconds disagree; send one of them");
  }
  const requested = duration ?? seconds;
  const durations = Object.keys(table).map(Number);
  if (requested !== null && !durations.includes(requested)) {
    throw reject(`MiniMax ${entry.id} duration must be one of: ${durations.join(", ")} seconds`);
  }
  if (requested !== null) request.duration = requested;

  if (present(body.resolution)) {
    const resolution = isString(body.resolution) ? body.resolution.trim().toUpperCase() : "";
    const allowed = table[requested ?? DEFAULT_DURATION] ?? [];
    if (!allowed.includes(resolution)) {
      throw reject(`MiniMax ${entry.id} at ${requested ?? DEFAULT_DURATION}s resolution must be one of: ${allowed.join(", ")}`);
    }
    request.resolution = resolution;
  }
  if (firstFrame) request.first_frame_image = firstFrame;

  for (const field of ["prompt_optimizer", "fast_pretreatment"]) {
    if (!present(body[field])) continue;
    if (!isBoolean(body[field])) throw reject(`MiniMax video ${field} must be true or false`);
    request[field] = body[field];
  }
  return request;
}

function callerMs(body, field, fallback, min, max) {
  if (!present(body?.[field])) return fallback;
  const value = body[field];
  if (!isNumber(value) || !Number.isFinite(value) || value < 1) {
    throw reject(`MiniMax video ${field} must be a positive number of milliseconds`);
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * The job deadline and poll interval: the source defaults (300 s, 5 s), or the
 * caller's values clamped to 600 s and 1 s–120 s. Never forwarded.
 */
export function resolveMinimaxTiming(body) {
  return {
    timeoutMs: callerMs(body, "timeout_ms", MINIMAX_JOB_TIMEOUT_MS, 1, MINIMAX_MAX_JOB_TIMEOUT_MS),
    pollIntervalMs: callerMs(body, "poll_interval_ms", MINIMAX_POLL_INTERVAL_MS, MINIMAX_MIN_POLL_INTERVAL_MS, MINIMAX_MAX_POLL_INTERVAL_MS),
  };
}
