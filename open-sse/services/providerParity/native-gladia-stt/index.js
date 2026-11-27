// Staged, unregistered Gladia native asynchronous transcription (STT) adapter
// (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createGladiaSttAdapter } from "./stt.js";

export * from "./config.js";
export { gladiaAcceptedJob } from "./http.js";
export {
  GLADIA_DROPPED_FIELDS, GLADIA_TRANSCRIPTION_RESPONSE_FORMATS, buildGladiaTranscriptionRequest, createGladiaSttAdapter,
  gladiaAudioUrl, gladiaJobBody, gladiaResultJob, gladiaTranscriptText, gladiaUploadFileName,
} from "./stt.js";

/** Default instance: a `gladia` branch ahead of handleSttCore's format switch. */
export const gladiaSttAdapter = createGladiaSttAdapter();
