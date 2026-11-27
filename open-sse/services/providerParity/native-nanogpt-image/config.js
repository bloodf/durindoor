// NanoGPT native image generation, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`nanogpt`: baseUrl
//   https://nano-gpt.com/api/v1/images/generations, authType "apikey",
//   authHeader "bearer", format "openai", models qwen-image (inputModalities
//   text+image), z-image-turbo, chroma, hidream; supportedSizes
//   ["1024x1024", "1024x1280", "1280x1024"]; no fallbackUrl)
// - open-sse/handlers/imageGeneration.ts handleOpenAIImageGeneration (body
//   { model, prompt } plus the validated output options, n, size, quality,
//   response_format, style; `Authorization: Bearer <apiKey|accessToken>`;
//   image_url only for OPENAI_IMAGE_TO_IMAGE_MODELS, which holds no NanoGPT id)
// - open-sse/handlers/imageGeneration/openAiImageFetch.ts (deadline covers the
//   body read, 2xx without a usable b64_json/url is a 502, usage kept internal)
// - open-sse/config/providers/registry/nanogpt/index.ts (modelsUrl
//   https://nano-gpt.com/api/v1/models) and
//   src/app/api/providers/[id]/models/discovery/{providerSets,normalizers}.ts
//   (`nanogpt` is a named OpenAI-style provider: GET <base>/v1/models with the
//   Bearer key; items from an array, data.data or data.models; id from
//   id || model || name)
//
// The local `nanogpt` provider (open-sse/providers/registry/nanogpt.js) is an
// API-key connection for chat; this staging reuses that same connection and
// key. Nothing here changes it.

export const NANOGPT_PROVIDER_ID = "nanogpt";
/** The source registry and the local provider both use alias "nanogpt"; no extra alias exists. */
export const NANOGPT_PROVIDER_ALIASES = Object.freeze([]);
export const NANOGPT_IMAGE_FORMAT = "openai";

export const NANOGPT_ORIGIN = "https://nano-gpt.com";
export const NANOGPT_IMAGE_PATH = "/api/v1/images/generations";
export const NANOGPT_IMAGE_URL = `${NANOGPT_ORIGIN}${NANOGPT_IMAGE_PATH}`;
export const NANOGPT_MODELS_URL = `${NANOGPT_ORIGIN}/api/v1/models`;

/**
 * Source registry models, in order. The source lists qwen-image with
 * inputModalities ["text", "image"], but its OpenAI path forwards an input
 * image only for OPENAI_IMAGE_TO_IMAGE_MODELS, which contains no NanoGPT id,
 * so no input image ever reached NanoGPT. This subset is text-to-image only.
 */
export const NANOGPT_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: "qwen-image", name: "Qwen Image", sourceInputModalities: Object.freeze(["text", "image"]) }),
  Object.freeze({ id: "z-image-turbo", name: "Z Image Turbo" }),
  Object.freeze({ id: "chroma", name: "Chroma" }),
  Object.freeze({ id: "hidream", name: "Hidream I1 Full" }),
]);
/** Source registry supportedSizes. */
export const NANOGPT_IMAGE_SIZES = Object.freeze(["1024x1024", "1024x1280", "1280x1024"]);
/** Still containers this subset forwards as `output_format`. */
export const NANOGPT_OUTPUT_FORMATS = Object.freeze(["png", "jpeg", "webp"]);
export const NANOGPT_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

// Gateway bounds (not in the source).
export const NANOGPT_SUBMIT_TIMEOUT_MS = 120_000;
export const NANOGPT_TOTAL_TIMEOUT_MS = 180_000;
export const NANOGPT_DISCOVERY_TIMEOUT_MS = 10_000;
export const NANOGPT_DISCOVERY_MAX_BYTES = 4 * 1024 * 1024;
export const NANOGPT_DISCOVERY_MAX_MODELS = 2000;
export const NANOGPT_RESPONSE_MAX_BYTES = 40 * 1024 * 1024;
export const NANOGPT_IMAGE_MAX_N = 10;
export const NANOGPT_MAX_RESULTS = 16;
export const NANOGPT_MAX_PROMPT_CHARS = 32_000;
export const NANOGPT_MIN_SIDE = 64;
export const NANOGPT_MAX_SIDE = 2048;
