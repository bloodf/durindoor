// Staged, unregistered Leonardo.Ai native reference-image edit adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createLeonardoImageEditAdapter } from "./edit.js";

export * from "./config.js";
export { buildLeonardoEditGeneration, createLeonardoImageEditAdapter } from "./edit.js";
export { checkLeonardoEditImage, parseLeonardoEditRequest } from "./request.js";
export {
  checkLeonardoStorageUrl, createLeonardoStorageConnector, encodeLeonardoStorageForm, parseLeonardoUploadTicket,
  resolveLeonardoStorageHost, uploadLeonardoInitImage,
} from "./storage.js";

/** Default instance for an image-edit adapter map under `leonardo` (alias `leo`). */
export const leonardoImageEditAdapter = createLeonardoImageEditAdapter();
