// Staged, unregistered NanoGPT native image adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createNanoGptImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildNanoGptImageRequest, createNanoGptImageAdapter, nanoGptAcceptedJob, nanoGptPublicUrl, normalizeNanoGptImageItems,
  resolveNanoGptImageCredential, resolveNanoGptImageModel,
} from "./image.js";
export { discoverNanoGptModels, isSafeNanoGptModelId, parseNanoGptModelList } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `nanogpt`. */
export const nanoGptImageAdapter = createNanoGptImageAdapter();
