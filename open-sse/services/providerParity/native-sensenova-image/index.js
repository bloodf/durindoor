// Staged, unregistered SenseNova (China) native image adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createSensenovaImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildSensenovaImageRequest, createSensenovaImageAdapter, normalizeSensenovaImageItems, resolveSensenovaImageCredential,
  resolveSensenovaImageModel, sensenovaAcceptedJob, sensenovaPublicUrl,
} from "./image.js";
export { isSafeSensenovaModelId } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `sensenova`. */
export const sensenovaImageAdapter = createSensenovaImageAdapter();
