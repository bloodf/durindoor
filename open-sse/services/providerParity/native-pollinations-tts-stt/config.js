// Pollinations native audio, staged only (#2034).
// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// config/audioRegistry.ts, handlers/audioSpeech.ts, handlers/audioTranscription.ts,
// utils/audioMultipart.ts under open-sse/. See the nested report for restrictions.
export const POLLINATIONS_PROVIDER_ID = "pollinations";
export const POLLINATIONS_ALIASES = Object.freeze(["pollinations", "pol"]);
export const POLLINATIONS_FORMAT = "openai";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const POLLINATIONS_ORIGIN = "https://gen.pollinations.ai";
export const POLLINATIONS_SPEECH_URL = `${POLLINATIONS_ORIGIN}/v1/audio/speech`;
export const POLLINATIONS_TRANSCRIPTION_URL = `${POLLINATIONS_ORIGIN}/v1/audio/transcriptions`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source speech rows (audioRegistry.ts `pollinations` speech entry), in source order. */
export const POLLINATIONS_TTS_MODELS = freezeAll([
  { id: "default", name: "Pollinations TTS (Free)", kind: "tts" },
]);

/**
 * Source transcription rows (audioRegistry.ts `pollinations` transcription entry).
 * `responseFormats` is this fork's conservative subset: the source forwards any
 * response_format. The whisper model keeps verbose_json and timestamp granularities.
 */
export const POLLINATIONS_STT_MODELS = freezeAll([
  { id: "whisper", name: "Pollinations Whisper (Free)", kind: "stt", responseFormats: Object.freeze(["json", "text", "verbose_json"]), timestamps: true },
]);

/** Source default voice (`body.voice || providerConfig.defaultVoice || "alloy"`; pollinations has no defaultVoice). */
export const POLLINATIONS_DEFAULT_VOICE = "alloy";
/** Source default container (normalizeSpeechResponseFormat: missing -> mp3). */
export const POLLINATIONS_DEFAULT_CONTAINER = "mp3";
export const POLLINATIONS_DEFAULT_SPEED = 1.0;

// Gateway bounds. The source sets none; these keep a request from hanging.
export const POLLINATIONS_TTS_TIMEOUT_MS = 120_000;
export const POLLINATIONS_STT_TIMEOUT_MS = 300_000;
export const POLLINATIONS_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const POLLINATIONS_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
export const POLLINATIONS_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const POLLINATIONS_MAX_TTS_REQUEST_BYTES = 256 * 1024;

export const pollinationsTtsModel = (id) => POLLINATIONS_TTS_MODELS.find((model) => model.id === id) ?? null;
export const pollinationsSttModel = (id) => POLLINATIONS_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Audio additions to the existing `pollinations` registry entry. The entry keeps
 * its id, alias, display, apikey auth, chat transport, models and any discovery hooks;
 * registration merges these fields and the model rows into it.
 */
export const POLLINATIONS_AUDIO_DEFINITION = Object.freeze({
  id: POLLINATIONS_PROVIDER_ID,
  alias: "pol",
  category: "free",
  authType: "apikey",
  noAuth: true,
  authModes: Object.freeze(["apikey"]),
  addServiceKinds: Object.freeze(["tts", "stt"]),
  ttsConfig: Object.freeze({ baseUrl: POLLINATIONS_SPEECH_URL, authType: "apikey", authHeader: "bearer", format: POLLINATIONS_FORMAT }),
  sttConfig: Object.freeze({ baseUrl: POLLINATIONS_TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: POLLINATIONS_FORMAT, translationModels: Object.freeze([]) }),
});
