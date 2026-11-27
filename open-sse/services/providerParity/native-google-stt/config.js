// Gemini Live (BidiGenerateContent) file-mode transcription metadata, staged
// and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `gemini` AUDIO_TRANSCRIPTION_PROVIDERS
// entry: baseUrl
// wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent,
// authType "apikey", authHeader "x-goog-api-key", format "gemini-live",
// modelScoped, one model) and open-sse/handlers/audioTranscription.ts
// (handleGeminiLiveTranscription -> open-sse/executors/geminiLiveTranscribe.ts).
//
// The #2034 inventory row `google` (format "gemini-tts", base
// https://generativelanguage.googleapis.com/v1beta/models) is the source's
// AUDIO_SPEECH_PROVIDERS entry (credentialProviderId "gemini"); the source
// AUDIO_TRANSCRIPTION_PROVIDERS map has no `google` key, so
// getTranscriptionProvider("google") returns null there. The only native
// Google AI Studio transcription in the source is this Live entry, keyed
// `gemini`, which is also DurinDoor's canonical provider id.
//
// DurinDoor's `gemini` provider already transcribes over Files+Interactions
// (gemini-3.5-transcribe) and generateContent (format "gemini-stt" in
// sttCore.js), and relays raw Live sessions on /v1/realtime/native (client
// drives setup; the relay authenticates with `?key=`). Neither turns an
// uploaded file into a Live transcript; this module stages only that half.

export const GEMINI_PROVIDER_ID = "gemini";
/** Staged handler key; the source format is "gemini-live". */
export const GEMINI_LIVE_STT_FORMAT = "gemini-live-stt";
export const GEMINI_LIVE_SOURCE_FORMAT = "gemini-live";
export const GEMINI_LIVE_ORIGIN = "wss://generativelanguage.googleapis.com";
/** The only endpoint the adapter sends credentials to. Connection base URLs are ignored. */
export const GEMINI_LIVE_WS_URL =
  `${GEMINI_LIVE_ORIGIN}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`;

export const GEMINI_LIVE_STT_MODEL_ID = "gemini-3.5-transcribe-live";
/** Source rows (modelScoped: only Live-capable models run over BidiGenerateContent). */
export const GEMINI_LIVE_STT_MODELS = Object.freeze([
  Object.freeze({ id: GEMINI_LIVE_STT_MODEL_ID, name: "Gemini 3.5 Transcribe Live", kind: "stt" }),
]);
export const geminiLiveSttModel = (id) => GEMINI_LIVE_STT_MODELS.find((model) => model.id === id) ?? null;

// Source bounds (geminiLiveTranscribe.ts).
/** Upload cap (GEMINI_LIVE_MAX_INPUT_BYTES). */
export const GEMINI_LIVE_MAX_INPUT_BYTES = 25 * 1024 * 1024;
/** Longest clip accepted (GEMINI_LIVE_MAX_AUDIO_SECONDS). */
export const GEMINI_LIVE_MAX_AUDIO_SECONDS = 600;
/** 16 kHz * 2 bytes * mono for the longest clip (GEMINI_LIVE_MAX_PCM_BYTES). */
export const GEMINI_LIVE_MAX_PCM_BYTES = 16_000 * 2 * GEMINI_LIVE_MAX_AUDIO_SECONDS;
/** One session's overall wait (GEMINI_LIVE_MAX_WAIT_MS). */
export const GEMINI_LIVE_TOTAL_TIMEOUT_MS = 120_000;
/** 100 ms of 16 kHz 16-bit mono audio per realtimeInput frame (PCM_CHUNK_BYTES). */
export const GEMINI_LIVE_PCM_CHUNK_BYTES = 3200;
/** Pause the send loop while this much is buffered (WS_BACKPRESSURE_BYTES). */
export const GEMINI_LIVE_BACKPRESSURE_BYTES = 65_536;
/** Wait after audioStreamEnd for a turnComplete (STREAM_END_GRACE_MS). */
export const GEMINI_LIVE_STREAM_END_GRACE_MS = 5_000;
/** Settle delay after turnComplete, to collect trailing transcription frames. */
export const GEMINI_LIVE_TURN_COMPLETE_SETTLE_MS = 250;
export const GEMINI_LIVE_PCM_MIME = "audio/pcm;rate=16000";

// Gateway bounds. The source sets none of these.
export const GEMINI_LIVE_HANDSHAKE_TIMEOUT_MS = 10_000;
/** Time from the setup frame to setupComplete. */
export const GEMINI_LIVE_SETUP_TIMEOUT_MS = 15_000;
export const GEMINI_LIVE_MAX_FRAME_BYTES = 1024 * 1024;
export const GEMINI_LIVE_MAX_TRANSCRIPT_BYTES = 1024 * 1024;
export const GEMINI_LIVE_MAX_TEXT_FIELD = 4096;

/**
 * Staged `sttConfig` addition for the existing `gemini` registry entry: the
 * Live model is dispatched to this adapter by model id ahead of the existing
 * "gemini-stt" branch; the base URL is fixed. No translation route exists in
 * the source.
 */
export const GEMINI_LIVE_STT_CONFIG = Object.freeze({
  baseUrl: GEMINI_LIVE_WS_URL,
  authType: "apikey",
  authHeader: "x-goog-api-key",
  format: GEMINI_LIVE_STT_FORMAT,
  models: GEMINI_LIVE_STT_MODELS,
  translationModels: Object.freeze([]),
});
