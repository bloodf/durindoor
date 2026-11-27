// Staged, unregistered KIE.AI native image and video adapters (#2034). Nothing
// in production imports this module yet; ./registration.json describes the
// serial registration step. Source attribution is in ./config.js.
import { createKieImageAdapter } from "./image.js";
import { createKieVideoAdapter } from "./video.js";

export * from "./config.js";
export { buildKieImageRequest, createKieImageAdapter, kieImageResultCandidates } from "./image.js";
export { buildKieVideoRequest, createKieVideoAdapter, kieVideoResultCandidates } from "./video.js";
export { kieResultJson, kieTaskState, runKieTask } from "./job.js";
export { kieAcceptedJob, kiePublicUrl } from "./http.js";

/** Default instances for IMAGE_ADAPTERS / VIDEO_GENERATION_ADAPTERS under `kie`. */
export const kieImageAdapter = createKieImageAdapter();
export const kieVideoAdapter = createKieVideoAdapter();
