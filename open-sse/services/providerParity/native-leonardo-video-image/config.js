// Leonardo.Ai native image and video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`leonardo`: baseUrl
//   https://cloud.leonardo.ai/api/rest/v1/generations, authType "apikey",
//   authHeader "bearer", format "leonardo-image", models phoenix / sdxl,
//   supportedSizes 1024x1024 / 1024x576 / 576x1024)
// - open-sse/config/videoRegistry.ts (`leonardo`: baseUrl
//   https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video, statusUrl
//   https://cloud.leonardo.ai/api/rest/v1/generations, authType "apikey",
//   authHeader "bearer", format "leonardo-video", models motion-2.0 /
//   motion-2.0-fast)
// - open-sse/handlers/imageGeneration/providers/leonardo.ts (LEONARDO_MODEL_IDS,
//   resolveLeonardoModelId, resolveLeonardoImageSize, 5 s poll, 300 s deadline)
// - open-sse/handlers/videoGeneration/leonardoHandler.ts (LEONARDO_VIDEO_MODELS,
//   resolveLeonardoVideoSize, motionMP4URL result, 5 s poll, 300 s deadline)
//
// The existing fork registry entry (open-sse/providers/registry/leonardo.js,
// alias `leo`, API-key connection, image kind hidden) keeps its connection
// mode; both adapters use the selected connection's key.

export const LEONARDO_PROVIDER_ID = "leonardo";
export const LEONARDO_ALIAS = "leo";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const LEONARDO_ORIGIN = "https://cloud.leonardo.ai";
export const LEONARDO_API_BASE = `${LEONARDO_ORIGIN}/api/rest/v1`;
/** Image submit (source imageRegistryData baseUrl) and the status URL of both kinds. */
export const LEONARDO_GENERATIONS_URL = `${LEONARDO_API_BASE}/generations`;
export const LEONARDO_IMAGE_SUBMIT_URL = LEONARDO_GENERATIONS_URL;
export const LEONARDO_VIDEO_SUBMIT_URL = `${LEONARDO_API_BASE}/generations-text-to-video`;
export const LEONARDO_STATUS_URL = LEONARDO_GENERATIONS_URL;
export const leonardoStatusUrl = (generationId) => `${LEONARDO_STATUS_URL}/${encodeURIComponent(generationId)}`;

export const LEONARDO_IMAGE_FORMAT = "leonardo-image";
export const LEONARDO_VIDEO_FORMAT = "leonardo-video";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

// Catalog id -> platform-model UUID (source LEONARDO_MODEL_IDS, from
// GET /api/rest/v1/platformModels). Leonardo answers a bare catalog id with 500.
export const LEONARDO_IMAGE_MODEL_IDS = Object.freeze({
  phoenix: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",
  sdxl: "16e7060a-803e-4df3-97ee-edcfa5dc9cc8",
});
export const LEONARDO_IMAGE_MODELS = freezeAll([
  { id: "phoenix", name: "Phoenix", kind: "image", platformModelId: LEONARDO_IMAGE_MODEL_IDS.phoenix },
  { id: "sdxl", name: "SDXL", kind: "image", platformModelId: LEONARDO_IMAGE_MODEL_IDS.sdxl },
]);
export const LEONARDO_DEFAULT_IMAGE_MODEL = "phoenix";
/** The source registry's advertised sizes; any WxH inside the bounds below is sent. */
export const LEONARDO_IMAGE_SIZES = Object.freeze(["1024x1024", "1024x576", "576x1024"]);
// Leonardo's documented generation bounds: 32..1536 px, multiples of 8.
export const LEONARDO_IMAGE_MIN_SIDE = 32;
export const LEONARDO_IMAGE_MAX_SIDE = 1536;
export const LEONARDO_IMAGE_DEFAULT_SIDE = 1024;

// Catalog id -> `model` enum (source LEONARDO_VIDEO_MODELS). `phoenix` was the
// old catalog id for video; the source keeps it working as Motion 2.0.
export const LEONARDO_VIDEO_MODEL_ENUMS = Object.freeze({
  "motion-2.0": "MOTION2",
  "motion-2.0-fast": "MOTION2FAST",
  phoenix: "MOTION2",
});
export const LEONARDO_VIDEO_MODELS = freezeAll([
  { id: "motion-2.0", name: "Motion 2.0", kind: "video", modelEnum: "MOTION2" },
  { id: "motion-2.0-fast", name: "Motion 2.0 Fast", kind: "video", modelEnum: "MOTION2FAST" },
]);
export const LEONARDO_VIDEO_LEGACY_ALIASES = Object.freeze({ phoenix: "motion-2.0" });

// [long side, short side] per resolution, and the portrait shapes that keep
// their aspect (source LEONARDO_VIDEO_SIZES / LEONARDO_PORTRAIT_SIZES).
export const LEONARDO_VIDEO_SIZES = Object.freeze({
  RESOLUTION_480: Object.freeze([832, 480]),
  RESOLUTION_720: Object.freeze([1280, 720]),
});
export const LEONARDO_PORTRAIT_SIZES = Object.freeze([Object.freeze([512, 768]), Object.freeze([576, 720])]);

// Source bounds: a 5 s poll and a 300 s job deadline for both kinds.
export const LEONARDO_POLL_INTERVAL_MS = 5_000;
export const LEONARDO_JOB_TIMEOUT_MS = 300_000;
// Gateway bounds: each submit and each status request.
export const LEONARDO_SUBMIT_TIMEOUT_MS = 30_000;
export const LEONARDO_REQUEST_TIMEOUT_MS = 30_000;
export const LEONARDO_MAX_POLLS = 60;
export const LEONARDO_MAX_POLL_RETRIES = 5;
export const LEONARDO_MAX_RETRY_DELAY_MS = 30_000;

export const leonardoImageModel = (id) => LEONARDO_IMAGE_MODELS.find((model) => model.id === id) ?? null;
export const leonardoVideoModel = (id) => LEONARDO_VIDEO_MODELS.find((model) => model.id === id) ?? null;
