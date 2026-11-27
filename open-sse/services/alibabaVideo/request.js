// Alibaba DashScope video-synthesis request bodies for /v1/video/generations.
// Used by handlers/videoProviders/alibaba.js; the job client is ./job.js.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/videoRegistry.ts, the `alibaba` entry (format
//   "dashscope-video", the nine model ids below, nothing else);
// - open-sse/handlers/videoGeneration/dashscopeHandler.ts:
//   buildAlibabaMediaPayload, buildHappyHorsePayload, the buildModernDashscope*
//   builders, buildDashscopeInput, buildModernDashscopeParameters,
//   collectDashscopeMedia / toDashscopeMediaItem / dedupeDashscopeMedia,
//   normalizeHappyHorseResolution and normalizeHappyHorseRatio.
//
// Fork deviations, all refusals before anything is sent (the source silently
// drops or forwards these):
// - a raw `parameters` object is refused instead of copied into the body;
// - media a model's builder would ignore (an image for a text-to-video model, a
//   second first frame, audio for reference-to-video, ...) is refused;
// - an explicit `media` list cannot be mixed with the shorthand media fields,
//   and an unknown explicit media type is refused instead of read as a
//   reference image;
// - media URLs must be https on a public host (literal check, the gateway
//   never fetches them: DashScope does);
// - resolution must be 720P or 1080P, the ratio one of the five the source
//   derives from a size, and a size must name one of those ratios with a 720
//   or 1080 short side (the source rounds any size to one of the two tiers);
// - a ratio or size for an image-to-video model is refused (the source drops
//   it: the first frame sets the ratio);
// - an unusable duration, seed, boolean or shot_type is refused, not dropped;
// - OpenAI's `seconds` is read as `duration`; `n` other than 1 is refused.
// Duration ranges are not checked here: the source sets none, and DashScope
// refuses an out-of-range value before it creates a task.
import { isBoolean, isNumber, isRecord, isString } from "../../../src/shared/utils/typeChecks.js";
import { isBlockedHost } from "../../../src/shared/utils/ssrfGuard.js";

/** How each model's body is built: the source's builder for that id. */
const MODEL_KINDS = Object.freeze({
  "happyhorse-1.1-t2v": "happyhorse-t2v",
  "happyhorse-1.1-i2v": "happyhorse-i2v",
  "happyhorse-1.1-r2v": "happyhorse-r2v",
  "happyhorse-1.0-video-edit": "video-edit",
  "wan2.7-videoedit": "video-edit",
  "wan2.7-t2v-2026-06-12": "t2v",
  "wan2.7-i2v-2026-04-25": "i2v",
  "wan2.6-i2v-flash": "i2v",
  "wan2.7-r2v-2026-06-12": "r2v",
});

/** The `alibaba` video model ids of the source registry, in its order. */
export const ALIBABA_VIDEO_MODEL_IDS = Object.freeze([
  "happyhorse-1.1-i2v",
  "happyhorse-1.1-t2v",
  "happyhorse-1.1-r2v",
  "happyhorse-1.0-video-edit",
  "wan2.7-i2v-2026-04-25",
  "wan2.6-i2v-flash",
  "wan2.7-t2v-2026-06-12",
  "wan2.7-r2v-2026-06-12",
  "wan2.7-videoedit",
]);

/** Ratios normalizeHappyHorseRatio derives from a size. */
export const ALIBABA_VIDEO_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"]);
export const ALIBABA_VIDEO_RESOLUTIONS = Object.freeze(["720P", "1080P"]);
// Gateway bounds, not DashScope limits.
export const ALIBABA_VIDEO_MAX_PROMPT_LENGTH = 8192;
export const ALIBABA_VIDEO_MAX_MEDIA = 9;
const MAX_URL_LENGTH = 2048;
const MAX_SHORT_TEXT = 64;

