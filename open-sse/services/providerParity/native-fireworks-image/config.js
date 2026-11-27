// Historical OmniRoute inventory, NOT supported native Fireworks capabilities.
// Source: cheaper-inference/OmniRoute (MIT), c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/config/imageRegistryData.ts and handlers/imageGeneration.ts's generic
// OpenAI branch. Checked against primary Fireworks sources 2026-11-27: native
// contracts remain unresolved. All five source rows are preserved without an
// unsupported/retired claim. No alias mapping is inferred from these strings.
// See registration.json and internal/docs/port-reports/native-fireworks-image.md.

export const FIREWORKS_PROVIDER_ID = "fireworks";
export const FIREWORKS_ALIASES = Object.freeze(["fireworks"]);
/** Fixed origin retained for future source-established transport. No active dispatch. */
export const FIREWORKS_ORIGIN = "https://api.fireworks.ai";
// Historical OmniRoute URL only; never a dispatch target.
export const FIREWORKS_SOURCE_IMAGE_URL = `${FIREWORKS_ORIGIN}/inference/v1/images/generations`;
export const FIREWORKS_IMAGE_URL = null;
export const FIREWORKS_CONTRACT_STATUS = "source-unresolved";
export const FIREWORKS_SUPPORTED_IMAGE_MODELS = Object.freeze([]);
// Historical source format, not the disabled adapter's format.
export const FIREWORKS_IMAGE_FORMAT = "openai";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const FIREWORKS_IMAGE_MODELS = freezeAll([
  { id: "accounts/fireworks/flux-kontext-max", name: "FLUX Kontext Max", kind: "image" },
  { id: "accounts/fireworks/flux-kontext-pro", name: "FLUX Kontext Pro", kind: "image" },
  { id: "accounts/fireworks/flux-1-schnell-fp8", name: "FLUX.1 schnell", kind: "image" },
  { id: "accounts/fireworks/models/flux-1-dev-fp8", name: "FLUX 1 Dev FP8", kind: "image" },
  { id: "accounts/fireworks/models/stable-diffusion-xl-1024-v1-0", name: "SDXL 1024 v1.0", kind: "image" },
]);
// Historical source sizes and response formats only. Adapter capabilities are empty.
export const FIREWORKS_IMAGE_SIZES = Object.freeze(["1024x1024", "512x512"]);
export const FIREWORKS_RESPONSE_FORMATS = Object.freeze(["url", "b64_json"]);

// Retained bounds for future source-established transport, not capability claims.
export const FIREWORKS_IMAGE_TIMEOUT_MS = 180_000;
// Historical source fixture ceiling, not an advertised native capability.
export const FIREWORKS_IMAGE_MAX_N = 10;

export const fireworksImageModel = (id) => FIREWORKS_IMAGE_MODELS.find((model) => model.id === id) ?? null;
