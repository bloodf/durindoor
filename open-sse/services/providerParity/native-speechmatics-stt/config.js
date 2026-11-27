// Speechmatics native batch transcription (STT) metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (transcription entry: id "speechmatics",
// baseUrl https://asr.api.speechmatics.com/v2/jobs, authType "apikey",
// authHeader "bearer", async true, format "speechmatics", models
// [{ id: "enhanced", name: "Enhanced" }]),
// open-sse/handlers/audioTranscription.ts (handleSpeechmaticsTranscription,
// pollSpeechmaticsJob, fetchSpeechmaticsTranscript,
// speechmaticsJobErrorMessage, speechmaticsOperatingPoint),
// open-sse/utils/audioMultipart.ts (buildMultipartBody, getUploadedFileName)
// and src/shared/constants/providers/audio.ts (the `speechmatics` display
// entry, alias "sm").
//
// DurinDoor has no `speechmatics` provider today; this module stages all of it.

export const SPEECHMATICS_PROVIDER_ID = "speechmatics";
/** Source display alias (audio.ts `alias: "sm"`). */
export const SPEECHMATICS_ALIAS = "sm";
export const SPEECHMATICS_STT_FORMAT = "speechmatics";

/** The only origin the key is sent to. Connection base URLs are ignored. */
export const SPEECHMATICS_ASR_ORIGIN = "https://asr.api.speechmatics.com";
export const SPEECHMATICS_JOBS_URL = `${SPEECHMATICS_ASR_ORIGIN}/v2/jobs`;

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/**
 * Source transcription rows. The model id is sent unchanged as
 * `transcription_config.operating_point` (source speechmaticsOperatingPoint).
 * The source comment names "standard" and "melia-1" as other operating points,
 * but its catalog lists only "enhanced", so only that is staged.
 */
export const SPEECHMATICS_STT_MODELS = freezeAll([
  { id: "enhanced", name: "Enhanced", kind: "stt", operatingPoint: "enhanced" },
]);

/** Source default when the request names no language: automatic identification. */
export const SPEECHMATICS_AUTO_LANGUAGE = "auto";

/** Source poll interval (2 s) and polling ceiling (120 s). */
export const SPEECHMATICS_POLL_INTERVAL_MS = 2_000;
export const SPEECHMATICS_POLL_WINDOW_MS = 120_000;

// Gateway bounds. The source sets none besides the poll window.
/** Total deadline: submission, poll window and transcript read. */
export const SPEECHMATICS_STT_TOTAL_TIMEOUT_MS = 240_000;
/** Ceiling for each single HTTP call (the submission included). */
export const SPEECHMATICS_STT_CALL_TIMEOUT_MS = 60_000;
export const SPEECHMATICS_MAX_STT_FILE_BYTES = 100 * 1024 * 1024;
export const SPEECHMATICS_MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
export const SPEECHMATICS_MAX_JSON_BYTES = 64 * 1024;

export const speechmaticsSttModel = (id) => SPEECHMATICS_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged provider definition for the serial registration step. Display fields
 * come from the source `speechmatics` entry in audio.ts; transport is the
 * fixed origin above. API key only; the source has no OAuth or cookie mode,
 * no validation probe and no model discovery for Speechmatics.
 */
export const SPEECHMATICS_PROVIDER_DEFINITION = Object.freeze({
  id: SPEECHMATICS_PROVIDER_ID,
  alias: SPEECHMATICS_PROVIDER_ID,
  aliases: Object.freeze([SPEECHMATICS_ALIAS]),
  uiAlias: SPEECHMATICS_ALIAS,
  display: Object.freeze({
    name: "Speechmatics",
    icon: "record_voice_over",
    color: "#0A2540",
    textIcon: "SM",
    website: "https://www.speechmatics.com",
    hasFree: true,
    freeNote: "Free tier — 8 hours/month, no credit card required. Batch (async) mode only.",
  }),
  category: "apikey",
  authType: "apikey",
  transport: Object.freeze({ baseUrl: SPEECHMATICS_JOBS_URL }),
  serviceKinds: Object.freeze(["stt"]),
  sttConfig: Object.freeze({
    baseUrl: SPEECHMATICS_JOBS_URL, authType: "apikey", authHeader: "bearer", async: true, format: SPEECHMATICS_STT_FORMAT,
    translationModels: Object.freeze([]),
  }),
});
