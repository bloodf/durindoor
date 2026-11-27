// Haiper native image and video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`haiper`: baseUrl
// https://api.haiper.ai/v1/jobs/gen2/text2video, statusUrl
// https://api.haiper.ai/v1/jobs, authType "apikey", authHeader "HAIPER_KEY",
// format "haiper-video", models [gen2 "Gen 2"]) and
// open-sse/config/imageRegistryData.ts (`haiper`: baseUrl
// https://api.haiper.ai/v1/jobs/gen2/text2image, statusUrl
// https://api.haiper.ai/v1/jobs, authType "apikey", authHeader "HAIPER_KEY",
// format "haiper-image", models [gen2 "Gen 2 Image"], supportedSizes
// 16:9/9:16/1:1/4:3/3:4). Wire behavior comes from
// open-sse/handlers/videoGeneration.ts (handleHaiperVideoGeneration) and
// open-sse/handlers/imageGeneration/providers/haiper.ts.
//
// The existing `haiper` provider (open-sse/providers/registry/haiper.js, alias
// `hp`) keeps its API-key connection mode and raw HAIPER_KEY header; both media
// kinds use the selected connection's key.

export const HAIPER_PROVIDER_ID = "haiper";
export const HAIPER_ALIAS = "hp";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const HAIPER_ORIGIN = "https://api.haiper.ai";
export const HAIPER_IMAGE_SUBMIT_URL = `${HAIPER_ORIGIN}/v1/jobs/gen2/text2image`;
export const HAIPER_VIDEO_SUBMIT_URL = `${HAIPER_ORIGIN}/v1/jobs/gen2/text2video`;
export const HAIPER_STATUS_URL = `${HAIPER_ORIGIN}/v1/jobs`;
/** The source's auth header: the key itself, no scheme. */
export const HAIPER_AUTH_HEADER = "HAIPER_KEY";

export const HAIPER_IMAGE_FORMAT = "haiper-image";
export const HAIPER_VIDEO_FORMAT = "haiper-video";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const HAIPER_IMAGE_MODELS = freezeAll([{ id: "gen2", name: "Gen 2 Image", kind: "image" }]);
export const HAIPER_VIDEO_MODELS = freezeAll([{ id: "gen2", name: "Gen 2", kind: "video" }]);
/** The registry's supportedSizes; Haiper takes them as `aspect_ratio`. */
export const HAIPER_IMAGE_ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"]);
export const HAIPER_IMAGE_DEFAULT_ASPECT_RATIO = "16:9";
/** The source always sends these two values for video and accepts no others. */
export const HAIPER_VIDEO_DURATION_SECONDS = 4;
export const HAIPER_VIDEO_ASPECT_RATIO = "16:9";

// The source bounds: a 5 s poll interval and a 300 s job deadline.
export const HAIPER_POLL_INTERVAL_MS = 5_000;
export const HAIPER_JOB_TIMEOUT_MS = 300_000;
// Gateway bounds: each submit and each status request.
export const HAIPER_SUBMIT_TIMEOUT_MS = 30_000;
export const HAIPER_REQUEST_TIMEOUT_MS = 30_000;
export const HAIPER_MAX_POLL_RETRIES = 5;
export const HAIPER_MAX_RETRY_DELAY_MS = 30_000;

export const haiperImageModel = (id) => HAIPER_IMAGE_MODELS.find((model) => model.id === id) ?? null;
export const haiperVideoModel = (id) => HAIPER_VIDEO_MODELS.find((model) => model.id === id) ?? null;
