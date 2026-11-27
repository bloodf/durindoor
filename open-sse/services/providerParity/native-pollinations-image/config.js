// Pollinations native image metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`pollinations`: id "pollinations",
// alias "pol", baseUrl https://gen.pollinations.ai/v1/images/generations,
// authType "apikey", authHeader "bearer", format "openai", eight static
// models, supportedSizes 1024x1024 / 512x512). Format "openai" dispatches to
// handleOpenAIImageGeneration in open-sse/handlers/imageGeneration.ts, which
// posts through handlers/imageGeneration/openAiImageFetch.ts.
//
// The existing `pollinations` provider (open-sse/providers/registry/pollinations.js)
// keeps its chat transport, its `pol` alias, its API-key connection mode and
// its keyless public fallback; the image kind uses the same selected
// connection. The source's `pollinations/kontext` image-model alias resolves to
// black-forest-labs/flux-kontext-pro, not to this provider, so it is not ported.

export const POLLINATIONS_PROVIDER_ID = "pollinations";
export const POLLINATIONS_ALIASES = Object.freeze(["pollinations", "pol"]);
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const POLLINATIONS_ORIGIN = "https://gen.pollinations.ai";
export const POLLINATIONS_IMAGE_URL = `${POLLINATIONS_ORIGIN}/v1/images/generations`;
export const POLLINATIONS_IMAGE_FORMAT = "openai";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

// `qwen-image` is in the source's OPENAI_IMAGE_TO_IMAGE_MODELS set, so it alone
// forwards one reference image as `image_url`.
export const POLLINATIONS_IMAGE_MODELS = freezeAll([
  { id: "klein", name: "FLUX.2 Klein 4B", kind: "image", inputModalities: ["text"] },
  { id: "flux", name: "Flux Schnell", kind: "image", inputModalities: ["text"] },
  { id: "zimage", name: "Z-Image Turbo", kind: "image", inputModalities: ["text"] },
  { id: "qwen-image", name: "Qwen Image Plus", kind: "image", inputModalities: ["text", "image"] },
  { id: "wan-image", name: "Wan 2.7 Image", kind: "image", inputModalities: ["text"] },
  { id: "gpt-image-2", name: "GPT Image 2", kind: "image", inputModalities: ["text"] },
  { id: "gptimage-large", name: "GPT Image 1.5", kind: "image", inputModalities: ["text"] },
  { id: "gptimage", name: "GPT Image 1 Mini", kind: "image", inputModalities: ["text"] },
]);
export const POLLINATIONS_IMAGE_SIZES = Object.freeze(["1024x1024", "512x512"]);
export const POLLINATIONS_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

// One synchronous call, headers and body together.
export const POLLINATIONS_IMAGE_TIMEOUT_MS = 180_000;
// The OpenAI Images ceiling; the source forwarded any n unchecked.
export const POLLINATIONS_IMAGE_MAX_N = 10;

export const pollinationsImageModel = (id) => POLLINATIONS_IMAGE_MODELS.find((model) => model.id === id) ?? null;
