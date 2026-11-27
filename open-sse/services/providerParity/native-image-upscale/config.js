// Native image upscale (POST /v1/images/upscale), staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/upscaleRegistry.ts (UPSCALE_PROVIDERS: adobe-firefly
//   alias firefly, stability-ai, topaz, syntx alias stx; model rows with
//   factors / supportsCreativity / supportsPrompt / promptRequired;
//   getAllUpscaleModels flat catalog with `format`)
// - open-sse/handlers/imageUpscale.ts (provider/model parse, format dispatch)
// - open-sse/handlers/imageUpscale/shared.ts (source image field order,
//   20 MiB source cap, output envelope `{ created, data, upscale }`)
// - open-sse/handlers/imageUpscale/{topaz,stability,syntx,adobeFirefly}.ts
// - open-sse/services/syntxMedia.ts, syntxAuth.ts, syntxMediaCatalog.ts
//   (upscale rows, design/generate + chat poll protocol, upload multipart)
//
// Every value below that is not marked "gateway bound" is the source's.

export const UPSCALE_ROUTE = "/v1/images/upscale";
export const UPSCALE_MODALITY = "image";

/** Source DEFAULT_UPSCALE_FACTORS and the handlers' default factor. */
export const DEFAULT_UPSCALE_FACTORS = Object.freeze([2, 4]);
export const DEFAULT_UPSCALE_FACTOR = 2;

/** Source MAX_UPSCALE_SOURCE_BYTES (matches the Firefly storage upload limit). */
export const MAX_UPSCALE_SOURCE_BYTES = 20 * 1024 * 1024;

/** Source factor field aliases, in source precedence order. */
export const FACTOR_FIELDS = Object.freeze(["factor", "scale", "upscale_factor", "upscaleFactor", "upsampler_factor", "upsamplerFactor"]);
/** Source creativity field aliases (Stability / Firefly readers). */
export const CREATIVITY_FIELDS = Object.freeze(["creativity", "creativity_percent", "creativityPercent"]);
/** Source single-image field order (extractUpscaleSourceImage). */
export const SOURCE_IMAGE_FIELDS = Object.freeze([
  "image_url", "imageUrl", "input_image", "source_image", "promptImage", "prompt_image", "image", "images",
  "image_urls", "imageUrls", "input_images", "reference_images", "referenceImages", "reference_image",
]);

