// Vertex AI Gemini speech (TTS) and transcription (STT) metadata, staged and
// unregistered. Nothing in production imports this directory yet; see
// ./registration.json for the serial registration step.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts, the two `vertex` entries:
// - AUDIO_TRANSCRIPTION_PROVIDERS.vertex: baseUrl
//   https://us-central1-aiplatform.googleapis.com/v1, authType "apikey",
//   authHeader "bearer", format "vertex-gemini", three models;
// - AUDIO_SPEECH_PROVIDERS.vertex: same baseUrl/auth, format
//   "vertex-gemini-tts", five models.
// The model ids and names below are the source's, in its order.

/** Canonical provider id; `vx` is the existing local alias (providers/registry/vertex.js). */
export const VERTEX_AUDIO_PROVIDER_ID = "vertex";
export const VERTEX_AUDIO_PROVIDER_ALIASES = Object.freeze(["vx"]);

/** The source registry's base URL (us-central1 regional host). */
export const VERTEX_AUDIO_SOURCE_BASE_URL = "https://us-central1-aiplatform.googleapis.com/v1";
export const VERTEX_AUDIO_DEFAULT_LOCATION = "us-central1";

export const VERTEX_TTS_FORMAT = "vertex-gemini-tts";
export const VERTEX_STT_FORMAT = "vertex-gemini";

export const VERTEX_TTS_MODELS = Object.freeze([
  { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS (Vertex)", kind: "tts" },
  { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS (Vertex)", kind: "tts" },
  { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS (Vertex)", kind: "tts" },
  { id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS (Vertex)", kind: "tts" },
  { id: "gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash-Lite TTS (Vertex)", kind: "tts" },
].map(Object.freeze));

export const VERTEX_STT_MODELS = Object.freeze([
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (Vertex Transcribe)", kind: "stt" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Vertex Transcribe)", kind: "stt" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (Vertex Transcribe)", kind: "stt" },
].map(Object.freeze));

export const VERTEX_TTS_MODEL_IDS = Object.freeze(VERTEX_TTS_MODELS.map((m) => m.id));
export const VERTEX_STT_MODEL_IDS = Object.freeze(VERTEX_STT_MODELS.map((m) => m.id));

/** Source default voice (vertexGenerateSpeech: `voiceName ?? "Kore"`). */
export const VERTEX_TTS_DEFAULT_VOICE = "Kore";

/**
 * Response formats this adapter can honor without re-encoding. The source
 * returns WAV for anything but `pcm`; mp3/opus/aac/flac are refused here
 * instead of being answered with WAV under another name. `json` is the local
 * core's base64 wrapper around the WAV bytes.
 */
export const VERTEX_TTS_RESPONSE_FORMATS = Object.freeze(["wav", "pcm", "json"]);
/** STT answers: `{ text }` JSON or plain text. No timestamps or segments exist. */
export const VERTEX_STT_RESPONSE_FORMATS = Object.freeze(["json", "text"]);

// Gateway bounds, not documented Vertex limits.
export const VERTEX_TTS_MAX_INPUT_CHARS = 32_000;
export const VERTEX_TTS_MAX_STYLE_CHARS = 4_000;
export const VERTEX_STT_MAX_PROMPT_CHARS = 4_000;
/** Raw upload bound, so the base64 inline body stays under Vertex's 20 MB inline request limit. */
export const VERTEX_STT_MAX_AUDIO_BYTES = 14 * 1024 * 1024;
export const VERTEX_TTS_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
export const VERTEX_STT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const VERTEX_AUDIO_REQUEST_TIMEOUT_MS = 120_000;
export const VERTEX_AUDIO_TOKEN_TIMEOUT_MS = 15_000;

/** Audio MIME types the STT body may name (Vertex Gemini audio input types). */
export const VERTEX_STT_AUDIO_MIME_TYPES = Object.freeze([
  "audio/wav", "audio/mpeg", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg",
  "audio/flac", "audio/webm", "audio/mp4", "audio/m4a", "audio/pcm",
]);

/**
 * Registry-shaped metadata for the existing `vertex` provider, in the shape
 * open-sse/providers/registry/*.js uses for `ttsConfig` / `sttConfig`.
 * Registration merges these into providers/registry/vertex.js and adds "tts"
 * and "stt" to its serviceKinds; this module never edits the registry.
 */
export const VERTEX_TTS_CONFIG = Object.freeze({
  baseUrl: VERTEX_AUDIO_SOURCE_BASE_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: VERTEX_TTS_FORMAT,
  defaultModel: VERTEX_TTS_MODEL_IDS[0],
  defaultVoice: VERTEX_TTS_DEFAULT_VOICE,
  models: VERTEX_TTS_MODELS,
});

export const VERTEX_STT_CONFIG = Object.freeze({
  baseUrl: VERTEX_AUDIO_SOURCE_BASE_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: VERTEX_STT_FORMAT,
  models: VERTEX_STT_MODELS,
});

/** Static discovery: the source lists these models and has no live list call. */
export function listVertexAudioModels(kind) {
  if (kind === "tts") return VERTEX_TTS_MODELS.map((m) => ({ ...m }));
  if (kind === "stt") return VERTEX_STT_MODELS.map((m) => ({ ...m }));
  return [];
}
