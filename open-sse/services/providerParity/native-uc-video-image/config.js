// UC Direct native image and video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`uc`: baseUrl
//   https://internal.chatuncensored.ai/v2/image-gen, authType "apikey",
//   authHeader "bearer", format "uc-image", 22 model ids)
// - open-sse/config/videoRegistry.ts (`uc`: baseUrl
//   https://internal.chatuncensored.ai/image_to_video, statusUrl
//   https://api.uncensored.com/api/v1/videos/generations, authType "apikey",
//   authHeader "bearer", format "uc-video", wan-2.2-spicy persona default plus
//   the 13-id metered REST catalog)
// - open-sse/handlers/imageGeneration/providers/ucImage.ts and
//   open-sse/handlers/videoGeneration/providers/ucVideo.ts (one handler per
//   kind, two surfaces picked by credential: a `uai_` key goes to the metered
//   REST API at https://api.uncensored.com/api/v1 with `X-api-key`; anything
//   else goes to the persona web surface with a Clerk JWT minted from cookies)
// - open-sse/config/providers/registry/uc-direct/index.ts (`uc-direct`, alias
//   `ucd`, `X-api-key: uai_sk_live_...`, 402 funds / 403 moderation or scope /
//   429 rate limit)
//
// Only the metered REST surface is staged. It is the vendor's documented
// developer API and the fork already ships it as `uc-direct` (alias `ucd`,
// open-sse/providers/registry/uc-direct.js, LLM only). The persona surface
// (internal.chatuncensored.ai and internal-6.pubyar.com behind a Clerk session
// minted from consumer-app cookies at clerk.uncensored.com) is the `uc`
// consumer-app path the fork retired in #1241 (closed not planned); its
// endpoints are recorded here as evidence and never called.

export const UC_PROVIDER_ID = "uc-direct";
export const UC_ALIAS = "ucd";
/** OmniRoute's media registry key; the fork has no `uc` provider (#1241). */
export const UC_SOURCE_PROVIDER_ID = "uc";
/** Model prefixes the source strips before sending `model`. `ucd/` is the fork alias. */
export const UC_MODEL_PREFIXES = Object.freeze(["uc-direct/", "ucd/", "uc/"]);

/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const UC_ORIGIN = "https://api.uncensored.com";
export const UC_API_BASE = `${UC_ORIGIN}/api/v1`;
export const UC_IMAGE_URL = `${UC_API_BASE}/images/generations`;
export const UC_VIDEO_URL = `${UC_API_BASE}/videos/generations`;
/** A server-supplied status_url is followed only under this path on UC_ORIGIN. */
export const UC_VIDEO_STATUS_PATH_PREFIX = "/api/v1/videos/";
/** The source's credential discriminator for the metered surface. */
export const UC_KEY_PREFIX = "uai_";
export const UC_AUTH_HEADER = "X-api-key";

export const UC_IMAGE_FORMAT = "uc-image";
export const UC_VIDEO_FORMAT = "uc-video";

/** Persona endpoints from the pinned source. Evidence only: nothing calls them. */
export const UC_PERSONA_ENDPOINTS = Object.freeze({
  image: "https://internal.chatuncensored.ai/v2/image-gen",
  textToVideo: "https://internal.chatuncensored.ai/text_to_video",
  imageToVideo: "https://internal.chatuncensored.ai/image_to_video",
  signedUpload: "https://internal-6.pubyar.com/generate-signed-url",
  clerkMint: "https://clerk.uncensored.com/v1/client/sessions/{sid}/tokens",
  tts: "wss://tts-stream.chatuncensored.ai",
});

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

// Source imageRegistryData `uc.models`, same order. The source sends the same
// id as `model` on the REST surface and as `model_version` on the persona one.
export const UC_IMAGE_MODELS = freezeAll([
  { id: "model-dev", name: "Flux Dev (UC)", kind: "image" },
  { id: "model-pro", name: "Flux Pro (UC)", kind: "image" },
  { id: "model-1.1", name: "Flux Pro 1.1 (UC)", kind: "image" },
  { id: "model-1.2", name: "Wan 2.2 (UC)", kind: "image" },
  { id: "seedream-v4.5", name: "Seedream v4.5 (UC)", kind: "image" },
  { id: "seedream-v5", name: "Seedream v5 (UC)", kind: "image" },
  { id: "flux-2", name: "FLUX.2 (UC)", kind: "image" },
  { id: "flux-2-pro", name: "FLUX.2 Pro (UC)", kind: "image" },
  { id: "lustify-v7", name: "Lustify v7 (UC)", kind: "image" },
  { id: "nano-banana", name: "Nano Banana (UC)", kind: "image" },
  { id: "nano-banana-2", name: "Nano Banana 2 (UC)", kind: "image" },
  { id: "nano-banana-pro", name: "Nano Banana Pro (UC)", kind: "image" },
  { id: "nano-banana-ultra", name: "Nano Banana Ultra (UC)", kind: "image" },
  { id: "gpt-image", name: "GPT Image (UC)", kind: "image" },
  { id: "gpt-image-2", name: "GPT Image 2 (UC)", kind: "image" },
  { id: "realism", name: "Realism (UC)", kind: "image" },
  { id: "realism-2", name: "Realism 2 (UC)", kind: "image" },
  { id: "z-image-turbo", name: "Z-Image Turbo (UC)", kind: "image" },
  { id: "prefect-pony-xl", name: "Prefect Pony XL (UC)", kind: "image" },
  { id: "wan-2.6", name: "Wan 2.6 (UC)", kind: "image" },
  { id: "wan-2.7-text-to-image", name: "Wan 2.7 Text-to-Image (UC)", kind: "image" },
  { id: "wan-2.7-text-to-image-pro", name: "Wan 2.7 Text-to-Image Pro (UC)", kind: "image" },
]);