const MEDIA_TYPES = new Set(["first_frame", "last_frame", "first_clip", "reference_image", "reference_video", "video", "driving_audio"]);
const IMAGE_FIELDS = ["image", "image_url", "imageUrls", "image_urls"];
const SHORTHAND_FIELDS = [...IMAGE_FIELDS, "reference_images", "video", "video_url", "videoUrls", "video_urls", "reference_videos", "audio", "audio_url"];
const CHAT_FIELDS = ["messages", "input_messages", "tools", "tool_choice"];
const WITHOUT_RATIO = new Set(["happyhorse-i2v", "i2v"]);
const IMAGES = new Set(["first_frame", "reference_image"]);
const VIDEOS = new Set(["video", "first_clip", "reference_video"]);

const reject = (message) => Object.assign(new Error(message), { status: 400 });
const present = (value) => value != null && value !== "" && !(Array.isArray(value) && value.length === 0);

/** Whether `model` is one of the source's `alibaba` video models. */
export const isAlibabaVideoModel = (model) => Object.hasOwn(MODEL_KINDS, model);

// An https URL on a literal public host, without credentials. Thrown otherwise.
function mediaUrl(raw) {
  const text = isString(raw) ? raw.trim() : "";
  let url = null;
  if (text && text.length <= MAX_URL_LENGTH) {
    try {
      url = new URL(text);
    } catch {
      url = null;
    }
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) {
    throw reject("Alibaba video media must be https URLs on a public host");
  }
  return url.href;
}

// toDashscopeMediaItem, strict: an unusable entry is refused, never skipped.
function mediaItem(value, fallbackType) {
  if (isString(value)) return { type: fallbackType, url: mediaUrl(value) };
  if (!isRecord(value)) throw reject("Alibaba video media entries must be URLs or objects with a url");
  const urls = [value.url, value.image_url, value.video_url, value.audio_url].filter(present);
  if (urls.length !== 1) throw reject("Alibaba video media entries need exactly one url");
  let type = fallbackType;
  if (value.type != null) {
    if (!MEDIA_TYPES.has(value.type)) throw reject(`Alibaba video media type must be one of: ${[...MEDIA_TYPES].join(", ")}`);
    type = value.type;
  }
  const item = { type, url: mediaUrl(urls[0]) };
  if (value.reference_voice != null) {
    if (!isString(value.reference_voice) || !value.reference_voice.trim() || value.reference_voice.length > MAX_SHORT_TEXT) {
      throw reject("Alibaba video reference_voice must be a short nonempty string");
    }
    item.reference_voice = value.reference_voice.trim();
  }
  return item;
}

const flat = (values) => values.flatMap((value) => (Array.isArray(value) ? value : [value])).filter((value) => value != null);

