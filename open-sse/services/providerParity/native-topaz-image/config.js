// Topaz Labs native image enhance, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/config/imageRegistryData.ts (`topaz`: baseUrl
//   https://api.topazlabs.com, authType "apikey", authHeader "x-api-key",
//   format "topaz", models [{ id: "topaz-enhance", inputModalities: ["image"] }],
//   supportedSizes ["1024x1024"])
// - open-sse/handlers/imageGeneration.ts (format "topaz" dispatch to
//   handleTopazImageGeneration: an input image is required; multipart POST
//   `${baseUrl}/image/v1/enhance` with headers Accept image/jpeg and
//   X-API-Key (apiKey, else accessToken); form fields `image` (blob named
//   image.png) and, when `size` is "WxH", `output_width` / `output_height`;
//   the answer is the raw image bytes, returned as b64_json or a data: URL with
//   revised_prompt = body.prompt)
//
// The local `topaz` provider (open-sse/providers/registry/topaz.js) is an
// API-key connection that already declares serviceKinds ["image"] but has no
// image transport; this staging reuses that connection's key and mode.

export const TOPAZ_PROVIDER_ID = "topaz";
/** The local registry alias equals the id; no other alias exists. */
export const TOPAZ_PROVIDER_ALIASES = Object.freeze([]);
export const TOPAZ_IMAGE_FORMAT = "topaz";

export const TOPAZ_API_ORIGIN = "https://api.topazlabs.com";
export const TOPAZ_ENHANCE_PATH = "/image/v1/enhance";
export const TOPAZ_ENHANCE_URL = `${TOPAZ_API_ORIGIN}${TOPAZ_ENHANCE_PATH}`;
/** Source header names and values. */
export const TOPAZ_AUTH_HEADER = "X-API-Key";
export const TOPAZ_ACCEPT = "image/jpeg";
/** Source multipart file name (constant, whatever the input container is). */
export const TOPAZ_UPLOAD_FILENAME = "image.png";

/** Source registry models, in order. */
export const TOPAZ_IMAGE_MODELS = Object.freeze([
  Object.freeze({ id: "topaz-enhance", name: "topaz-enhance", inputModalities: Object.freeze(["image"]) }),
]);
/** Source registry supportedSizes (advisory there: the handler sent any WxH). */
export const TOPAZ_IMAGE_SIZES = Object.freeze(["1024x1024"]);

/** Image containers accepted in and out (magic-byte sniffed). */
export const TOPAZ_IMAGE_MIMES = Object.freeze({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" });

// Gateway bounds (not in the source).
export const TOPAZ_SUBMIT_TIMEOUT_MS = 180_000;
export const TOPAZ_TOTAL_TIMEOUT_MS = 240_000;
export const TOPAZ_MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
export const TOPAZ_MIN_IMAGE_BYTES = 12;
export const TOPAZ_RESPONSE_MAX_BYTES = 48 * 1024 * 1024;
export const TOPAZ_MAX_OUTPUT_EDGE = 8192;
export const TOPAZ_MAX_PROMPT_CHARS = 8_000;
