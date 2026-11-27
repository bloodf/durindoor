// Staged, unregistered Ideogram native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js and ./image.js.
import { createIdeogramImageAdapter } from "./image.js";

export * from "./config.js";
export { buildIdeogramImageRequest, createIdeogramImageAdapter } from "./image.js";
export { ideogramAcceptedJob, ideogramPublicUrl } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `ideogram`. */
export const ideogramImageAdapter = createIdeogramImageAdapter();
