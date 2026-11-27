// Request builder for the staged xAI video adapter. The source
// (xaiGrokImagineHandler.ts buildXaiVideoPayload) sends `{ model, prompt,
// image?: { url }, reference_images?, duration?, aspect_ratio?, resolution? }`
// and silently drops everything else, stringifies a non-string prompt and
// sends `Number(duration)` even when it is NaN. CPA
// (openai_videos_handlers.go buildXAIVideosCreateRequest) also reads the
// OpenAI-style `seconds`, `size`, `input_reference` and `reference_image_urls`.
// Both shapes are accepted here; every value neither source could send
// correctly is refused with a 400 before anything is billable. The caller's
// `timeout_ms` / `poll_interval_ms` / `max_polls` are read as in the source
// and never forwarded.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  XAI_ASPECT_RATIOS, XAI_ASPECT_RATIO_ALIASES, XAI_JOB_TIMEOUT_MS, XAI_MAX_DURATION_SECONDS, XAI_MAX_JOB_TIMEOUT_MS,
  XAI_MAX_POLLS, XAI_MAX_POLL_INTERVAL_MS, XAI_MAX_REFERENCE_IMAGES, XAI_MIN_DURATION_SECONDS, XAI_MIN_POLL_INTERVAL_MS,
  XAI_POLL_INTERVAL_MS, XAI_RESOLUTIONS, XAI_SIZE_MAP, XAI_VIDEO_MODELS, xaiVideoModel,
} from "./config.js";

const MAX_PROMPT_CHARS = 8_000;
const MAX_URL_CHARS = 4_096;
// A data: URI start frame is forwarded as xAI accepts it; bound its size.
const MAX_DATA_URI_CHARS = 10 * 1024 * 1024;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const ALLOWED = new Set([
  "model", "prompt", "n", "response_format", "user", "stream",
  "image", "image_url", "input_reference", "reference_images", "reference_image_urls",
  "duration", "seconds", "size", "aspect_ratio", "resolution", "generate_audio",
  "timeout_ms", "poll_interval_ms", "max_polls",
]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null;

/**
 * An image reference xAI may fetch: an https URL on a public literal host
 * without userinfo, or a base64 `data:image/...` URI. Anything else is refused,
 * so the gateway never asks xAI to fetch a private or credentialed address.
 */
export function xaiImageReference(raw, field) {
  if (!isString(raw) || !raw.trim()) throw reject(`xAI video ${field} must be a non-empty image URL`);
  const value = raw.trim();
  if (value.startsWith("data:")) {
    if (value.length > MAX_DATA_URI_CHARS || !DATA_IMAGE_RE.test(value)) {
      throw reject(`xAI video ${field} must be a base64 data:image URI of at most ${MAX_DATA_URI_CHARS} characters`);
    }
    return value;
  }
  let url;
  try {
    url = value.length <= MAX_URL_CHARS ? new URL(value) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) {
    throw reject(`xAI video ${field} must be a public https URL or a data:image URI`);
  }
  return url.href;
}

// `image` as a string, `{ url }` or `{ image_url: { url } }`; CPA `input_reference.image_url`; bare `image_url`.
function startFrameOf(body) {
  const found = [];
  if (present(body.input_reference)) {
    const ref = body.input_reference;
    if (!isRecord(ref)) throw reject("xAI video input_reference must be an object");
    if (present(ref.file_id)) throw reject("input_reference.file_id is not supported for xAI video generation; use input_reference.image_url");
    if (present(ref.image_url)) found.push(["input_reference.image_url", ref.image_url]);
  }
  if (present(body.image)) {
    const image = body.image;
    if (isString(image)) found.push(["image", image]);
    else if (isRecord(image) && present(image.url)) found.push(["image.url", image.url]);
    else if (isRecord(image) && isRecord(image.image_url)) found.push(["image.image_url.url", image.image_url.url]);
    else throw reject("xAI video image must be a URL string or { url }");
  }
  if (present(body.image_url)) found.push(["image_url", isRecord(body.image_url) ? body.image_url.url : body.image_url]);
  if (found.length > 1) throw reject("xAI video takes one start image; send image, image_url or input_reference only once");
  return found.length ? xaiImageReference(found[0][1], found[0][0]) : null;
}

function referenceImagesOf(body) {
  const out = [];
  for (const field of ["reference_images", "reference_image_urls"]) {
    if (!present(body[field])) continue;
    if (!Array.isArray(body[field])) throw reject(`xAI video ${field} must be an array`);
    body[field].forEach((item, index) => {
      const raw = isString(item) ? item : isRecord(item) ? (item.url ?? (isRecord(item.image_url) ? item.image_url.url : undefined)) : undefined;
      out.push(xaiImageReference(raw, `${field}[${index}]`));
    });
  }
  if (out.length > XAI_MAX_REFERENCE_IMAGES) throw reject(`reference_images supports at most ${XAI_MAX_REFERENCE_IMAGES} images on xAI`);
  return out;
}

function durationOf(field, value) {
  const seconds = isString(value) && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(seconds) || seconds < XAI_MIN_DURATION_SECONDS || seconds > XAI_MAX_DURATION_SECONDS) {
    throw reject(`xAI video ${field} must be a whole number of seconds from ${XAI_MIN_DURATION_SECONDS} to ${XAI_MAX_DURATION_SECONDS}`);
  }
  return seconds;
}

