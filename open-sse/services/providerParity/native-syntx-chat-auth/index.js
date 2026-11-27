// Staged, unregistered SYNTX.ai native chat with Bearer JWT auth (#1234,
// #2034). Nothing in production imports this module; ./registration.json
// describes the serial registration step. Source attribution is in ./config.js.
export * from "./config.js";
export {
  SYNTX_DEFAULT_MODEL, SYNTX_FALLBACK_MODELS, SYNTX_MODELS_URL, SYNTX_REGISTRY_MODELS, createSyntxModelCatalog,
  inferSyntxAiName, mapSyntxModel, parseSyntxModelsCatalog, stripSyntxModelPrefix,
} from "./models.js";
export {
  connectionFingerprint, extractSyntxTokenFromUnknown, looksLikeJwt, resolveSyntxToken, stripBearerPrefix, syntxAuthHeaders, syntxSecrets,
} from "./auth.js";
export {
  SYNTX_CHAT_MESSAGE_LIMIT, SYNTX_CHAT_ROLLOVER_TURNS, canonicalizeSyntxUserText, createSyntxSessionStore, extractSyntxMessageText,
  hashSyntxConversation, isSyntxFollowUpHistory, looksLikeClaudeCodeSessionReset, stripClaudeCodeLocalCommandEnvelope,
  syntxMessagesForNewSession,
} from "./sessions.js";
export {
  SYNTX_FILE_COMPACT_PROMPT, SYNTX_NATIVE_TOOLS, SYNTX_TOOL_INSTRUCTIONS, buildSyntxFollowUpDelta, buildSyntxGenerateBody,
  buildSyntxGenerateText, buildSyntxThreadRolloverText, capSyntxGenerateText, chatTitleFromText, applySyntxSseFrame,
  encodeSyntxUploadMultipart, extractSyntxSseEvent, flattenSyntxMessages, formatSyntxToolDefs, isSyntxStreamUrl,
  listSyntxToolNames, looksLikeSyntxRefusal, normalizeSyntxRequestMessages, parseSyntxToolCalls, syntxToolCatalogFingerprint,
  trailingSyntxToolResults, wantSyntxThinking,
} from "./chat.js";
export { collectSyntxImageSources, decodeDataUrl, isDataImageUrl } from "./images.js";
export { SyntxTransportError, assertSafeImageUrl, fetchGuardedImage, readSyntxSse } from "./transport.js";
export { SyntxChatExecutor, createSyntxChatExecutor, isSyntxFileUrl } from "./executor.js";
