import { isObject, isString } from "@/shared/utils/typeChecks.js"; /**
 * Microsoft 365 Copilot SignalR-over-WebSocket frame helpers.
 *
 * These functions are transport-free so tests can pin the wire shape without
 * opening a live Microsoft socket.
 */
export const RECORD_SEPARATOR = String.fromCharCode(0x1e);
export const HANDSHAKE_REQUEST = { protocol: "json", version: 1 };
export const KEEPALIVE_PING = { type: 6 };

export const ALLOWED_MESSAGE_TYPES = [
"Chat",
"Suggestion",
"InternalSearchQuery",
"Disengaged",
"InternalLoaderMessage",
"Progress",
"GeneratedCode",
"RenderCardRequest",
"AdsQuery",
"SemanticSerp",
"GenerateContentQuery"];


export const M365_DEFAULT_OPTION_SETS = [
"search_result_progress_messages_with_search_queries",
"update_textdoc_response_after_streaming",
"deepleo_networking_timeout_10minutes_canmore",
"cwc_flux_image",
"cwc_code_interpreter",
"cwc_code_interpreter_amsfix",
"enable_msa_user",
"cwcgptv",
"flux_v3_gptv_enable_upload_multi_image_in_turn_wo_ch",
"gptvnorm2048",
"pdnascan",
"cwc_code_interpreter_citation_fix",
"code_interpreter_interactive_charts",
"cwc_code_interpreter_interactive_charts_inline_image",
"code_interpreter_matplotlib_patching",
"cwc_fileupload_odb",
"update_memory_plugin",
"add_custom_instructions",
"cwc_flux_v3",
"flux_v3_progress_messages",
"enable_batch_token_processing",
"enable_gg_gpt",
"flux_v3_image_gen_enable_non_watermarked_storage",
"flux_v3_image_gen_enable_story",
"rich_responses"];


export function encodeFrame(obj) {
  return JSON.stringify(obj) + RECORD_SEPARATOR;
}

export function handshakeFrame() {
  return encodeFrame(HANDSHAKE_REQUEST);
}

export function keepaliveFrame() {
  return encodeFrame(KEEPALIVE_PING);
}

export function splitFrames(buffer) {
  const parts = String(buffer).split(RECORD_SEPARATOR);
  const rest = parts.pop() ?? "";
  const frames = parts.filter((p) => p.length > 0);
  return { frames, rest };
}

export function parseFrame(frame) {
  const trimmed = String(frame || "").trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && isObject(parsed) && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function handshakeError(frame) {
  if (!frame) return null;
  return isString(frame.error) && frame.error.length > 0 ? frame.error : null;
}

export function buildChatInvocation(opts) {
  return {
    type: 4,
    target: "chat",
    invocationId: "0",
    arguments: [
    {
      source: "officeweb",
      clientCorrelationId: opts.traceId,
      sessionId: opts.sessionId,
      optionsSets: opts.optionsSets ?? [...M365_DEFAULT_OPTION_SETS],
      streamingMode: "ConciseWithPadding",
      spokenTextMode: "None",
      options: {},
      extraExtensionParameters: {},
      allowedMessageTypes: [...ALLOWED_MESSAGE_TYPES],
      sliceIds: [],
      threadLevelGptId: {},
      traceId: opts.traceId,
      isStartOfSession: opts.isStartOfSession ?? true,
      clientInfo: {},
      message: {
        author: "user",
        inputMethod: "Keyboard",
        text: opts.text,
        messageType: "Chat"
      },
      plugins: [],
      isSbsSupported: false,
      tone: opts.tone ?? "",
      renderReferencesBehindEOS: true,
      disconnectBehavior: ""
    }]

  };
}

export function isUpdateFrame(frame) {
  return !!frame && frame.type === 1 && frame.target === "update";
}

export function isCompletionFrame(frame) {
  return !!frame && frame.type === 3;
}

export function isLastUpdate(frame) {
  if (!isUpdateFrame(frame)) return false;
  const first = Array.isArray(frame.arguments) ? frame.arguments[0] : undefined;
  return first?.isLastUpdate === true;
}

export function extractBotText(frame) {
  if (!isUpdateFrame(frame)) return null;
  const first = Array.isArray(frame.arguments) ? frame.arguments[0] : undefined;
  const messages = first?.messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (message.messageType === "Progress" || message.contentType === "EarlyProgress") continue;
    if (
    (message.author === "bot" || message.author === undefined) && isString(
      message.text) &&
    message.text.length > 0)
    {
      return message.text;
    }
  }
  return null;
}

export function incrementalDelta(previous, next) {
  if (!next) return "";
  if (next === previous) return "";
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

export function extractWriteAtCursor(frame) {
  if (!isUpdateFrame(frame)) return null;
  const first = Array.isArray(frame.arguments) ? frame.arguments[0] : undefined;
  const value = first?.writeAtCursor;
  return isString(value) && value.length > 0 ? value : null;
}

export function extractFinalResultMessage(frame) {
  if (!frame || frame.type !== 2) return null;
  const message = frame.item?.result?.message;
  return isString(message) && message.length > 0 ? message : null;
}

export function accumulateBotContent(previous, frame) {
  const snapshot = extractBotText(frame);
  if (snapshot) return { delta: incrementalDelta(previous, snapshot), next: snapshot };
  const writeAtCursor = extractWriteAtCursor(frame);
  if (writeAtCursor) return { delta: writeAtCursor, next: previous + writeAtCursor };
  return { delta: "", next: previous };
}