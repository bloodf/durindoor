// Staged, unregistered NanoGPT native speech (TTS) and transcription (STT)
// adapters (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createNanogptSttAdapter } from "./stt.js";
import { createNanogptTtsAdapter } from "./tts.js";

export * from "./config.js";
export { nanogptAcceptedJob } from "./http.js";
export {
  NANOGPT_SPEECH_CONTAINERS, NANOGPT_SPEECH_RESPONSE_FORMATS, buildNanogptSpeechRequest, createNanogptTtsAdapter,
  matchesContainer, resolveNanogptContainer,
} from "./tts.js";
export {
  NANOGPT_TRANSCRIPTION_RESPONSE_FORMATS, buildNanogptTranscriptionRequest, createNanogptSttAdapter, nanogptUploadFileName,
} from "./stt.js";

/** Default instances: TTS_ADAPTERS under `nanogpt`, and a `nanogpt` branch ahead of handleSttCore's OpenAI default. */
export const nanogptTtsAdapter = createNanogptTtsAdapter();
export const nanogptSttAdapter = createNanogptSttAdapter();
