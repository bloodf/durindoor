// Nebius Token Factory native image generation, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`nebius`: baseUrl
//   https://api.tokenfactory.nebius.com/v1/images/generations, fallbackUrl
//   https://api.studio.nebius.com/v1/images/generations, authType "apikey",
//   authHeader "bearer", format "openai", one model
//   black-forest-labs/flux-schnell named "No Model yet", supportedSizes
//   ["1024x1024"], under the source comment "Curruntly no models serving")
// - open-sse/handlers/imageGeneration.ts handleOpenAIImageGeneration (body
//   { model, prompt } plus n, size, quality, response_format, style and the
//   validated output options; `Authorization: Bearer <apiKey|accessToken>`;
//   fallbackUrl retried on 404/410/502/503)
// - open-sse/handlers/imageGeneration/openAiImageFetch.ts (deadline covers the
//   body read, 2xx without a usable b64_json/url is a 502, usage kept internal)
// - src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts
//   (`nebius` discovery: GET https://api.tokenfactory.nebius.com/v1/models,
//   Bearer, data.data || data.models)
//
// The local `nebius` provider (open-sse/providers/registry/nebius.js) is an
// API-key connection for chat and embeddings; this staging reuses that same
// connection and key. Nothing here changes it.

export const NEBIUS_PROVIDER_ID = "nebius";
/** The source registry and the local provider both use alias "nebius"; no extra alias exists. */
export const NEBIUS_PROVIDER_ALIASES = Object.freeze([]);
export const NEBIUS_IMAGE_FORMAT = "openai";

export const NEBIUS_PRIMARY_ORIGIN = "https://api.tokenfactory.nebius.com";
export const NEBIUS_FALLBACK_ORIGIN = "https://api.studio.nebius.com";
export const NEBIUS_IMAGE_PATH = "/v1/images/generations";
export const NEBIUS_IMAGE_URL = `${NEBIUS_PRIMARY_ORIGIN}${NEBIUS_IMAGE_PATH}`;
export const NEBIUS_IMAGE_FALLBACK_URL = `${NEBIUS_FALLBACK_ORIGIN}${NEBIUS_IMAGE_PATH}`;
export const NEBIUS_MODELS_URL = `${NEBIUS_PRIMARY_ORIGIN}/v1/models`;

/** Source registry models, in order (the source names it "No Model yet"). */
export const NEBIUS_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: "black-forest-labs/flux-schnell", name: "No Model yet" }),
]);
/** Source registry supportedSizes. */
export const NEBIUS_IMAGE_SIZES = Object.freeze(["1024x1024"]);
/**
 * Primary statuses after which the fallback host is tried. The source also
 * retried 502/503; those may follow accepted work, so they are never replayed.
 */
export const NEBIUS_FALLBACK_STATUSES = Object.freeze([404, 410]);
/** Still containers this subset forwards as `output_format`. */
export const NEBIUS_OUTPUT_FORMATS = Object.freeze(["png", "jpeg", "webp"]);
export const NEBIUS_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

// Gateway bounds (not in the source).
export const NEBIUS_SUBMIT_TIMEOUT_MS = 120_000;
export const NEBIUS_TOTAL_TIMEOUT_MS = 180_000;
export const NEBIUS_DISCOVERY_TIMEOUT_MS = 10_000;
export const NEBIUS_DISCOVERY_MAX_BYTES = 2 * 1024 * 1024;
export const NEBIUS_DISCOVERY_MAX_MODELS = 1000;
export const NEBIUS_RESPONSE_MAX_BYTES = 40 * 1024 * 1024;
export const NEBIUS_IMAGE_MAX_N = 10;
export const NEBIUS_MAX_RESULTS = 16;
export const NEBIUS_MAX_PROMPT_CHARS = 32_000;
export const NEBIUS_MIN_SIDE = 64;
export const NEBIUS_MAX_SIDE = 2048;
