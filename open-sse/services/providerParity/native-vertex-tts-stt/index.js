// Vertex AI Gemini TTS/STT parity staging (OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad,
// open-sse/config/audioRegistry.ts `vertex` entries). Private and unregistered:
// see ./registration.json for the exports and the serial registration points.
export * from "./config.js";
export { resolveVertexAudioAuth, vertexGenerateContentRequest, vertexLocationOrigin, VERTEX_GLOBAL_ORIGIN } from "./auth.js";
export { sendVertexGenerateContent, vertexAudioAcceptedJob } from "./request.js";
export {
  buildVertexSpeechRequest, createVertexTtsAdapter, listVertexTtsVoices, normalizeVertexAudio, vertexUsageAccounting,
  default as vertexTtsAdapter,
} from "./speech.js";
export {
  buildVertexTranscriptionRequest, createVertexSttTranscriber, extractVertexTranscript, resolveVertexAudioMime, transcribeVertex,
} from "./transcription.js";
