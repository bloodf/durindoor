// Fireworks AI native image metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`fireworks`: id "fireworks", baseUrl
// https://api.fireworks.ai/inference/v1/images/generations, authType "apikey",
// authHeader "bearer", format "openai", five static models, supportedSizes
// 1024x1024 / 512x512). Format "openai" dispatches to
// handleOpenAIImageGeneration in open-sse/handlers/imageGeneration.ts, which
// posts through handlers/imageGeneration/openAiImageFetch.ts.
//
// The existing `fireworks` provider (open-sse/providers/registry/fireworks.js)
// keeps its chat and embedding transports and its API-key connection mode; the
// image kind uses the same selected connection's key. Model ids are the
// source's, verbatim (three omit the `/models/` segment in the source too).

export const FIREWORKS_PROVIDER_ID = "fireworks";
export const FIREWORKS_ALIASES = Object.freeze(["fireworks"]);
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const FIREWORKS_ORIGIN = "https://api.fireworks.ai";
export const FIREWORKS_IMAGE_URL = `${FIREWORKS_ORIGIN}/inference/v1/images/generations`;
export const FIREWORKS_IMAGE_FORMAT = "openai";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const FIREWORKS_IMAGE_MODELS = freezeAll([
  { id: "accounts/fireworks/flux-kontext-max", name: "FLUX Kontext Max", kind: "image" },
  { id: "accounts/fireworks/flux-kontext-pro", name: "FLUX Kontext Pro", kind: "image" },
  { id: "accounts/fireworks/flux-1-schnell-fp8", name: "FLUX.1 schnell", kind: "image" },
  { id: "accounts/fireworks/models/flux-1-dev-fp8", name: "FLUX 1 Dev FP8", kind: "image" },
  { id: "accounts/fireworks/models/stable-diffusion-xl-1024-v1-0", name: "SDXL 1024 v1.0", kind: "image" },
]);
export const FIREWORKS_IMAGE_SIZES = Object.freeze(["1024x1024", "512x512"]);
export const FIREWORKS_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

// One synchronous call, headers and body together.
export const FIREWORKS_IMAGE_TIMEOUT_MS = 180_000;
// The OpenAI Images ceiling; the source forwarded any n unchecked.
export const FIREWORKS_IMAGE_MAX_N = 10;

export const fireworksImageModel = (id) => FIREWORKS_IMAGE_MODELS.find((model) => model.id === id) ?? null;
