// Staged, unregistered Agnes native image and video adapters (#2034). Nothing
// in production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createAgnesImageAdapter } from "./image.js";
import { createAgnesVideoAdapter } from "./video.js";

export * from "./config.js";
export { buildAgnesImageRequest, createAgnesImageAdapter } from "./image.js";
export { buildAgnesVideoRequest, createAgnesVideoAdapter, runAgnesVideoJob } from "./video.js";
export { agnesAcceptedJob, agnesPublicUrl } from "./http.js";

/** Default instances for IMAGE_ADAPTERS / VIDEO_GENERATION_ADAPTERS under `agnes`. */
export const agnesImageAdapter = createAgnesImageAdapter();
export const agnesVideoAdapter = createAgnesVideoAdapter();
