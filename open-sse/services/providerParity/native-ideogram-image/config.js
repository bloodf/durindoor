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
// Wire contract correction (2026-11-27). The pinned source posts the fields
// flat to /generate. Ideogram's official API v1 OpenAPI spec
// (https://developer.ideogram.ai/openapi/ideogram-api-v1.json, servers
// https://api.ideogram.ai, security ApiKeyAuth = header `Api-Key`) documents:
// - POST /generate (operationId generate_post_generate_image, "Generate
//   (legacy)"): application/json GenerateImageRequest, which requires
//   `image_request` (ImageRequest: required `prompt`, `aspect_ratio` enum
//   ASPECT_*, `model` ModelEnum V_1 | V_1_TURBO | V_2 | V_2_TURBO | V_2A |
//   V_2A_TURBO | AUTO). V_3 is not in that enum.
// - POST /v1/ideogram-v3/generate (operationId
//   generate_post_generate_image_v3, "Generate with Ideogram 3.0"):
//   multipart/form-data with required `prompt` and `aspect_ratio`
//   AspectRatioV3 (`16x9`, ...); there is no model field.
// Both answer `{ created, data: [{ prompt, resolution, is_image_safe, seed, url }] }`.
// So V_2A is sent in the documented envelope to /generate and V_3 to the
// Ideogram 3.0 operation. See internal/docs/port-reports/native-ideogram-image.md.
//
// The existing `ideogram` provider (open-sse/providers/registry/ideogram.js,
// alias "ideo") keeps its API-key connection mode; the adapter reads only the
// selected connection's `apiKey`, as the source does.

export const IDEOGRAM_PROVIDER_ID = "ideogram";
export const IDEOGRAM_ALIASES = Object.freeze(["ideo"]);
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const IDEOGRAM_ORIGIN = "https://api.ideogram.ai";
/** Legacy generate operation (generate_post_generate_image): JSON `{ image_request }`. */
export const IDEOGRAM_IMAGE_URL = `${IDEOGRAM_ORIGIN}/generate`;
/** Ideogram 3.0 generate operation (generate_post_generate_image_v3): multipart form. */
export const IDEOGRAM_V3_IMAGE_URL = `${IDEOGRAM_ORIGIN}/v1/ideogram-v3/generate`;
/** Wire encodings of the two documented operations. */
export const IDEOGRAM_WIRE_JSON_ENVELOPE = "json-image-request";
export const IDEOGRAM_WIRE_V3_MULTIPART = "multipart-v3";
export const IDEOGRAM_IMAGE_FORMAT = "ideogram-image";
export const IDEOGRAM_AUTH_HEADER = "Api-Key";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const IDEOGRAM_IMAGE_MODELS = freezeAll([
  { id: "V_3", name: "Ideogram V3", kind: "image", url: IDEOGRAM_V3_IMAGE_URL, wire: IDEOGRAM_WIRE_V3_MULTIPART },
  { id: "V_2A", name: "Ideogram V2A", kind: "image", url: IDEOGRAM_IMAGE_URL, wire: IDEOGRAM_WIRE_JSON_ENVELOPE },
]);
/** The source's model when the request names none. */
export const IDEOGRAM_DEFAULT_MODEL = "V_3";
/** Registry metadata, verbatim. The source sends a 16:9 ratio whatever the size. */
export const IDEOGRAM_REGISTRY_SIZES = Object.freeze(["1024x1024", "1024x1792", "1792x1024"]);
/** The source's fixed wire aspect ratio, in the legacy AspectRatio enum. */
export const IDEOGRAM_ASPECT_RATIO = "ASPECT_16_9";
/** The same 16:9 ratio in the Ideogram 3.0 AspectRatioV3 enum. */
export const IDEOGRAM_V3_ASPECT_RATIO = "16x9";
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