// collectDashscopeMedia, strict: an explicit `media` list or the shorthand fields, not both.
function collectMedia(body) {
  const shorthand = SHORTHAND_FIELDS.filter((field) => present(body[field]));
  let media;
  if (body.media != null) {
    if (!Array.isArray(body.media)) throw reject("Alibaba video media must be a list");
    if (shorthand.length) throw reject(`Send media either as a media list or as ${shorthand.join(", ")}, not both`);
    media = body.media.map((item) => mediaItem(item, "reference_image"));
  } else {
    media = [];
    flat(IMAGE_FIELDS.map((field) => body[field])).forEach((value, index) => {
      media.push(mediaItem(value, index === 0 ? "first_frame" : "reference_image"));
    });
    for (const value of flat([body.reference_images])) media.push(mediaItem(value, "reference_image"));
    for (const value of flat([body.video, body.video_url, body.videoUrls, body.video_urls])) media.push(mediaItem(value, "video"));
    for (const value of flat([body.reference_videos])) media.push(mediaItem(value, "reference_video"));
    for (const value of flat([body.audio, body.audio_url])) media.push(mediaItem(value, "driving_audio"));
  }
  const seen = new Set();
  media = media.filter((item) => {
    const key = `${item.type}\0${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (media.length > ALIBABA_VIDEO_MAX_MEDIA) throw reject(`Alibaba video takes at most ${ALIBABA_VIDEO_MAX_MEDIA} media inputs here`);
  return media;
}

const copy = (item, type = item.type) => ({ type, url: item.url, ...(item.reference_voice ? { reference_voice: item.reference_voice } : null) });

function refuseExtra(model, media, allowed) {
  const extra = media.find((item) => !allowed.has(item.type));
  if (extra) throw reject(`${model} does not take ${extra.type} media`);
}

function single(model, items, what) {
  if (items.length > 1) throw reject(`${model} takes one ${what}`);
  return items[0];
}

// The `input.media` (and t2v `input.audio_url`) each source builder sets.
function mediaInput(model, kind, media) {
  const of = (types) => media.filter((item) => types.has(item.type));
  switch (kind) {
    case "happyhorse-t2v":
      refuseExtra(model, media, new Set());
      return {};
    case "t2v": {
      refuseExtra(model, media, new Set(["driving_audio"]));
      const audio = single(model, media, "driving audio");
      return audio ? { audio_url: audio.url } : {};
    }
    case "happyhorse-i2v": {
      refuseExtra(model, media, IMAGES);
      const frame = single(model, media, "first frame image");
      if (!frame) throw reject(`Image input is required for video model: ${model}`);
      return { media: [{ type: "first_frame", url: frame.url }] };
    }
    case "i2v": {
      refuseExtra(model, media, new Set([...IMAGES, "last_frame", "driving_audio"]));
      const frame = single(model, of(IMAGES), "first frame image");
      if (!frame) throw reject(`Image input is required for video model: ${model}`);
      const last = single(model, of(new Set(["last_frame"])), "last frame");
      const audio = single(model, of(new Set(["driving_audio"])), "driving audio");
      return { media: [{ type: "first_frame", url: frame.url }, ...[last, audio].filter(Boolean).map((item) => copy(item))] };
    }
    case "happyhorse-r2v": {
      refuseExtra(model, media, IMAGES);
      if (!media.length) throw reject(`Reference image input is required for video model: ${model}`);
      return { media: media.map((item) => ({ type: "reference_image", url: item.url })) };
    }
    case "r2v": {
      refuseExtra(model, media, new Set([...IMAGES, "last_frame", ...VIDEOS]));
      if (!media.length) throw reject(`Reference image or video input is required for video model: ${model}`);
      return { media: media.map((item) => copy(item, VIDEOS.has(item.type) ? "reference_video" : "reference_image")) };
    }
    case "video-edit": {
      refuseExtra(model, media, new Set([...IMAGES, ...VIDEOS]));
      const source = single(model, of(VIDEOS), "source video");
      if (!source) throw reject(`Video input is required for video model: ${model}`);
      return {
        media: [{ type: "video", url: source.url }, ...of(IMAGES).map((item) => copy(item, "reference_image"))],
      };
    }
    default:
      throw reject(`Unsupported alibaba video model: ${model}`);
  }
}

function dimensions(size) {
  const match = isString(size) ? /^(\d{1,5})\s*[x*×]\s*(\d{1,5})$/i.exec(size.trim()) : null;
  if (!match) throw reject("Alibaba video size must look like 1280x720");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = ALIBABA_VIDEO_RATIOS.find((value) => {
    const [w, h] = value.split(":").map(Number);
    return width * h === height * w;
  });
  const short = Math.min(width, height);
  if (!ratio || (short !== 720 && short !== 1080)) {
    throw reject(`Alibaba video size must have a ${ALIBABA_VIDEO_RATIOS.join(", ")} ratio and a 720 or 1080 short side`);
  }
  return { ratio, resolution: `${short}P` };
}

function oneOf(body, fields, label) {
  const given = fields.filter((field) => body[field] != null);
  const values = new Set(given.map((field) => (isString(body[field]) ? body[field].trim() : body[field])));
  if (values.size > 1) throw reject(`${given.join(" and ")} disagree; send one ${label}`);
  return given.length ? body[given[0]] : undefined;
}

function seconds(body) {
  const value = oneOf(body, ["duration", "seconds"], "duration");
  if (value === undefined) return undefined;
  const numeric = isNumber(value) ? value : isString(value) ? Number(value.trim().replace(/s$/i, "")) : NaN;
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw reject("Alibaba video duration must be a positive whole number of seconds");
  return numeric;
}

// buildModernDashscopeParameters, strict, without the raw `parameters` copy.
function parameters(model, kind, body) {
  const out = {};
  const withRatio = !WITHOUT_RATIO.has(kind);
  let resolution;
  const given = body.resolution;
  if (given != null) {
    resolution = isString(given) ? given.trim().toUpperCase() : null;
    if (!ALIBABA_VIDEO_RESOLUTIONS.includes(resolution)) throw reject(`Alibaba video resolution must be one of: ${ALIBABA_VIDEO_RESOLUTIONS.join(", ")}`);
  }
  let ratio = oneOf(body, ["ratio", "aspect_ratio"], "ratio");
  if (ratio != null) {
    if (!withRatio) throw reject(`${model} takes its ratio from the first frame; ratio is not supported`);
    ratio = isString(ratio) ? ratio.trim() : null;
    if (!ALIBABA_VIDEO_RATIOS.includes(ratio)) throw reject(`Alibaba video ratio must be one of: ${ALIBABA_VIDEO_RATIOS.join(", ")}`);
  }
  if (body.size != null) {
    if (!withRatio) throw reject(`${model} takes its ratio from the first frame; send resolution instead of size`);
    const fromSize = dimensions(body.size);
    if ((resolution && resolution !== fromSize.resolution) || (ratio && ratio !== fromSize.ratio)) {
      throw reject("Alibaba video size disagrees with resolution or ratio");
    }
    resolution = fromSize.resolution;
    ratio = fromSize.ratio;
  }
  if (resolution) out.resolution = resolution;
  if (ratio) out.ratio = ratio;
  const duration = seconds(body);
  if (duration !== undefined) out.duration = duration;
  for (const field of ["prompt_extend", "watermark"]) {
    if (body[field] == null) continue;
    if (!isBoolean(body[field])) throw reject(`Alibaba video ${field} must be true or false`);
    out[field] = body[field];
  }
  if (body.seed != null) {
    if (!Number.isSafeInteger(body.seed) || body.seed < 0) throw reject("Alibaba video seed must be a non-negative integer");
    out.seed = body.seed;
  }
  if (body.shot_type != null) {
    if (!isString(body.shot_type) || !body.shot_type.trim() || body.shot_type.length > MAX_SHORT_TEXT) {
      throw reject("Alibaba video shot_type must be a short nonempty string");
    }
    out.shot_type = body.shot_type.trim();
  }
  return out;
}

/**
 * The DashScope video-synthesis body for an OpenAI-style video request.
 * Throws a 400 error for an unknown model or anything the gateway refuses.
 *
 * @returns {{ model: string, input: object, parameters: object }}
 */
export function buildAlibabaVideoRequest(model, body) {
  if (!isRecord(body)) throw reject("Alibaba video generation needs a JSON object");
  if (CHAT_FIELDS.some((field) => body[field] !== undefined)) throw reject("Alibaba video generation takes a video request, not a chat");
  if (!isAlibabaVideoModel(model)) throw reject(`Unsupported alibaba video model: ${model}`);
  const kind = MODEL_KINDS[model];
  if (!isString(body.prompt) || !body.prompt.trim()) throw reject("Alibaba video generation needs a text prompt");
  if (body.prompt.length > ALIBABA_VIDEO_MAX_PROMPT_LENGTH) {
    throw reject(`Alibaba video prompts are limited to ${ALIBABA_VIDEO_MAX_PROMPT_LENGTH} characters here`);
  }
  if (body.parameters != null) throw reject("Alibaba video parameters are set from named fields; a raw parameters object is not supported");
  if (body.n != null && body.n !== 1) throw reject("Alibaba video generates one video per request");
  const input = { prompt: body.prompt };
  if (body.negative_prompt != null) {
    if (!isString(body.negative_prompt) || body.negative_prompt.length > ALIBABA_VIDEO_MAX_PROMPT_LENGTH) {
      throw reject("Alibaba video negative_prompt must be a string");
    }
    if (body.negative_prompt.trim()) input.negative_prompt = body.negative_prompt.trim();
  }
  Object.assign(input, mediaInput(model, kind, collectMedia(body)));
  return { model, input, parameters: parameters(model, kind, body) };
}
