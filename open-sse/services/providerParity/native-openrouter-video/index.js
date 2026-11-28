// Staged, unregistered OpenRouter native video adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createOpenrouterVideoAdapter } from "./video.js";

export * from "./config.js";
export {
  buildOpenrouterVideoRequest, createOpenrouterVideoAdapter, resolveOpenrouterTiming, runOpenrouterVideoJob,
} from "./video.js";
export { openrouterAcceptedJob, openrouterContentUrl } from "./http.js";

/** Default instance for VIDEO_GENERATION_ADAPTERS under `openrouter`. */
export const openrouterVideoAdapter = createOpenrouterVideoAdapter();
