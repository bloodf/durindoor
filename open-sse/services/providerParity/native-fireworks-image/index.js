// Staged, unregistered Fireworks AI native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js and ./image.js.
import { createFireworksImageAdapter } from "./image.js";

export * from "./config.js";
export { buildFireworksImageRequest, createFireworksImageAdapter } from "./image.js";
export { fireworksAcceptedJob, fireworksPublicUrl } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `fireworks`. */
export const fireworksImageAdapter = createFireworksImageAdapter();
