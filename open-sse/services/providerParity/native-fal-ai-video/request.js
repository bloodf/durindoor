// fal.ai video submit bodies for the three source models, built before any
// credential is used or any request is sent.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/mediaGeneration/fal.ts (buildFalVideoRequestBody,
// resolveFalModel, falDuration, grokDuration, geminiDuration,
// falResolutionFor) and open-sse/config/falEndpoint.ts (falSelectionEndpoint).
//
// Fork deviations: a value the source would silently replace with a default
// (a duration outside the model's range, a second image for a single-image
// model, an image for the text-only Veo Lite app) is refused with 400 instead.
// The Gemini range 3 to 10 s is refused rather than clamped. Image inputs must be
// https URLs on a public host or bounded base64 data URIs, because fal fetches
// them. The Grok endpoint variant follows the body actually sent. The source
// picks it from the caller's raw `image_url` / `reference_image_urls`, so a
// single `image_urls` entry went to `text-to-video` there. `n` above 1,
// `stream` and image upload fields are refused, not ignored.
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { falBuiltInFamily, falVideoEndpoint } from "./config.js";

const MAX_URL_LENGTH = 2048;
// Decoded image bytes fal is asked to read from a data URI.
export const FAL_VIDEO_MAX_DATA_URI_BYTES = 10 * 1024 * 1024;
const DATA_URI_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/;

export const FAL_VEO_ASPECT_RATIOS = Object.freeze(["16:9", "9:16"]);
export const FAL_VEO_DURATIONS = Object.freeze(["4s", "6s", "8s"]);
export const FAL_VEO_RESOLUTIONS = Object.freeze(["720p", "1080p"]);
export const FAL_GEMINI_SECONDS = Object.freeze({ min: 3, max: 10 });

// Fields this adapter never uploads. The source dropped them silently.
const UPLOAD_FIELDS = ["image", "images", "mask", "input_reference", "video", "video_url", "audio_url"];

export const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const present = (value) => value !== undefined && value !== null && value !== "";

/** An image reference fal may fetch: an https URL on a public host, or a bounded data URI. */
export function falImageReference(raw, field) {
  const text = isString(raw) ? raw.trim() : "";
  const data = DATA_URI_RE.exec(text);
  if (data) {
    const bytes = Math.floor((data[2].length * 3) / 4);
    if (bytes > FAL_VIDEO_MAX_DATA_URI_BYTES) throw badRequest(`${field} is larger than ${FAL_VIDEO_MAX_DATA_URI_BYTES} bytes`);
    return text;
  }
  let url = null;
  if (text && text.length <= MAX_URL_LENGTH) {
    try {
      url = new URL(text);
    } catch {
      url = null;
    }
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) {
    throw badRequest(`${field} must be an https URL on a public host or a base64 image data URI`);
  }
  return url.href;
}

// The caller's images, from `image_url` and/or `image_urls`, validated.
function images(body) {
  const list = [];
  if (present(body.image_url)) list.push(falImageReference(body.image_url, "image_url"));
  if (body.image_urls !== undefined) {
    if (!Array.isArray(body.image_urls)) throw badRequest("image_urls must be an array of image URLs");
    body.image_urls.forEach((value, i) => list.push(falImageReference(value, `image_urls[${i}]`)));
  }
  return list;
}

// Seconds from 8, "8" or "8s"; undefined when absent. Throws on anything else.
function seconds(value, field = "duration") {
  if (value === undefined || value === null) return undefined;
  const numeric = isNumber(value) ? value : isString(value) && /^\d+(\.\d+)?s?$/.test(value.trim()) ? Number(value.trim().replace(/s$/, "")) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) throw badRequest(`${field} must be a positive number of seconds`);
  return numeric;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// `aspect_ratio` (or `aspectRatio`), else the reduced ratio of an OpenAI `size`.
function aspectRatio(body) {
  const explicit = [body.aspect_ratio, body.aspectRatio].find((value) => present(value));
  let fromSize;
  if (present(body.size)) {
    const match = isString(body.size) ? /^(\d{1,5})\s*[x×]\s*(\d{1,5})$/i.exec(body.size.trim()) : null;
    if (!match || Number(match[1]) === 0 || Number(match[2]) === 0) throw badRequest("size must be WIDTHxHEIGHT");
    const divisor = gcd(Number(match[1]), Number(match[2]));
    fromSize = `${Number(match[1]) / divisor}:${Number(match[2]) / divisor}`;
  }
  if (explicit !== undefined) {
    if (!isString(explicit) || !/^\d{1,3}:\d{1,3}$/.test(explicit.trim())) throw badRequest("aspect_ratio must look like 16:9");
    if (fromSize && fromSize !== explicit.trim()) throw badRequest("size and aspect_ratio disagree");
    return explicit.trim();
  }
  return fromSize;
}

