// NanoGPT native speech (TTS) and transcription (STT) metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (both `nanogpt` entries: id "nanogpt",
// baseUrl https://nano-gpt.com/api/v1/audio/speech and
// https://nano-gpt.com/api/v1/audio/transcriptions, authType "apikey",
// authHeader "bearer", no `format`, so both use the OpenAI-compatible default
// branch), open-sse/handlers/audioSpeech.ts (handleAudioSpeech default branch,
// normalizeSpeechResponseFormat), open-sse/handlers/audioTranscription.ts
// (handleAudioTranscription default branch) and open-sse/utils/audioMultipart.ts
// (buildMultipartBody, getUploadedFileName).
//
// DurinDoor already has a `nanogpt` provider (open-sse/providers/registry/nanogpt.js)
// with apikey auth and serviceKinds ["llm"] only; this module stages its audio half.

export const NANOGPT_PROVIDER_ID = "nanogpt";
export const NANOGPT_FORMAT = "openai";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const NANOGPT_ORIGIN = "https://nano-gpt.com";
export const NANOGPT_SPEECH_URL = `${NANOGPT_ORIGIN}/api/v1/audio/speech`;
export const NANOGPT_TRANSCRIPTION_URL = `${NANOGPT_ORIGIN}/api/v1/audio/transcriptions`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source speech rows (audioRegistry.ts `nanogpt` speech entry), in source order. */
export const NANOGPT_TTS_MODELS = freezeAll([
  { id: "tts-1-hd", name: "TTS 1 HD", kind: "tts" },
  { id: "tts-1", name: "TTS 1", kind: "tts" },
]);

/**
 * Source transcription rows (audioRegistry.ts `nanogpt` transcription entry).
 * `responseFormats` is this fork's conservative subset: the source forwards any
 * response_format. Only whisper-1 keeps verbose_json and timestamp granularities.
 */
export const NANOGPT_STT_MODELS = freezeAll([
  { id: "whisper-1", name: "Whisper 1", kind: "stt", responseFormats: Object.freeze(["json", "text", "verbose_json"]), timestamps: true },
  { id: "gpt-4o-transcription", name: "GPT-4o Transcription", kind: "stt", responseFormats: Object.freeze(["json", "text"]), timestamps: false },
]);

/**
 * Transcription rows with every response_format NanoGPT documents for each
 * model, used by createNanogptDocumentedSttAdapter. NanoGPT's public audio model
 * catalog (GET https://nano-gpt.com/api/v1/audio-models?type=stt, row
 * `whisper-1`) lists `supported_parameters.response_formats` json, text,
 * verbose_json, srt, vtt and `timestamp_granularities` segment, word. It has no
 * `gpt-4o-transcription` row (only gpt-4o-mini-transcribe*, json only), so that
 * model keeps the original subset. No row lists diarized_json, and NanoGPT
 * documents diarization only for Elevenlabs-STT on its async /api/transcribe
 * workflow, so diarized_json stays refused for both models.
 */
export const NANOGPT_DOCUMENTED_STT_MODELS = freezeAll([
  { id: "whisper-1", name: "Whisper 1", kind: "stt", responseFormats: Object.freeze(["json", "text", "verbose_json", "srt", "vtt"]), timestamps: true },
  { id: "gpt-4o-transcription", name: "GPT-4o Transcription", kind: "stt", responseFormats: Object.freeze(["json", "text"]), timestamps: false },
]);

/** Source default voice (`body.voice || providerConfig.defaultVoice || "alloy"`; nanogpt has no defaultVoice). */
export const NANOGPT_DEFAULT_VOICE = "alloy";
/** Source default container (normalizeSpeechResponseFormat: missing -> mp3). */
export const NANOGPT_DEFAULT_CONTAINER = "mp3";
export const NANOGPT_DEFAULT_SPEED = 1.0;

// Gateway bounds. The source sets none; these keep a request from hanging.
export const NANOGPT_TTS_TIMEOUT_MS = 120_000;
export const NANOGPT_STT_TIMEOUT_MS = 300_000;
export const NANOGPT_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const NANOGPT_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
export const NANOGPT_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const NANOGPT_MAX_TTS_REQUEST_BYTES = 256 * 1024;

export const nanogptTtsModel = (id) => NANOGPT_TTS_MODELS.find((model) => model.id === id) ?? null;
export const nanogptSttModel = (id) => NANOGPT_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Audio additions to the existing `nanogpt` registry entry. The entry keeps
 * its id, alias, display, apikey auth, chat transport, models and modelsFetcher;
 * registration merges these fields and the model rows into it.
 */
export const NANOGPT_AUDIO_DEFINITION = Object.freeze({
  id: NANOGPT_PROVIDER_ID,
  alias: NANOGPT_PROVIDER_ID,
  category: "apikey",
  authType: "apikey",
  addServiceKinds: Object.freeze(["tts", "stt"]),
  ttsConfig: Object.freeze({ baseUrl: NANOGPT_SPEECH_URL, authType: "apikey", authHeader: "bearer", format: NANOGPT_FORMAT }),
  sttConfig: Object.freeze({ baseUrl: NANOGPT_TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: NANOGPT_FORMAT, translationModels: Object.freeze([]) }),
});
