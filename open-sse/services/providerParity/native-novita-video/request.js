// Request builder for the staged Novita video adapter. The source
// (novita.ts normalizeNovitaVideoParams / buildNovitaSubmitBody) sends
// `{ prompt, negative_prompt?, duration?, width?, height? }`, with width and
// height parsed from a `WxH` `size` prefix, and silently drops every other
// field, a non-string prompt (stringified), a non-number duration and an
// unparseable size. Here each of those is refused with a 400 before anything
// is sent. The caller's `timeout_ms` / `poll_interval_ms` are read as in the
// source (clamped by the same ceilings) and never forwarded.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NOVITA_JOB_TIMEOUT_MS, NOVITA_MAX_JOB_TIMEOUT_MS, NOVITA_MAX_POLL_INTERVAL_MS, NOVITA_MIN_POLL_INTERVAL_MS,
  NOVITA_POLL_INTERVAL_MS, NOVITA_VIDEO_MODELS, novitaVideoModel,
} from "./config.js";

const MAX_PROMPT_CHARS = 8_000;
const MAX_DURATION_SECONDS = 60;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 4096;
const SIZE_RE = /^(\d{1,5})\s*[x*]\s*(\d{1,5})$/;
// Gateway fields the adapter reads itself; only prompt, negative_prompt,
// duration/seconds and size reach Novita (as the source's body fields).
const ALLOWED = new Set([
  "model", "prompt", "n", "response_format", "user", "stream",
  "negative_prompt", "duration", "seconds", "size", "timeout_ms", "poll_interval_ms",
]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;

function durationOf(field, value) {
  const seconds = isString(value) && /^\d{1,3}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_DURATION_SECONDS) {
    throw reject(`Novita video ${field} must be a whole number of seconds from 1 to ${MAX_DURATION_SECONDS}`);
  }
  return seconds;
}

function dimensionsOf(size) {
  const match = isString(size) ? SIZE_RE.exec(size.trim()) : null;
  const width = match ? Number(match[1]) : NaN;
  const height = match ? Number(match[2]) : NaN;
  const ok = (value) => Number.isSafeInteger(value) && value >= MIN_DIMENSION && value <= MAX_DIMENSION;
  if (!ok(width) || !ok(height)) {
    throw reject(`Novita video size must be WIDTHxHEIGHT with each side from ${MIN_DIMENSION} to ${MAX_DIMENSION}`);
  }
  return { width, height };
}

/** The Novita `/v3/async/{model}` body for an OpenAI-style video request. */
export function buildNovitaVideoRequest(model, body) {
  if (!novitaVideoModel(model)) {
    throw reject(`Unsupported Novita video model: ${model}. Use one of: ${NOVITA_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("Novita video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Novita video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`Novita video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (present(body.n) && body.n !== 1) throw reject("Novita video generation returns one video per request (n=1)");
  if (body.stream) throw reject("Novita video generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "url") throw reject("Novita video supports response_format url only");
  const unsupported = Object.keys(body).find((key) => !ALLOWED.has(key) && present(body[key]));
  if (unsupported) throw reject(`Novita video generation does not support ${unsupported}`);

  const request = { prompt: body.prompt };
  if (present(body.negative_prompt)) {
    if (!isString(body.negative_prompt) || body.negative_prompt.length > MAX_PROMPT_CHARS) {
      throw reject(`Novita video negative_prompt must be a string of at most ${MAX_PROMPT_CHARS} characters`);
    }
    // The source skipped an empty negative prompt.
    if (body.negative_prompt) request.negative_prompt = body.negative_prompt;
  }
  const duration = present(body.duration) ? durationOf("duration", body.duration) : null;
  const seconds = present(body.seconds) ? durationOf("seconds", body.seconds) : null;
  if (duration !== null && seconds !== null && duration !== seconds) {
    throw reject("Novita video duration and seconds disagree; send one of them");
  }
  if ((duration ?? seconds) !== null) request.duration = duration ?? seconds;
  if (present(body.size)) Object.assign(request, dimensionsOf(body.size));
  return request;
}

function callerMs(body, field, fallback, min, max) {
  if (!present(body?.[field])) return fallback;
  const value = body[field];
  if (!isNumber(value) || !Number.isFinite(value) || value < 1) {
    throw reject(`Novita video ${field} must be a positive number of milliseconds`);
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * The job deadline and poll interval: the source defaults (300 s, 2.5 s), or
 * the caller's values clamped to 600 s and 1 s–120 s. Never forwarded.
 */
export function resolveNovitaTiming(body) {
  return {
    timeoutMs: callerMs(body, "timeout_ms", NOVITA_JOB_TIMEOUT_MS, 1, NOVITA_MAX_JOB_TIMEOUT_MS),
    pollIntervalMs: callerMs(body, "poll_interval_ms", NOVITA_POLL_INTERVAL_MS, NOVITA_MIN_POLL_INTERVAL_MS, NOVITA_MAX_POLL_INTERVAL_MS),
  };
}
