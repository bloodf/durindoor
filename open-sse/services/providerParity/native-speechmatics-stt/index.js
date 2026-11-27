// Staged, unregistered Speechmatics native batch transcription (STT) adapter
// (#2034). Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createSpeechmaticsSttAdapter } from "./stt.js";

export * from "./config.js";
export { speechmaticsAcceptedJob } from "./http.js";
export {
  SPEECHMATICS_TRANSCRIPTION_RESPONSE_FORMATS, SPEECHMATICS_UNSUPPORTED_FIELDS, buildSpeechmaticsTranscriptionRequest,
  createSpeechmaticsSttAdapter, speechmaticsJobConfig, speechmaticsUploadFileName,
} from "./stt.js";

/** Default instance: a `speechmatics` branch ahead of handleSttCore's format switch. */
export const speechmaticsSttAdapter = createSpeechmaticsSttAdapter();
