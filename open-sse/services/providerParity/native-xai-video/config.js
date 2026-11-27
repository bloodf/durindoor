// xAI (Grok Imagine) native video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`xai`: baseUrl https://api.x.ai/v1/videos,
// statusUrl https://api.x.ai/v1/videos, authType "apikey", authHeader
// "bearer", format "xai-video", model grok-imagine-video). Wire behavior comes
// from open-sse/handlers/videoGeneration.ts (format dispatch) and
// open-sse/handlers/videoGeneration/xaiGrokImagineHandler.ts: `POST
// {baseUrl}/generations` with a Bearer key answers `{ request_id }`, then `GET
// {statusUrl}/{request_id}` with the same key answers `{ status, video: { url } }`.
//
// The OpenAI-shaped create/retrieve/content envelopes (./envelope.js) and the
// model, duration, size, aspect-ratio, resolution and reference-image limits
// follow CLIProxyAPI at 47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e (MIT):
// sdk/api/handlers/openai/openai_videos_handlers.go and
// internal/runtime/executor/xai_executor_media.go.
//
// The existing `xai` provider (open-sse/providers/registry/xai.js) already
// lists these video models, `serviceKinds` with "video" and the async
// `/v1/videos` proxy (`videoConfig`, open-sse/handlers/videoCore.js), which
// covers native create, edit, extend and retrieve byte-for-byte. What it lacks
// is a synchronous `/v1/video/generations` adapter; that is staged here.

import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const XAI_PROVIDER_ID = "xai";
export const XAI_ALIAS = "xai";
/** The only origin the adapter sends a credential to. Connection base URLs are ignored. */
export const XAI_ORIGIN = "https://api.x.ai";
export const XAI_VIDEOS_URL = `${XAI_ORIGIN}/v1/videos`;
export const XAI_VIDEO_GENERATIONS_URL = `${XAI_VIDEOS_URL}/generations`;
export const XAI_VIDEO_EDITS_URL = `${XAI_VIDEOS_URL}/edits`;
export const XAI_VIDEO_EXTENSIONS_URL = `${XAI_VIDEOS_URL}/extensions`;
export const XAI_AUTH_HEADER = "Authorization";
export const XAI_AUTH_SCHEME = "Bearer";
export const XAI_VIDEO_FORMAT = "xai-video";

/** Native create endpoints by action (CPA xaiVideosGenerationsPath / EditsPath / ExtensionsPath). */
export const XAI_VIDEO_ACTION_URLS = Object.freeze({
  generations: XAI_VIDEO_GENERATIONS_URL,
  edits: XAI_VIDEO_EDITS_URL,
  extensions: XAI_VIDEO_EXTENSIONS_URL,
});

/** The status URL for an xAI request id (`GET /v1/videos/{request_id}`). */
export const xaiVideoStatusUrl = (requestId) => `${XAI_VIDEOS_URL}/${encodeURIComponent(requestId)}`;

function freezeEntry(entry) {
  const copy = { ...entry };
  if (entry.aliases) copy.aliases = Object.freeze([...entry.aliases]);
  return Object.freeze(copy);
}
const freezeAll = (list) => Object.freeze(list.map(freezeEntry));

/**
 * Video models. `grok-imagine-video` is the OmniRoute source model; the 1.5
 * models and their aliases are the ones the local registry (xai.js) and CPA
 * (canonicalXAIVideosModel) both list. `generateAudio` follows the local
 * registry params (`generate_audio` on 1.5 only).
 */
export const XAI_VIDEO_MODELS = freezeAll([
  { id: "grok-imagine-video", name: "Grok Imagine Video", kind: "video", generateAudio: false },
  {
    id: "grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", kind: "video", generateAudio: true,
    aliases: ["grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-2026-05-30"],
  },
  { id: "grok-imagine-video-1.5-lite", name: "Grok Imagine Video 1.5 Lite", kind: "video", generateAudio: false },
]);

/** The model row for a canonical id or alias, optionally `xai/`-prefixed; null otherwise. */
export function xaiVideoModel(id) {
  if (!isString(id)) return null;
  const bare = id.trim().replace(/^xai\//, "");
  return XAI_VIDEO_MODELS.find((model) => model.id === bare || model.aliases?.includes(bare)) ?? null;
}

// CPA limits (normalizeXAIVideosSeconds 1..15, maxXAIVideoReferences 7,
// xaiVideosSizeOptions, xaiVideosAspectRatio, xaiVideosResolution). CPA clamped
// an out-of-range duration and dropped unknown ratios; here both are a 400.
export const XAI_MIN_DURATION_SECONDS = 1;
export const XAI_MAX_DURATION_SECONDS = 15;
export const XAI_MAX_REFERENCE_IMAGES = 7;
export const XAI_ASPECT_RATIOS = Object.freeze(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]);
export const XAI_ASPECT_RATIO_ALIASES = Object.freeze({ square: "1:1", landscape: "16:9", portrait: "9:16" });
export const XAI_RESOLUTIONS = Object.freeze(["480p", "720p", "1080p"]);
/** OpenAI `size` values CPA maps onto xAI aspect ratio + 720p. */
export const XAI_SIZE_MAP = Object.freeze({
  "720x1280": Object.freeze({ aspect_ratio: "9:16", resolution: "720p" }),
  "1024x1792": Object.freeze({ aspect_ratio: "9:16", resolution: "720p" }),
  "1280x720": Object.freeze({ aspect_ratio: "16:9", resolution: "720p" }),
  "1792x1024": Object.freeze({ aspect_ratio: "16:9", resolution: "720p" }),
});

// Upstream job states (xaiGrokImagineHandler.ts: "done", "failed", else pending;
// CPA openAIVideoStatus adds the other spellings). "expired" is not a reported
// failure of the work, so it stays accepted work with an unknown cost.
export const XAI_DONE_STATUSES = Object.freeze(["done", "completed", "succeeded", "success"]);
export const XAI_FAILED_STATUSES = Object.freeze(["failed", "error", "cancelled", "canceled"]);
export const XAI_UNKNOWN_STATUSES = Object.freeze(["expired"]);
export const XAI_PENDING_STATUSES = Object.freeze(["pending", "queued", "processing", "in_progress", "running"]);

// Source bounds: 300 s default job deadline (30 min ceiling), 2.5 s poll
// interval (1 s floor, 30 min ceiling), 300 polls; each a client knob
// (`timeout_ms`, `poll_interval_ms`, `max_polls`) refused when out of range.
export const XAI_JOB_TIMEOUT_MS = 300_000;
export const XAI_MAX_JOB_TIMEOUT_MS = 30 * 60_000;
export const XAI_POLL_INTERVAL_MS = 2_500;
export const XAI_MIN_POLL_INTERVAL_MS = 1_000;
export const XAI_MAX_POLL_INTERVAL_MS = 30 * 60_000;
export const XAI_MAX_POLLS = 300;
// Gateway bounds: each submit and each status request; bounded status retries.
export const XAI_SUBMIT_TIMEOUT_MS = 60_000;
export const XAI_REQUEST_TIMEOUT_MS = 30_000;
export const XAI_MAX_POLL_RETRIES = 5;
export const XAI_MAX_RETRY_DELAY_MS = 30_000;
// Source MAX_RESPONSE_BYTES.
export const XAI_MAX_RESPONSE_BYTES = 1024 * 1024;
