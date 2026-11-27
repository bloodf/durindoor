// Staged, unregistered Topaz Labs native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createTopazImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildTopazEnhanceForm, buildTopazEnhanceHeaders, createTopazImageAdapter, decodeTopazInputImage, parseTopazImageRequest,
  resolveTopazImageCredential, resolveTopazImageModel, sniffTopazImage, topazAcceptedJob,
} from "./image.js";

/** Default instance for IMAGE_ADAPTERS under `topaz`. */
export const topazImageAdapter = createTopazImageAdapter();
