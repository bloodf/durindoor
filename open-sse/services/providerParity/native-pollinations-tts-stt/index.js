// Staged, unregistered Pollinations native speech (TTS) and transcription (STT)
// adapters (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createPollinationsSttAdapter } from "./stt.js";
import { createPollinationsTtsAdapter } from "./tts.js";

export * from "./config.js";
export { pollinationsAcceptedJob } from "./http.js";
export {
  POLLINATIONS_SPEECH_CONTAINERS, POLLINATIONS_SPEECH_RESPONSE_FORMATS, buildPollinationsSpeechRequest, createPollinationsTtsAdapter,
  matchesContainer, resolvePollinationsContainer,
} from "./tts.js";
export {
  POLLINATIONS_TRANSCRIPTION_RESPONSE_FORMATS, buildPollinationsTranscriptionRequest, createPollinationsSttAdapter, pollinationsUploadFileName,
} from "./stt.js";

/** Default instances: TTS_ADAPTERS under `pollinations`, and a `pollinations` branch ahead of handleSttCore's OpenAI default. */
export const pollinationsTtsAdapter = createPollinationsTtsAdapter();
export const pollinationsSttAdapter = createPollinationsSttAdapter();
