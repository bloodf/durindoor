// SYNTX.ai native media metadata, staged and not registered (#1234, #2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/services/syntxAuth.ts (SYNTX_API_BASE, SYNTX_SITE, SYNTX_USER_AGENT,
// stripBearerPrefix, looksLikeJwt, extractSyntxTokenFromUnknown,
// resolveSyntxToken, syntxAuthHeaders), open-sse/services/syntxMedia.ts (chat
// create, upload-files, {design|video|audio}/generate, chat messages poll,
// audio/transcribe, provider rules, settings mappers, bounds),
// open-sse/services/syntxMediaCatalog.ts (SYNTX_FALLBACK_MEDIA_MODELS,
// parseSyntxMediaModelId, kinds), open-sse/handlers/syntxAudio.ts (speech,
// music, transcription), open-sse/handlers/imageGeneration/providers/syntx.ts
// (generations and edits) and open-sse/handlers/videoGeneration/syntxHandler.ts.
// Upscale (open-sse/handlers/imageUpscale/syntx.ts) is owned by the separate
// native-image-upscale unit, which reuses the exports listed in registration.json.
import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const SYNTX_PROVIDER_ID = "syntx";
export const SYNTX_PROVIDER_ALIAS = "stx";

/** The only origin the JWT is ever sent to. Connection base URLs are ignored. */
export const SYNTX_API_ORIGIN = "https://api.syntx.ai";
export const SYNTX_SITE = "https://syntx.ai/";
export const SYNTX_SITE_ORIGIN = "https://syntx.ai";
/** Source browser identity (syntxAuth.ts SYNTX_USER_AGENT), sent verbatim. */
export const SYNTX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const SYNTX_CHATS_URL = `${SYNTX_API_ORIGIN}/api/v1/chats`;
export const SYNTX_UPLOAD_URL = `${SYNTX_API_ORIGIN}/api/v1/chats/upload-files`;
export const SYNTX_TRANSCRIBE_URL = `${SYNTX_API_ORIGIN}/api/v1/audio/transcribe`;
export const syntxGenerateUrl = (route, aiName) =>
  `${SYNTX_API_ORIGIN}/api/v1/${route}/generate?ai_name=${encodeURIComponent(aiName)}`;
export const syntxMessagesUrl = (chatUuid) =>
  `${SYNTX_API_ORIGIN}/api/v1/chats/${encodeURIComponent(chatUuid)}/messages?page_size=50`;

// Source bounds (syntxMedia.ts).
export const SYNTX_POLL_TIMEOUT_MS = 600_000;
export const SYNTX_POLL_INTERVAL_MS = 5_000;
export const SYNTX_MAX_POLL_ERRORS = 5;
export const SYNTX_TRANSCRIBE_MAX_BYTES = 52_428_800;
export const SYNTX_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const SYNTX_DOWNLOAD_TIMEOUT_MS = 300_000;
export const SYNTX_MAX_DOWNLOAD_REDIRECTS = 3;
export const SYNTX_MAX_N = 8;
// Gateway bounds (the source has none for these).
export const SYNTX_REQUEST_TIMEOUT_MS = 30_000;
export const SYNTX_SUBMIT_TIMEOUT_MS = 60_000;
export const SYNTX_UPLOAD_TIMEOUT_MS = 120_000;
export const SYNTX_TRANSCRIBE_TIMEOUT_MS = 300_000;
export const SYNTX_MIN_POLL_TIMEOUT_MS = 1_000;
export const SYNTX_JSON_MAX_BYTES = 1024 * 1024;
export const SYNTX_POLL_MAX_BYTES = 4 * 1024 * 1024;
export const SYNTX_ERROR_MAX_BYTES = 16 * 1024;
export const SYNTX_MAX_PROMPT_CHARS = 32_000;
export const SYNTX_MAX_REFERENCES = 8;
export const SYNTX_MAX_RESULTS = 16;

export const SYNTX_MEDIA_KINDS = Object.freeze(["image", "video", "speech", "music", "upscale", "transcription"]);

const ASPECT = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const GPT_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"];
const TIER_RES = ["1K", "2K", "4K"];
const VIDEO_ASPECT = ["16:9", "9:16", "1:1"];

function row(aiName, modelType, name, kind, inputModalities, caps) {
  return Object.freeze({
    id: `${aiName}/${modelType}`,
    name,
    aiName,
    modelType,
    kind,
    inputModalities: Object.freeze(inputModalities ?? ["text"]),
    caps: Object.freeze({ ...(caps ?? {}) }),
  });
}

