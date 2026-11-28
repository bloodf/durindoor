// HuggingFace native text-to-speech metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `huggingface` speech entry: id
// "huggingface", baseUrl https://router.huggingface.co/hf-inference/models,
// authType "apikey", authHeader "bearer", format "huggingface-tts", models
// canopylabs/orpheus-3b-0.1-ft, ResembleAI/chatterbox, hexgrad/Kokoro-82M) and
// open-sse/handlers/audioSpeech.ts (handleHuggingFaceTtsSpeech: POST
// `${baseUrl}/${modelId}` with the Hub id's slash kept as a path separator,
// `Content-Type: application/json` and `Authorization: Bearer <key>`, body
// `{ inputs: input }`, binary audio answer passed through, audio/wav when the
// answer names no content type).
//
// DurinDoor already has a `huggingface` provider
// (open-sse/providers/registry/huggingface.js, alias `hf`) serving image and
// STT on the same router and the same API key, and a dormant
// `huggingface-tts` format handler in open-sse/handlers/ttsProviders/genericFormats.js.
// That handler is unreachable: the registry entry hides the tts kind
// (`hiddenKinds: ["tts"]`), has no ttsConfig and no tts model, so
// synthesizeViaConfig returns null. It also URL-encodes the Hub id
// (`hexgrad%2FKokoro-82M`), which is not the source's wire path. This module
// stages the speech half; see ./registration.json.

import { isString } from "../../../../src/shared/utils/typeChecks.js";

export const HUGGINGFACE_PROVIDER_ID = "huggingface";
/** Existing registry alias; the speech half shares the connection. */
export const HUGGINGFACE_ALIASES = Object.freeze(["hf"]);
export const HUGGINGFACE_TTS_FORMAT = "huggingface-tts";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const HUGGINGFACE_ROUTER_ORIGIN = "https://router.huggingface.co";
/** Source baseUrl: the router with the hf-inference provider pinned in the path. */
export const HUGGINGFACE_TTS_BASE_URL = `${HUGGINGFACE_ROUTER_ORIGIN}/hf-inference/models`;

/** Source speech rows. Any other well-formed Hub id is also sent, as the source does. */
export const HUGGINGFACE_TTS_MODELS = Object.freeze([
  Object.freeze({ id: "canopylabs/orpheus-3b-0.1-ft", name: "Orpheus 3B", kind: "tts" }),
  Object.freeze({ id: "ResembleAI/chatterbox", name: "Chatterbox", kind: "tts" }),
  Object.freeze({ id: "hexgrad/Kokoro-82M", name: "Kokoro TTS", kind: "tts" }),
]);
export const HUGGINGFACE_DEFAULT_TTS_MODEL = HUGGINGFACE_TTS_MODELS[0].id;

/**
 * A Hub model id: exactly `owner/name`, each segment starting with a letter or
 * digit and made of letters, digits, `.`, `_` or `-`, no `..`. A third segment
 * would be a voice suffix, which the source never sends.
 */
export const HUGGINGFACE_HUB_ID = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/;
export const isHuggingFaceHubId = (id) => isString(id) && HUGGINGFACE_HUB_ID.test(id) && !id.includes("..");

/** The router URL for one Hub id; the slash stays a path separator (source wire shape). */
export function huggingfaceTtsUrl(modelId) {
  if (!isHuggingFaceHubId(modelId)) throw new Error("Invalid HuggingFace model ID");
  return `${HUGGINGFACE_TTS_BASE_URL}/${modelId}`;
}

// Gateway bounds. The source sets none; these keep a request from hanging.
export const HUGGINGFACE_TTS_TIMEOUT_MS = 120_000;
export const HUGGINGFACE_MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const HUGGINGFACE_MAX_TTS_REQUEST_BYTES = 256 * 1024;

export const huggingfaceTtsModel = (id) => HUGGINGFACE_TTS_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged Hub discovery for the tts kind, same shape as the existing image and
 * stt `modelsFetchers` rows (only the hf-inference provider, text-to-speech
 * pipeline). The source has no speech discovery; this follows the local
 * per-kind convention.
 */
export const HUGGINGFACE_TTS_MODELS_FETCHER = Object.freeze({
  url: "https://huggingface.co/api/models?inference_provider=hf-inference&pipeline_tag=text-to-speech&limit=30",
  type: "huggingface-tts",
});

/**
 * Suggested-models filter for HUGGINGFACE_TTS_MODELS_FETCHER: well-formed Hub
 * ids only, most downloaded first (same rule as the `huggingface-stt` filter).
 */
export function huggingfaceTtsSuggestions(models) {
  return (Array.isArray(models) ? models : [])
    .filter((m) => isHuggingFaceHubId(m?.id))
    .sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0) || (Number(b.likes) || 0) - (Number(a.likes) || 0))
    .map((m) => ({ id: m.id, name: isString(m.name) && m.name ? m.name : m.id }));
}

/** Staged speech config for the existing registry entry (same shape as other ttsConfig blocks). */
export const HUGGINGFACE_TTS_CONFIG = Object.freeze({
  baseUrl: HUGGINGFACE_TTS_BASE_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: HUGGINGFACE_TTS_FORMAT,
  models: HUGGINGFACE_TTS_MODELS,
});

/**
 * Staged additions to the existing `huggingface` registry entry. Identity,
 * display, auth, image and stt stay as they are; the tts kind is unhidden and
 * the speech model rows, speech config and tts discovery are added.
 */
export const HUGGINGFACE_TTS_PROVIDER_ADDITIONS = Object.freeze({
  id: HUGGINGFACE_PROVIDER_ID,
  aliases: HUGGINGFACE_ALIASES,
  authType: "apikey",
  addServiceKinds: Object.freeze(["tts"]),
  removeHiddenKinds: Object.freeze(["tts"]),
  addModels: HUGGINGFACE_TTS_MODELS,
  ttsConfig: HUGGINGFACE_TTS_CONFIG,
  modelsFetchers: Object.freeze({ tts: HUGGINGFACE_TTS_MODELS_FETCHER }),
});
