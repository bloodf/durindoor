// deAPI native speech (TTS) and transcription (STT) metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (both `deapi` entries: id "deapi", baseUrl
// https://oai.deapi.ai/v1/audio/speech and
// https://oai.deapi.ai/v1/audio/transcriptions, authType "apikey", authHeader
// "bearer", format "openai"; speech supportedFormats ["mp3"]),
// open-sse/handlers/audioSpeech.ts (OpenAI-compatible default branch of
// handleAudioSpeech), open-sse/handlers/audioTranscription.ts
// (OpenAI-compatible default branch of handleAudioTranscription),
// open-sse/utils/audioMultipart.ts (buildMultipartBody, getUploadedFileName)
// and src/shared/constants/providers/apikey/specialty-media.ts (the `deapi`
// display entry).
//
// DurinDoor has no `deapi` provider today; this module stages its audio half.

export const DEAPI_PROVIDER_ID = "deapi";
export const DEAPI_FORMAT = "openai";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const DEAPI_ORIGIN = "https://oai.deapi.ai";
export const DEAPI_SPEECH_URL = `${DEAPI_ORIGIN}/v1/audio/speech`;
export const DEAPI_TRANSCRIPTION_URL = `${DEAPI_ORIGIN}/v1/audio/transcriptions`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source speech rows. The voice-design model needs `instructions`. */
export const DEAPI_TTS_MODELS = freezeAll([
  { id: "Kokoro", name: "Kokoro (deAPI)", kind: "tts" },
  { id: "Chatterbox", name: "Chatterbox (deAPI)", kind: "tts" },
  { id: "Qwen3_TTS_12Hz_1_7B_CustomVoice", name: "Qwen3 TTS 1.7B (deAPI)", kind: "tts" },
  { id: "Qwen3_TTS_12Hz_1_7B_VoiceDesign", name: "Qwen3 TTS Voice Design (deAPI)", kind: "tts", requiresInstructions: true },
]);

/** Source transcription rows. Only the CT2 build has word timestamps and diarized_json (source comment). */
export const DEAPI_STT_MODELS = freezeAll([
  { id: "WhisperLargeV3Ct2", name: "Whisper Large v3 CT2 (deAPI)", kind: "stt", wordTimestamps: true, diarizedJson: true },
  { id: "WhisperLargeV3", name: "Whisper Large v3 (deAPI)", kind: "stt", wordTimestamps: false, diarizedJson: false },
]);

/** Source default voice: deAPI maps the OpenAI stock voices onto each model's own voices. */
export const DEAPI_DEFAULT_VOICE = "alloy";
/** Source speech `supportedFormats`. */
export const DEAPI_SPEECH_CONTAINER = "mp3";
export const DEAPI_DEFAULT_SPEED = 1.0;

// Gateway bounds. The source sets none; these keep a request from hanging.
export const DEAPI_TTS_TIMEOUT_MS = 120_000;
export const DEAPI_STT_TIMEOUT_MS = 300_000;
export const DEAPI_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const DEAPI_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
export const DEAPI_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const DEAPI_MAX_TTS_REQUEST_BYTES = 256 * 1024;

export const deapiTtsModel = (id) => DEAPI_TTS_MODELS.find((model) => model.id === id) ?? null;
export const deapiSttModel = (id) => DEAPI_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged provider definition for the serial registration step. Display fields
 * come from the source `deapi` entry; transport is the fixed gateway origin.
 * No validateUrl: the source has none for deAPI and no free probe is known.
 */
export const DEAPI_PROVIDER_DEFINITION = Object.freeze({
  id: DEAPI_PROVIDER_ID,
  alias: DEAPI_PROVIDER_ID,
  display: Object.freeze({
    name: "deAPI",
    icon: "image",
    color: "#18181B",
    textIcon: "DE",
    website: "https://deapi.ai",
  }),
  category: "apikey",
  authType: "apikey",
  serviceKinds: Object.freeze(["tts", "stt"]),
  ttsConfig: Object.freeze({ baseUrl: DEAPI_SPEECH_URL, authType: "apikey", authHeader: "bearer", format: DEAPI_FORMAT }),
  sttConfig: Object.freeze({ baseUrl: DEAPI_TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: DEAPI_FORMAT, translationModels: Object.freeze([]) }),
});
