// Staged, unregistered Haiper native image and video adapters (#2034). Nothing
// in production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createHaiperImageAdapter, createHaiperVideoAdapter } from "./adapters.js";

export * from "./config.js";
export { createHaiperImageAdapter, createHaiperVideoAdapter } from "./adapters.js";
export { buildHaiperImageRequest, buildHaiperVideoRequest } from "./request.js";
export { runHaiperJob } from "./job.js";
export { haiperAcceptedJob, haiperPublicUrl } from "./http.js";

/** Default instances for IMAGE_ADAPTERS / VIDEO_GENERATION_ADAPTERS under `haiper`. */
export const haiperImageAdapter = createHaiperImageAdapter();
export const haiperVideoAdapter = createHaiperVideoAdapter();
