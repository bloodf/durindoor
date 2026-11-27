// Staged, unregistered Leonardo.Ai native image and video adapters (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createLeonardoImageAdapter } from "./image.js";
import { createLeonardoVideoAdapter } from "./video.js";

export * from "./config.js";
export {
  buildLeonardoImageRequest, createLeonardoImageAdapter, leonardoImageResult, resolveLeonardoImageModelId,
  resolveLeonardoImageSize,
} from "./image.js";
export {
  buildLeonardoVideoRequest, createLeonardoVideoAdapter, leonardoVideoResult, resolveLeonardoVideoModel,
  resolveLeonardoVideoSize,
} from "./video.js";
export { runLeonardoJob } from "./job.js";
export { leonardoAcceptedJob, leonardoPublicUrl } from "./http.js";

/** Default instances for IMAGE_ADAPTERS / VIDEO_GENERATION_ADAPTERS under `leonardo` (alias `leo`). */
export const leonardoImageAdapter = createLeonardoImageAdapter();
export const leonardoVideoAdapter = createLeonardoVideoAdapter();
