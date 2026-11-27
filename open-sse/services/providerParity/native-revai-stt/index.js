// Staged, unregistered Rev AI native asynchronous transcription (STT) adapter
// (#2034). Nothing in production imports this module yet; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
import { createRevaiSttAdapter } from "./stt.js";

export * from "./config.js";
export { revaiAcceptedJob } from "./http.js";
export {
  REVAI_TRANSCRIPTION_RESPONSE_FORMATS, REVAI_UNSUPPORTED_FIELDS, buildRevaiTranscriptionRequest, createRevaiSttAdapter,
  revaiJobOptions, revaiUploadFileName,
} from "./stt.js";

/** Default instance: a `rev-ai` branch ahead of handleSttCore's format switch. */
export const revaiSttAdapter = createRevaiSttAdapter();
