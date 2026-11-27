// Staged, unregistered Soniox native speech (TTS) and asynchronous
// transcription (STT) adapters (#2034). Nothing in production imports this
// module yet; ./registration.json describes the serial registration step.
// Source attribution is in ./config.js.
import { createSonioxSttAdapter } from "./stt.js";
import { createSonioxTtsAdapter } from "./tts.js";

export * from "./config.js";
export { sonioxAcceptedJob } from "./http.js";
export {
  SONIOX_SPEECH_CONTAINERS, SONIOX_SPEECH_CONTENT_TYPES, SONIOX_SPEECH_RESPONSE_FORMATS, buildSonioxSpeechRequest,
  createSonioxTtsAdapter, matchesSonioxContainer, resolveSonioxContainer, resolveSonioxVoice,
} from "./tts.js";
export {
  SONIOX_DIARIZATION_FIELDS, SONIOX_TRANSCRIPTION_RESPONSE_FORMATS, buildSonioxTranscriptionRequest, createSonioxSttAdapter,
  groupSonioxTokensBySpeaker, readSonioxDiarization, sonioxJobBody, sonioxTranscriptBody, sonioxUploadFileName,
} from "./stt.js";

/** Default instances: TTS_ADAPTERS under `soniox`, and a `soniox` branch ahead of handleSttCore's format switch. */
export const sonioxTtsAdapter = createSonioxTtsAdapter();
export const sonioxSttAdapter = createSonioxSttAdapter();
