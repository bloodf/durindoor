// SenseNova (China) native image generation, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`sensenova`: baseUrl
//   https://api.sensenova.cn/v1/images/generations, authType "apikey",
//   authHeader "bearer", format "openai", one model sensenova-u1-fast named
//   "SenseNova U1 Fast", supportedSizes ["1024x1024"], no fallbackUrl, under
//   the source comment "same SenseNova api-key/connection as the chat
//   provider. (9router#2233)")
// - open-sse/handlers/imageGeneration.ts handleOpenAIImageGeneration (body
//   { model, prompt } plus validated output options, n, size, quality,
//   response_format, style; `Authorization: Bearer <apiKey|accessToken>`)
// - open-sse/handlers/imageGeneration/openAiImageFetch.ts (deadline covers the
//   body read, 2xx without a usable b64_json/url is a 502, usage kept internal)
// - src/app/api/providers/[id]/models/discovery/providerSets.ts and
//   providerModelsConfig.ts: `sensenova` is in neither, so the source has no
//   dynamic image-model discovery for it; the static registry list is the
//   whole catalog and nothing is invented here.
//
// The local `sensenova` provider (open-sse/providers/registry/sensenova.js) is
// an API-key chat connection on https://token.sensenova.cn. This staging reuses
// that same connection and key, sending it only to api.sensenova.cn. The
// separate `sensenova-intl` provider (token.sensenova.ai, already in
// IMAGE_ADAPTERS) is a different host, account region and body whitelist and is
// not touched.

export const SENSENOVA_PROVIDER_ID = "sensenova";
/** The source registry and the local provider both use alias "sensenova"; no extra alias exists. */
export const SENSENOVA_PROVIDER_ALIASES = Object.freeze([]);
export const SENSENOVA_IMAGE_FORMAT = "openai";

export const SENSENOVA_IMAGE_ORIGIN = "https://api.sensenova.cn";
export const SENSENOVA_IMAGE_PATH = "/v1/images/generations";
export const SENSENOVA_IMAGE_URL = `${SENSENOVA_IMAGE_ORIGIN}${SENSENOVA_IMAGE_PATH}`;

/** Source registry models, in order. */
export const SENSENOVA_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: "sensenova-u1-fast", name: "SenseNova U1 Fast" }),
]);
/** Source registry supportedSizes. */
export const SENSENOVA_IMAGE_SIZES = Object.freeze(["1024x1024"]);
/** Still containers this subset forwards as `output_format`. */
export const SENSENOVA_OUTPUT_FORMATS = Object.freeze(["png", "jpeg", "webp"]);
export const SENSENOVA_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

// Gateway bounds (not in the source).
export const SENSENOVA_SUBMIT_TIMEOUT_MS = 120_000;
export const SENSENOVA_TOTAL_TIMEOUT_MS = 180_000;
export const SENSENOVA_RESPONSE_MAX_BYTES = 40 * 1024 * 1024;
export const SENSENOVA_IMAGE_MAX_N = 10;
export const SENSENOVA_MAX_RESULTS = 16;
export const SENSENOVA_MAX_PROMPT_CHARS = 32_000;
export const SENSENOVA_MIN_SIDE = 64;
export const SENSENOVA_MAX_SIDE = 2048;