function assertCommon(body) {
  if (!isRecord(body)) throw badRequest("fal video generation needs a JSON object");
  if (!isString(body.prompt) || !body.prompt.trim()) throw badRequest("fal video generation needs a text prompt");
  if (body.n !== undefined && body.n !== 1) throw badRequest("fal video generation returns one video per request; n must be 1");
  if (body.stream !== undefined && body.stream !== false) throw badRequest("fal video generation does not stream");
  const upload = UPLOAD_FIELDS.find((field) => present(body[field]) && !(Array.isArray(body[field]) && body[field].length === 0));
  if (upload) throw badRequest(`${upload} is not supported; pass image references as image_url or image_urls`);
}

function veoBody(body) {
  if (images(body).length) throw badRequest("Veo 3.1 Lite on fal is text-to-video only");
  const ratio = aspectRatio(body) ?? "16:9";
  if (!FAL_VEO_ASPECT_RATIOS.includes(ratio)) throw badRequest(`aspect_ratio must be one of: ${FAL_VEO_ASPECT_RATIOS.join(", ")}`);
  const duration = seconds(body.duration);
  if (duration !== undefined && !FAL_VEO_DURATIONS.includes(`${duration}s`)) {
    throw badRequest(`duration must be one of: ${FAL_VEO_DURATIONS.join(", ")}`);
  }
  const resolution = present(body.resolution) ? body.resolution : body.quality === "hd" ? "1080p" : "720p";
  if (!FAL_VEO_RESOLUTIONS.includes(resolution)) throw badRequest(`resolution must be one of: ${FAL_VEO_RESOLUTIONS.join(", ")}`);
  const request = {
    prompt: body.prompt.trim(),
    aspect_ratio: ratio,
    duration: duration === undefined ? "8s" : `${duration}s`,
    resolution,
    generate_audio: isBoolean(body.generate_audio) ? body.generate_audio : true,
  };
  for (const field of ["negative_prompt", "safety_tolerance"]) {
    if (!present(body[field])) continue;
    if (!isString(body[field])) throw badRequest(`${field} must be a string`);
    request[field] = body[field].trim();
  }
  if (body.seed !== undefined) {
    if (!Number.isInteger(body.seed)) throw badRequest("seed must be an integer");
    request.seed = body.seed;
  }
  if (body.auto_fix !== undefined) {
    if (!isBoolean(body.auto_fix)) throw badRequest("auto_fix must be a boolean");
    request.auto_fix = body.auto_fix;
  }
  return { endpoint: "fal-ai/veo3.1/lite", request };
}

function geminiBody(model, body) {
  const list = images(body);
  if (list.length > 1) throw badRequest("Gemini Omni Flash on fal takes at most one image");
  if (model.endsWith("/image-to-video") && list.length === 0) throw badRequest("image-to-video needs image_url");
  const duration = seconds(body.duration);
  if (duration !== undefined && (!Number.isInteger(duration) || duration < FAL_GEMINI_SECONDS.min || duration > FAL_GEMINI_SECONDS.max)) {
    throw badRequest(`duration must be a whole number of seconds from ${FAL_GEMINI_SECONDS.min} to ${FAL_GEMINI_SECONDS.max}`);
  }
  const request = { prompt: body.prompt.trim(), aspect_ratio: aspectRatio(body) ?? "16:9", duration: duration ?? 8 };
  if (list.length) request.image_url = list[0];
  return { endpoint: list.length ? "google/gemini-omni-flash/image-to-video" : "google/gemini-omni-flash", request };
}

function grokBody(model, body) {
  const list = images(body);
  const duration = seconds(body.duration);
  if (duration !== undefined && !Number.isInteger(duration)) throw badRequest("duration must be a whole number of seconds");
  if (present(body.resolution) && !isString(body.resolution)) throw badRequest("resolution must be a string");
  const request = {
    prompt: body.prompt.trim(),
    aspect_ratio: aspectRatio(body) ?? "16:9",
    duration: duration ?? 6,
    resolution: present(body.resolution) ? body.resolution.trim() : "720p",
  };
  const variant = list.length > 1 ? "reference-to-video" : list.length === 1 ? "image-to-video" : "text-to-video";
  if (list.length === 1) request.image_url = list[0];
  if (list.length > 1) request.reference_image_urls = list;
  const requested = model.slice("xai/grok-imagine-video/".length);
  if (requested !== "text-to-video" && requested !== variant) {
    throw badRequest(`${requested} needs ${requested === "image-to-video" ? "exactly one image" : "two or more images"}`);
  }
  return { endpoint: `xai/grok-imagine-video/${variant}`, request };
}

/**
 * The fal endpoint and submit body for a built-in source model, or null when
 * `model` needs schema discovery (or the caller passed `fal_input`). Throws a
 * 400 error for anything the model cannot take.
 */
export function buildFalVideoRequest(model, body) {
  const family = falBuiltInFamily(model);
  assertCommon(body);
  if (!family || body.fal_input !== undefined) return null;
  if (family === "veo") return veoBody(body);
  if (family === "gemini-omni") return geminiBody(model, body);
  return grokBody(model, body);
}

/** The endpoint a discovered (non-built-in) model addresses. Throws a 400 error. */
export function falDiscoveredEndpoint(model) {
  return falVideoEndpoint(model);
}

export { assertCommon as assertFalVideoCommon, aspectRatio as falAspectRatio };
