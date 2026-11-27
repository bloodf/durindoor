// SYNTX.ai native chat, staged and not registered (#1234, #2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/syntx.ts (SyntxExecutor shell and flow comment),
// open-sse/executors/syntxExecute.ts (create chat, uploads, generate, SSE
// read, OpenAI JSON/SSE assembly), open-sse/executors/syntxChat.ts (prompt
// flatten, tool catalog, tool-call parse, SSE decode, generate body,
// multipart, stream-URL check), open-sse/services/syntxAuth.ts (Bearer JWT
// resolution and site headers), open-sse/services/syntxSessions.ts
// (chat_uuid continuity), open-sse/services/syntxModels.ts (catalog and
// discovery) and open-sse/config/providers/registry/syntx/index.ts.
//
// The source never calls `/api/v1/chat/completions`. Its flow is
//   POST https://api.syntx.ai/api/v1/chats {title, scope:"text"} -> {uuid}
//   optional POST https://api.syntx.ai/api/v1/chats/upload-files (multipart)
//   POST https://api.syntx.ai/api/v1/llm/generate?ai_name=... -> {stream_url}
//   GET  https://sse.syntx.ai/stream/... (no auth) -> data: {type:"content"} ... usage_final, [DONE]
// The source has no token refresh: the credential is a long-lived site JWT.

export const SYNTX_PROVIDER_ID = "syntx";
export const SYNTX_PROVIDER_ALIAS = "stx";

/** Source SYNTX_API_BASE (syntxAuth.ts). The registry's `/api/v1` base URL is nominal. */
export const SYNTX_API_BASE = "https://api.syntx.ai";
/** Source registry baseUrl, carried only into the provider definition. */
export const SYNTX_REGISTRY_BASE_URL = "https://api.syntx.ai/api/v1";
/** Source SYNTX_SSE_ORIGIN: the only origin a returned stream_url may use. */
export const SYNTX_SSE_ORIGIN = "https://sse.syntx.ai";
export const SYNTX_SITE = "https://syntx.ai/";
export const SYNTX_ORIGIN = "https://syntx.ai";
export const SYNTX_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const SYNTX_CHATS_URL = `${SYNTX_API_BASE}/api/v1/chats`;
export const SYNTX_UPLOAD_URL = `${SYNTX_API_BASE}/api/v1/chats/upload-files`;
export const SYNTX_SETTINGS_URL = `${SYNTX_API_BASE}/api/v1/user/settings`;
export const SYNTX_GENERATE_PATH = `${SYNTX_API_BASE}/api/v1/llm/generate`;
/** Source: an image already on this host is sent as-is, without a re-upload. */
export const SYNTX_UPLOADED_FILE_PREFIX = "https://r2.syntx.ai/";

/** Source SYNTX_REQUEST_TIMEOUT_MS: generate plus SSE may sit silent for minutes. */
export const SYNTX_REQUEST_TIMEOUT_MS = 600_000;
/** Source SYNTX_MAX_GENERATE_CHARS and rollover budgets. */
export const SYNTX_MAX_GENERATE_CHARS = 200_000;
export const SYNTX_ROLLOVER_TRANSCRIPT_CHARS = 150_000;
export const SYNTX_ROLLOVER_TOOL_CHARS = 2_000;
export const SYNTX_ROLLOVER_LAST_USER_CHARS = 20_000;
/** Source SYNTX_ACCOUNT_SYSTEM_PROMPT_MAX_CHARS. */
export const SYNTX_ACCOUNT_SYSTEM_PROMPT_MAX_CHARS = 4000;
/** Source upload cap in uploadSyntxBytes. */
export const SYNTX_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Source CATALOG_TTL_MS. */
export const SYNTX_MODELS_TTL_MS = 10 * 60_000;

// Gateway bounds. The source has only the 600 s request timeout.
/** Longest silence on the SSE body once it opened. */
export const SYNTX_IDLE_TIMEOUT_MS = 300_000;
/** Deadline for each auxiliary call (create chat, settings, upload, model list, image download). */
export const SYNTX_AUX_TIMEOUT_MS = 60_000;
export const SYNTX_MAX_JSON_BYTES = 1024 * 1024;
export const SYNTX_MAX_STREAM_BYTES = 16 * 1024 * 1024;
export const SYNTX_MAX_EVENT_BYTES = 1024 * 1024;
export const SYNTX_MAX_ERROR_BYTES = 8 * 1024;
/** Image parts uploaded per turn; extra parts are dropped. */
export const SYNTX_MAX_IMAGES = 8;
/** Bytes downloaded per remote image (the source upload cap applies after). */
export const SYNTX_MAX_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const SYNTX_MAX_IMAGE_REDIRECTS = 3;

/** Fixed client-facing messages. None quotes a token, stream URL or upstream body. */
export const SYNTX_MESSAGES = Object.freeze({
  unconfigured: "Missing SYNTX JWT — paste the Authorization Bearer token from syntx.ai",
  empty: "SYNTX requires a non-empty user message",
  createFailed: "SYNTX create chat failed",
  auth: "SYNTX rejected the account token; paste a fresh token",
  historyUpload: "SYNTX history file upload failed",
  generateFailed: "SYNTX generate failed",
  generateUncertain: "SYNTX generate request did not complete; whether it was accepted is unknown",
  invalidStreamUrl: "SYNTX generate returned an invalid stream URL",
  streamFailed: "SYNTX stream failed",
  streamError: "SYNTX stream error",
  truncated: "SYNTX stream ended before the answer finished",
  idle: "SYNTX stream stalled",
  timeout: "SYNTX request timed out",
  tooLarge: "SYNTX answer exceeded the size limit",
  aborted: "SYNTX request aborted",
});

/**
 * Provider definition for the serial registration step (source registry
 * syntx/index.ts). Not imported by any registry here. The model rows are in
 * models.js (SYNTX_REGISTRY_MODELS) to keep this file import-free.
 */
export const SYNTX_PROVIDER_DEFINITION = Object.freeze({
  id: SYNTX_PROVIDER_ID,
  alias: SYNTX_PROVIDER_ALIAS,
  name: "SYNTX",
  format: "openai",
  serviceKinds: Object.freeze(["llm"]),
  baseUrl: SYNTX_REGISTRY_BASE_URL,
  authType: "apikey",
  authHeader: "bearer",
  timeoutMs: SYNTX_REQUEST_TIMEOUT_MS,
  passthroughModels: true,
  executor: Object.freeze({ module: "open-sse/services/providerParity/native-syntx-chat-auth/executor.js", export: "SyntxChatExecutor", baseUrl: SYNTX_API_BASE }),
});
