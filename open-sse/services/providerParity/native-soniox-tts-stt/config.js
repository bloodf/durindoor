// Soniox native speech (TTS) and transcription (STT) metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (STT entry: id "soniox", baseUrl
// https://api.soniox.com/v1/transcriptions, authType "apikey", authHeader
// "bearer", async true, format "soniox"; TTS entry: id "soniox", baseUrl
// https://tts-rt.soniox.com/tts, authType "apikey", authHeader "bearer",
// format "soniox-tts"), open-sse/handlers/audioSpeech.ts (handleSonioxSpeech,
// resolveSonioxVoice), open-sse/handlers/audioTranscription.ts
// (handleSonioxTranscription, readSonioxOptions, readDiarizationFlag,
// groupSonioxTokensBySpeaker), open-sse/utils/audioMultipart.ts
// (buildMultipartBody, getUploadedFileName),
// src/shared/constants/providers/audio.ts (the `soniox` display entry, alias
// "sx") and src/lib/providers/validation/audioMiscProviders.ts
// (validateSonioxProvider: GET https://api.soniox.com/v1/transcriptions).
//
// DurinDoor has no `soniox` provider today; this module stages all of it.

export const SONIOX_PROVIDER_ID = "soniox";
/** Source display alias (audio.ts `alias: "sx"`). */
export const SONIOX_ALIAS = "sx";
export const SONIOX_STT_FORMAT = "soniox";
export const SONIOX_TTS_FORMAT = "soniox-tts";

/** The only origins the key is sent to. Connection base URLs are ignored. */
export const SONIOX_API_ORIGIN = "https://api.soniox.com";
export const SONIOX_TTS_ORIGIN = "https://tts-rt.soniox.com";
export const SONIOX_FILES_URL = `${SONIOX_API_ORIGIN}/v1/files`;
export const SONIOX_TRANSCRIPTIONS_URL = `${SONIOX_API_ORIGIN}/v1/transcriptions`;
export const SONIOX_TTS_URL = `${SONIOX_TTS_ORIGIN}/tts`;
/** Source validateSonioxProvider probe (GET; 401/403 means a bad key). */
export const SONIOX_VALIDATE_URL = SONIOX_TRANSCRIPTIONS_URL;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source speech rows, in source order. tts-rt-v1 is deprecated upstream and served by v2 (source comment). */
export const SONIOX_TTS_MODELS = freezeAll([
  { id: "tts-rt-v2", name: "Soniox TTS RT v2", kind: "tts" },
  { id: "tts-rt-v1", name: "Soniox TTS RT v1", kind: "tts", deprecated: true },
]);

/** Source transcription rows, in source order. */
export const SONIOX_STT_MODELS = freezeAll([
  { id: "stt-async-v5", name: "Soniox STT Async v5", kind: "stt" },
  { id: "stt-async-v4", name: "Soniox STT Async v4", kind: "stt" },
]);

/** Source defaults (audioSpeech.ts SONIOX_DEFAULT_VOICE / SONIOX_DEFAULT_LANGUAGE). */
export const SONIOX_DEFAULT_VOICE = "Adrian";
export const SONIOX_DEFAULT_LANGUAGE = "en";
export const SONIOX_DEFAULT_CONTAINER = "mp3";
/** Source OPENAI_STOCK_VOICES: not Soniox voices, mapped to the default voice. */
export const SONIOX_OPENAI_STOCK_VOICES = Object.freeze([
  "alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse",
]);

/** Source poll interval (2 s) and polling ceiling (120 s). */
export const SONIOX_POLL_INTERVAL_MS = 2_000;
export const SONIOX_POLL_WINDOW_MS = 120_000;

// Gateway bounds. The source sets none besides the poll window.
export const SONIOX_TTS_TIMEOUT_MS = 120_000;
/** Total STT deadline: upload, create, poll window and transcript read. */
export const SONIOX_STT_TOTAL_TIMEOUT_MS = 240_000;
/** Ceiling for each single STT HTTP call (the upload included). */
export const SONIOX_STT_CALL_TIMEOUT_MS = 60_000;
export const SONIOX_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const SONIOX_MAX_TTS_REQUEST_BYTES = 256 * 1024;
export const SONIOX_MAX_STT_FILE_BYTES = 100 * 1024 * 1024;
export const SONIOX_MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
export const SONIOX_MAX_JSON_BYTES = 64 * 1024;

export const sonioxTtsModel = (id) => SONIOX_TTS_MODELS.find((model) => model.id === id) ?? null;
export const sonioxSttModel = (id) => SONIOX_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged provider definition for the serial registration step. Display fields
 * come from the source `soniox` entry in audio.ts; transport is the fixed
 * origins above. API key only; no OAuth or cookie modes exist for Soniox.
 */
export const SONIOX_PROVIDER_DEFINITION = Object.freeze({
  id: SONIOX_PROVIDER_ID,
  alias: SONIOX_PROVIDER_ID,
  aliases: Object.freeze([SONIOX_ALIAS]),
  uiAlias: SONIOX_ALIAS,
  display: Object.freeze({
    name: "Soniox",
    icon: "mic",
    color: "#5B5BD6",
    textIcon: "SX",
    website: "https://soniox.com",
  }),
  category: "apikey",
  authType: "apikey",
  transport: Object.freeze({ baseUrl: SONIOX_TRANSCRIPTIONS_URL, validateUrl: SONIOX_VALIDATE_URL }),
  serviceKinds: Object.freeze(["tts", "stt"]),
  ttsConfig: Object.freeze({ baseUrl: SONIOX_TTS_URL, authType: "apikey", authHeader: "bearer", format: SONIOX_TTS_FORMAT }),
  sttConfig: Object.freeze({
    baseUrl: SONIOX_TRANSCRIPTIONS_URL, authType: "apikey", authHeader: "bearer", async: true, format: SONIOX_STT_FORMAT,
    translationModels: Object.freeze([]),
  }),
});
