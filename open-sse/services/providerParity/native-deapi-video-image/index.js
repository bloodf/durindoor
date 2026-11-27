// Staged, unregistered deAPI native image and video adapters (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createDeapiImageAdapter } from "./image.js";
import { createDeapiVideoAdapter } from "./video.js";

export * from "./config.js";
export { buildDeapiImageRequest, createDeapiImageAdapter } from "./image.js";
export { buildDeapiVideoRequest, createDeapiVideoAdapter, runDeapiVideoJob } from "./video.js";
export { deapiAcceptedJob, deapiPublicUrl } from "./http.js";

/** Default instances for IMAGE_ADAPTERS / VIDEO_GENERATION_ADAPTERS under `deapi`. */
export const deapiImageAdapter = createDeapiImageAdapter();
export const deapiVideoAdapter = createDeapiVideoAdapter();