function aspectRatioOf(value) {
  const key = isString(value) ? value.trim().toLowerCase() : "";
  const ratio = XAI_ASPECT_RATIO_ALIASES[key] ?? (XAI_ASPECT_RATIOS.includes(key) ? key : null);
  if (!ratio) throw reject(`xAI video aspect_ratio must be one of ${XAI_ASPECT_RATIOS.join(", ")}`);
  return ratio;
}

function resolutionOf(value) {
  const key = isString(value) ? value.trim().toLowerCase() : "";
  if (!XAI_RESOLUTIONS.includes(key)) throw reject(`xAI video resolution must be one of ${XAI_RESOLUTIONS.join(", ")}`);
  return key;
}

/**
 * The xAI `POST /v1/videos/generations` body for an OpenAI-style or native
 * video request, plus the request metadata the OpenAI envelope echoes.
 *
 * @returns {{ request: object, meta: { model: string, prompt: string, seconds: string|null, size: string|null } }}
 */
export function buildXaiVideoRequest(model, body) {
  const row = xaiVideoModel(model);
  if (!row) {
    throw reject(`Unsupported xAI video model: ${model}. Use one of: ${XAI_VIDEO_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isRecord(body)) throw reject("xAI video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("xAI video generation needs a text prompt");
  if (body.prompt.length > MAX_PROMPT_CHARS) throw reject(`xAI video prompts must not exceed ${MAX_PROMPT_CHARS} characters`);
  if (present(body.n) && body.n !== 1) throw reject("xAI video generation returns one video per request (n=1)");
  if (body.stream) throw reject("xAI video generation does not support streaming");
  if (present(body.response_format) && body.response_format !== "url") throw reject("xAI video supports response_format url only");
  const unsupported = Object.keys(body).find((key) => !ALLOWED.has(key) && present(body[key]));
  if (unsupported) throw reject(`xAI video generation does not support ${unsupported}`);

  const prompt = body.prompt.trim();
  const request = { model: row.id, prompt };

  const duration = present(body.duration) ? durationOf("duration", body.duration) : null;
  const seconds = present(body.seconds) ? durationOf("seconds", body.seconds) : null;
  if (duration !== null && seconds !== null && duration !== seconds) throw reject("xAI video duration and seconds disagree; send one of them");
  if ((duration ?? seconds) !== null) request.duration = duration ?? seconds;

  let size = null;
  if (present(body.size)) {
    size = isString(body.size) ? body.size.trim() : "";
    const mapped = XAI_SIZE_MAP[size];
    if (!mapped) throw reject(`xAI video size must be one of ${Object.keys(XAI_SIZE_MAP).join(", ")}`);
    Object.assign(request, mapped);
  }
  if (present(body.aspect_ratio)) {
    const ratio = aspectRatioOf(body.aspect_ratio);
    if (size && ratio !== request.aspect_ratio) throw reject("xAI video size and aspect_ratio disagree; send one of them");
    request.aspect_ratio = ratio;
  }
  if (present(body.resolution)) request.resolution = resolutionOf(body.resolution);

  if (present(body.generate_audio)) {
    if (!row.generateAudio) throw reject(`xAI video model ${row.id} does not support generate_audio`);
    if (!isBoolean(body.generate_audio)) throw reject("xAI video generate_audio must be true or false");
    request.generate_audio = body.generate_audio;
  }

  const image = startFrameOf(body);
  const references = referenceImagesOf(body);
  if (image && references.length) throw reject("image and reference_images cannot be combined on xAI");
  if (image) request.image = { url: image };
  if (references.length) request.reference_images = references.map((url) => ({ url }));

  return {
    request,
    meta: { model: row.id, prompt, seconds: (duration ?? seconds) === null ? null : String(duration ?? seconds), size },
  };
}

function knob(body, field, fallback, min, max, message) {
  const value = body?.[field];
  if (!present(value)) return fallback;
  const n = isString(value) && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!isNumber(n) || !Number.isFinite(n) || n < min || n > max) throw reject(message);
  return Math.max(1, Math.floor(n));
}

/**
 * Job bounds from the caller's `timeout_ms`, `poll_interval_ms` and
 * `max_polls`, with the source defaults and ceilings. The poll budget is
 * `min(max_polls, ceil(timeout / interval))` as in the source.
 */
export function resolveXaiTiming(body) {
  const timeoutMs = knob(body, "timeout_ms", XAI_JOB_TIMEOUT_MS, 1, XAI_MAX_JOB_TIMEOUT_MS,
    `timeout_ms must be a positive number of milliseconds up to ${XAI_MAX_JOB_TIMEOUT_MS}`);
  const pollIntervalMs = knob(body, "poll_interval_ms", XAI_POLL_INTERVAL_MS, XAI_MIN_POLL_INTERVAL_MS, XAI_MAX_POLL_INTERVAL_MS,
    `poll_interval_ms must be between ${XAI_MIN_POLL_INTERVAL_MS} and ${XAI_MAX_POLL_INTERVAL_MS}`);
  const clientMaxPolls = knob(body, "max_polls", XAI_MAX_POLLS, 1, XAI_MAX_POLLS,
    `max_polls must be a number of polls between 1 and ${XAI_MAX_POLLS}`);
  return { timeoutMs, pollIntervalMs, maxPolls: Math.min(clientMaxPolls, Math.max(1, Math.ceil(timeoutMs / pollIntervalMs))) };
}
