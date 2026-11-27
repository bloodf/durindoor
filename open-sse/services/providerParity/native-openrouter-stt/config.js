// OpenRouter native transcription (STT) metadata, staged and not registered
// (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `openrouter` transcription entry: id
// "openrouter", baseUrl https://openrouter.ai/api/v1/audio/transcriptions,
// authType "apikey", authHeader "bearer", format "openrouter-stt",
// supportedFormats ["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"] and
// eleven models), open-sse/handlers/audioTranscription.ts (the
// `openrouter-stt` branch of handleAudioTranscription) and
// open-sse/handlers/openrouterTranscription.ts (handleOpenRouterTranscription,
// resolveOpenRouterAudioFormat).
//
// DurinDoor's `openrouter` provider (open-sse/providers/registry/openrouter.js)
// has llm, embedding, tts, imageToText, rerank and systemone kinds and no
// `sttConfig`; this module stages only the missing transcription half.

export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OPENROUTER_STT_FORMAT = "openrouter-stt";
/** The only origin the adapter sends the key to. Connection base URLs are ignored. */
export const OPENROUTER_ORIGIN = "https://openrouter.ai";
export const OPENROUTER_TRANSCRIPTION_URL = `${OPENROUTER_ORIGIN}/api/v1/audio/transcriptions`;

/** Source `supportedFormats`: the `input_audio.format` values the endpoint takes. */
export const OPENROUTER_STT_AUDIO_FORMATS = Object.freeze(["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"]);

/** Source transcription rows, in source order. */
export const OPENROUTER_STT_MODELS = Object.freeze([
  { id: "deepgram/nova-3", name: "Deepgram Nova-3" },
  { id: "microsoft/mai-transcribe-1.5", name: "Microsoft MAI-Transcribe 1.5" },
  { id: "nvidia/parakeet-tdt-0.6b-v3", name: "NVIDIA Parakeet TDT 0.6B v3" },
  { id: "mistralai/voxtral-mini-transcribe", name: "Mistral Voxtral Mini Transcribe" },
  { id: "qwen/qwen3-asr-flash-2026-02-10", name: "Qwen3 ASR Flash 2026-02-10" },
  { id: "google/chirp-3", name: "Google Chirp 3" },
  { id: "openai/gpt-4o-mini-transcribe", name: "OpenAI GPT-4o Mini Transcribe" },
  { id: "openai/whisper-large-v3", name: "OpenAI Whisper Large v3" },
  { id: "openai/whisper-large-v3-turbo", name: "OpenAI Whisper Large v3 Turbo" },
  { id: "openai/whisper-1", name: "OpenAI Whisper 1" },
  { id: "openai/gpt-4o-transcribe", name: "OpenAI GPT-4o Transcribe" },
].map((entry) => Object.freeze({ ...entry, kind: "stt" })));

// Gateway bounds. The source sets none; these keep a request from hanging and
// keep the base64 JSON body (4/3 of the audio) within a sane size.
export const OPENROUTER_STT_TIMEOUT_MS = 300_000;
export const OPENROUTER_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const OPENROUTER_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

export const openrouterSttModel = (id) => OPENROUTER_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Staged `sttConfig` for the existing `openrouter` registry entry. No
 * translation route: the source has none for OpenRouter, and an empty
 * `translationModels` plus a non-openai format keeps supportsSttTranslation false.
 */
export const OPENROUTER_STT_CONFIG = Object.freeze({
  baseUrl: OPENROUTER_TRANSCRIPTION_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: OPENROUTER_STT_FORMAT,
  supportedFormats: OPENROUTER_STT_AUDIO_FORMATS,
  translationModels: Object.freeze([]),
});
