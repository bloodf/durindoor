// UC (uncensored.com) native persona WebSocket chat, staged and not
// registered (#1241, #2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/uc.ts (UcExecutor: credential check, scoped JWT, tool
// shim, streaming and buffered OpenAI answers, turn error classification),
// open-sse/executors/uc/constants.ts (socket host, origin, app version, turn
// timeout), open-sse/executors/uc/catalog.ts (the 19 persona models),
// open-sse/executors/uc/protocol.ts (turn assembly and the persona frame),
// open-sse/executors/uc/stream.ts (newline-delimited frame parsing, soft
// errors, token estimate), open-sse/executors/uc/toolDialect.ts (code-style
// and <tool_code> dialects) and open-sse/executors/uc/ws.ts (one socket per
// turn, Origin-only upgrade, `?token=` auth).
//
// Session tokens come only from the staged native-uc-signin session
// controller, which reads the selected connection's providerSpecificData.
// The `uc-direct` provider (api.uncensored.com, metered REST, `uai_` API key)
// is a different backend: nothing here reads an API key, sends a Bearer
// header or falls back to uc-direct.
import { UC_PROVIDER_ALIAS, UC_PROVIDER_DEFINITION, UC_PROVIDER_ID } from "../native-uc-tts/config.js";
import { UC_AUTH_SOURCES, UC_SIGNIN_OPT_IN_ENV, isUcConsumerSignInEnabled } from "../native-uc-signin/config.js";
import { UC_CHAT_MODELS, UC_CHAT_REGISTRY_MODELS } from "./catalog.js";

export const UC_CHAT_PROVIDER_ID = UC_PROVIDER_ID;
export const UC_CHAT_PROVIDER_ALIAS = UC_PROVIDER_ALIAS;

/** Source UC_WS_HOST: the persona inference socket. Connection base URLs are ignored. */
export const UC_WS_HOST = "wss://internal-6.pubyar.com/ws";
/** Source UC_BASE_URL: the nominal registry base URL; never fetched. */
export const UC_CHAT_BASE_URL = "https://internal-6.pubyar.com";
/** Source UC_ORIGIN: the only header on the socket upgrade. */
export const UC_ORIGIN = "https://uncensored.com";
/** Source UC_APP_VERSION carried by every persona frame. */
export const UC_APP_VERSION = "1.0.0-web";
/** Source UC_WS_TIMEOUT_MS, kept as the whole-turn deadline. */
export const UC_WS_TIMEOUT_MS = 120_000;
/** Source UC_TOKEN_REFRESH_SKEW_S (8 s), handed to the session controller. */
export const UC_TOKEN_REFRESH_SKEW_MS = 8_000;

// Gateway bounds. The source has only the total turn timeout.
export const UC_HANDSHAKE_TIMEOUT_MS = 15_000;
/** Longest silence between two socket messages once the frame left. */
export const UC_IDLE_TIMEOUT_MS = 60_000;
export const UC_MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const UC_MAX_TURN_BYTES = 16 * 1024 * 1024;
/** A split frame is held at most this long while its next part arrives. */
export const UC_MAX_CARRY_BYTES = UC_MAX_FRAME_BYTES;

/**
 * Two guards, both required: the operator opt-in shared with the staged
 * sign-in module, and connection metadata written by that module's
 * buildUcConnectionMetadata (an accepted `ucAuthSource` and `ucSignedInAt`).
 */
export const UC_CHAT_OPT_IN_ENV = UC_SIGNIN_OPT_IN_ENV;
export const isUcChatEnabled = isUcConsumerSignInEnabled;
export const UC_CHAT_AUTH_SOURCES = UC_AUTH_SOURCES;

/** Fixed client-facing messages. None quotes a cookie, token, socket URL or upstream body. */
export const UC_CHAT_MESSAGES = Object.freeze({
  disabled: "UC persona chat is not enabled",
  unconfigured: "UC persona chat needs a UC connection signed in through the dashboard (email code or cookie import); API keys are not used",
  unknownModel: "Unsupported UC persona model",
  noMessages: "UC persona chat needs a messages array",
  empty: "No user message to send to UC.",
  mediaUnsupported: "UC persona media input is not supported by this gateway yet; send text only",
  reauth: "UC session ended; sign in again",
  challenge: "UC asked for an interactive check; finish sign-in in the dashboard",
  identity: "UC session does not belong to the selected account",
  socketAuth: "UC refused the persona socket token",
  rateLimited: "UC rate-limited the request",
  mintTimeout: "UC session token request timed out",
  mintFailed: "UC session token request failed",
  connect: "UC persona socket could not connect",
  handshakeTimeout: "UC persona socket did not open in time",
  proxy: "UC persona socket proxy is required but unavailable",
  timeout: "UC persona turn timed out; whether it was counted is unknown",
  idle: "UC persona turn stalled; whether it was counted is unknown",
  closed: "UC persona socket closed before the answer ended",
  tooLarge: "UC persona answer exceeded the size limit",
  sendFailed: "UC persona frame could not be sent",
  emptyResponse: "UC returned an empty response.",
  softError: "UC returned a transient soft-error",
});

/**
 * Provider definition for the serial registration step: the staged TTS
 * definition (shared id, alias, display and credential fields) with the
 * source `llm` kind added. Not imported by any registry here.
 */
export const UC_CHAT_PROVIDER_DEFINITION = Object.freeze({
  ...UC_PROVIDER_DEFINITION,
  serviceKinds: Object.freeze(["llm"]),
  executor: Object.freeze({ module: "open-sse/services/providerParity/native-uc-chat/executor.js", export: "UcChatExecutor", baseUrl: UC_CHAT_BASE_URL }),
  chatModels: UC_CHAT_REGISTRY_MODELS,
  modelIds: Object.freeze(UC_CHAT_MODELS.map((model) => model.id)),
});
