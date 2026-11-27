// Staged, unregistered Novita native video adapter (#2034). Nothing in
// production imports this module yet; ./registration.json describes the serial
// registration step. Source attribution is in ./config.js.
import { createNovitaVideoAdapter } from "./adapter.js";

export * from "./config.js";
export { createNovitaVideoAdapter } from "./adapter.js";
export { buildNovitaVideoRequest, resolveNovitaTiming } from "./request.js";
export { runNovitaVideoTask } from "./job.js";
export { novitaAcceptedJob, novitaPublicUrl } from "./http.js";

/** Default instance for VIDEO_GENERATION_ADAPTERS under `novita`. */
export const novitaVideoAdapter = createNovitaVideoAdapter();
