// SYNTX request providerOptions: the source's OpenAI-field mappers and the SPA
// pre-processor rules (syntxMedia.ts mapSyntx{Image,Video,Audio}RequestSettings
// and applySyntxProviderRules), ported line for line. See ./config.js for the
// source attribution.
import { SYNTX_MAX_N } from "./config.js";
import { isNumber, isString } from "../../../../src/shared/utils/typeChecks.js";

const drop = (providerOptions, key) => void delete providerOptions[key];
const dropAll = (providerOptions, keys) => keys.forEach((key) => drop(providerOptions, key));

function applyGrokVideoRules(modelType, providerOptions) {
  if (modelType === "grok_i2v") drop(providerOptions, "aspect_ratio");
  if (modelType === "grok_v2v") dropAll(providerOptions, ["aspect_ratio", "video_duration", "resolution"]);
}

function applyGrokImageRules(modelType, fileCount, providerOptions) {
  if (modelType === "grok_i2i_pro") drop(providerOptions, "aspect_ratio");
  else if (modelType === "grok_i2i" && fileCount < 2) drop(providerOptions, "aspect_ratio");
}

function applyIdeogramRules(providerOptions) {
  if (providerOptions.mode === "upscale") drop(providerOptions, "aspect_ratio");
  if (providerOptions.mode === "describe") {
    dropAll(providerOptions, ["aspect_ratio", "quality", "details_quality", "seed", "style", "version", "negative_prompt", "enhance", "rendering_speed"]);
  }
}

function applySeedreamRules(modelType, providerOptions) {
  if ((modelType === "seedream-4.5" || modelType === "seedream-5") && providerOptions.resolution === "1K") providerOptions.resolution = "2K";
  if (modelType === "seedream-5.0-pro" && providerOptions.resolution === "4K") providerOptions.resolution = "2K";
}

const PROVIDER_RULES = Object.freeze({
  grok_video: (modelType, _fileCount, providerOptions) => applyGrokVideoRules(modelType, providerOptions),
  kling: (modelType, _fileCount, providerOptions) => { if (/^kling_o1_/.test(modelType)) drop(providerOptions, "mode"); },
  runway: (modelType, _fileCount, providerOptions) => { if (modelType === "acttwo") drop(providerOptions, "video_duration"); },
  grok_image: applyGrokImageRules,
  ideogram: (_modelType, _fileCount, providerOptions) => applyIdeogramRules(providerOptions),
  luma_image: (_modelType, fileCount, providerOptions) => { if (fileCount > 0 && providerOptions.mode !== undefined) providerOptions.mode = "auto"; },
  midjourney: (_modelType, _fileCount, providerOptions) => {
    if (providerOptions.version === "8.1" || providerOptions.version === "niji 7") drop(providerOptions, "quality");
  },
  "runway-frames": (_modelType, _fileCount, providerOptions) => drop(providerOptions, "style"),
  seedream: (modelType, _fileCount, providerOptions) => applySeedreamRules(modelType, providerOptions),
  "sora-images": (modelType, _fileCount, providerOptions) => {
    if (modelType === "gpt-image-2") return;
    drop(providerOptions, "quality");
    drop(providerOptions, "details_quality");
  },
  wan_image: (modelType, fileCount, providerOptions) => {
    if (modelType === "wan-2.7-pro" && fileCount > 0 && providerOptions.resolution === "4K") providerOptions.resolution = "2K";
  },
  suno: (_modelType, _fileCount, providerOptions) => {
    if ((providerOptions.mode ?? "generate") === "generate") dropAll(providerOptions, ["audio_url", "continue_at", "source_clip_id", "source_task_id"]);
  },
});

/** Mutates `providerOptions`; only the table's own entries run (never a prototype member). */
export function applySyntxProviderRules(aiName, providerOptions, { modelType, fileCount = 0 }) {
  if (!Object.hasOwn(PROVIDER_RULES, aiName)) return;
  PROVIDER_RULES[aiName](modelType || "", fileCount, providerOptions);
}

const RESOLUTION_TOKEN = /^(?:\d+x\d+|\d+K|[1-9]\d{1,3}p)$/i;
const ASPECT_TOKEN = /^\d+:\d+$/;

function firstString(body, keys) {
  for (const key of keys) {
    const value = body[key];
    if (isString(value) && value.trim() && value.trim().toLowerCase() !== "auto") return value.trim();
  }
  return "";
}

function firstNumber(body, keys) {
  for (const key of keys) {
    const value = body[key];
    if (isNumber(value) && Number.isFinite(value) && value > 0) return value;
    if (isString(value) && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

/** Source mapSyntxImageRequestSettings: "16:9" is aspect_ratio, "1024x1024"/"2K"/"720p" is resolution. */
export function mapSyntxImageSettings(aiName, modelType, body) {
  const providerOptions = { model_type: modelType };
  providerOptions.n = isNumber(body.n) && body.n > 0 ? Math.min(body.n, SYNTX_MAX_N) : 1;
  const size = firstString(body, ["size", "aspect_ratio", "aspectRatio"]);
  const quality = firstString(body, ["quality", "resolution"]);
  if (ASPECT_TOKEN.test(size)) providerOptions.aspect_ratio = size;
  else if (RESOLUTION_TOKEN.test(size)) providerOptions.resolution = size;
  if (RESOLUTION_TOKEN.test(quality)) {
    providerOptions.resolution = quality;
  } else if (quality && quality.toLowerCase() !== "auto") {
    if (aiName === "sora-images" && modelType === "gpt-image-2") providerOptions.quality = quality;
    else if (aiName === "midjourney") providerOptions.quality = quality;
  }
  return providerOptions;
}

/** Source mapSyntxVideoRequestSettings (grok_video takes video_duration). */
export function mapSyntxVideoSettings(aiName, modelType, body) {
  const providerOptions = { model_type: modelType };
  const aspect = firstString(body, ["aspect_ratio", "aspectRatio", "ratio", "size"]);
  if (ASPECT_TOKEN.test(aspect) || /^\d+:\d+$/.test(aspect.replace("x", ":"))) {
    providerOptions.aspect_ratio = aspect.includes("x") ? aspect.replace("x", ":") : aspect;
  }
  const duration = firstNumber(body, ["duration", "durationSeconds", "video_duration"]);
  if (duration != null) {
    if (aiName === "grok_video") providerOptions.video_duration = duration;
    else providerOptions.duration = duration;
  }
  const resolution = firstString(body, ["resolution", "quality"]);
  if (RESOLUTION_TOKEN.test(resolution) || /p$/i.test(resolution)) providerOptions.resolution = resolution;
  const fps = firstNumber(body, ["fps"]);
  if (fps != null) providerOptions.fps = fps;
  const seed = firstNumber(body, ["seed"]);
  if (seed != null) providerOptions.seed = seed;
  return providerOptions;
}

/** Source mapSyntxAudioRequestSettings (speech and music). */
export function mapSyntxAudioSettings(_aiName, modelType, body) {
  const providerOptions = { model_type: modelType };
  const voice = firstString(body, ["voice", "voice_id"]);
  if (voice && voice.toLowerCase() !== "alloy") providerOptions.voice_id = voice;
  const duration = firstNumber(body, ["duration"]);
  if (duration != null) providerOptions.duration = duration;
  const speed = firstNumber(body, ["speed"]);
  if (speed != null && speed !== 1) providerOptions.speed = speed;
  const style = firstString(body, ["style_prompt", "instructions"]);
  if (style) providerOptions.prompt = style;
  return providerOptions;
}
