// Staged, unregistered xAI (Grok Imagine) native video adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createXaiVideoAdapter } from "./adapter.js";

export * from "./config.js";
export { createXaiVideoAdapter } from "./adapter.js";
export { buildXaiVideoRequest, resolveXaiTiming, xaiImageReference } from "./request.js";
export { runXaiVideoJob, submitXaiVideoJob, fetchXaiVideoStatus, settleXaiStatus, xaiVideoSeconds, XAI_REQUEST_ID_RE } from "./job.js";
export { xaiAcceptedJob, xaiCredential, xaiPublicUrl } from "./http.js";
export { openAIVideoStatus, openAIVideoFromXaiCreate, openAIVideoFromXaiStatus, resolveXaiVideoContent } from "./envelope.js";

/** Default instance for VIDEO_GENERATION_ADAPTERS under `xai`. */
export const xaiVideoAdapter = createXaiVideoAdapter();
