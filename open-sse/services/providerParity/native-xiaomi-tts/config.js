// Xiaomi MiMo native text-to-speech metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `xiaomi-mimo` speech entry: id
// "xiaomi-mimo", baseUrl https://api.xiaomimimo.com/v1/chat/completions,
// authType "apikey", authHeader "bearer", format "xiaomi-mimo-tts",
// supportedFormats ["mp3", "wav"], models mimo-v2.5-tts,
// mimo-v2.5-tts-voicedesign, mimo-v2.5-tts-voiceclone) and
// open-sse/handlers/audioSpeech.ts (handleXiaomiMimoSpeech and its
// normalizeXiaomiMimo* / getXiaomiMimoAudioData helpers).
//
// DurinDoor already has a `xiaomi-mimo` chat provider
// (open-sse/providers/registry/xiaomi-mimo.js, aliases mimo / mimo-desktop /
// xmd, auth modes oauth + apikey) with no speech half: no ttsConfig, no tts
// serviceKind, no tts model row, no TTS adapter and no `xiaomi-mimo-tts`
// format handler. This module stages the speech half; see ./registration.json.

export const XIAOMI_MIMO_PROVIDER_ID = "xiaomi-mimo";
/** Existing registry aliases of the chat provider; the speech half shares the connection. */
export const XIAOMI_MIMO_ALIASES = Object.freeze(["mimo", "mimo-desktop", "xmd"]);
/** Existing connection modes; speech works only with the API key mode (see tts.js). */
export const XIAOMI_MIMO_AUTH_MODES = Object.freeze(["oauth", "apikey"]);
export const XIAOMI_MIMO_TTS_FORMAT = "xiaomi-mimo-tts";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const XIAOMI_MIMO_ORIGIN = "https://api.xiaomimimo.com";
export const XIAOMI_MIMO_TTS_URL = `${XIAOMI_MIMO_ORIGIN}/v1/chat/completions`;
/** Source dynamic catalog (#15307): the cloud API's OpenAI-style model list. */
export const XIAOMI_MIMO_MODELS_URL = `${XIAOMI_MIMO_ORIGIN}/v1/models`;
/** Source default when neither the request nor the connection names a voice. */
export const XIAOMI_MIMO_DEFAULT_VOICE = "mimo_default";

/** Source speech rows (also returned by the live catalog). */
export const XIAOMI_MIMO_TTS_MODELS = Object.freeze([
  Object.freeze({ id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", kind: "tts" }),
  Object.freeze({ id: "mimo-v2.5-tts-voicedesign", name: "MiMo V2.5 Voice Design", kind: "tts" }),
  Object.freeze({ id: "mimo-v2.5-tts-voiceclone", name: "MiMo V2.5 Voice Clone", kind: "tts" }),
]);
export const XIAOMI_MIMO_DEFAULT_TTS_MODEL = XIAOMI_MIMO_TTS_MODELS[0].id;
/** A catalog id that names a MiMo speech model (static rows or a newer live one). */
export const XIAOMI_MIMO_TTS_MODEL_PATTERN = /^mimo-v\d+(?:\.\d+)*-tts(?:-[a-z0-9]+)?$/;
/** Source `supportedFormats`; also the `audio.format` enum the upstream accepts. */
export const XIAOMI_MIMO_SPEECH_CONTAINERS = Object.freeze(["mp3", "wav"]);

// Gateway bounds. The source sets none; these keep a request from hanging.
export const XIAOMI_MIMO_TTS_TIMEOUT_MS = 120_000;
export const XIAOMI_MIMO_DISCOVERY_TIMEOUT_MS = 15_000;
export const XIAOMI_MIMO_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const XIAOMI_MIMO_MAX_TTS_REQUEST_BYTES = 256 * 1024;
export const XIAOMI_MIMO_MAX_CATALOG_BYTES = 1024 * 1024;

export const xiaomiMimoTtsModel = (id) => XIAOMI_MIMO_TTS_MODELS.find((model) => model.id === id) ?? null;

/** Staged speech config for the existing registry entry (same shape as other ttsConfig blocks). */
export const XIAOMI_MIMO_TTS_CONFIG = Object.freeze({
  baseUrl: XIAOMI_MIMO_TTS_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: XIAOMI_MIMO_TTS_FORMAT,
  supportedFormats: XIAOMI_MIMO_SPEECH_CONTAINERS,
  defaultVoice: XIAOMI_MIMO_DEFAULT_VOICE,
  models: XIAOMI_MIMO_TTS_MODELS,
});

/**
 * Staged additions to the existing `xiaomi-mimo` registry entry. Identity,
 * display, both auth modes and the chat transports stay as they are; only the
 * speech kind, the speech model rows and the speech config are added.
 */
export const XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS = Object.freeze({
  id: XIAOMI_MIMO_PROVIDER_ID,
  aliases: XIAOMI_MIMO_ALIASES,
  authModes: XIAOMI_MIMO_AUTH_MODES,
  addServiceKinds: Object.freeze(["tts"]),
  addModels: XIAOMI_MIMO_TTS_MODELS,
  ttsConfig: XIAOMI_MIMO_TTS_CONFIG,
});
