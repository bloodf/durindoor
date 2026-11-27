// Staged, unregistered MaxAI native image adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createMaxaiImageAdapter } from "./image.js";

export * from "./config.js";
export {
  buildMaxaiImageRequest, createMaxaiImageAdapter, extractMaxaiImageUrls, maxaiAcceptedJob, maxaiPublicUrl,
  resolveMaxaiImageModel,
} from "./image.js";
export {
  MAXAI_HEADER_NAMES, buildMaxaiSignedHeaders, computeMaxaiProof, isUsableMaxaiConstants, maxaiAesEncrypt,
  maxaiStaticHeaders, resolveMaxaiImageCredential,
} from "./signing.js";
export { createMaxaiConstantsSource, discoverMaxaiConstants, parseMaxaiBundle } from "./http.js";

/** Default instance for IMAGE_ADAPTERS under `maxai` (alias `mx`). */
export const maxaiImageAdapter = createMaxaiImageAdapter();
