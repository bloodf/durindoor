// Staged, unregistered Grok CLI (Grok Build) native video adapter (#2034).
// Nothing in production imports this module yet; ./registration.json describes
// the serial registration step. Source attribution is in ./config.js.
import { createGrokCliVideoAdapter } from "./adapter.js";

export * from "./config.js";
export { createGrokCliVideoAdapter } from "./adapter.js";
export { buildGrokCliVideoRequest, resolveGrokCliTiming } from "./request.js";
export { runGrokCliVideoJob } from "./job.js";
export { grokCliAcceptedJob, grokCliMediaHeaders, grokCliPublicUrl, grokCliToken } from "./http.js";

/** Default instance for VIDEO_GENERATION_ADAPTERS under `grok-cli`. */
export const grokCliVideoAdapter = createGrokCliVideoAdapter();
