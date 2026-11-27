// DeepInfra native video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`deepinfra`: baseUrl
// https://api.deepinfra.com/v1/inference, authType "apikey", authHeader
// "bearer", format "deepinfra-video", models Wan-AI/Wan2.2-T2V-A14B,
// Wan-AI/Wan2.2-TI2V-5B, Wan-AI/Wan2.7-T2V, Lightricks/LTX-2.3-Distilled).
// Wire behavior comes from open-sse/handlers/videoGeneration.ts (format
// dispatch) and open-sse/handlers/videoGeneration/deepinfraHandler.ts: one
// synchronous `POST {baseUrl}/{model}` with a Bearer key, answering
// `{ video_url, seed, request_id, inference_status }`. There is no job id and
// no status endpoint.
//
// The existing `deepinfra` provider (open-sse/providers/registry/deepinfra.js,
// alias `deepinfra`) keeps its API-key connection mode and Bearer header; video
// uses the selected connection's key. Its chat base URL is never used here.

export const DEEPINFRA_PROVIDER_ID = "deepinfra";
export const DEEPINFRA_ALIAS = "deepinfra";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const DEEPINFRA_ORIGIN = "https://api.deepinfra.com";
export const DEEPINFRA_INFERENCE_URL = `${DEEPINFRA_ORIGIN}/v1/inference`;
export const DEEPINFRA_AUTH_HEADER = "Authorization";
export const DEEPINFRA_AUTH_SCHEME = "Bearer";
export const DEEPINFRA_VIDEO_FORMAT = "deepinfra-video";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/**
 * The source's static list, in source order. `acceptsImage` marks the one
 * text+image model (TI2V); the source forwarded `image` to every model, which
 * would silently drop the image on text-only models, so it is refused there.
 */
export const DEEPINFRA_VIDEO_MODELS = freezeAll([
  { id: "Wan-AI/Wan2.2-T2V-A14B", name: "Wan 2.2 T2V A14B", kind: "video", acceptsImage: false },
  { id: "Wan-AI/Wan2.2-TI2V-5B", name: "Wan 2.2 TI2V 5B", kind: "video", acceptsImage: true },
  { id: "Wan-AI/Wan2.7-T2V", name: "Wan 2.7 T2V", kind: "video", acceptsImage: false },
  { id: "Lightricks/LTX-2.3-Distilled", name: "LTX 2.3 Distilled", kind: "video", acceptsImage: false },
]);

export const deepinfraVideoModel = (id) => DEEPINFRA_VIDEO_MODELS.find((model) => model.id === id) ?? null;

/** The inference URL for a listed model. Model ids are fixed, so the path is too. */
export const deepinfraVideoUrl = (model) => `${DEEPINFRA_INFERENCE_URL}/${model.id}`;

// The source had no bound at all. The call is synchronous and renders the
// whole video, so one deadline covers the send, the render and the body read.
export const DEEPINFRA_VIDEO_TIMEOUT_MS = 600_000;
export const DEEPINFRA_MAX_RESPONSE_BYTES = 256 * 1024;
