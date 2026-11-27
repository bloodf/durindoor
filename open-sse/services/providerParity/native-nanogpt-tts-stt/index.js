// Staged, unregistered NanoGPT native speech (TTS) and transcription (STT)
// adapters (#2034). Nothing in production imports this module yet;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
//
// Two instances per modality: the original subset (nanogptTtsAdapter,
// nanogptSttAdapter) and the documented-format adapters registration uses
// (nanogptDocumentedTtsAdapter adds pcm, nanogptDocumentedSttAdapter adds srt
// and vtt for whisper-1).
import { createNanogptDocumentedSttAdapter, createNanogptSttAdapter } from "./stt.js";
import { createNanogptDocumentedTtsAdapter, createNanogptTtsAdapter } from "./tts.js";

export * from "./config.js";
export { nanogptAcceptedJob } from "./http.js";
export { NANOGPT_PCM_DEFAULTS, checkNanogptPcm } from "./pcm.js";
export { NANOGPT_SUBTITLE_CONTENT_TYPES, NANOGPT_SUBTITLE_FORMATS, validSubtitles } from "./subtitles.js";
export {
  NANOGPT_DOCUMENTED_SPEECH_CONTAINERS, NANOGPT_DOCUMENTED_SPEECH_RESPONSE_FORMATS, NANOGPT_SPEECH_CONTAINERS,
  NANOGPT_SPEECH_RESPONSE_FORMATS, buildNanogptSpeechRequest, createNanogptDocumentedTtsAdapter, createNanogptTtsAdapter,
  matchesContainer, resolveNanogptContainer,
} from "./tts.js";
export {
  NANOGPT_DOCUMENTED_TRANSCRIPTION_RESPONSE_FORMATS, NANOGPT_TRANSCRIPTION_RESPONSE_FORMATS, buildNanogptTranscriptionRequest,
  createNanogptDocumentedSttAdapter, createNanogptSttAdapter, nanogptUploadFileName,
} from "./stt.js";

/** Original-subset instances (pcm, srt and vtt refused). */
export const nanogptTtsAdapter = createNanogptTtsAdapter();
export const nanogptSttAdapter = createNanogptSttAdapter();
/** Documented-format instances: TTS_ADAPTERS under `nanogpt`, and the `nanogpt` branch ahead of handleSttCore's OpenAI default. */
export const nanogptDocumentedTtsAdapter = createNanogptDocumentedTtsAdapter();
export const nanogptDocumentedSttAdapter = createNanogptDocumentedSttAdapter();
