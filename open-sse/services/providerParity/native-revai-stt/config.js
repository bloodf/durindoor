// Rev AI native asynchronous transcription (STT) metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (STT entry: id "rev-ai", baseUrl
// https://api.rev.ai/speechtotext/v1, authType "apikey", authHeader "bearer",
// async true, format "rev-ai"; models machine, low_cost, fusion),
// open-sse/handlers/audioTranscription.ts (handleRevAiTranscription),
// open-sse/utils/audioMultipart.ts (buildMultipartBody, getUploadedFileName),
// src/shared/constants/providers/audio.ts (the `rev-ai` display entry, alias
// "revai") and src/lib/providers/validation/audioMiscProviders.ts
// (validateRevAiProvider: GET https://api.rev.ai/speechtotext/v1/jobs?limit=1).
//
// DurinDoor has no `rev-ai` provider today; this module stages all of it.

export const REVAI_PROVIDER_ID = "rev-ai";
/** Source display alias (audio.ts `alias: "revai"`). */
export const REVAI_ALIAS = "revai";
export const REVAI_STT_FORMAT = "rev-ai";

/** The only origin the key is sent to. Connection base URLs are ignored. */
export const REVAI_API_ORIGIN = "https://api.rev.ai";
export const REVAI_BASE_URL = `${REVAI_API_ORIGIN}/speechtotext/v1`;
export const REVAI_JOBS_URL = `${REVAI_BASE_URL}/jobs`;
/** Source validateRevAiProvider probe (GET; 401/403 means a bad key). */
export const REVAI_VALIDATE_URL = `${REVAI_JOBS_URL}?limit=1`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source transcription rows, in source order. The id is sent as `options.transcriber`. */
export const REVAI_STT_MODELS = freezeAll([
  { id: "machine", name: "Reverb ASR", kind: "stt" },
  { id: "low_cost", name: "Low-Cost ASR", kind: "stt" },
  { id: "fusion", name: "Fusion ASR", kind: "stt" },
]);

/** Source poll interval (2 s) and polling ceiling (120 s). */
export const REVAI_POLL_INTERVAL_MS = 2_000;
export const REVAI_POLL_WINDOW_MS = 120_000;

// Gateway bounds. The source sets none besides the poll window.
/** Total deadline: submit, poll window and transcript read. */
export const REVAI_STT_TOTAL_TIMEOUT_MS = 180_000;
/** Ceiling for each single HTTP call (the media submit included). */
export const REVAI_STT_CALL_TIMEOUT_MS = 60_000;
export const REVAI_MAX_STT_FILE_BYTES = 100 * 1024 * 1024;
export const REVAI_MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
export const REVAI_MAX_JSON_BYTES = 64 * 1024;

export const revaiSttModel = (id) => REVAI_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged provider definition for the serial registration step. Display fields
 * come from the source `rev-ai` entry in audio.ts; transport is the fixed
 * origin above. API key only; no OAuth or cookie modes exist for Rev AI.
 */
export const REVAI_PROVIDER_DEFINITION = Object.freeze({
  id: REVAI_PROVIDER_ID,
  alias: REVAI_PROVIDER_ID,
  aliases: Object.freeze([REVAI_ALIAS]),
  uiAlias: REVAI_ALIAS,
  display: Object.freeze({
    name: "Rev AI",
    icon: "record_voice_over",
    color: "#FF5C35",
    textIcon: "RV",
    website: "https://www.rev.ai",
  }),
  category: "apikey",
  authType: "apikey",
  transport: Object.freeze({ baseUrl: REVAI_BASE_URL, validateUrl: REVAI_VALIDATE_URL }),
  serviceKinds: Object.freeze(["stt"]),
  sttConfig: Object.freeze({
    baseUrl: REVAI_BASE_URL, authType: "apikey", authHeader: "bearer", async: true, format: REVAI_STT_FORMAT,
    translationModels: Object.freeze([]),
  }),
});
