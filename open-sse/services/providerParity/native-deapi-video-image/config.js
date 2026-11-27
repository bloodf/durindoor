// deAPI native image and video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`deapi`: baseUrl
//   https://oai.deapi.ai/v1/images/generations, authType "apikey",
//   authHeader "bearer", format "openai", models ZImageTurbo_INT8 /
//   Flux_2_Klein_4B_BF16 / Flux1schnell / ZAnimeDistill_8Step_INT8, provider
//   supportedSizes 512x512 / 768x768 / 1024x1024 / 1024x1536 / 1536x1024 and
//   square-only sizes for the two Z-Image models)
// - open-sse/config/videoRegistry.ts (`deapi`: baseUrl
//   https://oai.deapi.ai/v1/videos, authType "apikey", authHeader "bearer",
//   format "deapi-video-job", models Ltx2_5_22B_Dist_INT8 /
//   MiniMaxH3_33B_Turbo_INT8 / Ltx2_3_22B_Dist_INT8 /
//   Ltxv_13B_0_9_8_Distilled_FP8)
// - open-sse/handlers/videoGeneration/job.ts (preset "deapi-video-job":
//   POST /v1/videos, `seconds` as a string, job id `id`, poll
//   GET /v1/videos/{id}, statuses completed / failed, result only from the
//   key-gated GET /v1/videos/{id}/content, 5 s x 120 polls)
// - src/shared/constants/providers/apikey/specialty-media.ts (`deapi` catalog
//   entry: alias "deapi", name "deAPI", website https://deapi.ai, API key
//   sk-dp-<id>-<secret> sent as Authorization: Bearer)
//
// The fork has no `deapi` provider at all (no registry entry, alias, adapter
// or oai.deapi.ai config), so the provider definition below is staged too.

export const DEAPI_PROVIDER_ID = "deapi";
export const DEAPI_ALIAS = "deapi";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const DEAPI_ORIGIN = "https://oai.deapi.ai";
export const DEAPI_API_BASE = `${DEAPI_ORIGIN}/v1`;
export const DEAPI_IMAGE_URL = `${DEAPI_API_BASE}/images/generations`;
export const DEAPI_VIDEO_URL = `${DEAPI_API_BASE}/videos`;
export const deapiVideoStatusUrl = (id) => `${DEAPI_VIDEO_URL}/${encodeURIComponent(id)}`;
export const deapiVideoContentUrl = (id) => `${deapiVideoStatusUrl(id)}/content`;

export const DEAPI_IMAGE_FORMAT = "openai";
export const DEAPI_VIDEO_FORMAT = "deapi-video-job";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const DEAPI_IMAGE_SIZES = Object.freeze(["512x512", "768x768", "1024x1024", "1024x1536", "1536x1024"]);
const SQUARE_SIZES = Object.freeze(["512x512", "768x768", "1024x1024"]);

// `supportedSizes` is set only where the source narrows the provider list.
export const DEAPI_IMAGE_MODELS = freezeAll([
  { id: "ZImageTurbo_INT8", name: "Z-Image Turbo (deAPI)", kind: "image", supportedSizes: SQUARE_SIZES },
  { id: "Flux_2_Klein_4B_BF16", name: "FLUX.2 Klein 4B (deAPI)", kind: "image" },
  { id: "Flux1schnell", name: "FLUX.1 schnell (deAPI)", kind: "image" },
  { id: "ZAnimeDistill_8Step_INT8", name: "Z-Anime (deAPI)", kind: "image", supportedSizes: SQUARE_SIZES },
]);

export const DEAPI_VIDEO_MODELS = freezeAll([
  { id: "Ltx2_5_22B_Dist_INT8", name: "LTX-2.5 22B (deAPI)", kind: "video" },
  { id: "MiniMaxH3_33B_Turbo_INT8", name: "MiniMax H3 Turbo (deAPI)", kind: "video" },
  { id: "Ltx2_3_22B_Dist_INT8", name: "LTX-2.3 22B (deAPI)", kind: "video" },
  { id: "Ltxv_13B_0_9_8_Distilled_FP8", name: "LTX-Video 13B Distilled (deAPI)", kind: "video" },
]);

// Image: one synchronous call (the source used the configured fetch timeout).
export const DEAPI_IMAGE_TIMEOUT_MS = 120_000;
// Video: the source preset's 5 s x 120 poll window, as a hard job deadline.
export const DEAPI_POLL_INTERVAL_MS = 5_000;
export const DEAPI_MAX_POLLS = 120;
export const DEAPI_JOB_TIMEOUT_MS = 600_000;
// Gateway bounds: the submit, each status request and the content download.
export const DEAPI_SUBMIT_TIMEOUT_MS = 30_000;
export const DEAPI_REQUEST_TIMEOUT_MS = 30_000;
export const DEAPI_CONTENT_TIMEOUT_MS = 120_000;
export const DEAPI_MAX_POLL_RETRIES = 5;
export const DEAPI_MAX_RETRY_DELAY_MS = 30_000;
/** Largest clip read from /content; anything bigger is not buffered. */
export const DEAPI_MAX_VIDEO_BYTES = 64 * 1024 * 1024;

export const deapiImageModel = (id) => DEAPI_IMAGE_MODELS.find((model) => model.id === id) ?? null;
export const deapiVideoModel = (id) => DEAPI_VIDEO_MODELS.find((model) => model.id === id) ?? null;
/** The sizes one image model takes: its own list, else the provider list. */
export const deapiImageSizes = (id) => deapiImageModel(id)?.supportedSizes ?? DEAPI_IMAGE_SIZES;

/**
 * The provider definition for open-sse/providers/registry/deapi.js, in the
 * shape of the existing registry entries. Staged only: nothing reads it.
 * Kinds are enabled together with the adapter registration.
 */
export const DEAPI_PROVIDER_DEFINITION = Object.freeze({
  id: DEAPI_PROVIDER_ID,
  alias: DEAPI_ALIAS,
  display: Object.freeze({
    name: "deAPI",
    icon: "image",
    color: "#18181B",
    textIcon: "DE",
    website: "https://deapi.ai",
  }),
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: Object.freeze([
    ...DEAPI_IMAGE_MODELS.map(({ id, name, kind }) => Object.freeze({ id, name, kind })),
    ...DEAPI_VIDEO_MODELS.map(({ id, name, kind }) => Object.freeze({ id, name, kind })),
  ]),
  serviceKinds: Object.freeze(["image", "video"]),
  imageConfig: Object.freeze({ baseUrl: DEAPI_IMAGE_URL, authType: "apikey", authHeader: "bearer" }),
});
