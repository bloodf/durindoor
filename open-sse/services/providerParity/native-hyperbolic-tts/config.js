// Hyperbolic native text-to-speech metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `hyperbolic` speech entry: id
// "hyperbolic", baseUrl https://api.hyperbolic.xyz/v1/audio/generation,
// authType "apikey", authHeader "bearer", format "hyperbolic", models
// [{ id: "melo-tts", name: "Melo TTS" }]) and open-sse/handlers/audioSpeech.ts
// (handleHyperbolicSpeech: POST `{ text }` with `Content-Type:
// application/json` and `Authorization: Bearer <key>`, answer `{ audio:
// "<base64>" }` decoded and served as audio/mpeg).
//
// DurinDoor already has a `hyperbolic` chat provider
// (open-sse/providers/registry/hyperbolic.js, alias `hyp`) and a dormant
// `hyperbolic` format handler in open-sse/handlers/ttsProviders/genericFormats.js.
// That handler is unreachable: the registry entry has no ttsConfig, no tts
// serviceKind and no tts model, so synthesizeViaConfig returns null for it.
// This module stages the speech half; see ./registration.json.

export const HYPERBOLIC_PROVIDER_ID = "hyperbolic";
/** Existing registry alias of the chat provider; the speech half shares the connection. */
export const HYPERBOLIC_ALIASES = Object.freeze(["hyp"]);
export const HYPERBOLIC_TTS_FORMAT = "hyperbolic";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const HYPERBOLIC_ORIGIN = "https://api.hyperbolic.xyz";
export const HYPERBOLIC_TTS_URL = `${HYPERBOLIC_ORIGIN}/v1/audio/generation`;

/** Source speech rows (static; the source has no speech model discovery). */
export const HYPERBOLIC_TTS_MODELS = Object.freeze([
  Object.freeze({ id: "melo-tts", name: "Melo TTS", kind: "tts" }),
]);
export const HYPERBOLIC_DEFAULT_TTS_MODEL = HYPERBOLIC_TTS_MODELS[0].id;
/** The source serves the decoded audio as audio/mpeg; the adapter checks mp3 magic bytes. */
export const HYPERBOLIC_SPEECH_CONTAINER = "mp3";

// Gateway bounds. The source sets none; these keep a request from hanging.
export const HYPERBOLIC_TTS_TIMEOUT_MS = 120_000;
export const HYPERBOLIC_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const HYPERBOLIC_MAX_TTS_REQUEST_BYTES = 256 * 1024;

export const hyperbolicTtsModel = (id) => HYPERBOLIC_TTS_MODELS.find((model) => model.id === id) ?? null;

/** Staged speech config for the existing registry entry (same shape as other ttsConfig blocks). */
export const HYPERBOLIC_TTS_CONFIG = Object.freeze({
  baseUrl: HYPERBOLIC_TTS_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: HYPERBOLIC_TTS_FORMAT,
  models: HYPERBOLIC_TTS_MODELS,
});

/**
 * Staged additions to the existing `hyperbolic` registry entry. Identity,
 * display, auth and chat transport stay as they are; only the speech kind,
 * the speech model row and the speech config are added.
 */
export const HYPERBOLIC_TTS_PROVIDER_ADDITIONS = Object.freeze({
  id: HYPERBOLIC_PROVIDER_ID,
  aliases: HYPERBOLIC_ALIASES,
  authType: "apikey",
  addServiceKinds: Object.freeze(["tts"]),
  addModels: HYPERBOLIC_TTS_MODELS,
  ttsConfig: HYPERBOLIC_TTS_CONFIG,
});
