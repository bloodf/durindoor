// KIE.AI native image and video metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/videoRegistry.ts (`kie`: baseUrl https://api.kie.ai,
// statusUrl https://api.kie.ai/api/v1/jobs/recordInfo, authType "apikey",
// authHeader "bearer", format "kie-video", 16 Market video models),
// open-sse/config/imageRegistryData.ts (`kie`: same baseUrl/statusUrl/auth,
// format "kie-image", supportedSizes 1:1/16:9/9:16/4:3/3:4, models from
// open-sse/config/providers/registry/kie/imageModels.ts) and the
// KIE_MARKET_UPSTREAM_MODEL_IDS table of open-sse/handlers/imageGeneration.ts.
//
// The existing `kie` provider (open-sse/providers/registry/kie.js) keeps its
// chat transport and API-key connection mode; these media kinds use the same
// selected connection's key.

export const KIE_PROVIDER_ID = "kie";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const KIE_ORIGIN = "https://api.kie.ai";
export const KIE_IMAGE_FORMAT = "kie-image";
export const KIE_VIDEO_FORMAT = "kie-video";

// Market (unified) task API: every video model and most image models.
export const KIE_MARKET_CREATE_URL = `${KIE_ORIGIN}/api/v1/jobs/createTask`;
export const KIE_MARKET_STATUS_URL = `${KIE_ORIGIN}/api/v1/jobs/recordInfo`;
// Dedicated Flux Kontext API (catalog entries carrying kieFluxKontextModel).
export const KIE_FLUX_KONTEXT_CREATE_URL = `${KIE_ORIGIN}/api/v1/flux/kontext/generate`;
export const KIE_FLUX_KONTEXT_STATUS_URL = `${KIE_ORIGIN}/api/v1/flux/kontext/record-info`;
// Direct 4o image API (the one non-Market, non-Kontext catalog entry).
export const KIE_GPT4O_CREATE_URL = `${KIE_ORIGIN}/api/v1/gpt4o-image/generate`;
export const KIE_GPT4O_STATUS_URL = `${KIE_ORIGIN}/api/v1/gpt4o-image/record-info`;

