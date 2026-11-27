// Staged, unregistered UC (uncensored.com) native persona WebSocket chat
// (#1241, #2034). Nothing in production imports this module;
// ./registration.json describes the serial registration step. Source
// attribution is in ./config.js.
export * from "./config.js";
export { UC_CHAT_MODELS, UC_CHAT_REGISTRY_MODELS, UC_DEFAULT_CONTEXT, resolveUcChatModel, ucContextWindow } from "./catalog.js";
export {
  UC_HISTORY_ROLES, UC_IDENTITY_STEER, UC_PART_TYPE, UC_TOOL_RESULT_PREFIX, UC_TURN_DIVIDER,
  assembleUcTurn, buildPersonaFrame, currentTurnHasMedia, ucContentToText,
} from "./protocol.js";
export { UC_FRAME_TYPES, UC_SOFT_ERROR_PATTERNS, UC_TOP_LEVEL_ERROR_CODES, UcFrameParser, detectUcSoftError, estimateUcTokens } from "./stream.js";
export {
  UC_CODESTYLE_HEADER, UC_CODESTYLE_MODELS, UC_REFUSAL_PATTERNS, applyCodestylePreamble, injectExtraDialectCalls,
  parseCodestyleCalls, parseToolcodeCalls, parseUcExtraDialects, ucLooksLikeRefusal, ucUsesCodestyle,
} from "./toolDialect.js";
export { __setUcChatWebSocketForTesting, buildUcWsUrl, runUcTurn } from "./ws.js";
export { UcChatExecutor, classifyUcTurnError, createUcChatExecutor, resolveUcChatCredential } from "./executor.js";

export { UcAttachmentChatExecutor, createUcAttachmentChatExecutor } from "./attachmentExecutor.js";
