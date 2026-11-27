// Staged, unregistered Gemini Live (BidiGenerateContent) file-mode
// transcription adapter (#2034). Nothing in production imports this module
// yet; ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createGeminiLiveSttAdapter } from "./stt.js";

export * from "./config.js";
export {
  GEMINI_LIVE_AUDIO_END_FRAME, GEMINI_LIVE_REFUSED_FIELDS, GEMINI_LIVE_RESPONSE_FORMATS,
  buildGeminiLiveSetupFrame, buildGeminiLiveTranscriptionRequest, extractPcmFrom16kWav, geminiLiveAudioFrames,
} from "./request.js";
export { runGeminiLiveSocket } from "./socket.js";
export {
  createGeminiLiveSttAdapter, geminiLiveAcceptedJob, geminiLiveAuthHeaders, geminiLiveHandshakeRefusal,
} from "./stt.js";

/** Default instance: a `gemini` + gemini-3.5-transcribe-live branch ahead of handleSttCore's format switch. */
export const geminiLiveSttAdapter = createGeminiLiveSttAdapter();