// Source videoRegistry `uc.models` marked "uc-direct REST metered catalog
// (§2.3)", same order. `wan-2.2-spicy` is the persona picker default and is
// not part of the REST catalog, so it is not staged. `input` records what the
// id names: i2v-* animate an input image, t2v-* take text only.
export const UC_VIDEO_MODELS = freezeAll([
  { id: "t2v-turbo", name: "Text-to-Video Turbo (UC)", kind: "video", input: "text" },
  { id: "t2v-standard", name: "Text-to-Video Standard (UC)", kind: "video", input: "text" },
  { id: "i2v-turbo", name: "Image-to-Video Turbo (UC)", kind: "video", input: "image" },
  { id: "i2v-standard", name: "Image-to-Video Standard (UC)", kind: "video", input: "image" },
  { id: "i2v-pro", name: "Image-to-Video Pro (UC)", kind: "video", input: "image" },
  { id: "i2v-sora", name: "Image-to-Video Sora (UC)", kind: "video", input: "image" },
  { id: "i2v-sora-pro", name: "Image-to-Video Sora Pro (UC)", kind: "video", input: "image" },
  { id: "cosmos-predict", name: "Cosmos Predict (UC)", kind: "video", input: "any" },
  { id: "av-gen", name: "AV Gen (UC)", kind: "video", input: "any" },
  { id: "ltx-distilled", name: "LTX Distilled (UC)", kind: "video", input: "any" },
  { id: "seedance-2.0", name: "Seedance 2.0 (UC)", kind: "video", input: "any" },
  { id: "seedance-2.0-fast", name: "Seedance 2.0 Fast (UC)", kind: "video", input: "any" },
  { id: "happyhorse", name: "HappyHorse (UC)", kind: "video", input: "any" },
]);
export const UC_PERSONA_ONLY_VIDEO_MODELS = Object.freeze(["wan-2.2-spicy"]);

/** Source REST image `n` ceiling (UC_IMAGE_N_MAX). */
export const UC_IMAGE_N_MAX = 4;
// Image: one synchronous call (the source had no bound; the fork adds one).
export const UC_IMAGE_TIMEOUT_MS = 120_000;
// Video: the source's REST poll defaults (3 s interval, 300 s total) as a hard job deadline.
export const UC_POLL_INTERVAL_MS = 3_000;
export const UC_JOB_TIMEOUT_MS = 300_000;
// Gateway bounds: the submit and each status request.
export const UC_SUBMIT_TIMEOUT_MS = 60_000;
export const UC_REQUEST_TIMEOUT_MS = 30_000;
export const UC_MAX_POLL_RETRIES = 5;
export const UC_MAX_RETRY_DELAY_MS = 30_000;

/** Strip one source routing prefix; returns the REST model id. */
export function ucModelId(model) {
  const text = typeof model === "string" ? model.trim() : "";
  const prefix = UC_MODEL_PREFIXES.find((p) => text.startsWith(p));
  return prefix ? text.slice(prefix.length) : text;
}
export const ucImageModel = (model) => UC_IMAGE_MODELS.find((m) => m.id === ucModelId(model)) ?? null;
export const ucVideoModel = (model) => UC_VIDEO_MODELS.find((m) => m.id === ucModelId(model)) ?? null;

/**
 * The media additions for open-sse/providers/registry/uc-direct.js. Staged
 * only: nothing reads it. The existing entry (transport, x-api-key raw auth,
 * modelsFetcher, passthroughModels, llm kind) is kept as is.
 */
export const UC_PROVIDER_MEDIA_ADDITIONS = Object.freeze({
  id: UC_PROVIDER_ID,
  alias: UC_ALIAS,
  addServiceKinds: Object.freeze(["image", "video"]),
  addModels: Object.freeze([
    ...UC_IMAGE_MODELS.map(({ id, name, kind }) => Object.freeze({ id, name, kind })),
    ...UC_VIDEO_MODELS.map(({ id, name, kind }) => Object.freeze({ id, name, kind })),
  ]),
  imageConfig: Object.freeze({ baseUrl: UC_IMAGE_URL, authType: "apikey", authHeader: "x-api-key" }),
});
