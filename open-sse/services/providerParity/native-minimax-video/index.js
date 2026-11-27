// Staged, unregistered MiniMax native video adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createMinimaxVideoAdapter } from "./adapter.js";

export * from "./config.js";
export { createMinimaxVideoAdapter } from "./adapter.js";
export { buildMinimaxVideoRequest, resolveMinimaxTiming, MINIMAX_MAX_PROMPT_CHARS } from "./request.js";
export { runMinimaxVideoTask } from "./job.js";
export { minimaxAcceptedJob, minimaxPublicUrl } from "./http.js";

/** Default instance for VIDEO_GENERATION_ADAPTERS under `minimax`. */
export const minimaxVideoAdapter = createMinimaxVideoAdapter();