/**
 * The source seed catalog (SYNTX_FALLBACK_MEDIA_MODELS), row for row. Only
 * these exact ids are accepted; the source's live `/api/v1/ai/models`
 * discovery and its passthrough of unknown `ai_name/model_type` ids are not
 * staged, so no request is sent to a model this table does not name.
 */
export const SYNTX_MEDIA_MODELS = Object.freeze([
  row("sora-images", "gpt-image-2", "GPT Image 2", "image", ["text", "image"], { supportedSizes: GPT_IMAGE_SIZES, maxReferenceItems: 4 }),
  row("sora-images", "gpt-image-1", "GPT Image 1", "image", ["text", "image"], { supportedSizes: GPT_IMAGE_SIZES, maxReferenceItems: 4 }),
  row("flux", "flux-pro", "FLUX Pro", "image", ["text"], { supportedAspectRatios: ASPECT }),
  row("flux", "flux-dev", "FLUX Dev", "image", ["text"], { supportedAspectRatios: ASPECT }),
  row("midjourney", "midjourney", "Midjourney", "image", ["text"], { supportedAspectRatios: [...ASPECT, "2:3", "3:2"] }),
  row("banana", "nano-banana", "Nano Banana", "image", ["text", "image"], { supportedAspectRatios: [...ASPECT, "2:3", "3:2"], maxReferenceItems: 8 }),
  row("ideogram", "ideogram", "Ideogram", "image", ["text", "image"], { supportedAspectRatios: ASPECT, maxReferenceItems: 4 }),
  row("seedream", "seedream-4.5", "Seedream 4.5", "image", ["text", "image"], { supportedAspectRatios: ASPECT, supportedResolutions: ["2K", "4K"], maxReferenceItems: 4 }),
  row("seedream", "seedream-5", "Seedream 5", "image", ["text", "image"], { supportedAspectRatios: ASPECT, supportedResolutions: ["2K", "4K"], maxReferenceItems: 4 }),
  row("grok_image", "grok_i2i", "Grok Image", "image", ["text", "image"], { supportedAspectRatios: ASPECT, maxReferenceItems: 4 }),
  row("grok_image", "grok_i2i_pro", "Grok Image Pro", "image", ["text", "image"], { maxReferenceItems: 4 }),
  row("wan_image", "wan-2.7", "Wan 2.7 Image", "image", ["text", "image"], { supportedAspectRatios: ASPECT, supportedResolutions: TIER_RES, maxReferenceItems: 4 }),
  row("wan_image", "wan-2.7-pro", "Wan 2.7 Image Pro", "image", ["text", "image"], { supportedAspectRatios: ASPECT, supportedResolutions: ["1K", "2K"], maxReferenceItems: 4 }),
  row("recraft", "recraft", "Recraft", "image", ["text"], { supportedSizes: ["1024x1024", "1365x1024", "1024x1365"] }),
  row("runway-frames", "runway-frames", "Runway Frames", "image", ["text"], { supportedSizes: ["1920x1080", "1080x1920", "1024x1024"] }),
  row("luma_image", "luma", "Luma Image", "image", ["text", "image"], { supportedAspectRatios: ASPECT, maxReferenceItems: 4 }),
  row("stable-diffusion", "sdxl", "Stable Diffusion XL", "image", ["text"], { supportedSizes: ["1024x1024", "768x1344", "1344x768"] }),
  row("higgsfield", "higgsfield", "Higgsfield", "image", ["text"], { supportedAspectRatios: ASPECT }),
  row("kling-kolors", "kling-kolors", "Kling Kolors", "image", ["text"], { supportedAspectRatios: ASPECT }),

  row("wan_video", "wan-2.6", "Wan 2.6 Video", "video", ["text", "image"], { supportedAspectRatios: [...VIDEO_ASPECT, "4:3", "3:4"], supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 2 }),
  row("wan_video", "wan-2.7", "Wan 2.7 Video", "video", ["text", "image"], { supportedAspectRatios: [...VIDEO_ASPECT, "4:3", "3:4"], supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 2 }),
  row("kling", "kling-1.6", "Kling 1.6", "video", ["text", "image"], { supportedAspectRatios: VIDEO_ASPECT, supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 2 }),
  row("kling", "kling-2.1", "Kling 2.1", "video", ["text", "image"], { supportedAspectRatios: VIDEO_ASPECT, supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 2 }),
  row("runway", "gen3", "Runway Gen-3", "video", ["text", "image"], { supportedAspectRatios: ["1280:768", "768:1280"], supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 1 }),
  row("grok_video", "grok_t2v", "Grok Video T2V", "video", ["text"], { supportedAspectRatios: VIDEO_ASPECT, supportedResolutions: ["720p", "480p"], supportedDurations: [5, 10], durationDefault: 5 }),
  row("grok_video", "grok_i2v", "Grok Video I2V", "video", ["text", "image"], { supportedResolutions: ["720p", "480p"], supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 1, imageRequired: true }),
  row("seedance", "seedance", "Seedance", "video", ["text", "image"], { supportedAspectRatios: [...VIDEO_ASPECT, "4:3", "3:4"], supportedDurations: [5, 10], durationDefault: 5, maxReferenceItems: 1 }),
  row("sora", "sora-2", "Sora 2", "video", ["text", "image"], { supportedAspectRatios: VIDEO_ASPECT, supportedDurations: [4, 8, 12], durationDefault: 8, maxReferenceItems: 1 }),
  row("topaz_astra", "topaz_astra", "Topaz Astra", "video", ["text", "image"], { supportedAspectRatios: VIDEO_ASPECT, supportedDurations: [5, 10], durationDefault: 5, imageRequired: true, maxReferenceItems: 1 }),
  row("beeble", "beeble", "Beeble", "video", ["text"], { supportedAspectRatios: VIDEO_ASPECT, supportedDurations: [5, 10], durationDefault: 5 }),

  row("elevenlabs", "eleven_multilingual_v2", "ElevenLabs Multilingual v2", "speech"),
  row("elevenlabs", "eleven_turbo_v2", "ElevenLabs Turbo v2", "speech"),
  row("elevenlabs", "eleven_flash_v2", "ElevenLabs Flash v2", "speech"),

  row("suno", "chirp-v4", "Suno V4", "music", ["text"], { supportedDurations: [30, 60, 120], durationDefault: 30 }),
  row("suno", "chirp-v3-5", "Suno V3.5", "music", ["text"], { supportedDurations: [30, 60, 120], durationDefault: 30 }),
  row("suno-music", "suno", "Suno Music", "music", ["text"], { supportedDurations: [30, 60, 120], durationDefault: 30 }),

  row("magnific", "magnific", "Magnific Upscale", "upscale", ["image"], { imageRequired: true, maxReferenceItems: 1 }),
  row("topaz_ai", "topaz", "Topaz AI Upscale", "upscale", ["image"], { imageRequired: true, maxReferenceItems: 1 }),
  row("ideogram", "upscale", "Ideogram Upscale", "upscale", ["image"], { imageRequired: true, maxReferenceItems: 1 }),

  Object.freeze({
    id: "transcribe", name: "SYNTX Transcribe", aiName: "transcribe", modelType: "transcribe",
    kind: "transcription", inputModalities: Object.freeze(["audio"]), caps: Object.freeze({}),
  }),
]);

/** Catalog rows of one kind. */
export const syntxModelsForKind = (kind) => SYNTX_MEDIA_MODELS.filter((model) => model.kind === kind);

/**
 * Exact model selection for one kind. `ai_name/model_type` must be a catalog
 * row of that kind. A bare id is accepted only when exactly one row of that
 * kind has it as its model_type or ai_name (the source's bare lookup searches
 * every kind and takes the first hit, so `wan-2.7` would pick the image row
 * for a video request). Anything else is null: no default, no passthrough.
 */
export function resolveSyntxModel(model, kind) {
  if (!isString(model)) return null;
  let text = model.trim();
  for (const prefix of [`${SYNTX_PROVIDER_ID}/`, `${SYNTX_PROVIDER_ALIAS}/`]) {
    if (text.startsWith(prefix)) text = text.slice(prefix.length);
  }
  if (!text) return null;
  const rows = syntxModelsForKind(kind);
  const exact = rows.find((entry) => entry.id === text);
  if (exact) return exact;
  if (text.includes("/")) return null;
  const bare = rows.filter((entry) => entry.modelType === text || entry.aiName === text);
  return bare.length === 1 ? bare[0] : null;
}
