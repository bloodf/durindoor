// Agnes native image and video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`agnes`: baseUrl
// https://apihub.agnes-ai.com/v1/images/generations, authType "apikey",
// authHeader "bearer", format "agnes-image", models agnes-image-2.0/2.1/2.5-flash,
// supportedSizes 1K/2K/3K/4K), open-sse/config/videoRegistry.ts (`agnes`:
// baseUrl https://apihub.agnes-ai.com, statusUrl https://apihub.agnes-ai.com/agnesapi,
// authType "apikey", authHeader "bearer", format "agnes-video-job", models
// agnes-video-v2.0 / agnes-video-2.5-flash / agnes-video-2.5 with jobPreset
// "agnes-video-2.5-job" on the 2.5 pair) and the two Agnes presets of
// open-sse/handlers/videoGeneration/job.ts.
//
// The existing `agnes` provider (open-sse/providers/registry/agnes.js) keeps its
// chat transport and API-key connection mode; these media kinds use the same
// selected connection's key. `agnes-cn` has no media entry in the source and
// gets none here.

export const AGNES_PROVIDER_ID = "agnes";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const AGNES_ORIGIN = "https://apihub.agnes-ai.com";
export const AGNES_IMAGE_URL = `${AGNES_ORIGIN}/v1/images/generations`;
export const AGNES_VIDEO_SUBMIT_URL = `${AGNES_ORIGIN}/v1/videos`;
export const AGNES_VIDEO_STATUS_URL = `${AGNES_ORIGIN}/agnesapi`;

export const AGNES_IMAGE_FORMAT = "agnes-image";
export const AGNES_VIDEO_FORMAT = "agnes-video-job";
export const AGNES_VIDEO_25_PRESET = "agnes-video-2.5-job";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const AGNES_IMAGE_MODELS = freezeAll([
  { id: "agnes-image-2.0-flash", name: "Agnes Image 2.0 Flash", kind: "image", inputModalities: ["text", "image"] },
  { id: "agnes-image-2.1-flash", name: "Agnes Image 2.1 Flash", kind: "image", inputModalities: ["text", "image"] },
  { id: "agnes-image-2.5-flash", name: "Agnes Image 2.5 Flash", kind: "image", inputModalities: ["text", "image"] },
]);
export const AGNES_IMAGE_SIZES = Object.freeze(["1K", "2K", "3K", "4K"]);

export const AGNES_VIDEO_MODELS = freezeAll([
  { id: "agnes-video-v2.0", name: "Agnes Video V2.0", kind: "video", jobPreset: AGNES_VIDEO_FORMAT },
  { id: "agnes-video-2.5-flash", name: "Agnes Video 2.5 Flash", kind: "video", jobPreset: AGNES_VIDEO_25_PRESET },
  { id: "agnes-video-2.5", name: "Agnes Video 2.5", kind: "video", jobPreset: AGNES_VIDEO_25_PRESET },
]);

const encode = encodeURIComponent;

/**
 * The two source job presets. V2.0 answers `video_id` and is polled on
 * /agnesapi with the model name; 2.5 answers `id`, is polled on /v1/videos/{id}
 * and takes `seconds` as a string.
 */
export const AGNES_VIDEO_JOB_PRESETS = Object.freeze({
  [AGNES_VIDEO_FORMAT]: Object.freeze({
    id: AGNES_VIDEO_FORMAT,
    taskIdPath: "video_id",
    pollUrl: (taskId, model) => `${AGNES_VIDEO_STATUS_URL}?video_id=${encode(taskId)}&model_name=${encode(model)}`,
    stringSeconds: false,
  }),
  [AGNES_VIDEO_25_PRESET]: Object.freeze({
    id: AGNES_VIDEO_25_PRESET,
    taskIdPath: "id",
    pollUrl: (taskId) => `${AGNES_VIDEO_SUBMIT_URL}/${encode(taskId)}`,
    stringSeconds: true,
  }),
});

// The source preset bounds: a 2 s poll interval and 60 polls.
export const AGNES_VIDEO_POLL_INTERVAL_MS = 2_000;
export const AGNES_VIDEO_MAX_POLLS = 60;
// Gateway bounds: the whole job, each submit and each status request.
export const AGNES_VIDEO_TIMEOUT_MS = 300_000;
export const AGNES_VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
export const AGNES_VIDEO_REQUEST_TIMEOUT_MS = 30_000;
export const AGNES_VIDEO_MAX_POLL_RETRIES = 5;
export const AGNES_VIDEO_MAX_RETRY_DELAY_MS = 30_000;
// One synchronous image call, headers and body together.
export const AGNES_IMAGE_TIMEOUT_MS = 180_000;
export const AGNES_IMAGE_MAX_INPUTS = 16;

export const agnesImageModel = (id) => AGNES_IMAGE_MODELS.find((model) => model.id === id) ?? null;
export const agnesVideoModel = (id) => AGNES_VIDEO_MODELS.find((model) => model.id === id) ?? null;
