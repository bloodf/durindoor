// Grok CLI (Grok Build OAuth) native speech (TTS) and transcription (STT)
// metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (both `grok-cli` entries: id "grok-cli",
// baseUrl https://api.x.ai/v1/tts with format "grok-tts" and model
// `grok-tts`, and baseUrl https://api.x.ai/v1/stt with format "grok-stt" and
// model `grok-voice-transcribe-2.0`; authType "oauth", authHeader "bearer"),
// open-sse/handlers/audioSpeech.ts (the `grok-tts` branch),
// open-sse/handlers/audioTranscription.ts (the `grok-stt` branch),
// open-sse/handlers/grokMedia.ts (getGrokMediaToken, grokMediaHeaders,
// handleGrokSpeech, handleGrokTranscription) and open-sse/config/grokBuild.ts
// (getGrokBuildClientHeaders, GROK_BUILD_TOKEN_AUTH).
//
// DurinDoor's `grok-cli` provider (open-sse/providers/registry/grok-cli.js) is
// an OAuth device-code chat provider with no media kinds. The `xai` provider
// has `ttsConfig`/`sttConfig` on the same api.x.ai endpoints, but in API-key
// mode only and without the Grok CLI token-auth identity; it is not used here
// and an API key is never substituted for the OAuth token.
import { GROK_CLI_SHELL_USER_AGENT, GROK_CLI_VERSION } from "../../../config/grokCli.js";

export const GROK_CLI_PROVIDER_ID = "grok-cli";
/** Registry aliases of the existing `grok-cli` entry (primary `gb`). */
export const GROK_CLI_ALIASES = Object.freeze(["gb", "gcli", "grok-build"]);
export const GROK_TTS_FORMAT = "grok-tts";
export const GROK_STT_FORMAT = "grok-stt";
/** The only origin either adapter sends the OAuth token to. Connection base URLs are ignored. */
export const GROK_VOICE_ORIGIN = "https://api.x.ai";
export const GROK_SPEECH_URL = `${GROK_VOICE_ORIGIN}/v1/tts`;
export const GROK_TRANSCRIPTION_URL = `${GROK_VOICE_ORIGIN}/v1/stt`;

/** Source `GROK_BUILD_TOKEN_AUTH`, sent as `X-XAI-Token-Auth`. */
export const GROK_TOKEN_AUTH = "xai-grok-cli";
export const GROK_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLIENT_MODE = "headless";

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

/** Source speech row. `grok-tts` is a gateway routing ID; it is never sent upstream. */
export const GROK_TTS_MODELS = freezeAll([{ id: "grok-tts", name: "Grok Text to Speech (OAuth)", kind: "tts" }]);
/** Source transcription row. The ID is sent upstream as the multipart `model` field. */
export const GROK_STT_MODELS = freezeAll([{ id: "grok-voice-transcribe-2.0", name: "Grok Voice Transcribe 2.0 (OAuth)", kind: "stt" }]);

/** Source speech codecs (`speechCodecs`). */
export const GROK_SPEECH_CODECS = Object.freeze(["mp3", "wav", "pcm", "mulaw", "alaw"]);
export const GROK_DEFAULT_VOICE = "eve";
export const GROK_DEFAULT_LANGUAGE = "auto";
export const GROK_DEFAULT_CODEC = "mp3";
/** Source validateGrokSpeechSpeed bounds. */
export const GROK_MIN_SPEED = 0.7;
export const GROK_MAX_SPEED = 1.5;

/** Source transcription response formats. */
export const GROK_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "verbose_json", "text"]);
/** Source native transcription options, forwarded before the file in this order. */
export const GROK_STT_OPTION_FIELDS = Object.freeze([
  "language", "diarize", "multichannel", "channels", "sample_rate", "audio_format", "format", "filler_words",
]);

// Source deadlines (120 s speech, 300 s transcription) plus gateway size bounds.
export const GROK_TTS_TIMEOUT_MS = 120_000;
export const GROK_STT_TIMEOUT_MS = 300_000;
export const GROK_MAX_TTS_REQUEST_BYTES = 256 * 1024;
export const GROK_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const GROK_MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
export const GROK_MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

export const grokTtsModel = (id) => GROK_TTS_MODELS.find((model) => model.id === id) ?? null;
export const grokSttModel = (id) => GROK_STT_MODELS.find((model) => model.id === id) ?? null;

/**
 * Source grokMediaHeaders: the Grok Build client identity, the CLI token-auth
 * marker and the OAuth bearer. The client version and user agent are the
 * fork's pinned Grok CLI identity (open-sse/config/grokCli.js), which the
 * existing `grok-cli` executor already sends; the source default is 1.0.41.
 */
export function grokVoiceHeaders(token) {
  return {
    "x-grok-client-version": GROK_CLI_VERSION,
    "x-grok-client-identifier": GROK_CLIENT_IDENTIFIER,
    "x-grok-client-mode": GROK_CLIENT_MODE,
    "User-Agent": GROK_CLI_SHELL_USER_AGENT,
    "X-XAI-Token-Auth": GROK_TOKEN_AUTH,
    Authorization: `Bearer ${token}`,
  };
}

/** Staged `ttsConfig` for the existing `grok-cli` registry entry. */
export const GROK_CLI_TTS_CONFIG = Object.freeze({
  baseUrl: GROK_SPEECH_URL,
  authType: "oauth",
  authHeader: "bearer",
  format: GROK_TTS_FORMAT,
  supportedFormats: GROK_SPEECH_CODECS,
});

/** Staged `sttConfig`; a non-openai format and no `translationModels` keep translations off. */
export const GROK_CLI_STT_CONFIG = Object.freeze({
  baseUrl: GROK_TRANSCRIPTION_URL,
  authType: "oauth",
  authHeader: "bearer",
  format: GROK_STT_FORMAT,
  translationModels: Object.freeze([]),
});
