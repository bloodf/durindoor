// OpenRouter native video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/videoRegistry.ts (`openrouter`: id "openrouter", baseUrl
//   https://openrouter.ai/api/v1, authType "apikey", authHeader "bearer",
//   format "openrouter-video-job", 14 static model slugs)
// - open-sse/handlers/videoGeneration.ts (a registry provider whose format
//   names a job preset is dispatched to handleVideoJobGeneration)
// - open-sse/handlers/videoGeneration/job.ts (preset "openrouter-video-job":
//   POST /videos with `{ model, prompt, duration?, ...extras }`, job id `id`,
//   poll GET /videos/{id}, status completed | failed | cancelled | expired,
//   result `unsigned_urls`, downloaded with the key because the content route
//   is auth-gated, `resultFormat` mp4, 180 polls x 2 s)
// - tests/unit/services/openrouter-video-job.test.ts (submit answers 202
//   `{ id, polling_url, status: "pending" }`; the finished job carries
//   `unsigned_urls: ["https://openrouter.ai/api/v1/videos/{id}/content?index=0"]`)
//
// The fork already has an `openrouter` provider
// (open-sse/providers/registry/openrouter.js, alias "openrouter", API key,
// Bearer) for chat, embeddings, TTS, images, rerank and System One. It has no
// video kind, no videoConfig and no video adapter, and nothing in the fork
// sends to /api/v1/videos. Video uses that same connection's key; its chat
// transport, extra headers and /models discovery are not used here.

export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_ALIAS = "openrouter";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const OPENROUTER_ORIGIN = "https://openrouter.ai";
export const OPENROUTER_API_PATH = "/api/v1";
export const OPENROUTER_API_BASE = `${OPENROUTER_ORIGIN}${OPENROUTER_API_PATH}`;
export const OPENROUTER_VIDEO_URL = `${OPENROUTER_API_BASE}/videos`;
export const openrouterVideoStatusUrl = (id) => `${OPENROUTER_VIDEO_URL}/${encodeURIComponent(id)}`;
export const OPENROUTER_VIDEO_FORMAT = "openrouter-video-job";
export const OPENROUTER_AUTH_TYPE = "apikey";
export const OPENROUTER_AUTH_HEADER = "bearer";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** The source's static list, in source order. Ids are OpenRouter slugs, sent as `model`. */
export const OPENROUTER_VIDEO_MODELS = freezeAll([
  { id: "google/veo-3.1", name: "Veo 3.1", kind: "video" },
  { id: "google/veo-3.1-fast", name: "Veo 3.1 Fast", kind: "video" },
  { id: "google/veo-3.1-lite", name: "Veo 3.1 Lite", kind: "video" },
  { id: "openai/sora-2-pro", name: "Sora 2 Pro", kind: "video" },
  { id: "kwaivgi/kling-v3.0-pro", name: "Kling 3.0 Pro", kind: "video" },
  { id: "kwaivgi/kling-v3.0-std", name: "Kling 3.0 Standard", kind: "video" },
  { id: "bytedance/seedance-2.5", name: "Seedance 2.5", kind: "video" },
  { id: "bytedance/seedance-2.0", name: "Seedance 2.0", kind: "video" },
  { id: "minimax/hailuo-3-max", name: "Hailuo 3 Max", kind: "video" },
  { id: "minimax/hailuo-3", name: "Hailuo 3", kind: "video" },
  { id: "alibaba/wan-3.0", name: "Wan 3.0", kind: "video" },
  { id: "alibaba/wan-3.0-prime", name: "Wan 3.0 Prime", kind: "video" },
  { id: "x-ai/grok-imagine-video-1.5", name: "Grok Imagine Video 1.5", kind: "video" },
  { id: "runway/gen-4.5", name: "Runway Gen-4.5", kind: "video" },
]);

export const openrouterVideoModel = (id) => OPENROUTER_VIDEO_MODELS.find((model) => model.id === id) ?? null;

// Source preset window: 180 polls x 2 s. A caller's `max_polls` /
// `poll_interval_ms` (videoGeneration.ts resolveVideoJobPollingOverrides,
// utils/pollBounds.ts) may move it, but never past the larger of the preset
// window and the 600 s caller ceiling; here that ceiling is also a hard job
// deadline, and the interval has a 1 s floor the source lacked.
export const OPENROUTER_POLL_INTERVAL_MS = 2_000;
export const OPENROUTER_MAX_POLLS = 180;
export const OPENROUTER_JOB_TIMEOUT_MS = 600_000;
export const OPENROUTER_MIN_POLL_INTERVAL_MS = 1_000;
export const OPENROUTER_MAX_POLL_INTERVAL_MS = 120_000;
// Gateway bounds: the submit, each status request and the content download.
export const OPENROUTER_SUBMIT_TIMEOUT_MS = 30_000;
export const OPENROUTER_REQUEST_TIMEOUT_MS = 30_000;
export const OPENROUTER_CONTENT_TIMEOUT_MS = 120_000;
export const OPENROUTER_MAX_POLL_RETRIES = 5;
export const OPENROUTER_MAX_RETRY_DELAY_MS = 30_000;
/** Largest clip read from the content route; anything bigger is not buffered. */
export const OPENROUTER_MAX_VIDEO_BYTES = 64 * 1024 * 1024;
