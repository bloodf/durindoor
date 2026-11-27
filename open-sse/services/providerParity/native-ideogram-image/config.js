// Ideogram native image metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/imageRegistryData.ts (`ideogram`: id "ideogram", baseUrl
// https://api.ideogram.ai/generate, authType "apikey", authHeader "Api-Key",
// format "ideogram-image", models V_3 / V_2A, supportedSizes 1024x1024 /
// 1024x1792 / 1792x1024). Format "ideogram-image" dispatches to
// handleIdeogramImageGeneration (open-sse/handlers/imageGeneration.ts ->
// handlers/imageGeneration/providers/ideogram.ts) and is listed in
// SINGLE_IMAGE_FANOUT_FORMATS (handlers/imageGeneration/fanOut.ts).
//
// The existing `ideogram` provider (open-sse/providers/registry/ideogram.js,
// alias "ideo") keeps its API-key connection mode; the adapter reads only the
// selected connection's `apiKey`, as the source does.

export const IDEOGRAM_PROVIDER_ID = "ideogram";
export const IDEOGRAM_ALIASES = Object.freeze(["ideo"]);
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const IDEOGRAM_ORIGIN = "https://api.ideogram.ai";
export const IDEOGRAM_IMAGE_URL = `${IDEOGRAM_ORIGIN}/generate`;
export const IDEOGRAM_IMAGE_FORMAT = "ideogram-image";
export const IDEOGRAM_AUTH_HEADER = "Api-Key";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const IDEOGRAM_IMAGE_MODELS = freezeAll([
  { id: "V_3", name: "Ideogram V3", kind: "image" },
  { id: "V_2A", name: "Ideogram V2A", kind: "image" },
]);
/** The source's model when the request names none. */
export const IDEOGRAM_DEFAULT_MODEL = "V_3";
/** Registry metadata, verbatim. The source sends ASPECT_16_9 whatever the size. */
export const IDEOGRAM_REGISTRY_SIZES = Object.freeze(["1024x1024", "1024x1792", "1792x1024"]);
/** The source's fixed wire aspect ratio. */
export const IDEOGRAM_ASPECT_RATIO = "ASPECT_16_9";
/** Sizes this subset accepts: only the registry size the fixed 16:9 ratio can honor. */
export const IDEOGRAM_IMAGE_SIZES = Object.freeze(["1792x1024"]);
/** The source downloads the result URL and answers base64 only. */
export const IDEOGRAM_RESPONSE_FORMATS = Object.freeze(["b64_json"]);

// One synchronous call per image (headers, body and result download together).
export const IDEOGRAM_CALL_TIMEOUT_MS = 120_000;
// Whole request, across every fanned-out call.
export const IDEOGRAM_TOTAL_TIMEOUT_MS = 300_000;
// IMAGE_FANOUT_MAX_N in the source; larger values are refused here, not clamped.
export const IDEOGRAM_IMAGE_MAX_N = 10;

export const ideogramImageModel = (id) => IDEOGRAM_IMAGE_MODELS.find((model) => model.id === id) ?? null;
