// Kie native speech (TTS) and transcription (STT) metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (both `kie` entries: id "kie", baseUrl
// https://api.kie.ai, authType "apikey", authHeader "bearer", format
// "kie-audio"), open-sse/handlers/audioSpeech.ts (handleKieAudioSpeech,
// pollKieAudioResult, findKieAudioUrl, normalizeKieElevenLabsVoice),
// open-sse/handlers/audioTranscription.ts (handleKieAudioTranscription,
// pollKieTranscriptionResult, normalizeKieTranscriptionText),
// open-sse/executors/kie.ts (POST /api/v1/jobs/createTask, GET
// /api/v1/jobs/recordInfo?taskId=) and open-sse/utils/kieTask.ts
// (normalizeKieTaskState, parseKieResultJson, getKieTaskId).
//
// The existing `kie` provider (open-sse/providers/registry/kie.js) keeps its
// chat transport and API-key connection mode; these kinds use the same
// selected connection's key and nothing else.

export const KIE_PROVIDER_ID = "kie";
export const KIE_AUDIO_FORMAT = "kie-audio";
/** The only origin either adapter sends the key to. Connection base URLs are ignored. */
export const KIE_ORIGIN = "https://api.kie.ai";
export const KIE_CREATE_TASK_URL = `${KIE_ORIGIN}/api/v1/jobs/createTask`;
export const KIE_RECORD_INFO_URL = `${KIE_ORIGIN}/api/v1/jobs/recordInfo`;
/**
 * The source sends `callBackUrl` on every speech task and falls back to a
 * placeholder host when nothing is configured. This gateway polls, so it
 * sends its own non-resolvable placeholder and never a caller-chosen URL.
 */
export const KIE_PLACEHOLDER_CALLBACK_URL = "https://durindoor.invalid/api/kie/callback";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Speech models this subset sends the source's speech-shaped `input` to. */
export const KIE_TTS_MODELS = freezeAll([
  { id: "elevenlabs/text-to-speech-multilingual-v2", name: "ElevenLabs TTS v2", kind: "tts" },
  { id: "elevenlabs/text-to-speech-turbo-2-5", name: "ElevenLabs TTS Turbo 2.5", kind: "tts" },
]);

/** Transcription models this subset submits a file to and reads text back from. */
export const KIE_STT_MODELS = freezeAll([
  { id: "elevenlabs/speech-to-text", name: "ElevenLabs STT", kind: "stt" },
]);

/**
 * Source registry rows that are not supported here, with the reason. Each is
 * refused before submission instead of being sent a body it was not built for.
 */
export const KIE_EXCLUDED_MODELS = Object.freeze({
  "elevenlabs/text-to-dialogue-v3": Object.freeze({
    kind: "tts",
    reason: "the source sends a single-speaker speech input (text and one voice); a dialogue task needs a speaker list the OpenAI speech request cannot express",
  }),
  "elevenlabs/sound-effect-v2": Object.freeze({
    kind: "tts",
    reason: "a sound-effect task is not speech; the source sends voice and stability fields that do not apply and the speech route has no prompt/duration contract for it",
  }),
  "elevenlabs/audio-isolation": Object.freeze({
    kind: "stt",
    reason: "audio isolation returns audio, not a transcript; the source transcription path would answer an empty text",
  }),
});

/** Source voice aliases (normalizeKieElevenLabsVoice); the default is Rachel. */
export const KIE_VOICE_ALIASES = Object.freeze({
  alloy: "Rachel",
  echo: "Adam",
  fable: "Brian",
  onyx: "Antoni",
  nova: "Bella",
  shimmer: "Dorothy",
});
export const KIE_DEFAULT_VOICE = "Rachel";

// Source poll bounds: 2 s interval; 60 s for speech, 120 s for transcription.
export const KIE_POLL_INTERVAL_MS = 2_000;
export const KIE_TTS_TIMEOUT_MS = 60_000;
export const KIE_STT_TIMEOUT_MS = 120_000;
// Gateway bounds for each submit and each status request.
export const KIE_SUBMIT_TIMEOUT_MS = 30_000;
export const KIE_REQUEST_TIMEOUT_MS = 30_000;
export const KIE_MAX_POLL_RETRIES = 5;
export const KIE_MAX_RETRY_DELAY_MS = 30_000;
// Result audio download bounds (no credential is sent).
export const KIE_DOWNLOAD_TIMEOUT_MS = 60_000;
export const KIE_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
// Upload bound for transcription: the decoded file, before base64.
export const KIE_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
// Gateway bound on one serialized speech task body.
export const KIE_MAX_TTS_REQUEST_BYTES = 256 * 1024;

export const kieTtsModel = (id) => KIE_TTS_MODELS.find((model) => model.id === id) ?? null;
export const kieSttModel = (id) => KIE_STT_MODELS.find((model) => model.id === id) ?? null;
