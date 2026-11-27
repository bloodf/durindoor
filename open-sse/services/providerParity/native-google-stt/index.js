// Staged, unregistered Gemini Live (BidiGenerateContent) file-mode
// transcription adapter (#2034). Nothing in production imports this module
// yet; ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
import { createGeminiLiveConvertingSttAdapter, createGeminiLiveSttAdapter } from "./stt.js";

export * from "./config.js";
export {
  GEMINI_LIVE_AUDIO_END_FRAME, GEMINI_LIVE_REFUSED_FIELDS, GEMINI_LIVE_RESPONSE_FORMATS,
  buildGeminiLiveSetupFrame, buildGeminiLiveTranscriptionRequest, extractPcmFrom16kWav, geminiLiveAudioFrames,
} from "./request.js";
export { runGeminiLiveSocket } from "./socket.js";
export {
  GEMINI_LIVE_FFMPEG_CANDIDATES, GEMINI_LIVE_FFMPEG_ENV, GEMINI_LIVE_FFMPEG_MISSING_MESSAGE, GEMINI_LIVE_FFMPEG_REAP_MS,
  GEMINI_LIVE_FFMPEG_STDERR_MAX_BYTES, GEMINI_LIVE_FFMPEG_TIMEOUT_MS, GEMINI_LIVE_UPLOAD_CONTAINERS,
  createGeminiLiveAudioConverter, encodePcm16kWav, geminiLiveFfmpegArgs, sniffGeminiLiveUpload,
} from "./convert.js";
export {
  createGeminiLiveConvertingSttAdapter, createGeminiLiveSttAdapter, geminiLiveAcceptedJob, geminiLiveAuthHeaders,
  geminiLiveHandshakeRefusal,
} from "./stt.js";

/** Default instance: 16 kHz mono 16-bit PCM WAV only; spawns no process. */
export const geminiLiveSttAdapter = createGeminiLiveSttAdapter();
/**
 * The instance registration wires: a `gemini` + gemini-3.5-transcribe-live
 * branch ahead of handleSttCore's format switch, with source upload conversion.
 */
export const geminiLiveConvertingSttAdapter = createGeminiLiveConvertingSttAdapter();
