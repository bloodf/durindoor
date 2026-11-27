// Leonardo.Ai native reference-image edits, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// - open-sse/handlers/imageGeneration/providers/leonardo.ts
//   (LEONARDO_EDIT_INIT_STRENGTH 0.3, LEONARDO_INIT_IMAGE_EXTENSIONS,
//   uploadLeonardoInitImage lines 58-85: POST {api}/init-image with the bearer
//   key and `{ extension }`, read `uploadInitImage.{ id, url, fields }`, parse
//   `fields` as JSON, pre-encode the S3 form (fields, then `file` named
//   "init") as bytes plus its boundary header and POST it WITHOUT the Leonardo
//   key; handleLeonardoImageGeneration lines 88-123: the generation body gains
//   `init_image_id` and `init_strength`, then the ordinary job is polled)
// - src/app/api/v1/images/edits/route.ts (Leonardo branch: one reference
//   image only, body `{ prompt, size }`, model through resolveLeonardoModelId)
//
// Model ids, size rules, the generation job and its poll are reused read-only
// from ../native-leonardo-video-image.
import { LEONARDO_API_BASE } from "../native-leonardo-video-image/config.js";

/** Source LEONARDO_EDIT_INIT_STRENGTH: how closely the output follows the reference. */
export const LEONARDO_EDIT_INIT_STRENGTH = 0.3;
/** Init-image upload request (source: the generations URL with /generations -> /init-image). */
export const LEONARDO_INIT_IMAGE_URL = `${LEONARDO_API_BASE}/init-image`;

/** Sniffed format -> MIME sent with the file and source extension. */
export const LEONARDO_EDIT_FORMATS = Object.freeze({
  png: Object.freeze({ mime: "image/png", extension: "png" }),
  jpeg: Object.freeze({ mime: "image/jpeg", extension: "jpg" }),
  webp: Object.freeze({ mime: "image/webp", extension: "webp" }),
});
/** Declared MIME types accepted when they agree with the sniffed bytes. */
export const LEONARDO_EDIT_DECLARED_MIMES = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/webp": "webp",
});

// Gateway bounds (not in the source).
export const LEONARDO_EDIT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const LEONARDO_EDIT_MIN_IMAGE_BYTES = 12;
export const LEONARDO_INIT_TIMEOUT_MS = 30_000;
export const LEONARDO_STORAGE_TIMEOUT_MS = 60_000;
export const LEONARDO_DNS_TIMEOUT_MS = 10_000;
export const LEONARDO_STORAGE_MAX_FIELDS = 32;
export const LEONARDO_STORAGE_MAX_FIELD_BYTES = 8 * 1024;
export const LEONARDO_STORAGE_MAX_URL_LENGTH = 2048;
