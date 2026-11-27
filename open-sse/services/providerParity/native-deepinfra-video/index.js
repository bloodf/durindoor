// Staged, unregistered DeepInfra native video adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createDeepinfraVideoAdapter } from "./adapter.js";

export * from "./config.js";
export { createDeepinfraVideoAdapter } from "./adapter.js";
export { buildDeepinfraVideoRequest } from "./request.js";
export { deepinfraAcceptedJob, deepinfraPublicUrl } from "./http.js";

/** Default instance for VIDEO_GENERATION_ADAPTERS under `deepinfra`. */
export const deepinfraVideoAdapter = createDeepinfraVideoAdapter();
