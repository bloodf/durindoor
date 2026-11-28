// Deepgram native text-to-speech metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (`deepgram` speech entry: id "deepgram",
// baseUrl https://api.deepgram.com/v1/speak, authType "apikey", authHeader
// "token", format "deepgram", models aura-asteria-en, aura-luna-en,
// aura-stella-en) and open-sse/handlers/audioSpeech.ts (handleDeepgramSpeech:
// model in the `model` query parameter, `Authorization: Token <key>`, JSON body
// `{ text }`, binary audio answer, default content type audio/mpeg).
//
// DurinDoor already has a `deepgram` provider (open-sse/providers/registry/deepgram.js)
// with apikey auth, alias "dg" and serviceKinds ["stt"] only; it has no
// ttsConfig, so the existing FORMAT_HANDLERS.deepgram in
// open-sse/handlers/ttsProviders/genericFormats.js is unreachable. This module
// stages the speech half.

import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const DEEPGRAM_PROVIDER_ID = "deepgram";
export const DEEPGRAM_ALIASES = Object.freeze(["deepgram", "dg"]);
export const DEEPGRAM_FORMAT = "deepgram";
/** The only origin the key is sent to. Connection base URLs are ignored. */
export const DEEPGRAM_ORIGIN = "https://api.deepgram.com";
export const DEEPGRAM_SPEAK_URL = `${DEEPGRAM_ORIGIN}/v1/speak`;
/** Model listing used by the existing dashboard voices route (not in the pinned source). */
export const DEEPGRAM_MODELS_URL = `${DEEPGRAM_ORIGIN}/v1/models`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source speech rows (audioRegistry.ts `deepgram` speech entry), in source order. */
export const DEEPGRAM_TTS_MODELS = freezeAll([
  { id: "aura-asteria-en", name: "Aura Asteria (EN)", kind: "tts" },
  { id: "aura-luna-en", name: "Aura Luna (EN)", kind: "tts" },
  { id: "aura-stella-en", name: "Aura Stella (EN)", kind: "tts" },
]);

/**
 * Deepgram speech model ids are voice ids (`aura-<voice>-<lang>` or
 * `aura-2-<voice>-<lang>`). Ids beyond the three source rows come from
 * discovery; anything not in this shape is refused before submit.
 */
export const DEEPGRAM_TTS_MODEL_PATTERN = /^aura(?:-2)?-[a-z]+-[a-z]{2}$/;
export const isDeepgramTtsModel = (id) => isString(id) && DEEPGRAM_TTS_MODEL_PATTERN.test(id);

/** The source sends no encoding/container parameter; Deepgram's default answer is MP3. */
export const DEEPGRAM_CONTAINER = "mp3";
/** response_format values accepted from a client: mp3 and the gateway's json wrapper (base64 of the same mp3). */
export const DEEPGRAM_SPEECH_RESPONSE_FORMATS = Object.freeze(["mp3", "json"]);

// Gateway bounds. The source sets none.
/** Deepgram's documented per-request text limit for /v1/speak, in characters. */
export const DEEPGRAM_MAX_TEXT_CHARS = 2000;
export const DEEPGRAM_TTS_TIMEOUT_MS = 120_000;
export const DEEPGRAM_DISCOVERY_TIMEOUT_MS = 15_000;
export const DEEPGRAM_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const DEEPGRAM_MAX_DISCOVERY_BYTES = 2 * 1024 * 1024;

/**
 * Speech additions to the existing `deepgram` registry entry. The entry keeps
 * its id, alias, aliases, display, apikey auth, STT transport, models and
 * sttConfig; registration merges these fields and the model rows into it.
 */
export const DEEPGRAM_TTS_DEFINITION = Object.freeze({
  id: DEEPGRAM_PROVIDER_ID,
  alias: DEEPGRAM_PROVIDER_ID,
  aliases: Object.freeze(["dg"]),
  category: "apikey",
  authType: "apikey",
  addServiceKinds: Object.freeze(["tts"]),
  ttsConfig: Object.freeze({ baseUrl: DEEPGRAM_SPEAK_URL, authType: "apikey", authHeader: "token", format: DEEPGRAM_FORMAT }),
});
