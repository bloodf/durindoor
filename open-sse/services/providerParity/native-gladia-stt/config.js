// Gladia native transcription (STT) metadata, staged and not registered
// (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (AUDIO_TRANSCRIPTION_PROVIDERS entry: id
// "gladia", baseUrl https://api.gladia.io/v2/pre-recorded, authType "apikey",
// authHeader "x-gladia-key", async true, format "gladia"; models solaria-1 and
// solaria-mini), open-sse/config/registryUtils.ts (buildAuthHeaders case
// "x-gladia-key" -> `{ "x-gladia-key": token }`),
// open-sse/handlers/audioTranscription.ts (handleGladiaTranscription,
// pollGladiaResultOnce), open-sse/utils/audioMultipart.ts (buildMultipartBody,
// getUploadedFileName) and src/shared/constants/providers/audio.ts (the
// `gladia` display entry).
//
// DurinDoor has no `gladia` provider today; this module stages all of it.

export const GLADIA_PROVIDER_ID = "gladia";
/** Source display alias (audio.ts `alias: "gladia"`): the same as the id. */
export const GLADIA_ALIAS = "gladia";
export const GLADIA_STT_FORMAT = "gladia";
/** Source authHeader: the raw key in a custom header, no scheme. */
export const GLADIA_AUTH_HEADER = "x-gladia-key";

/** The only origin the key is sent to. Connection base URLs are ignored. */
export const GLADIA_API_ORIGIN = "https://api.gladia.io";
/** Source upload URL (hard-coded in handleGladiaTranscription). */
export const GLADIA_UPLOAD_URL = `${GLADIA_API_ORIGIN}/v2/upload`;
/** Source registry baseUrl: the pre-recorded job submit. */
export const GLADIA_PRE_RECORDED_URL = `${GLADIA_API_ORIGIN}/v2/pre-recorded`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source transcription rows, in source order. */
export const GLADIA_STT_MODELS = freezeAll([
  { id: "solaria-1", name: "Solaria 1", kind: "stt" },
  { id: "solaria-mini", name: "Solaria Mini", kind: "stt" },
]);

/** Source poll interval (2 s), polling window (120 s) and per-poll timeout (15 s). */
export const GLADIA_POLL_INTERVAL_MS = 2_000;
export const GLADIA_POLL_WINDOW_MS = 120_000;
export const GLADIA_POLL_CALL_TIMEOUT_MS = 15_000;

// Gateway bounds. The source bounds only the polling.
/** Total deadline: upload, submit and the polling window. */
export const GLADIA_STT_TOTAL_TIMEOUT_MS = 240_000;
/** Ceiling for the upload and the submit. */
export const GLADIA_STT_CALL_TIMEOUT_MS = 60_000;
export const GLADIA_MAX_STT_FILE_BYTES = 100 * 1024 * 1024;
/** A finished poll answer carries the whole result (utterances, words). */
export const GLADIA_MAX_RESULT_BYTES = 16 * 1024 * 1024;
export const GLADIA_MAX_JSON_BYTES = 64 * 1024;
export const GLADIA_MAX_AUDIO_URL_LENGTH = 2_048;

export const gladiaSttModel = (id) => GLADIA_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged provider definition for the serial registration step. Display fields
 * come from the source `gladia` entry in audio.ts; transport is the fixed
 * origin above. API key only; no OAuth or cookie modes exist for Gladia.
 * The source display entry lists `serviceKinds: []`, but its transcription
 * registry entry is reachable from /v1/audio/transcriptions, so the staged
 * entry declares `stt`.
 */
export const GLADIA_PROVIDER_DEFINITION = Object.freeze({
  id: GLADIA_PROVIDER_ID,
  alias: GLADIA_ALIAS,
  aliases: Object.freeze([]),
  display: Object.freeze({
    name: "Gladia",
    icon: "record_voice_over",
    color: "#6425FE",
    textIcon: "GL",
    website: "https://gladia.io",
  }),
  category: "apikey",
  authType: "apikey",
  transport: Object.freeze({ baseUrl: GLADIA_PRE_RECORDED_URL }),
  serviceKinds: Object.freeze(["stt"]),
  sttConfig: Object.freeze({
    baseUrl: GLADIA_PRE_RECORDED_URL, authType: "apikey", authHeader: GLADIA_AUTH_HEADER, async: true, format: GLADIA_STT_FORMAT,
    translationModels: Object.freeze([]),
  }),
});
