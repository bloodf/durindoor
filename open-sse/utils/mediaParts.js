/**
 * Unified media-part detection for request messages.
 * Single source of truth shared by the vision/audio bridge guardrails (src/)
 * and the combo compatibility filter (open-sse/) — the two previously kept
 * divergent copies (guardrail missed input_image; combo saw it).
 */

import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const MAX_DEPTH = 8;

/** Extract a URL from either a bare string or a `{ url }` object. */
function urlFrom(raw) {
  if (isString(raw)) return raw;
  const url = raw?.url;
  return isString(url) ? url : undefined;
}

function pushPart(ctx, kind, ref, variant, depth, path) {
  ctx.out.push({
    kind,
    ref,
    messageIndex: ctx.messageIndex,
    partIndex: ctx.partIndex,
    nested: depth > 0,
    path,
    variant,
  });
  if (ctx.stopAtKind === kind) ctx.found = true;
}

/** Strict image shapes with an extractable ref. Returns true when one was pushed. */
function inspectImageParts(obj, type, ctx, depth, path) {
  if (type === "image_url" || type === "input_image") {
    const url = urlFrom(obj.image_url);
    if (url) {
      pushPart(
        ctx,
        "image",
        url,
        type === "input_image" ? "input_image" : "image_url",
        depth,
        path
      );
      return true;
    }
  }
  if (type === "image") {
    const source = obj.source;
    if (source?.type === "base64" && isString(source.data)) {
      const media = isString(source.media_type) ? source.media_type : "image/png";
      pushPart(ctx, "image", `data:${media};base64,${source.data}`, "image_base64", depth, path);
      return true;
    }
    // Non-empty url required: an empty `source.url` is not an extractable image
    // (mirrors the guardrail's historical `if (url)` guard).
    if (source?.type === "url" && isString(source.url) && source.url) {
      pushPart(ctx, "image", source.url, "image_source_url", depth, path);
      return true;
    }
  }
  return false;
}

/**
 * Audio shapes. Returns true when a part was pushed (at most one per object).
 * Callers must NOT early-return on audio: the same object can also carry
 * image indicators or nest image parts inside its payload.
 */
function inspectAudioParts(obj, type, mediaType, ctx, depth, path) {
  if (type === "input_audio") {
    const audio = obj.input_audio;
    if (isString(audio?.data)) {
      pushPart(ctx, "audio", audio.data, "input_audio", depth, path);
      return true;
    }
  }
  if (type === "audio_url") {
    const url = urlFrom(obj.audio_url);
    if (url) {
      pushPart(ctx, "audio", url, "audio_url", depth, path);
      return true;
    }
  }
  if (isString(mediaType) && mediaType.startsWith("audio/")) {
    const data = obj.source.data;
    if (isString(data)) {
      pushPart(ctx, "audio", data, "audio_source", depth, path);
      return true;
    }
  }
  return false;
}

/** Strict video shapes with an extractable URL, data URI, or base64 ref. */
function inspectVideoParts(obj, type, mediaType, ctx, depth, path) {
  if (type === "input_video") {
    const ref = urlFrom(obj.video_url ?? obj.input_video ?? obj.url);
    if (ref) {
      pushPart(ctx, "video", ref, "input_video", depth, path);
      return true;
    }
  }
  if (type === "video_url") {
    const ref = urlFrom(obj.video_url);
    if (ref) {
      pushPart(ctx, "video", ref, "video_url", depth, path);
      return true;
    }
  }
  const source = obj.source;
  if (source) {
    const videoMediaType =
      isString(mediaType) && mediaType.toLowerCase().startsWith("video/");
    // Base64 must carry an explicit video MIME. This prevents a type:video wrapper
    // from relabelling arbitrary base64 content as MP4.
    if (videoMediaType && isString(source.data)) {
      pushPart(
        ctx,
        "video",
        `data:${mediaType};base64,${source.data}`,
        "video_source",
        depth,
        path
      );
      return true;
    }
    const ref = urlFrom(source.url);
    const explicitAnthropicUrl = type === "video" && source.type === "url";
    if (ref && (explicitAnthropicUrl || type === "video_source" || videoMediaType)) {
      pushPart(ctx, "video", ref, "video_source", depth, path);
      return true;
    }
  }
  return false;
}

/**
 * Combo-parity image indicators: the legacy valueContainsImagePart
 * (comboStructure) matched image-ish `type` names case-insensitively, bare
 * `image_url`/`input_image` keys, and `source.media_type` image/* — all
 * without needing an extractable ref. Emit an indicator part (ref
 * best-effort, possibly "") so boolean callers keep seeing those requests as
 * vision requests. Returns true when one was pushed.
 */
function inspectImageIndicators(obj, type, mediaType, ctx, depth, path) {
  const lowerType = type?.toLowerCase();
  const looksLikeImage =
    lowerType === "image" ||
    lowerType === "image_url" ||
    lowerType === "input_image" ||
    "image_url" in obj ||
    "input_image" in obj;
  const imageMediaType =
    isString(mediaType) && mediaType.toLowerCase().startsWith("image/");
  if (!looksLikeImage && !imageMediaType) return false;
  pushPart(
    ctx,
    "image",
    urlFrom(obj.image_url ?? obj.input_image) ?? "",
    "image_indicator",
    depth,
    path
  );
  return true;
}

function inspect(value, ctx, depth, path) {
  if (ctx.found || depth > MAX_DEPTH || value == null) return;
  if (isString(value)) {
    if (value.startsWith("data:image/")) {
      pushPart(ctx, "image", value, "data_uri_string", depth, path);
    }
    if (value.startsWith("data:video/")) {
      pushPart(ctx, "video", value, "data_uri_string", depth, path);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      inspect(value[i], ctx, depth + 1, [...path, i]);
      if (ctx.found) return;
    }
    return;
  }
  if (!isObject(value)) return;
  const obj = value;
  const type = isString(obj.type) ? obj.type : undefined;

  if (inspectImageParts(obj, type, ctx, depth, path)) return;

  const mediaType = obj.source?.media_type;
  // Audio does not early-return: the same object can also carry image
  // indicators (bare `image_url`/`input_image` keys the legacy combo filter
  // matched) or nest image parts inside its payload.
  inspectAudioParts(obj, type, mediaType, ctx, depth, path);
  if (ctx.found) return;
  if (inspectVideoParts(obj, type, mediaType, ctx, depth, path)) return;
  if (inspectImageIndicators(obj, type, mediaType, ctx, depth, path)) return;
  for (const [key, nested] of Object.entries(obj)) {
    inspect(nested, ctx, depth + 1, [...path, key]);
    if (ctx.found) return;
  }
}

export function detectMediaParts(messages) {
  const out = [];
  if (!Array.isArray(messages)) return out;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const content = messages[messageIndex]?.content;
    if (!Array.isArray(content)) continue;
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      inspect(content[partIndex], { out, messageIndex, partIndex }, 0, []);
    }
  }
  return out;
}

/**
 * Early-exit presence check: returns true as soon as the FIRST part of the
 * requested kind is found, without collecting the full part list or finishing
 * the traversal. Prefer this on hot paths (e.g. the combo compatibility
 * filter runs on every request) over `detectMediaParts(...).some(...)`.
 */
export function containsMediaKind(messages, kind) {
  if (!Array.isArray(messages)) return false;
  const out = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const content = messages[messageIndex]?.content;
    if (!Array.isArray(content)) continue;
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      const ctx = { out, messageIndex, partIndex, stopAtKind: kind };
      inspect(content[partIndex], ctx, 0, []);
      if (ctx.found) return true;
    }
  }
  return false;
}
