// Staged, unregistered Nebius Token Factory native image adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createNebiusImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildNebiusImageRequest, createNebiusImageAdapter, nebiusAcceptedJob, nebiusPublicUrl, normalizeNebiusImageItems,
  resolveNebiusImageCredential, resolveNebiusImageModel,
} from "./image.js";
export { discoverNebiusModels, isSafeNebiusModelId, parseNebiusModelList } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `nebius`. */
export const nebiusImageAdapter = createNebiusImageAdapter();