/** The three source image routes, chosen by catalog entry. */
export const KIE_IMAGE_ROUTES = Object.freeze({
  market: Object.freeze({ id: "market", createUrl: KIE_MARKET_CREATE_URL, statusUrl: KIE_MARKET_STATUS_URL }),
  fluxKontext: Object.freeze({ id: "fluxKontext", createUrl: KIE_FLUX_KONTEXT_CREATE_URL, statusUrl: KIE_FLUX_KONTEXT_STATUS_URL }),
  direct: Object.freeze({ id: "direct", createUrl: KIE_GPT4O_CREATE_URL, statusUrl: KIE_GPT4O_STATUS_URL }),
});

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const KIE_IMAGE_MODELS = freezeAll([
  { id: "gpt4o-image", name: "KIE 4o Image" },
  { id: "seedream/4.5-text-to-image", name: "Seedream 4.5", isMarket: true },
  { id: "seedream/4.5-edit", name: "Seedream 4.5 Edit", isMarket: true },
  { id: "seedream/5.0-lite-text-to-image", name: "Seedream 5.0 Lite", isMarket: true },
  { id: "seedream/5.0-lite-image-to-image", name: "Seedream 5.0 Lite I2I", isMarket: true },
  { id: "z-image", name: "Z-Image", isMarket: true },
  { id: "z-image/4.0-text-to-image", name: "Z-Image (legacy alias 4.0)", isMarket: true },
  { id: "z-image/4.5-text-to-image", name: "Z-Image (legacy alias 4.5)", isMarket: true },
  { id: "google-imagen/nano-banana-2", name: "Nano Banana 2", isMarket: true },
  { id: "google-imagen/nano-banana", name: "Nano Banana", isMarket: true },
  { id: "google-imagen/nano-banana-pro", name: "Nano Banana Pro", isMarket: true },
  { id: "google-imagen/nano-banana-edit", name: "Nano Banana Edit", isMarket: true },
  { id: "flux/2-pro-image-to-image", name: "Flux 2 Pro I2I", isMarket: true },
  { id: "flux/2-pro-text-to-image", name: "Flux 2 Pro T2I", isMarket: true },
  { id: "flux/2-image-to-image", name: "Flux 2 I2I", isMarket: true },
  { id: "flux/2-text-to-image", name: "Flux 2 T2I", isMarket: true },
  { id: "flux/kontext", name: "Flux Kontext Pro", isMarket: false, kieFluxKontextModel: "flux-kontext-pro" },
  { id: "flux/kontext-max", name: "Flux Kontext Max", isMarket: false, kieFluxKontextModel: "flux-kontext-max" },
  { id: "grok-imagine/text-to-image", name: "Grok Imagine T2I", isMarket: true },
  { id: "grok-imagine/image-to-image", name: "Grok Imagine I2I", isMarket: true },
  { id: "gpt/gpt-image-1.5-text-to-image", name: "GPT Image 1.5 T2I", isMarket: true },
  { id: "gpt/gpt-image-1.5-image-to-image", name: "GPT Image 1.5 I2I", isMarket: true },
  { id: "gpt/gpt-image-2-text-to-image", name: "GPT Image 2 T2I", isMarket: true },
  { id: "gpt/gpt-image-2-image-to-image", name: "GPT Image 2 I2I", isMarket: true },
  { id: "ideogram/v3-text-to-image", name: "Ideogram v3", isMarket: true },
  { id: "ideogram/v3-edit", name: "Ideogram v3 Edit", isMarket: true },
  { id: "ideogram/v3-remix", name: "Ideogram v3 Remix", isMarket: true },
  { id: "ideogram/v3-reframe", name: "Ideogram v3 Reframe", isMarket: true },
  { id: "qwen/text-to-image", name: "Qwen T2I", isMarket: true },
  { id: "qwen/image-to-image", name: "Qwen I2I", isMarket: true },
  { id: "qwen/image-edit", name: "Qwen Edit", isMarket: true },
  { id: "qwen2/image-edit", name: "Qwen2 Edit", isMarket: true },
  { id: "qwen2/text-to-image", name: "Qwen2 T2I", isMarket: true },
  { id: "wan/2.7-image", name: "Wan 2.7 Image", isMarket: true },
  { id: "wan/2.7-image-pro", name: "Wan 2.7 Image Pro", isMarket: true },
]);

/** Registry supportedSizes: the aspect ratios KIE takes. */
export const KIE_IMAGE_SIZES = Object.freeze(["1:1", "16:9", "9:16", "4:3", "3:4"]);
/** The source's mapImageSize table for OpenAI pixel sizes (only entries that land in KIE_IMAGE_SIZES are usable). */
export const KIE_OPENAI_SIZE_TO_RATIO = Object.freeze({
  "256x256": "1:1",
  "512x512": "1:1",
  "1024x1024": "1:1",
  "1792x1024": "16:9",
  "1024x1792": "9:16",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
});

/** Catalog id -> KIE Market upstream id, where they differ (source table, verbatim). */
export const KIE_MARKET_UPSTREAM_MODEL_IDS = Object.freeze({
  "google-imagen/nano-banana": "google/nano-banana",
  "google-imagen/nano-banana-2": "nano-banana-2",
  "google-imagen/nano-banana-pro": "nano-banana-pro",
  "google-imagen/nano-banana-edit": "google/nano-banana-edit",
  "gpt/gpt-image-2-text-to-image": "gpt-image-2-text-to-image",
  "gpt/gpt-image-2-image-to-image": "gpt-image-2-image-to-image",
  "gpt/gpt-image-1.5-text-to-image": "gpt-image/1.5-text-to-image",
  "gpt/gpt-image-1.5-image-to-image": "gpt-image/1.5-image-to-image",
  "seedream/5.0-lite-text-to-image": "seedream/5-lite-text-to-image",
  "seedream/5.0-lite-image-to-image": "seedream/5-lite-image-to-image",
  "flux/2-pro-text-to-image": "flux-2/pro-text-to-image",
  "flux/2-pro-image-to-image": "flux-2/pro-image-to-image",
  "flux/2-text-to-image": "flux-2/flex-text-to-image",
  "flux/2-image-to-image": "flux-2/flex-image-to-image",
  "wan/2.7-image": "wan/2-7-image",
  "wan/2.7-image-pro": "wan/2-7-image-pro",
  "z-image/4.0-text-to-image": "z-image",
  "z-image/4.5-text-to-image": "z-image",
});

