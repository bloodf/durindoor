// Staged, unregistered UC Direct native image and video adapters (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createUcImageAdapter } from "./image.js";
import { createUcVideoAdapter } from "./video.js";

export * from "./config.js";
export { buildUcImageRequest, createUcImageAdapter } from "./image.js";
export { buildUcVideoRequest, createUcVideoAdapter, extractUcVideo, runUcVideoJob, ucStatusUrl } from "./video.js";
export { ucAcceptedJob, ucPublicUrl, ucToken } from "./http.js";

/** Default instances for IMAGE_ADAPTERS / VIDEO_GENERATION_ADAPTERS under `uc-direct` and `ucd`. */
export const ucImageAdapter = createUcImageAdapter();
export const ucVideoAdapter = createUcVideoAdapter();
