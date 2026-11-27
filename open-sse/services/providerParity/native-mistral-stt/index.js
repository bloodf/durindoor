// Staged, unregistered Mistral native transcription (STT) adapter (#2034).
// Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createMistralSttAdapter } from "./stt.js";

export * from "./config.js";
export { mistralSttAcceptedJob, mistralSttRefusal } from "./http.js";
export {
  MISTRAL_GRANULARITY_WIRE_FIELD, MISTRAL_TRANSCRIPTION_RESPONSE_FORMATS, buildMistralTranscriptionRequest, createMistralSttAdapter, mistralUploadFileName,
} from "./stt.js";

/** Default instance: a `mistral` branch ahead of handleSttCore's format switch. */
export const mistralSttAdapter = createMistralSttAdapter();
