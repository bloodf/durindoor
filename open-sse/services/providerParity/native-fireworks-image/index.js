// Staged, unregistered Fireworks AI native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json records the blocked
// registration disposition. Source attribution is in ./config.js and ./image.js.
import { createFireworksImageAdapter } from "./image.js";

export * from "./config.js";
export { buildFireworksImageRequest, createFireworksImageAdapter } from "./image.js";
export { fireworksAcceptedJob, fireworksPublicUrl } from "./http.js";

/** Disabled private instance. Do not add it to IMAGE_ADAPTERS. */
export const fireworksImageAdapter = createFireworksImageAdapter();
