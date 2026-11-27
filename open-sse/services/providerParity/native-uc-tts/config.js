// UC (uncensored.com) native text-to-speech metadata, staged and not
// registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (AUDIO_SPEECH_PROVIDERS.uc: id "uc",
// baseUrl "wss://tts-stream.chatuncensored.ai", authType "web-cookie",
// authHeader "none", format "uc-tts", models [{ id: "jade" }]),
// open-sse/handlers/audioSpeech.ts (the `uc-tts` branch),
// open-sse/handlers/uc/ucTts.ts (socket URL, start frame, frame parsing),
// open-sse/executors/uc/constants.ts, credentials.ts and clerkAuth.ts (Clerk
// `__session` mint from the durable `__client` cookie), and
// src/shared/constants/providers/web-cookie.ts (the `uc` provider row, alias
// `ucn`). The pinned source has no `uc` entry in AUDIO_TRANSCRIPTION_PROVIDERS,
// so there is no UC speech-to-text to port.
//
// The existing `uc-direct` provider (api.uncensored.com, metered REST, API key)
// is a different backend and stays untouched.

const freezeAll = (list) => Object.freeze(list.map((entry) => Object.freeze({ ...entry })));

export const UC_PROVIDER_ID = "uc";
export const UC_PROVIDER_ALIAS = "ucn";
export const UC_TTS_FORMAT = "uc-tts";

/** Exact pinned source registry fields (AUDIO_SPEECH_PROVIDERS.uc). */
export const UC_TTS_REGISTRY_ENTRY = Object.freeze({
  id: UC_PROVIDER_ID,
  baseUrl: "wss://tts-stream.chatuncensored.ai",
  authType: "web-cookie",
  authHeader: "none",
  format: UC_TTS_FORMAT,
  models: freezeAll([{ id: "jade", name: "UC Voice (Jade)" }]),
});

/** The only socket host. Connection base URLs are ignored. */
export const UC_TTS_WS_HOST = "wss://tts-stream.chatuncensored.ai";
/** Origin the UC web app sends; the only header on the socket upgrade. */
export const UC_ORIGIN = "https://uncensored.com";
/** Clerk Frontend API: the only host the durable cookie is sent to. */
export const UC_CLERK_FAPI = "https://clerk.uncensored.com";
export const UC_CLERK_JS_VERSION = "5.127.1";

export const UC_TTS_MODELS = UC_TTS_REGISTRY_ENTRY.models;
export const UC_TTS_DEFAULT_VOICE = "jade";
/** Start-frame model when none is named (source UC_TTS_DEFAULT_MODEL). */
export const UC_TTS_DEFAULT_MODEL = "default";
/** The source answers audio/mpeg only. */
export const UC_TTS_RESPONSE_FORMATS = Object.freeze(["mp3"]);

/**
 * Provider definition for the serial registration step: the source
 * web-cookie row, plus the tts kind this module adds. Not imported by any
 * registry here.
 */
export const UC_PROVIDER_DEFINITION = Object.freeze({
  id: UC_PROVIDER_ID,
  alias: UC_PROVIDER_ALIAS,
  display: Object.freeze({ name: "UC (uncensored.com)", icon: "auto_awesome", color: "#111827", textIcon: "UC", website: "https://uncensored.com" }),
  category: "webCookie",
  authType: "web-cookie",
  credentialFields: Object.freeze({
    clientCookie: Object.freeze(["ucClientCookie", "clientCookie", "__client"]),
    sid: Object.freeze(["ucSid", "sid"]),
    uid: Object.freeze(["ucUid", "uid"]),
    cookies: Object.freeze(["ucCookies", "cookies"]),
  }),
  serviceKinds: Object.freeze(["tts"]),
  sourceServiceKinds: Object.freeze(["llm"]),
  ttsConfig: Object.freeze({ baseUrl: UC_TTS_WS_HOST, authType: "web-cookie", authHeader: "none", format: UC_TTS_FORMAT, defaultVoice: UC_TTS_DEFAULT_VOICE }),
  models: UC_TTS_MODELS.map((model) => Object.freeze({ ...model, kind: "tts" })),
});

// Source total socket timeout (UC_TTS_WS_TIMEOUT_MS), kept as the whole-call deadline.
export const UC_TTS_TOTAL_TIMEOUT_MS = 120_000;
// Gateway bounds.
export const UC_MINT_TIMEOUT_MS = 15_000;
export const UC_HANDSHAKE_TIMEOUT_MS = 15_000;
export const UC_IDLE_TIMEOUT_MS = 30_000;
export const UC_MAX_MINT_BYTES = 16 * 1024;
export const UC_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const UC_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const UC_MAX_INPUT_CHARS = 4096;
export const UC_MAX_JWT_LENGTH = 8192;

export const ucTtsModel = (id) => UC_TTS_MODELS.find((model) => model.id === id) ?? null;
