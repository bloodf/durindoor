// Staged native Scribe transcription, ported from OmniRoute (MIT), commit
// 3a17f7e908308a217887a7617c2c793b95ea83c0: open-sse/config/audioRegistry.ts
// and open-sse/handlers/audioTranscription.ts, handleElevenLabsTranscription.
export const ELEVENLABS_PROVIDER_ID = "elevenlabs";
export const ELEVENLABS_TRANSCRIPTION_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const ELEVENLABS_STT_MODELS = Object.freeze([
  Object.freeze({ id: "scribe_v1", name: "ElevenLabs Scribe v1", kind: "stt" }),
  Object.freeze({ id: "scribe_v2", name: "ElevenLabs Scribe v2", kind: "stt" }),
]);
export const ELEVENLABS_STT_CONFIG = Object.freeze({ baseUrl: ELEVENLABS_TRANSCRIPTION_URL, authType: "apikey", authHeader: "xi-api-key", format: "elevenlabs-stt", yieldToBareIds: true, translationModels: Object.freeze([]) });
export const ELEVENLABS_STT_TIMEOUT_MS = 300000;
export const ELEVENLABS_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const ELEVENLABS_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
