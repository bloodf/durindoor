// Staged, unregistered Hyperbolic native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createHyperbolicImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildHyperbolicImageRequest, createHyperbolicImageAdapter, extractHyperbolicImages, hyperbolicAcceptedJob,
  resolveHyperbolicImageCredential, resolveHyperbolicImageModel, sniffImageBase64,
} from "./image.js";

/** Default instance for IMAGE_ADAPTERS under `hyperbolic` (alias `hyp`). */
export const hyperbolicImageAdapter = createHyperbolicImageAdapter();
