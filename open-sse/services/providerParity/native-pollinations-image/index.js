// Staged, unregistered Pollinations native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js and ./image.js.
import { createPollinationsImageAdapter } from "./image.js";

export * from "./config.js";
export { buildPollinationsImageRequest, createPollinationsImageAdapter } from "./image.js";
export { pollinationsAcceptedJob, pollinationsAuth, pollinationsPublicUrl } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `pollinations` (and the `pol` alias). */
export const pollinationsImageAdapter = createPollinationsImageAdapter();