export const RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);
export const OUTPUT_FORMATS = Object.freeze(["png", "jpeg", "webp"]);
export const IMAGE_MIMES = Object.freeze({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" });

// --- Topaz Labs (source topaz.ts) -------------------------------------------
export const TOPAZ_PROVIDER_ID = "topaz";
export const TOPAZ_ORIGIN = "https://api.topazlabs.com";
export const TOPAZ_ENHANCE_URL = `${TOPAZ_ORIGIN}/image/v1/enhance`;
/** Source: "Topaz caps a single output edge well below this". */
export const TOPAZ_MAX_OUTPUT_EDGE = 16000;
/** Source multipart file name for the image part. */
export const TOPAZ_UPLOAD_FILENAME = "image";

// --- Stability AI (source stability.ts) -------------------------------------
export const STABILITY_PROVIDER_ID = "stability-ai";
export const STABILITY_ORIGIN = "https://api.stability.ai";
export const STABILITY_ENDPOINTS = Object.freeze({
  fast: "/v2beta/stable-image/upscale/fast",
  conservative: "/v2beta/stable-image/upscale/conservative",
  creative: "/v2beta/stable-image/upscale/creative",
});
export const stabilityResultUrl = (id) => `${STABILITY_ORIGIN}/v2beta/results/${encodeURIComponent(id)}`;
/** Documented creativity float ranges, a 0-100 % request is mapped into them. */
export const STABILITY_CREATIVITY = Object.freeze({
  conservative: Object.freeze({ min: 0.2, max: 0.5, fallback: 0.35 }),
  creative: Object.freeze({ min: 0, max: 0.35, fallback: 0.3 }),
});
export const STABILITY_POLL_INTERVAL_MS = 3000;
export const STABILITY_RESULT_TIMEOUT_MS = 300_000;
export const STABILITY_UPLOAD_FILENAME = "image";

// --- SYNTX (source syntx.ts / syntxMedia.ts / syntxAuth.ts) -----------------
export const SYNTX_PROVIDER_ID = "syntx";
export const SYNTX_ALIAS = "stx";
export const SYNTX_ORIGIN = "https://api.syntx.ai";
export const SYNTX_CHATS_URL = `${SYNTX_ORIGIN}/api/v1/chats`;
export const SYNTX_UPLOAD_URL = `${SYNTX_ORIGIN}/api/v1/chats/upload-files`;
export const syntxDesignGenerateUrl = (aiName) => `${SYNTX_ORIGIN}/api/v1/design/generate?ai_name=${encodeURIComponent(aiName)}`;
export const syntxMessagesUrl = (chatUuid) => `${SYNTX_ORIGIN}/api/v1/chats/${chatUuid}/messages?page_size=50`;
export const SYNTX_SITE = "https://syntx.ai/";
export const SYNTX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
export const SYNTX_POLL_TIMEOUT_MS = 600_000;
export const SYNTX_POLL_INTERVAL_MS = 5_000;
export const SYNTX_POLL_MAX_ERRORS = 5;
export const SYNTX_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const SYNTX_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const SYNTX_DOWNLOAD_TIMEOUT_MS = 300_000;
export const SYNTX_DOWNLOAD_MAX_REDIRECTS = 3;
export const SYNTX_UPLOAD_FILENAME = "source.png";
export const SYNTX_DEFAULT_PROMPT = "upscale";
export const SYNTX_CHAT_SCOPE = "image";

// --- Adobe Firefly (source adobeFirefly.ts) ---------------------------------
export const ADOBE_FIREFLY_SOURCE_ID = "adobe-firefly";
export const ADOBE_FIREFLY_SOURCE_ALIAS = "firefly";
export const ADOBE_FIREFLY_SERVICES_ID = "adobe-firefly-api";
/** Source Firefly upscale rows (consumer firefly-3p upsample). Never active here. */
export const ADOBE_FIREFLY_SOURCE_MODELS = Object.freeze(["topaz", "topaz-standard", "topaz-bloom"]);

// --- Gateway bounds (not in the source) -------------------------------------
export const SUBMIT_TIMEOUT_MS = 180_000;
export const TOTAL_TIMEOUT_MS = 600_000;
export const JSON_MAX_BYTES = 4 * 1024 * 1024;
/** Base64 envelopes (Stability) carry the image: allow its encoded size plus slack. */
export const STABILITY_JSON_MAX_BYTES = 72 * 1024 * 1024;
export const RESULT_MAX_BYTES = 48 * 1024 * 1024;
export const SOURCE_FETCH_TIMEOUT_MS = 30_000;
export const SOURCE_FETCH_MAX_REDIRECTS = 3;
export const MAX_PROMPT_CHARS = 10_000;
export const MAX_URL_CHARS = 4096;
export const MAX_TIMEOUT_OVERRIDE_MS = 600_000;
export const MIN_IMAGE_BYTES = 12;

const row = (entry) => Object.freeze({ ...entry, factors: Object.freeze([...entry.factors]) });

/**
 * Active upscale registry: the source rows whose vendor this gateway can
 * reach with an existing, matching credential. Adobe Firefly is not here; see
 * ADOBE_FIREFLY_DISPOSITION.
 */
export const UPSCALE_PROVIDERS = Object.freeze({
  [STABILITY_PROVIDER_ID]: Object.freeze({
    id: STABILITY_PROVIDER_ID,
    aliases: Object.freeze([]),
    format: "stability-upscale",
    // Source catalog flags are kept as-is (conservative still takes `creativity`
    // in the handler although its row does not advertise it).
    models: Object.freeze([
      row({ id: "fast", name: "Stability Fast Upscale (4x)", factors: [4], description: "Lightweight 4x upscale, no prompt." }),
      row({
        id: "conservative", name: "Stability Conservative Upscale", factors: [4], supportsPrompt: true, promptRequired: true,
        description: "Up to ~4 MP while preserving every detail. Prompt required upstream.",
      }),
      row({
        id: "creative", name: "Stability Creative Upscale", factors: [4], supportsCreativity: true, supportsPrompt: true, promptRequired: true,
        description: "Heavily reimagines low-quality inputs (async job). Prompt required upstream.",
      }),
    ]),
  }),
  [TOPAZ_PROVIDER_ID]: Object.freeze({
    id: TOPAZ_PROVIDER_ID,
    aliases: Object.freeze([]),
    format: "topaz-upscale",
    models: Object.freeze([
      row({ id: "topaz-enhance", name: "Topaz Labs Enhance", factors: [2, 4], description: "Topaz Labs Image Enhance (auto model selection)." }),
    ]),
  }),
  [SYNTX_PROVIDER_ID]: Object.freeze({
    id: SYNTX_PROVIDER_ID,
    aliases: Object.freeze([SYNTX_ALIAS]),
    format: "syntx-upscale",
    // Source syntxMediaCatalog upscale rows through toRegistryUpscaleModels.
    models: Object.freeze([
      row({ id: "magnific/magnific", aiName: "magnific", modelType: "magnific", name: "Magnific Upscale", factors: [2, 4], supportsPrompt: true, description: "Magnific Upscale" }),
      row({ id: "topaz_ai/topaz", aiName: "topaz_ai", modelType: "topaz", name: "Topaz AI Upscale", factors: [2, 4], supportsPrompt: false, description: "Topaz AI Upscale" }),
      row({ id: "ideogram/upscale", aiName: "ideogram", modelType: "upscale", name: "Ideogram Upscale", factors: [2, 4], supportsPrompt: true, description: "Ideogram Upscale" }),
    ]),
  }),
});

/**
 * Why the source's Adobe Firefly upscale rows stay unavailable. Answered
 * before any credential is read or any request is sent.
 */
export const ADOBE_FIREFLY_DISPOSITION = Object.freeze({
  status: 501,
  consumer:
    "Adobe Firefly consumer upscale (firefly-3p /v2/3p-images/upsample with a firefly.adobe.com session cookie) is unavailable: " +
    "DurinDoor keeps adobe-firefly / firefly unregistered and accepts no Firefly web cookie, web-app token or ARP session",
  services:
    "Adobe Firefly Services (adobe-firefly-api) has no documented upscale operation equivalent to the source's Topaz upsample job; " +
    "its pinned contract covers images/generate-async, status, cancel and videos/generate only",
});
