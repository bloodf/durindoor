// Staged, unregistered OpenRouter native transcription (STT) adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createOpenRouterSttAdapter } from "./stt.js";

export * from "./config.js";
export { openrouterSttAcceptedJob, openrouterSttRefusal } from "./http.js";
export {
  OPENROUTER_TRANSCRIPTION_RESPONSE_FORMATS, buildOpenRouterTranscriptionRequest, createOpenRouterSttAdapter,
  resolveOpenRouterAudioFormat, sniffOpenRouterAudioFormat,
} from "./stt.js";

/** Default instance: an `openrouter` branch ahead of handleSttCore's format switch. */
export const openrouterSttAdapter = createOpenRouterSttAdapter();
