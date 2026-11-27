// MaxAI native image generation, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`maxai`: alias "mx", baseUrl
//   https://api.maxai.me/gpt/get_image_generate_response, authType "apikey",
//   authHeader "bearer", format "maxai-image", six models, supportedSizes)
// - open-sse/handlers/imageGeneration.ts (format "maxai-image" dispatch to
//   handleMaxaiImageGeneration with model, provider, body, credentials, signal)
// - open-sse/handlers/imageGeneration/providers/maxaiImage.ts (MAXAI_IMAGE_PATH,
//   default size 1024x1024, n cap 4, strict sizes for gpt-image-1 / dall-e-3,
//   model aliases, body { prompt, style, size, n, model_name } with style
//   default "vivid", png_url > webp_url > url extraction, status "OK" check,
//   401/418 marked retryable)
// - open-sse/executors/maxai/{signing,credentials,protocol}.ts (X-Authorization
//   signer, credential triple, static Firefox-150 identity headers)
//
// The source registry says authType "apikey"; the local `maxai` provider is a
// webCookie connection (open-sse/providers/registry/maxai.js) whose session
// carries the same access token / device id / user id triple. This staging
// keeps the local cookie connection mode and its field precedence
// (open-sse/executors/maxai.js cookieValues) instead of a new API-key mode.

export const MAXAI_PROVIDER_ID = "maxai";
export const MAXAI_PROVIDER_ALIASES = Object.freeze(["mx"]);
export const MAXAI_IMAGE_FORMAT = "maxai-image";

export const MAXAI_API_ORIGIN = "https://api.maxai.me";
export const MAXAI_IMAGE_PATH = "/gpt/get_image_generate_response";
export const MAXAI_IMAGE_URL = `${MAXAI_API_ORIGIN}${MAXAI_IMAGE_PATH}`;
/** Web app origin the signing constants are read from (public bundle, no credentials). */
export const MAXAI_WEBAPP_ORIGIN = "https://www.maxai.co";
export const MAXAI_WEBAPP_PAGE = `${MAXAI_WEBAPP_ORIGIN}/app/`;

/** Source registry models, in order. */
export const MAXAI_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: "gpt-image-1", name: "GPT Image 1 (MaxAI)" }),
  Object.freeze({ id: "dall-e-3", name: "DALL-E 3 (MaxAI)" }),
  Object.freeze({ id: "flux-1-schnell", name: "FLUX.1 [schnell] (MaxAI)" }),
  Object.freeze({ id: "flux-1-dev", name: "FLUX.1 [dev] (MaxAI)" }),
  Object.freeze({ id: "flux-1-pro", name: "FLUX.1 [pro] (MaxAI)" }),
  Object.freeze({ id: "sd3-medium", name: "Stable Diffusion 3 Medium (MaxAI)" }),
]);
/** Source MAXAI_IMAGE_ALIASES (model-name aliases, not provider aliases). */
export const MAXAI_IMAGE_MODEL_ALIASES = Object.freeze({
  "stable-diffusion-v3": "sd3-medium",
  "stable-diffusion-3-medium": "sd3-medium",
  "flux-1-schneil": "flux-1-schnell",
});
/** Source registry supportedSizes. */
export const MAXAI_IMAGE_SIZES = Object.freeze(["1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"]);
/** Source MAXAI_STRICT_SIZE_MODELS: upstream rejects anything else for these. */
export const MAXAI_STRICT_SIZES = Object.freeze({
  "gpt-image-1": Object.freeze(["1024x1024", "1024x1536", "1536x1024", "auto"]),
  "dall-e-3": Object.freeze(["1024x1024", "1024x1792", "1792x1024"]),
});
export const MAXAI_IMAGE_DEFAULT_SIZE = "1024x1024";
export const MAXAI_IMAGE_DEFAULT_STYLE = "vivid";
export const MAXAI_IMAGE_MAX_N = 4;

// Gateway bounds (not in the source).
export const MAXAI_SUBMIT_TIMEOUT_MS = 120_000;
export const MAXAI_TOTAL_TIMEOUT_MS = 180_000;
export const MAXAI_CONSTANTS_REQUEST_TIMEOUT_MS = 8_000;
export const MAXAI_CONSTANTS_TOTAL_TIMEOUT_MS = 30_000;
export const MAXAI_CONSTANTS_MAX_CHUNKS = 80;
export const MAXAI_CONSTANTS_MAX_BYTES = 4 * 1024 * 1024;
export const MAXAI_RESPONSE_MAX_BYTES = 256 * 1024;
export const MAXAI_MAX_RESULT_URLS = 16;
export const MAXAI_MAX_PROMPT_CHARS = 32_000;
