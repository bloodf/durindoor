// Staged, unregistered deAPI native speech (TTS) and transcription (STT)
// adapters (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createDeapiSttAdapter } from "./stt.js";
import { createDeapiTtsAdapter } from "./tts.js";

export * from "./config.js";
export { deapiAcceptedJob } from "./http.js";
export { DEAPI_SPEECH_RESPONSE_FORMATS, buildDeapiSpeechRequest, createDeapiTtsAdapter, isMp3 } from "./tts.js";
export {
  DEAPI_TRANSCRIPTION_RESPONSE_FORMATS, buildDeapiTranscriptionRequest, createDeapiSttAdapter, deapiUploadFileName,
} from "./stt.js";

/** Default instances: TTS_ADAPTERS under `deapi`, and a `deapi` branch ahead of handleSttCore's OpenAI default. */
export const deapiTtsAdapter = createDeapiTtsAdapter();
export const deapiSttAdapter = createDeapiSttAdapter();
