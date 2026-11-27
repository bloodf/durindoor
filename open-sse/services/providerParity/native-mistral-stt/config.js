// Mistral native transcription (STT) metadata, staged and not registered
// (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `mistral` transcription entry: id
// "mistral", baseUrl https://api.mistral.ai/v1/audio/transcriptions, authType
// "apikey", authHeader "bearer", no `format` and three models) and
// open-sse/handlers/audioTranscription.ts (handleAudioTranscription: with no
// `format` the entry takes the default OpenAI-compatible multipart branch).
//
// DurinDoor's `mistral` provider (open-sse/providers/registry/mistral.js) has
// llm, imageToText and embedding kinds and no `sttConfig`; this module stages
// only the missing transcription half.

export const MISTRAL_PROVIDER_ID = "mistral";
/** Staged handler key. The source entry has no `format`; see MISTRAL_STT_CONFIG. */
export const MISTRAL_STT_FORMAT = "mistral-stt";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const MISTRAL_ORIGIN = "https://api.mistral.ai";
export const MISTRAL_TRANSCRIPTION_URL = `${MISTRAL_ORIGIN}/v1/audio/transcriptions`;

/** Source transcription rows, in source order (two ids share one display name upstream). */
export const MISTRAL_STT_MODELS = Object.freeze([
  { id: "voxtral-mini-latest", name: "Voxtral Mini Transcribe 2" },
  { id: "voxtral-mini-2602", name: "Voxtral Mini Transcribe 2" },
  { id: "voxtral-mini-transcribe-3", name: "Voxtral Mini Transcribe 3" },
].map((entry) => Object.freeze({ ...entry, kind: "stt" })));

// Gateway bounds. The source sets none. The file cap matches the public STT
// route's 25 MiB upload limit (src/sse/handlers/stt.js).
export const MISTRAL_STT_TIMEOUT_MS = 300_000;
export const MISTRAL_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const MISTRAL_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

export const mistralSttModel = (id) => MISTRAL_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged `sttConfig` for the existing `mistral` registry entry. The wire is the
 * source's OpenAI-style multipart, but the format is not "openai": that value
 * would route through sttCore's generic default (all client fields forwarded,
 * no deadline, no accepted-job) and make supportsSttTranslation true, while
 * the source has no Mistral translation route.
 */
export const MISTRAL_STT_CONFIG = Object.freeze({
  baseUrl: MISTRAL_TRANSCRIPTION_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: MISTRAL_STT_FORMAT,
  translationModels: Object.freeze([]),
});
