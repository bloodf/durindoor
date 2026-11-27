// Hyperbolic native image generation, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`hyperbolic`: baseUrl
//   https://api.hyperbolic.xyz/v1/image/generation, authType "apikey",
//   authHeader "bearer", format "hyperbolic" ("custom: uses model_name,
//   returns base64 images"), models [SDXL1.0-base], supportedSizes
//   [1024x1024], followed by the note "Curruntly no models serving")
// - open-sse/handlers/imageGeneration.ts (format "hyperbolic" dispatch to
//   handleHyperbolicImageGeneration with model, provider, body, credentials)
// - open-sse/handlers/imageGeneration/providers/hyperbolic.ts (body
//   { model_name, prompt, height, width, backend: "auto" }, Bearer
//   apiKey || accessToken, answer { images: [{ image: <base64> }] } mapped to
//   { b64_json, revised_prompt })
//
// The local `hyperbolic` provider (open-sse/providers/registry/hyperbolic.js)
// is an API-key chat connection on the same api.hyperbolic.xyz origin; this
// staging reuses that connection's key and mode unchanged.

export const HYPERBOLIC_PROVIDER_ID = "hyperbolic";
/** The local registry alias / uiAlias for the existing provider. */
export const HYPERBOLIC_PROVIDER_ALIASES = Object.freeze(["hyp"]);
export const HYPERBOLIC_IMAGE_FORMAT = "hyperbolic";

export const HYPERBOLIC_API_ORIGIN = "https://api.hyperbolic.xyz";
export const HYPERBOLIC_IMAGE_PATH = "/v1/image/generation";
export const HYPERBOLIC_IMAGE_URL = `${HYPERBOLIC_API_ORIGIN}${HYPERBOLIC_IMAGE_PATH}`;

/** Source registry models, in order. */
export const HYPERBOLIC_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: "SDXL1.0-base", name: "SDXL 1.0 Base (Hyperbolic)" }),
]);
/** Source registry supportedSizes. */
export const HYPERBOLIC_IMAGE_SIZES = Object.freeze(["1024x1024"]);
export const HYPERBOLIC_IMAGE_DEFAULT_SIZE = "1024x1024";
/** Source constant body field. */
export const HYPERBOLIC_IMAGE_BACKEND = "auto";

// Gateway bounds (not in the source).
export const HYPERBOLIC_SUBMIT_TIMEOUT_MS = 120_000;
export const HYPERBOLIC_TOTAL_TIMEOUT_MS = 180_000;
/** Base64 PNG of a 1024x1024 SDXL image is a few MB; leave room, stay bounded. */
export const HYPERBOLIC_RESPONSE_MAX_BYTES = 24 * 1024 * 1024;
export const HYPERBOLIC_MAX_IMAGE_B64_CHARS = 20 * 1024 * 1024;
export const HYPERBOLIC_MAX_RESULT_IMAGES = 4;
export const HYPERBOLIC_MAX_PROMPT_CHARS = 8_000;