export const KIE_VIDEO_MODELS = freezeAll([
  { id: "veo/veo-3-1", name: "Veo 3.1", isMarket: true },
  { id: "veo/veo-3-1-fast", name: "Veo 3.1 Fast", isMarket: true },
  { id: "kling-3.0/video", name: "Kling 3.0", isMarket: true },
  { id: "bytedance/seedance-2", name: "Seedance v2.0", isMarket: true },
  { id: "wan/2-7-text-to-video", name: "Wan 2.7 T2V", isMarket: true },
  { id: "wan/2-7-image-to-video", name: "Wan 2.7 I2V", isMarket: true },
  { id: "hailuo/02-text-to-video-pro", name: "Hailuo Pro T2V", isMarket: true },
  { id: "hailuo/2-3-image-to-video-pro", name: "Hailuo 2.3 Pro I2V", isMarket: true },
  { id: "grok-imagine/text-to-video", name: "Grok Imagine T2V", isMarket: true },
  { id: "grok-imagine/image-to-video", name: "Grok Imagine I2V", isMarket: true },
  { id: "happyhorse/text-to-video", name: "HappyHorse T2V", isMarket: true },
  { id: "happyhorse/image-to-video", name: "HappyHorse I2V", isMarket: true },
  { id: "sora-2-text-to-video", name: "Sora 2 T2V", isMarket: true },
  { id: "sora-2-image-to-video", name: "Sora 2 I2V", isMarket: true },
  { id: "sora-2-pro-text-to-video", name: "Sora 2 Pro T2V", isMarket: true },
  { id: "sora-2-pro-image-to-video", name: "Sora 2 Pro I2V", isMarket: true },
]);

/**
 * Video catalog rows the source lists but cannot serve: its submit body never
 * carries an input image, so an image-to-video model has nothing to animate.
 * They stay in the metadata (source parity) and are refused before submit.
 */
export const KIE_VIDEO_UNSUPPORTED_MODELS = Object.freeze(
  KIE_VIDEO_MODELS.filter((model) => model.id.includes("image-to-video")).map((model) => model.id)
);

// Source defaults: 2.5 s poll interval and a 300 s job deadline.
export const KIE_POLL_INTERVAL_MS = 2_500;
export const KIE_JOB_TIMEOUT_MS = 300_000;
export const KIE_MAX_POLLS = 120;
// Gateway bounds for each request.
export const KIE_SUBMIT_TIMEOUT_MS = 30_000;
export const KIE_REQUEST_TIMEOUT_MS = 30_000;
export const KIE_MAX_POLL_RETRIES = 5;
export const KIE_MAX_RETRY_DELAY_MS = 30_000;

export const kieImageModel = (id) => KIE_IMAGE_MODELS.find((model) => model.id === id) ?? null;
export const kieVideoModel = (id) => KIE_VIDEO_MODELS.find((model) => model.id === id) ?? null;
export const kieMarketUpstreamId = (id) => KIE_MARKET_UPSTREAM_MODEL_IDS[id] ?? id;

/** The source's route choice: Kontext by catalog field, Market by flag or a namespaced id, else direct. */
export function kieImageRoute(entry) {
  if (entry.kieFluxKontextModel) return KIE_IMAGE_ROUTES.fluxKontext;
  if (entry.isMarket || entry.id.includes("/")) return KIE_IMAGE_ROUTES.market;
  return KIE_IMAGE_ROUTES.direct;
}
