// Fish Audio native text-to-speech metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `fishaudio` speech entry: id
// "fishaudio", baseUrl https://api.fish.audio/v1/tts, authType "apikey",
// authHeader "bearer", format "fishaudio", models s2.1-pro-free, s2.1-pro,
// s2-pro, s1 and the legacy speech-1.6 / speech-1.5),
// open-sse/handlers/audioSpeech.ts (dispatches format "fishaudio" to
// handleFishAudioSpeech), open-sse/executors/fishAudioTts.ts (the payload
// builder and the `provider_options.fishaudio` validation tables) and
// src/app/api/v1/_shared/fishAudioProxy.ts (voice-model discovery at
// GET https://api.fish.audio/model with the same Bearer key).
//
// DurinDoor already registers Fish Audio as `fish-audio` (alias `fish`) in
// open-sse/providers/registry/fish-audio.js, with the same endpoint, Bearer auth
// and `model` header, served by FORMAT_HANDLERS["fish-audio"] in
// open-sse/handlers/ttsProviders/genericFormats.js. That handler always asks for
// mp3, drops every Fish option, has no deadline, follows redirects and quotes
// the upstream error. This module stages the remaining source delta under the
// existing identity; see ./registration.json.

/** Canonical DurinDoor id (existing registry entry). */
export const FISH_AUDIO_PROVIDER_ID = "fish-audio";
/** Existing registry alias. */
export const FISH_AUDIO_ALIASES = Object.freeze(["fish"]);
/** OmniRoute's id and format name; proposed as an extra alias at registration. */
export const FISH_AUDIO_SOURCE_ID = "fishaudio";
/** Local ttsConfig format name (kept; the source calls it "fishaudio"). */
export const FISH_AUDIO_TTS_FORMAT = "fish-audio";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const FISH_AUDIO_ORIGIN = "https://api.fish.audio";
export const FISH_AUDIO_TTS_URL = `${FISH_AUDIO_ORIGIN}/v1/tts`;
export const FISH_AUDIO_VOICES_URL = `${FISH_AUDIO_ORIGIN}/model`;
/** Namespace the source reads provider options from: `provider_options.fishaudio`. */
export const FISH_AUDIO_OPTIONS_KEY = "fishaudio";

/** Source speech rows. The legacy ids are kept by the source for existing clients. */
export const FISH_AUDIO_TTS_MODELS = Object.freeze([
  Object.freeze({ id: "s2.1-pro-free", name: "S2.1 Pro Free", kind: "tts" }),
  Object.freeze({ id: "s2.1-pro", name: "S2.1 Pro", kind: "tts" }),
  Object.freeze({ id: "s2-pro", name: "S2 Pro", kind: "tts" }),
  Object.freeze({ id: "s1", name: "S1", kind: "tts" }),
  Object.freeze({ id: "speech-1.6", name: "Speech 1.6 (legacy)", kind: "tts", legacy: true }),
  Object.freeze({ id: "speech-1.5", name: "Speech 1.5 (legacy)", kind: "tts", legacy: true }),
]);
/** Rows missing from the existing registry entry. */
export const FISH_AUDIO_ADDED_TTS_MODELS = Object.freeze(FISH_AUDIO_TTS_MODELS.filter((model) => model.legacy));
export const FISH_AUDIO_DEFAULT_TTS_MODEL = FISH_AUDIO_TTS_MODELS[0].id;
export const fishAudioTtsModel = (id) => FISH_AUDIO_TTS_MODELS.find((model) => model.id === id) ?? null;

// Source validation tables (fishAudioTts.ts).
export const FISH_AUDIO_FORMATS = Object.freeze(["wav", "pcm", "mp3", "opus"]);
export const FISH_AUDIO_LATENCY = Object.freeze(["low", "normal", "balanced"]);
export const FISH_AUDIO_SAMPLE_RATES = Object.freeze([8000, 16000, 24000, 32000, 44100, 48000]);
export const FISH_AUDIO_MP3_BITRATES = Object.freeze([64, 128, 192]);
export const FISH_AUDIO_OPUS_BITRATES = Object.freeze([-1000, 24000, 32000, 48000, 64000]);

// Gateway bounds. The source sets none; these keep a request from hanging.
export const FISH_AUDIO_TTS_TIMEOUT_MS = 120_000;
export const FISH_AUDIO_VOICES_TIMEOUT_MS = 30_000;
export const FISH_AUDIO_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const FISH_AUDIO_MAX_TTS_REQUEST_BYTES = 256 * 1024;
export const FISH_AUDIO_MAX_VOICES_BYTES = 2 * 1024 * 1024;
export const FISH_AUDIO_MAX_REFERENCE_IDS = 16;
export const FISH_AUDIO_MAX_REFERENCE_ID_LENGTH = 128;

/** Staged speech config for the existing registry entry (same shape as its ttsConfig). */
export const FISH_AUDIO_TTS_CONFIG = Object.freeze({
  baseUrl: FISH_AUDIO_TTS_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: FISH_AUDIO_TTS_FORMAT,
  models: FISH_AUDIO_TTS_MODELS,
});

/**
 * Staged additions to the existing `fish-audio` registry entry. Identity,
 * display, auth mode and serviceKinds stay as they are; the legacy model rows
 * and the OmniRoute id as an alias are added.
 */
export const FISH_AUDIO_TTS_PROVIDER_ADDITIONS = Object.freeze({
  id: FISH_AUDIO_PROVIDER_ID,
  aliases: FISH_AUDIO_ALIASES,
  addAliases: Object.freeze([FISH_AUDIO_SOURCE_ID]),
  authType: "apikey",
  serviceKinds: Object.freeze(["tts"]),
  addModels: FISH_AUDIO_ADDED_TTS_MODELS,
  ttsConfig: FISH_AUDIO_TTS_CONFIG,
});
