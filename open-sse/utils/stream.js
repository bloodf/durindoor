import { antigravityGeminiResponse } from "./antigravityGeminiNative.js";
import { hasResponsesSnapshotOutput } from "./emptyStreamTerminal.js";
import { translateResponse, initState } from "../translator/index.js";
import { formatClaudeSseError, parseSseFrame } from "./sseFrames.js";
import { FORMATS, GEMINI_FAMILY_FORMATS } from "../translator/formats.js";
import { appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, refreshProvisionalOutput, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, enrichUsageCost, COLORS } from "./usageTracking.js";
import { attachTokensPerSecond } from "./generationThroughput.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE, ensureStreamToolCallIds } from "./streamHelpers.js";
import { PROVIDERS } from "../config/providers.js";
import { CLAUDE_BLOCK } from "../translator/schema/index.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, isOpenAIResponsesLifecycleTerminal, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { createResponsesSequenceReplayTracker } from "./responsesSequenceReplay.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { createThinkTagStreamExtractor } from "./thinkStripper.js";
import { resolveInlineThinkingFormat } from "./inlineThinking.js";
import { INLINE_THINKING_FORMATS } from "../providers/schema.js";
import { appendReasoningText, extractReasoningText } from "../translator/concerns/reasoning.js";
import { decloakToolName } from "./claudeCloaking.js";
import { restoreOpenAIToolNames } from "../translator/concerns/toolCall.js";
import { CLAUDE_STOP, OPENAI_FINISH } from "../translator/schema/finishReasons.js";
import { normalizeOpenAIFinish } from "../translator/concerns/finishReason.js";
import { choiceHasOutput, classifyMaskedGatewayError, createUpstreamTerminalTracker } from "./streamTerminal.js";
import { normalizeArrayContentChunk } from "./arrayContentDelta.js";
import { advancePendingSseLineBytes, MAX_PENDING_SSE_LINE_BYTES } from "./pendingSseLine.js";
import { isProviderKeepaliveEvent } from "./providerKeepalive.js";
import {
  createMinimaxThinkingStreamState,
  flushMinimaxThinkingStreamState,
  isMinimaxThinkingProvider,
  sanitizeMinimaxDelta,
  shouldOmitStreamReasoning,
  stripClientReasoningDelta } from
"./minimaxThinkingStream.js";

import { SSE_COMMENT_KEEPALIVE, SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";
import { isBoolean, isNumber, isObject, isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { extractStreamErrorPayload } from "./streamLifecycle.js";
import { credentialErrorSecrets, sanitizeErrorMessageWithSecrets, sanitizeStructuredErrorBody } from "./error.js";

export { COLORS, formatSSE };
export { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate", // Full translation between formats
  PASSTHROUGH: "passthrough" // No translation, normalize output, extract usage
};
const GEMINI_PASSTHROUGH_PROVIDERS = new Set(["antigravity", "agy", "gemini", "gemini-cli", "gc", "vertex"]);
// Bound finish_reason -> real usage deferral when the upstream never sends a
// usage trailer or [DONE]. This is not a general stream inactivity timeout.
const PENDING_COMPLETION_FLUSH_MS = 3000;

// This transform forwards line by line (it also carries NDJSON), so it reads
// each line's fields with the shared parser instead of waiting for whole frames.
/** Trimmed value of a line's `data:` field, or null for any other line. */
function sseLineData(line) {
  const { hasData, data } = parseSseFrame(line);
  // A bare `data` line (no colon) is forwarded untouched.
  return hasData && line !== "data" ? data.trim() : null;
}

const sseLineEvent = (line) => parseSseFrame(line).eventName?.trim() || null;

/** Forwarded `data:x` lines are written as `data: x`. */
const spaceDataField = (line) => line.replace(/^data:(?! )/, "data: ");

/** A `data:` line holding only the start of a JSON value split over several data lines. */
function startsSplitData(line) {
  const value = sseLineData(line);
  if (!value?.startsWith("{") && !value?.startsWith("[")) return false;
  try {JSON.parse(value);return false;} catch {return true;}
}

/** One `data:` line for held lines that form a single JSON value, else null. */
function joinSplitData(lines) {
  const { data } = parseSseFrame(lines.map((line) => line.trim()).join("\n"));
  try {JSON.parse(data);} catch {return null;}
  const eol = lines[0].endsWith("\r") ? "\r" : "";
  return {
    others: lines.filter((line) => sseLineData(line.trim()) === null),
    // Newlines between JSON tokens are whitespace.
    line: `data: ${data.replace(/\n/g, " ")}${eol}`
  };
}

function normalizeStreamError(error, secrets = []) {
  // Public fields only: redact the selected credential values before they reach the client.
  const safe = (value) => sanitizeErrorMessageWithSecrets(String(value), secrets);
  if (!error || !isObject(error)) {
    return { message: safe(error || "Upstream stream error"), type: "server_error", code: "stream_error" };
  }
  return {
    message: safe(error.message || "Upstream stream error"),
    type: safe(error.type || "server_error"),
    code: safe(error.code || "stream_error")
  };
}

/**
 * Redact the selected credential values from a PUBLIC error envelope in place.
 *
 * Recognized failure envelopes (`error`, nested `response.failed`, string
 * errors) are sanitized and re-serialized before they leave the stream.
 * Ordinary non-error frames are left alone. `streamErrorPayload` is a separate
 * copy produced by `extractStreamErrorPayload`, so the internal upstreamError
 * stays raw.
 */
function sanitizePublicErrorEnvelope(parsed, secrets = []) {
  // isObject(null) is true here, so a bare `data: null` frame would pass and then throw
  // on the property read below.
  if (!isObject(parsed) || parsed === null) return false;
  if (parsed.type !== "response.failed" && parsed.error == null && parsed.type !== "error") {
    // Gemini nested errors reach translators as public text: redact in place (#1342).
    const holder = parsed.promptFeedback?.error ? parsed.promptFeedback :
    parsed.response?.promptFeedback?.error ? parsed.response.promptFeedback :
    parsed.response?.error ? parsed.response : null;
    if (!holder || (!isObject(holder.error) && !isString(holder.error))) return false;
    holder.error = sanitizeStructuredErrorBody(holder.error, secrets);
    return true;
  }
  const error = parsed.type === "response.failed" ? parsed.response?.error :
  parsed.error ?? (parsed.type === "error" ? parsed : null);
  if (error === null || (!isObject(error) && !isString(error))) return false;
  // Error extensions and string errors are public diagnostics too. Reuse the
  // JSON error boundary so nested secrets are redacted while safe metadata and
  // non-error content frames retain their existing shape.
  const safe = sanitizeStructuredErrorBody(isString(error) ? { message: error } : error, secrets);
  if (parsed.type === "response.failed") parsed.response.error = safe;
  else if (parsed.error != null) parsed.error = safe;
  else Object.assign(parsed, safe);
  return true;
}

/**
 * Error that ends a translated stream with the client's protocol error terminal.
 * A nested Responses `response.failed` counts like a top-level `error` when the
 * client speaks another format, so it never reaches the client as `[Error]`
 * stop content (#1327). Same-format Responses keeps the upstream failed event.
 */
function translatedTerminalError(parsed, sourceFormat) {
  if (parsed?.error) return parsed.error;
  if (parsed?.type !== "response.failed" || sourceFormat === FORMATS.OPENAI_RESPONSES) return null;
  // A failed status without an error object still ends as an error terminal.
  return parsed.response?.error || (parsed.response?.status === "failed" ? { message: "Upstream response failed" } : null);
}

/** Forward executor-side validation failures in the client's SSE format (#2681). */
function formatTranslatedStreamError(error, sourceFormat, secrets = []) {
  const normalized = normalizeStreamError(error, secrets);
  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    const now = Math.floor(Date.now() / 1000);
    const failed = {
      type: "response.failed",
      response: {
        id: `resp_error_${Date.now()}`,
        object: "response",
        created_at: now,
        status: "failed",
        background: false,
        error: normalized,
        output: []
      },
      sequence_number: 0
    };
    return `event: response.failed\ndata: ${JSON.stringify(failed)}\n\ndata: [DONE]\n\n`;
  }
  if (sourceFormat === FORMATS.CLAUDE) {
    return formatClaudeSseError(normalized) + "data: [DONE]\n\n";
  }
  return `data: ${JSON.stringify({ error: normalized })}\n\ndata: [DONE]\n\n`;
}

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes (content, usage)
 * @param {string} options.apiKey - API key for usage tracking
 */
export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    claudeCloaked = false,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    onCoherentTerminal = null,
    providerBody = null,
    apiKey = null,
    claudeClassifierCompat = "off",
    credentials = null,
    nativeGemini = false
  } = options;

  // Selected/refreshed credential values redacted from the PUBLIC translated error only.
  const errorSecrets = credentialErrorSecrets(credentials);
  let buffer = "";
  let pendingLineBytes = 0;
  // OpenAI SDK consumers can attempt to decode field-only SSE events as JSON.
  // Hold their framing until a data line proves the event has a payload.
  const filterEmptyOpenAIFrames = mode === STREAM_MODE.PASSTHROUGH && targetFormat === FORMATS.OPENAI;
  let pendingSSEFields = "";
  let sseFrameHasData = false;
  let sseFrameHasComment = false;
  // Responses passthrough: the upstream speaks the Responses protocol and the
  // client wants it unchanged, so the frames are forwarded as they arrive.
  const responsesPassthrough = mode === STREAM_MODE.PASSTHROUGH && targetFormat === FORMATS.OPENAI_RESPONSES;
  // Empty provider keepalive blocks can crash strict SDK JSON parsing.
  // Filter only those blocks in Chat and Responses passthrough (OmniRoute
  // #1146). Claude passthrough keeps its
  // genuine `event: ping` frames, and the gateway-generated keepalives never
  // travel through this transform.
  const filterProviderKeepalive = mode === STREAM_MODE.PASSTHROUGH &&
    (targetFormat === FORMATS.OPENAI || targetFormat === FORMATS.OPENAI_RESPONSES);
  let keepaliveCandidate = [];
  let keepaliveCandidateSize = 0;
  let keepaliveFrameStart = true;
  // Replayed Responses events (a reconnect re-sending an already forwarded
  // sequence_number) are dropped before they reach the client.
  const responsesReplay = createResponsesSequenceReplayTracker();
  // Passthrough tool-call (choice, index) keys already opened on the client wire.
  const openedToolCalls = new Set();
  let usage = null;
  // Delay estimates for clients requesting an OpenAI usage trailer.
  let pendingUsageEstimate = false;
  let usageChunkMeta = {};

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const claudeCompatMode = claudeClassifierCompat || "off";
  const systemTexts = Array.isArray(body?.system) ?
  body.system.map((part) => isString(part?.text) ? part.text : "").filter(Boolean) :
  [];
  const stopSequences = Array.isArray(body?.stop_sequences) ? body.stop_sequences : [];
  const isClaudeClassifierRequest =
  sourceFormat === FORMATS.CLAUDE && (
  systemTexts.some((text) => text.includes("You are a security monitor for autonomous AI coding agents")) ||
  stopSequences.includes("</block>"));

  const claudeCompat =
  sourceFormat === FORMATS.CLAUDE && (
  claudeCompatMode === "always" ||
  claudeCompatMode === "auto" && isClaudeClassifierRequest);

  // MiniMax M3 passthrough: peel leaked thinking markers from delta.content into
  // reasoning_content, then (openai transport only) strip reasoning fields so
  // OpenAI clients (OpenCode) don't render them. Ported from upstream PR #2525.
  const minimaxThinkingState = mode === STREAM_MODE.PASSTHROUGH &&
  isMinimaxThinkingProvider(provider) &&
  targetFormat === FORMATS.OPENAI ?
  createMinimaxThinkingStreamState() :
  null;

  // The compatibility parser is enabled only by exact provider transport/model
  // metadata. State is isolated by OpenAI choice index.
  const extractInlineThinking = mode === STREAM_MODE.PASSTHROUGH &&
  resolveInlineThinkingFormat(provider, model, targetFormat) === INLINE_THINKING_FORMATS.THINK_TAGS;
  // When the inline-thinking extractor owns <think> peeling for this provider/model
  // (registry quirks.inlineThinking), the upstream-#2525 sanitizer must not also
  // rewrite delta.content — the extractor's fail-open byte-for-byte contract wins.
  const sanitizeMinimaxThinking = minimaxThinkingState && !extractInlineThinking;
  const omitStreamReasoning = sanitizeMinimaxThinking && shouldOmitStreamReasoning(provider);

  const state = mode === STREAM_MODE.TRANSLATE ?
  { ...initState(sourceFormat, body || providerBody), requestedModel: model, searchEnabled: provider === "codex" && sourceFormat === FORMATS.CLAUDE && body?.tools?.some(tool => tool?.type === "web_search_20250305"), provider, toolNameMap, clientTools: Array.isArray(body?.tools) ? body.tools : null, providerBody, model, dsmlModel: providerBody?.model || model, signatureNamespace: connectionId, sessionId: credentials?._clientSessionId || null, ...(claudeCompat && { claudeCompat: true }) } :
  null;
  // Keep a compact completion view while chunks flow. Unlike retained request
  // diagnostics, this sees terminal metadata even when callers cap raw events.
  const providerSummary = (() => {
    const MAX_MODEL = 256;
    const MAX_ID = 256;
    const MAX_TEXT = 64 * 1024;
    const MAX_REASONING = 32 * 1024;
    const MAX_FIELD = 16 * 1024;
    const MAX_TOOLS = 64;
    const MAX_PARTS = 256;
    const MAX_USAGE_FIELDS = 64;
    const format = mode === STREAM_MODE.TRANSLATE ? targetFormat : sourceFormat || targetFormat;
    const isResponses = format === FORMATS.OPENAI_RESPONSES || format === FORMATS.OPENAI_RESPONSE;
    const isClaude = format === FORMATS.CLAUDE;
    const isGemini = format === FORMATS.GEMINI || format === FORMATS.GEMINI_CLI || format === FORMATS.ANTIGRAVITY;
    const bounded = (value, limit = MAX_FIELD) => isString(value) ? value.slice(0, limit) : "";
    const append = (current, value, limit) => current.length >= limit ? current : current + bounded(value, limit - current.length);
    const scalarUsage = (value) => {
      if (!value || !isObject(value) || Array.isArray(value)) return null;
      const result = {};
      let accepted = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const item = value[key];
        if (!isNumber(item) && !isBoolean(item) && !isString(item)) continue;
        if (accepted++ >= MAX_USAGE_FIELDS) break;
        result[bounded(key, 64)] = isString(item) ? bounded(item) : item;
      }
      return result;
    };
    const projectResponse = (value) => {
      if (!value || !isObject(value) || Array.isArray(value)) return null;
      return {
        id: bounded(value.id, MAX_ID),
        model: bounded(value.model, MAX_MODEL),
        status: bounded(value.status, 64),
        created_at: isNumber(value.created_at) ? value.created_at : undefined,
        usage: scalarUsage(value.usage)
      };
    };
    let sawAny = false;
    let summaryModel = bounded(model, MAX_MODEL);
    let summaryUsage = null;
    let content = "";
    let reasoning = "";
    let finishReason = null;
    const toolCalls = new Map();
    let response = null;
    let completedResponse = null;
    let responseText = "";
    const responseTools = new Map();
    const claudeBlocks = new Map();
    let claudeId = "";
    let claudeRole = "assistant";
    let claudeStopReason = "end_turn";
    let claudeStopSequence = null;
    let sawClaudeMessageStart = false;
    let sawClaudeMessageStop = false;
    const geminiParts = [];
    let geminiRole = "model";
    let geminiFinishReason = "STOP";
    const boundedObject = (value) => {
      if (isString(value)) {
        try {return JSON.parse(bounded(value));} catch {return {};}
      }
      if (!value || !isObject(value) || Array.isArray(value)) return {};
      const text = JSON.stringify(value);
      if (text === undefined || text.length > MAX_FIELD) return {};
      try {return JSON.parse(text);} catch {return {};}
    };
    const appendGeminiPart = (part) => {
      const last = geminiParts.at(-1);
      if (last?.text && part.text && Boolean(last.thought) === Boolean(part.thought)) last.text = append(last.text, part.text, MAX_FIELD);else
      if (geminiParts.length < MAX_PARTS) geminiParts.push(part.text ? { text: bounded(part.text), ...(part.thought === true ? { thought: true } : null) } : { functionCall: { name: bounded(part.functionCall?.name, 256), args: boundedObject(part.functionCall?.args) } });
    };
    return {
      ingest(rawChunk) {
        if (!rawChunk || !isObject(rawChunk) || Array.isArray(rawChunk)) return;
        const chunk = isGemini && rawChunk.response && isObject(rawChunk.response) && !Array.isArray(rawChunk.response) ? rawChunk.response : rawChunk;
        if (!Object.keys(chunk).length) return;
        if (isResponses) {
          sawAny = true;
          if (chunk.type === "response.completed") completedResponse = projectResponse(chunk.response);
          if (chunk.response) response = projectResponse(chunk.response);else
          if (chunk.object === "response") response = projectResponse(chunk);
          if (chunk.type === "response.output_text.delta") responseText = append(responseText, chunk.delta, MAX_TEXT);
          if (chunk.usage) summaryUsage = scalarUsage(chunk.usage);else
          if (chunk.response?.usage) summaryUsage = scalarUsage(chunk.response.usage);
          const item = chunk.item;
          const outputIndex = Number.isSafeInteger(chunk.output_index) ? chunk.output_index : null;
          if (chunk.type === "response.output_item.added" && item?.type === "function_call" && responseTools.size < MAX_TOOLS) {
            const key = outputIndex ?? bounded(item.id, MAX_ID);
            responseTools.set(key, { id: bounded(item.id, MAX_ID), type: "function_call", call_id: bounded(item.call_id, MAX_ID), name: bounded(item.name, 256), arguments: bounded(item.arguments) });
          } else if (chunk.type === "response.function_call_arguments.delta" || chunk.type === "response.function_call_arguments.done") {
            const key = outputIndex ?? bounded(chunk.item_id, MAX_ID);
            const tool = responseTools.get(key);
            if (tool) tool.arguments = chunk.type.endsWith(".done") ? bounded(chunk.arguments) : append(tool.arguments, chunk.delta, MAX_FIELD);
          } else if (chunk.type === "response.output_item.done" && item?.type === "function_call") {
            const key = outputIndex ?? bounded(item.id, MAX_ID);
            const tool = responseTools.get(key);
            if (tool) Object.assign(tool, { id: bounded(item.id, MAX_ID), call_id: bounded(item.call_id, MAX_ID), name: bounded(item.name, 256), arguments: bounded(item.arguments) || tool.arguments });
          }
          return;
        }
        if (isClaude) {
          sawAny = true;
          if (chunk.type === "message_start") {
            const message = chunk.message || {};
            sawClaudeMessageStart = Array.isArray(message.content);
            claudeId = bounded(message.id, MAX_ID) || claudeId;
            summaryModel = bounded(message.model, MAX_MODEL) || summaryModel;
            claudeRole = bounded(message.role, 32) || claudeRole;
            if (message.usage) summaryUsage = mergeUsage(summaryUsage, scalarUsage(message.usage));
          } else if (chunk.type === "content_block_start") {
            const key = Number.isSafeInteger(chunk.index) ? chunk.index : claudeBlocks.size;
            if (claudeBlocks.size < MAX_PARTS || claudeBlocks.has(key)) {
              const block = chunk.content_block || {};
              claudeBlocks.set(key, { type: bounded(block.type, 32), id: bounded(block.id, MAX_ID), name: bounded(block.name, 256), text: bounded(block.text), thinking: bounded(block.thinking), signature: bounded(block.signature, MAX_ID), inputJson: "" });
            }
          } else if (chunk.type === "content_block_delta") {
            const key = Number.isSafeInteger(chunk.index) ? chunk.index : 0;
            const delta = chunk.delta || {};
            const block = claudeBlocks.get(key);
            if (block) {
              if (delta.type === "input_json_delta") block.inputJson = append(block.inputJson, delta.partial_json, MAX_FIELD);else
              if (delta.type === "thinking_delta" || isString(delta.thinking)) block.thinking = append(block.thinking, delta.thinking, MAX_FIELD);else
              block.text = append(block.text, delta.text, MAX_FIELD);
            }
          } else if (chunk.type === "message_delta") {
            claudeStopReason = bounded(chunk.delta?.stop_reason, 64) || claudeStopReason;
            claudeStopSequence = bounded(chunk.delta?.stop_sequence, MAX_FIELD) || claudeStopSequence;
            if (chunk.usage) summaryUsage = mergeUsage(summaryUsage, scalarUsage(chunk.usage));
          } else {
            if (chunk.type === "message_stop") sawClaudeMessageStop = true;
            if (chunk.usage) summaryUsage = mergeUsage(summaryUsage, scalarUsage(chunk.usage));
          }
          return;
        }
        if (isGemini) {
          sawAny = true;
          summaryModel = bounded(chunk.modelVersion, MAX_MODEL) || summaryModel;
          if (chunk.usageMetadata) summaryUsage = mergeUsage(summaryUsage, scalarUsage(chunk.usageMetadata));
          const candidate = chunk.candidates?.[0] || {};
          geminiFinishReason = bounded(candidate.finishReason, 64) || geminiFinishReason;
          const candidateContent = candidate.content || {};
          geminiRole = bounded(candidateContent.role, 32) || geminiRole;
          for (const part of candidateContent.parts || []) {
            if (part?.functionCall || isString(part?.text)) appendGeminiPart(part);
          }
          return;
        }
        if (!Array.isArray(chunk.choices)) return;
        sawAny = true;
        summaryModel = bounded(chunk.model, MAX_MODEL) || summaryModel;
        if (chunk.usage) summaryUsage = mergeUsage(summaryUsage, scalarUsage(chunk.usage));
        for (const [position, choice] of chunk.choices.entries()) {
          const delta = choice?.delta;
          content = append(content, delta?.content, MAX_TEXT);
          reasoning = append(reasoning, extractReasoningText(delta), MAX_REASONING);
          finishReason = bounded(choice?.finish_reason, 64) || finishReason;
          for (const [toolPosition, toolCall] of (delta?.tool_calls || []).entries()) {
            const index = Number.isSafeInteger(toolCall.index) ? toolCall.index : toolPosition;
            const current = toolCalls.get(index) || toolCalls.get(`id:${toolCall.id}`);
            if (!current && new Set(toolCalls.values()).size >= MAX_TOOLS) continue;
            const tool = current || { index, id: "", type: "", function: { name: "", arguments: "" } };
            tool.id = bounded(toolCall.id, MAX_ID) || tool.id;
            tool.type = bounded(toolCall.type, 32) || tool.type;
            tool.function.name = append(tool.function.name, toolCall.function?.name, 256);
            tool.function.arguments = append(tool.function.arguments, toolCall.function?.arguments, MAX_FIELD);
            toolCalls.set(index, tool);
            if (tool.id) toolCalls.set(`id:${tool.id}`, tool);
          }
        }
      },
      hasClaudeTokenLimitReason() {
        return sawClaudeMessageStart && sawClaudeMessageStop && claudeStopReason === CLAUDE_STOP.MAX_TOKENS;
      },
      finalize(finalUsage) {
        if (!sawAny) return undefined;
        if (isResponses) {
          const picked = completedResponse || response || {};
          const output = responseTools.size ? [...responseTools.values()] : responseText ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: responseText }] }] : [];
          return { providerResponse: { id: picked.id || `resp_${Date.now()}`, object: "response", model: picked.model || summaryModel || "unknown", output, usage: picked.usage ?? summaryUsage ?? null, status: picked.status || (completedResponse ? "completed" : "in_progress"), created_at: picked.created_at || Math.floor(Date.now() / 1000), metadata: {} } };
        }
        if (isClaude) {
          const contentBlocks = [...claudeBlocks.entries()].sort(([a], [b]) => a - b).flatMap(([, block]) => {
            if (block.type === "tool_use") {
              let input = {};
              try {
                if (block.inputJson) input = JSON.parse(block.inputJson);
              } catch {
                input = block.inputJson;
              }
              return [{ type: "tool_use", id: block.id, name: block.name, input }];
            }
            if (block.type === "thinking") return block.thinking ? [{ type: "thinking", thinking: block.thinking, ...(block.signature ? { signature: block.signature } : null) }] : [];
            return block.text ? [{ type: "text", text: block.text }] : [];
          });
          return { providerResponse: { id: claudeId || `msg_${Date.now()}`, type: "message", role: claudeRole, model: summaryModel || "claude", content: contentBlocks, stop_reason: claudeStopReason, ...(claudeStopSequence ? { stop_sequence: claudeStopSequence } : null), ...(summaryUsage ? { usage: summaryUsage } : null) } };
        }
        if (isGemini) return { providerResponse: { candidates: [{ index: 0, content: { role: geminiRole, parts: geminiParts }, finishReason: geminiFinishReason }], ...(summaryUsage ? { usageMetadata: summaryUsage } : null), modelVersion: summaryModel || "gemini" } };
        const message = {};
        if (content) message.content = content;
        if (reasoning.trim()) message.reasoning_content = reasoning.trim();
        if (toolCalls.size) message.tool_calls = [...new Set(toolCalls.values())];
        return { providerResponse: { object: "chat.completion", ...(summaryModel ? { model: summaryModel } : null), ...(summaryUsage || finalUsage ? { usage: summaryUsage || finalUsage } : null), choices: [{ finish_reason: finishReason, message }] } };
      }
    };
  })();

  let totalContentLength = 0;
  const contentChunks = [];
  const thinkingChunks = [];
  /** Append chunks without copying growing prefixes; join only at observable completion/snapshot boundaries. */
  const appendContent = (chunk) => contentChunks.push(chunk);
  const appendThinking = (chunk) => thinkingChunks.push(chunk);
  let hasSnapshotOutput = false;
  const getAccumulatedCompletion = () => ({
    ...(hasSnapshotOutput ? { hasSnapshotOutput: true } : null),
    content: contentChunks.join(""),
    thinking: thinkingChunks.join("")
  });
  let ttftAt = null;
  // Gateway-measured tok/s excluding TTFT (#12631 port). No-op until the first
  // token lands; generation-only duration is simply "now minus first token".
  const withTps = (usageObj) => attachTokensPerSecond(usageObj, ttftAt ? Date.now() - ttftAt : null);
  /** Tool-call frames are useful output even when providers omit usage and text. */
  let hadToolCalls = false;
  // Claude output seen so far; refreshes a provisional message_start count.
  let claudeOutputChars = 0;
  // Names only, for a readable log label — a turn that only calls tools accumulates
  // no content and would otherwise log as "[Empty streaming response]", indistinguishable
  // from a truncated stream. Dedup keeps a chatty multi-call turn's label short.
  const toolCallNames = new Set();
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};
  let onStreamCompleteFired = false; // guard so terminal-chunk completion + flush() both fire onStreamComplete only once
  let sawOpenAITokenLimit = false;
  const isOpenAITokenLimitFrame = (chunk) => targetFormat === FORMATS.OPENAI &&
    Array.isArray(chunk?.choices) && chunk.choices.some((choice) =>
      choice?.finish_reason === OPENAI_FINISH.LENGTH && isRecord(choice.delta));
  const recordCompletionData = (parsed, {
    summary = true, trackUsage = true, content = false, tokenLimit = isOpenAITokenLimitFrame(parsed)
  } = {}) => {
    if (summary) sawOpenAITokenLimit ||= tokenLimit;
    if (targetFormat === FORMATS.OPENAI_RESPONSES && (mode === STREAM_MODE.PASSTHROUGH || sourceFormat === FORMATS.OPENAI_RESPONSES) && hasResponsesSnapshotOutput(parsed)) hasSnapshotOutput = true;
    if (summary) providerSummary.ingest(parsed);
    const geminiParts = parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content?.parts || [];
    const openaiToolCalls = parsed.choices?.some?.((choice) => choice?.delta?.tool_calls?.length > 0 || choice?.delta?.function_call);
    const claudeToolUseStart = parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use";
    const responsesToolCall = parsed.item?.type === "function_call" || parsed.item?.type === "custom_tool_call";
    const geminiToolCall = geminiParts.some((part) => part?.functionCall);
    const finalMessageToolCalls = parsed.message?.tool_calls?.length > 0;
    hadToolCalls = hadToolCalls ||
    openaiToolCalls || claudeToolUseStart || responsesToolCall || geminiToolCall || finalMessageToolCalls;
    if (openaiToolCalls) {
      for (const choice of parsed.choices) {
        for (const call of choice?.delta?.tool_calls || []) {
          if (isString(call?.function?.name) && call.function.name) toolCallNames.add(call.function.name);
        }
        if (isString(choice?.delta?.function_call?.name) && choice.delta.function_call.name) {
          toolCallNames.add(choice.delta.function_call.name);
        }
      }
    }
    if (claudeToolUseStart && isString(parsed.content_block?.name) && parsed.content_block.name) {
      toolCallNames.add(parsed.content_block.name);
    }
    if (responsesToolCall && isString(parsed.item?.name) && parsed.item.name) {
      toolCallNames.add(parsed.item.name);
    }
    if (geminiToolCall) {
      for (const part of geminiParts) {
        if (isString(part?.functionCall?.name) && part.functionCall.name) toolCallNames.add(part.functionCall.name);
      }
    }
    if (finalMessageToolCalls) {
      for (const call of parsed.message.tool_calls) {
        if (isString(call?.function?.name) && call.function.name) toolCallNames.add(call.function.name);
      }
    }
    if (summary && parsed.type === "content_block_delta") {
      const delta = parsed.delta;
      const piece = [delta?.text, delta?.thinking, delta?.partial_json].find((value) => isString(value) && value);
      if (piece) claudeOutputChars += piece.length;
    }
    const extracted = extractUsage(parsed);
    if (trackUsage && extracted) usage = mergeUsage(usage, extracted);
    if (!content) return extracted;

    if (!minimaxThinkingState) {
      for (const choice of parsed.choices || []) {
        const delta = choice?.delta;
        if (isString(delta?.content) && delta.content) {
          totalContentLength += delta.content.length;
          appendContent(delta.content);
        }
        const reasoning = extractReasoningText(delta);
        if (reasoning) {
          totalContentLength += reasoning.length;
          appendThinking(reasoning);
        }
      }
    }
    const geminiTextParts = parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content?.parts || [];
    for (const part of geminiTextParts) {
      if (!isString(part?.text) || !part.text) continue;
      totalContentLength += part.text.length;
      if (part.thought === true) appendThinking(part.text);else
      appendContent(part.text);
    }
    return extracted;
  };

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let currentUpstreamEvent = null;
  let openAIResponsesTerminalSeen = false;
  let responsesLifecycleTerminalForwarded = false;
  let openAIResponsesDoneSent = false;
  const emitPendingUsageEstimate = (controller) => {
    if (!pendingUsageEstimate) return;
    pendingUsageEstimate = false;
    if (hasValidUsage(usage)) return;
    usage = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
    const chunk = {
      id: usageChunkMeta.id,
      object: "chat.completion.chunk",
      created: usageChunkMeta.created ?? Math.floor(Date.now() / 1000),
      model: usageChunkMeta.model || model,
      choices: [],
      usage: filterUsageForFormat(usage, FORMATS.OPENAI),
    };
    const output = `data: ${JSON.stringify(chunk)}\n\n`;
    reqLogger?.appendConvertedChunk?.(output);
    controller.enqueue(sharedEncoder.encode(output));
  };

  let streamDoneSent = false; // track duplicate [DONE] across transform + flush
  // A forwarded data line still waiting for the blank line that ends its frame.
  let dataFrameOpen = false;
  // OpenAI choices terminate independently. Suppress only repeated terminal
  // chunks for the same index; another choice may still finish later.
  const passthroughFinishedChoices = new Set();
  const normalizeOpenAIPassthroughChunk = (parsed) => {
    if (targetFormat !== FORMATS.OPENAI || !Array.isArray(parsed?.choices)) {
      return { changed: false, keep: true };
    }
    let changed = normalizeArrayContentChunk(parsed);
    for (const choice of parsed.choices) {
      const delta = choice?.delta;
      if (isString(delta?.reasoning) && delta.reasoning.trim() && !delta.reasoning_content) {
        delta.reasoning_content = delta.reasoning;
        changed = true;
      }
    }
    const choiceCount = parsed.choices.length;
    parsed.choices = parsed.choices.filter((choice, position) => {
      if (!choice?.finish_reason) return true;
      const index = Number.isInteger(choice.index) ? choice.index : position;
      if (passthroughFinishedChoices.has(index)) return false;
      passthroughFinishedChoices.add(index);
      return true;
    });
    changed = parsed.choices.length !== choiceCount || changed;
    return { changed, keep: choiceCount === 0 || parsed.choices.length > 0 || Boolean(parsed.usage) };
  };

  // An upstream gateway can hide its failure behind an HTTP 200 finish chunk
  // (native_finish_reason). With no output before it, that finish becomes an
  // in-band error, so the turn is not recorded as a blank success (upstream #3611).
  let openAIOutputSeen = false;
  const maskedGatewayErrorEnvelope = (parsed) => {
    if (targetFormat !== FORMATS.OPENAI || !Array.isArray(parsed?.choices)) return null;
    openAIOutputSeen ||= parsed.choices.some(choiceHasOutput);
    const reason = openAIOutputSeen ? null : classifyMaskedGatewayError(parsed);
    return reason ?
    { error: { message: `Upstream provider error: ${reason}`, type: "upstream_error", code: reason } } :
    null;
  };

  let claudeTerminalSeen = false;
  let upstreamErrorForwarded = false;
  // First in-stream error envelope (OpenAI/Anthropic `error`, Responses
  // `error` / `response.failed`), in both passthrough and translate mode. It
  // reaches onStreamComplete as `upstreamError` so a request-scoped refusal is
  // not read as an empty stream that cools the account down (OmniRoute #14585),
  // and so a stream that failed after HTTP 200 is recorded as an error, not a
  // success (upstream 9router #4332). The client bytes are not affected.
  let streamErrorPayload = null;
  const terminalBody = providerBody || body;
  const upstreamTerminal = createUpstreamTerminalTracker({
    format: targetFormat,
    onCoherentTerminal,
    deferSuccessCallback: true,
    expectedChoiceCount: terminalBody?.n,
    expectedCandidateCount: terminalBody?.candidate_count ??
    terminalBody?.candidateCount ??
    terminalBody?.generationConfig?.candidateCount ??
    terminalBody?.generation_config?.candidate_count
  });
  const hasTokenLimitTerminal = () => !streamErrorPayload && upstreamTerminal.outcome === "success" &&
    (sawOpenAITokenLimit || providerSummary.hasClaudeTokenLimitReason());
  const completionSummary = (usage) => {
    const summary = providerSummary.finalize(usage);
    return hasTokenLimitTerminal() ? { ...summary, hasTokenLimitTerminal: true } : summary;
  };
  const observeBufferedUpstream = (line, pendingEventName = null) => {
    if (line.startsWith("event:")) return sseLineEvent(line);
    const data = sseLineData(line);
    if (data === null && !line.startsWith("{")) return pendingEventName;
    const parsed = parseSSELine(line, targetFormat);
    if (parsed?.done) upstreamTerminal.observe({ rawDone: true, eventName: pendingEventName });else
    if (parsed) {
      upstreamTerminal.observe({ chunk: parsed, eventName: pendingEventName });
      if (
      targetFormat === FORMATS.CLAUDE &&
      parsed?.type === "message_stop" &&
      upstreamTerminal.outcome === "success")
      claudeTerminalSeen = true;
    } else
    if (line.startsWith("{") || data) upstreamTerminal.fail();
    return null;
  };

  // The compatibility parser is enabled only by exact provider transport/model
  // metadata. State is isolated by OpenAI choice index.
  const inlineThinkingStates = new Map();
  let inlineThinkingChunkMeta = null;

  const getInlineThinkingState = (choiceIndex) => {
    if (!inlineThinkingStates.has(choiceIndex)) {
      inlineThinkingStates.set(choiceIndex, {
        extractor: createThinkTagStreamExtractor(),
        bypass: false,
        reasoningSeen: false,
        reasoningEndsWithNewline: false,
        lastReasoningSource: null
      });
    }
    return inlineThinkingStates.get(choiceIndex);
  };

  const appendInlineThinkingReasoning = (choiceState, existing, addition) => {
    if (!isString(addition) || addition.length === 0) return existing;
    if (isString(existing) && existing.length > 0) {
      return appendReasoningText(existing, addition);
    }
    if (choiceState.reasoningSeen) {
      const separator = choiceState.reasoningEndsWithNewline || addition.startsWith("\n") ? "" : "\n";
      return `${existing || ""}${separator}${addition}`;
    }
    return appendReasoningText(existing, addition);
  };

  const trackInlineThinkingReasoning = (choiceState, value, source) => {
    if (!isString(value) || value.length === 0) return;
    choiceState.reasoningSeen = true;
    choiceState.reasoningEndsWithNewline = value.endsWith("\n");
    if (source) choiceState.lastReasoningSource = source;
  };

  const normalizeNativeReasoningAfterInline = (choiceState, value) => {
    if (!isString(value) || value.length === 0) return value;
    if (choiceState.lastReasoningSource !== "inline") return value;
    const separator = choiceState.reasoningEndsWithNewline || value.startsWith("\n") ? "" : "\n";
    return `${separator}${value}`;
  };

  const flushInlineThinkingStates = () => {
    if (!extractInlineThinking || inlineThinkingStates.size === 0) return "";
    const choices = [];
    for (const [index, choiceState] of inlineThinkingStates) {
      const pending = choiceState.extractor.flush();
      const delta = {};
      if (pending.content) {
        delta.content = pending.content;
        totalContentLength += pending.content.length;
        appendContent(pending.content);
      }
      if (pending.reasoning) {
        delta.reasoning_content = appendInlineThinkingReasoning(choiceState, undefined, pending.reasoning);
        trackInlineThinkingReasoning(choiceState, delta.reasoning_content, "inline");
        totalContentLength += delta.reasoning_content.length;
        appendThinking(delta.reasoning_content);
      }
      if (Object.keys(delta).length > 0) {
        choices.push({ index, delta, finish_reason: null });
      }
    }
    inlineThinkingStates.clear();
    if (choices.length === 0) return "";
    const chunk = {
      id: inlineThinkingChunkMeta?.id || `chatcmpl-${Date.now()}`,
      object: inlineThinkingChunkMeta?.object || "chat.completion.chunk",
      created: inlineThinkingChunkMeta?.created || Math.floor(Date.now() / 1000),
      model: inlineThinkingChunkMeta?.model || model || "unknown",
      choices
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  };

  /**
   * Return partial accounting without closing the transform. Interrupted stream
   * finalizers use this when flush cannot run, preferring provider usage and
   * otherwise estimating from content already received.
   */
  // Replicate predictions do not consistently report token counts; leave them unknown.
  const getStreamSnapshot = () => {
    const currentUsage = refreshProvisionalOutput(mode === STREAM_MODE.PASSTHROUGH ? usage : state?.usage, claudeOutputChars);
    const resolvedUsage = hasValidUsage(currentUsage) ? currentUsage :
    provider !== "replicate" && totalContentLength > 0 ?
    estimateUsage(body, totalContentLength, mode === STREAM_MODE.PASSTHROUGH ? FORMATS.OPENAI : sourceFormat) :
    null;
    return {
      ...getAccumulatedCompletion(),
      usage: resolvedUsage,
      ttftAt
    };
  };

  let completionFlushTimer = null;
  let pendingClaudeFinish = null;
  let releasingClaudeFinish = false;
  let translatedStreamFinalized = false;
  const clearCompletionFlushTimer = () => {
    clearTimeout(completionFlushTimer);
    completionFlushTimer = null;
  };
  // Clients commonly cancel immediately after response.completed, so EOF is
  // too late for accounting and the completion callback on this path.
  const finalizeTranslatedStream = () => {
    clearCompletionFlushTimer();
    if (translatedStreamFinalized) return;
    translatedStreamFinalized = true;
    if (provider !== "replicate" && !hasValidUsage(state?.usage) && totalContentLength > 0) {
      state.usage = mergeUsage(state.usage, estimateUsage(body, totalContentLength, sourceFormat));
    }
    if (hasValidUsage(state?.usage)) {
      logUsage(state.provider || targetFormat, state.usage, model, connectionId, apiKey);
    } else {
      appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => {});
    }
    if (onStreamComplete && !onStreamCompleteFired) {
      onStreamCompleteFired = true;
      onStreamComplete({
        ...getAccumulatedCompletion(),
        ...(hadToolCalls ? { hadToolCalls: true } : null),
        ...(toolCallNames.size ? { toolCallNames: [...toolCallNames] } : null),
        ...(streamErrorPayload ? { upstreamError: streamErrorPayload } : null)
      }, state?.usage, ttftAt, completionSummary(state?.usage));
    }
  };

  // A wire [DONE] closes the opportunity for trailing usage, even when the
  // upstream keeps the transport open. Do not wait for EOF to complete Codex.
  const flushPendingResponsesCompletion = (controller) => {
    if (targetFormat !== FORMATS.OPENAI || sourceFormat !== FORMATS.OPENAI_RESPONSES ||
        !state?.awaitingTrailingUsage || state.completedSent) return;
    const completed = translateResponse(targetFormat, sourceFormat, null, state);
    for (const item of completed || []) {
      if (item == null) continue;
      const output = formatSSE(item, sourceFormat);
      reqLogger?.appendConvertedChunk?.(output);
      controller.enqueue(sharedEncoder.encode(output));
      sseEmittedCount++;
    }
    finalizeTranslatedStream();
  };

  // Candidates are held only until payload, another field, or the size limit
  // proves they must follow the ordinary stream path. Empty candidates are
  // discarded at their frame boundary (or at EOF).
  const selectKeepaliveLines = (lines, eof = false) => {
    if (!filterProviderKeepalive) return lines;
    const selected = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const frameStart = keepaliveFrameStart;
      keepaliveFrameStart = !trimmed;
      if (!keepaliveCandidate.length && frameStart && isProviderKeepaliveEvent(line.replace(/\r$/, ""))) {
        keepaliveCandidate.push(line);
        keepaliveCandidateSize = line.length + 1;
      } else if (keepaliveCandidate.length) {
        keepaliveCandidate.push(line);
        keepaliveCandidateSize += line.length + 1;
        if (!trimmed) {
          keepaliveCandidate = [];
          keepaliveCandidateSize = 0;
        } else if (!/^data: ?$/.test(line.replace(/\r$/, "")) || keepaliveCandidateSize >= 65536) {
          selected.push(...keepaliveCandidate);
          keepaliveCandidate = [];
          keepaliveCandidateSize = 0;
        }
      } else {
        selected.push(line);
      }
    }
    if (eof) {
      keepaliveCandidate = [];
      keepaliveCandidateSize = 0;
    }
    return selected;
  };

  // Lines of a frame whose JSON spans several `data:` lines, held until the
  // frame ends. Only a line that fails to parse on its own starts a hold.
  let splitData = null;
  // Held lines being processed again as they were; they must not be held twice.
  let replayLines = 0;
  const holdSplitData = (line) => {splitData = { lines: [line], size: line.length };};

  const processLines = (lines, controller) => {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmed = line.trim();
        // The synthetic Claude finish line is never part of an upstream frame.
        const mayHold = !releasingClaudeFinish && replayLines === 0;
        if (!releasingClaudeFinish && replayLines > 0) replayLines--;

        if (splitData && !releasingClaudeFinish) {
          if (trimmed && sseLineData(trimmed) !== "[DONE]" && splitData.size <= MAX_PENDING_SSE_LINE_BYTES) {
            splitData.lines.push(line);
            splitData.size += line.length;
            continue;
          }
          const held = splitData.lines;
          splitData = null;
          const joined = joinSplitData(held);
          if (!joined) replayLines = held.length;
          const released = joined ? [...joined.others, joined.line] : held;
          lines = [...lines.slice(0, lineIndex), ...released, ...lines.slice(lineIndex)];
          lineIndex--;
          continue;
        }

        const receipt = pendingClaudeFinish && trimmed ? parseSSELine(trimmed, targetFormat) : null;
        // A usage trailer split over data lines is awaited until it is joined.
        if (pendingClaudeFinish && trimmed && (receipt || !startsSplitData(trimmed))) {
          const finish = pendingClaudeFinish;
          pendingClaudeFinish = null;
          clearCompletionFlushTimer();
          if (receipt?.id === finish.id && Array.isArray(receipt.choices) && receipt.choices.length === 0 && hasValidUsage(receipt.usage)) {
            finish.usage = receipt.usage;
          }
          releasingClaudeFinish = true;
          try { processLines([`data: ${JSON.stringify(finish)}`], controller); } finally { releasingClaudeFinish = false; }
        }

        if (isDebugEnabled && trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = sseLineEvent(trimmed) || "";
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
        }

        // SSE event labels are part of the upstream terminal contract. Keep the
        // next label in every mode/format so event/payload contradictions cannot
        // be hidden by passthrough normalization.
        if (trimmed.startsWith("event:")) {
          currentUpstreamEvent = sseLineEvent(trimmed);
          if (mode === STREAM_MODE.TRANSLATE && targetFormat === FORMATS.OPENAI_RESPONSES) {
            currentOpenAIResponsesEvent = currentUpstreamEvent;
          } else if (responsesPassthrough) {
            // Hold the label until its frame is known to be forwarded: a replayed
            // frame has to lose its label too, or the client sees an event
            // label whose payload was dropped.
            if (pendingSSEFields.length + line.length < 65536) pendingSSEFields += line + "\n";
            continue;
          }
        }

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;
          let pendingInlineThinkingOutput = "";
          const inlineThinkingRecoveryChoices = [];

          const dataValue = sseLineData(trimmed);
          const isDoneLine = dataValue === "[DONE]";
          const isDataLine = dataValue !== null;
          if (filterEmptyOpenAIFrames) {
            if (!trimmed) {
              pendingSSEFields = "";
              const forwardTerminator = sseFrameHasData || sseFrameHasComment;
              sseFrameHasData = false;
              sseFrameHasComment = false;
              currentUpstreamEvent = null;
              if (!forwardTerminator) {
                continue;
              }
            } else if (trimmed.startsWith(":")) {
              sseFrameHasComment = true;
            } else if (!isDataLine && /^(?:id|event|retry)(?::|$)/.test(trimmed)) {
              // Bound buffering for a malformed stream that never terminates a frame.
              if (pendingSSEFields.length + line.length < 65536) pendingSSEFields += line + "\n";
              continue;
            }
          }
          const upstreamEventForLine = isDataLine ? currentUpstreamEvent : null;
          if (isDataLine) currentUpstreamEvent = null;
          if (isDoneLine) {
            if (streamDoneSent) continue;
            pendingInlineThinkingOutput = flushInlineThinkingStates();
            emitPendingUsageEstimate(controller);
            streamDoneSent = true;
            upstreamTerminal.observe({ rawDone: true, eventName: upstreamEventForLine });
          }

          if ((isDataLine || trimmed.startsWith("{")) && !isDoneLine && (isDataLine ? dataValue : trimmed)) {
            try {
              const upstreamChunk = JSON.parse(isDataLine ? dataValue : trimmed);
              const gatewayError = maskedGatewayErrorEnvelope(upstreamChunk);
              const parsed = gatewayError ?? upstreamChunk;
              // A replayed Responses frame re-sends a sequence_number that was
              // already forwarded. Forwarding it again duplicates its content,
              // and its held event label has to go with it.
              if (responsesPassthrough && responsesReplay.isReplay(parsed)) {
                pendingSSEFields = "";
                continue;
              }
              streamErrorPayload ??= extractStreamErrorPayload(parsed);
              const publicError = sanitizePublicErrorEnvelope(parsed, errorSecrets);

              // OpenAI-format upstreams may stream `delta.content` as typed part
              // arrays (Mistral thinking chunks). Fold them into the string
              // `content` / `reasoning_content` the chat-chunk contract requires
              // before any client-visible path sees the chunk (OmniRoute #15757).

              if (Array.isArray(parsed?.choices)) {
                inlineThinkingChunkMeta = {
                  id: parsed.id,
                  object: parsed.object,
                  created: parsed.created,
                  model: parsed.model
                };
              }

              const openAITokenLimitFrame = isOpenAITokenLimitFrame(parsed);
              const idFixed = fixInvalidId(parsed);

              // Decloak tool names in Claude content_block_start events.
              // claude→claude passthrough doesn't go through translateResponse (which
              // applies toolNameMap in TRANSLATE mode), so without this the client
              // receives suffixed names (e.g. "Execute_ide") it doesn't recognize.
              let toolNameDecloaked = false;
              if (parsed?.type === "content_block_start" && parsed?.content_block?.type === "tool_use") {
                const original = decloakToolName(parsed.content_block.name, toolNameMap, claudeCloaked);
                if (original !== parsed.content_block.name) {
                  parsed.content_block = { ...parsed.content_block, name: original };
                  toolNameDecloaked = true;
                }
              }
              if (restoreOpenAIToolNames(parsed, toolNameMap)) toolNameDecloaked = true;

              // Some Anthropic-compatible providers (MiniMax) omit `signature`
              // from the thinking block start. Strict Messages clients deserialize
              // that field before the later signature_delta arrives, so inject an
              // empty placeholder when the provider quirk requests it (#2706).
              let fieldsInjected = gatewayError !== null;
              if (
              PROVIDERS[provider]?.quirks?.ensureThinkingSignature &&
              parsed.type === "content_block_start" &&
              parsed.content_block?.type === CLAUDE_BLOCK.THINKING &&
              parsed.content_block.signature === undefined)
              {
                parsed.content_block.signature = "";
                fieldsInjected = true;
              }
              if (parsed.choices !== undefined) {
                if (!parsed.object) {parsed.object = "chat.completion.chunk";fieldsInjected = true;}
                if (!parsed.created) {parsed.created = Math.floor(Date.now() / 1000);fieldsInjected = true;}
              }

              // Strip Azure-specific non-standard fields from streaming chunks
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                  // Claude stop_reason literals (end_turn, tool_use, ...) are not OpenAI values.
                  const finishReason = normalizeOpenAIFinish(choice.finish_reason);
                  if (finishReason !== choice.finish_reason) {
                    choice.finish_reason = finishReason;
                    fieldsInjected = true;
                  }
                }
              }

              // Strip empty tool_calls arrays that break AI SDK reasoning tracking.
              // Some providers (e.g. CodeBuddy CN) include `"tool_calls": []` in
              // every streaming delta. @ai-sdk/openai-compatible checks
              // `delta.tool_calls != null` — an empty array passes this check,
              // causing premature `reasoning-end` on every chunk.
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                    delete choice.delta.tool_calls;
                    fieldsInjected = true;
                  }
                }
              }

              // Peel leaked MiniMax thinking markers out of delta.content into
              // reasoning_content before the inline-thinking extractor and content
              // accounting see them (upstream PR #2525).
              if (sanitizeMinimaxThinking && parsed?.choices?.[0]?.delta) {
                if (sanitizeMinimaxDelta(parsed.choices[0].delta, minimaxThinkingState)) {
                  fieldsInjected = true;
                }
              }

              // Provider-specific stream normalization (e.g. SenseNova maps
              // delta.reasoning -> delta.reasoning_content) runs before the
              // hasValuableContent gate so reasoning-only chunks survive.
              fieldsInjected = PROVIDERS[provider]?.normalizeStreamChunk?.(parsed) || fieldsInjected;

              // Same-format OpenAI passthrough uses reasoning_content on the
              // client wire and terminates each choice once. Provider-specific
              // normalizers already ran, so canonical values remain authoritative.
              const normalized = normalizeOpenAIPassthroughChunk(parsed);
              fieldsInjected = normalized.changed || fieldsInjected;
              if (!normalized.keep) continue;

              upstreamTerminal.observe({ chunk: parsed, eventName: upstreamEventForLine });
              if (
              targetFormat === FORMATS.CLAUDE &&
              parsed?.type === "message_stop" &&
              upstreamTerminal.outcome === "success")
              claudeTerminalSeen = true;
              recordCompletionData(parsed, { trackUsage: false, tokenLimit: openAITokenLimitFrame });


              // Usage-only OpenAI chunks have choices:[] and would otherwise
              // be discarded as empty before accounting sees them.
              const extracted = extractUsage(parsed);
              if (extracted) {
                usage = mergeUsage(usage, extracted);
              }
              if (!hasValuableContent(parsed, targetFormat || FORMATS.OPENAI) && !extracted) continue;
              if (minimaxThinkingState) {
                const delta = parsed.choices?.[0]?.delta;
                const content = delta?.content;
                const reasoning = delta?.reasoning_content;
                if (content && isString(content)) {
                  totalContentLength += content.length;
                  appendContent(content);
                }
                if (reasoning && isString(reasoning)) {
                  totalContentLength += reasoning.length;
                  appendThinking(reasoning);
                }
                // Upstream still reasons; don't forward thinking fields to OpenAI
                // clients (OpenCode renders them).
                if (omitStreamReasoning && delta && stripClientReasoningDelta(delta)) {
                  fieldsInjected = true;
                }
              }

              if (extractInlineThinking && Array.isArray(parsed.choices)) {
                for (const [position, choice] of parsed.choices.entries()) {
                  const choiceIndex = Number.isInteger(choice?.index) ? choice.index : position;
                  const choiceState = getInlineThinkingState(choiceIndex);
                  const extractor = choiceState.extractor;
                  const delta = choice.delta || (choice.delta = {});
                  let nextContent = isString(delta.content) ? delta.content : "";
                  let changed = false;
                  let emittedInlineReasoning = false;

                  const hasStructuredReasoning = delta.reasoning_content != null && !isString(
                    delta.reasoning_content);
                  const hasNativeReasoning = isString(delta.reasoning_content) &&
                  delta.reasoning_content.length > 0;

                  if (!choiceState.bypass && hasNativeReasoning) {
                    const normalizedNativeReasoning = normalizeNativeReasoningAfterInline(
                      choiceState,
                      delta.reasoning_content
                    );
                    if (normalizedNativeReasoning !== delta.reasoning_content) {
                      delta.reasoning_content = normalizedNativeReasoning;
                      changed = true;
                    }
                  }

                  if (!choiceState.bypass && hasStructuredReasoning) {
                    const pending = extractor.failOpen();
                    choiceState.bypass = true;
                    if (pending.content) {
                      if (isString(delta.content)) {
                        nextContent = `${pending.content}${delta.content}`;
                        changed = true;
                      } else if (delta.content == null) {
                        nextContent = pending.content;
                        changed = true;
                      } else {
                        inlineThinkingRecoveryChoices.push({
                          index: choiceIndex,
                          delta: { content: pending.content },
                          finish_reason: null
                        });
                        totalContentLength += pending.content.length;
                        appendContent(pending.content);
                      }
                    }
                  } else if (!choiceState.bypass && isString(delta.content)) {
                    const extractedThink = extractor.process(delta.content);
                    nextContent = extractedThink.content;
                    changed = extractedThink.changed || extractedThink.content !== delta.content;
                    if (extractedThink.reasoning) {
                      delta.reasoning_content = appendInlineThinkingReasoning(
                        choiceState,
                        delta.reasoning_content,
                        extractedThink.reasoning
                      );
                      changed = true;
                      emittedInlineReasoning = true;
                    }
                  }

                  if (choice.finish_reason) {
                    const pending = extractor.flush();
                    if (pending.content) {
                      nextContent += pending.content;
                      changed = true;
                    }
                    if (pending.reasoning) {
                      delta.reasoning_content = appendInlineThinkingReasoning(
                        choiceState,
                        delta.reasoning_content,
                        pending.reasoning
                      );
                      changed = true;
                      emittedInlineReasoning = true;
                    }
                    inlineThinkingStates.delete(choiceIndex);
                  }

                  if (changed) {
                    fieldsInjected = true;
                    if (nextContent.length > 0) delta.content = nextContent;else
                    delete delta.content;
                  }

                  trackInlineThinkingReasoning(
                    choiceState,
                    delta.reasoning_content,
                    emittedInlineReasoning ? "inline" : hasNativeReasoning ? "native" : null
                  );
                }
              }

              if (inlineThinkingRecoveryChoices.length > 0) {
                const recoveryChunk = {
                  id: inlineThinkingChunkMeta?.id || parsed.id || `chatcmpl-${Date.now()}`,
                  object: inlineThinkingChunkMeta?.object || parsed.object || "chat.completion.chunk",
                  created: inlineThinkingChunkMeta?.created || parsed.created || Math.floor(Date.now() / 1000),
                  model: inlineThinkingChunkMeta?.model || parsed.model || model || "unknown",
                  choices: inlineThinkingRecoveryChoices
                };
                pendingInlineThinkingOutput += `data: ${JSON.stringify(recoveryChunk)}\n\n`;
              }

              // Mark tool calls opened only once the chunk is certain to reach the
              // client; a dropped opening fragment must not leave later ones id-less (#1433).
              if (ensureStreamToolCallIds(parsed, openedToolCalls)) fieldsInjected = true;
              recordCompletionData(parsed, { summary: false, trackUsage: false, content: true });

              // Detect terminal chunk in both OpenAI (choices[0].finish_reason) and
              // Gemini-family (response.candidates[0].finishReason) passthrough shapes.
              if (parsed.id || parsed.model) usageChunkMeta = { id: parsed.id, created: parsed.created, model: parsed.model };
              const isFinishChunk = parsed.choices?.some?.((choice) => choice?.finish_reason) ||
              parsed.response?.candidates?.[0]?.finishReason;
              const formatLine = (obj) => isDataLine ? `data: ${JSON.stringify(obj)}\n` : `${JSON.stringify(obj)}\n`;
              const lateUsage = pendingUsageEstimate && hasValidUsage(parsed.usage);
              if (provider !== "replicate" && isFinishChunk && !hasValidUsage(usage) && (!targetFormat || targetFormat === FORMATS.OPENAI) && (providerBody?.stream_options?.include_usage === true || body?.stream_options?.include_usage === true)) {
                pendingUsageEstimate = true;
              } else if (provider !== "replicate" && isFinishChunk && !hasValidUsage(usage)) {
                const estimated = mergeUsage(usage, estimateUsage(body, totalContentLength, FORMATS.OPENAI));
                parsed.usage = filterUsageForFormat(withTps(enrichUsageCost(estimated, provider, model)), FORMATS.OPENAI);
                output = formatLine(parsed);
                injectedUsage = true;
              } else if ((isFinishChunk || lateUsage) && usage) {
                pendingUsageEstimate = false;
                const buffered = addBufferToUsage(usage, provider);
                parsed.usage = filterUsageForFormat(withTps(enrichUsageCost(buffered, provider, model)), FORMATS.OPENAI);
                output = formatLine(parsed);
                injectedUsage = true;
              } else if (idFixed || fieldsInjected) {
                output = formatLine(parsed);
                injectedUsage = true;
              }

              // OpenAI finish_reason can precede a usage-only chunk, so its
              // callback waits for flush. Wrapped Antigravity terminal chunks
              // do not. A direct Gemini shape without a declared wire format
              // is the legacy helper contract and completes immediately;
              // explicit Gemini streams defer so trailing usage/tool parts win.
              const immediateGeminiTerminal =
              parsed.response?.candidates?.some?.((candidate) => candidate?.finishReason) ||
              targetFormat == null && parsed.candidates?.some?.((candidate) => candidate?.finishReason);
              if (immediateGeminiTerminal && onStreamComplete && !onStreamCompleteFired) {
                if (provider !== "replicate" && !hasValidUsage(usage) && totalContentLength > 0) {
                  usage = mergeUsage(usage, estimateUsage(body, totalContentLength, FORMATS.GEMINI));
                }
                onStreamCompleteFired = true;
                onStreamComplete(
                  {
                    ...getAccumulatedCompletion(),
                    ...(hadToolCalls ? { hadToolCalls: true } : null),
                    ...(toolCallNames.size ? { toolCallNames: [...toolCallNames] } : null)
                  },
                  usage,
                  ttftAt,
                  completionSummary(usage)
                );
              }
              if (toolNameDecloaked && !injectedUsage) {
                output = isDataLine ? `data: ${JSON.stringify(parsed)}\n` : `${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
              // A redaction mutated the frame, so the raw `line` fallback below would
              // forward the unsanitized bytes; re-serialize instead.
              if (publicError) {
                output = isDataLine ? `data: ${JSON.stringify(parsed)}\n` : `${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch {
              if (mayHold && startsSplitData(trimmed)) {
                currentUpstreamEvent = upstreamEventForLine;
                holdSplitData(line);
                continue;
              }
              upstreamTerminal.fail();
              // Skip non-JSON data lines silently — don't forward garbage to clients.
              // Upstream providers sometimes return plain-text errors (HTML, rate-limit
              // messages) in the SSE stream that would break downstream JSON decoders.
              continue;
            }
          }

          if (!injectedUsage) {
            output = spaceDataField(line) + "\n";
          }

          if (pendingInlineThinkingOutput) output = pendingInlineThinkingOutput + output;

          if (filterEmptyOpenAIFrames && isDataLine) {
            sseFrameHasData = true;
            output = pendingSSEFields + output;
            pendingSSEFields = "";
          } else if (responsesPassthrough) {
            // The held Responses label belongs in front of the line it labels;
            // a line that carries no frame of its own flushes it first.
            output = pendingSSEFields + output;
            pendingSSEFields = "";
          }

          if (isDataLine) dataFrameOpen = true;else
          if (!trimmed) dataFrameOpen = false;
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        // parseSSELine drops comments, so a long upstream wait would send the client
        // nothing and a reverse proxy would time out (decolua/9router#4376). The
        // upstream comment text is not relayed.
        if (trimmed.startsWith(":")) {
          controller.enqueue(sharedEncoder.encode(SSE_COMMENT_KEEPALIVE));
          continue;
        }

        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) {
          if (mayHold && targetFormat !== FORMATS.OLLAMA && startsSplitData(trimmed)) holdSplitData(line);else
          if (sseLineData(trimmed)) upstreamTerminal.fail();
          continue;
        }

        // Only wait when the actual upstream request asks for a usage trailer.
        if (!releasingClaudeFinish && targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.CLAUDE &&
            providerBody?.stream_options?.include_usage === true && parsed.id &&
            parsed.choices?.some?.((choice) => choice.finish_reason) && !hasValidUsage(parsed.usage)) {
          pendingClaudeFinish = parsed;
          completionFlushTimer = setTimeout(() => {
            completionFlushTimer = null;
            const finish = pendingClaudeFinish;
            pendingClaudeFinish = null;
            if (!finish) return;
            releasingClaudeFinish = true;
            try { processLines([`data: ${JSON.stringify(finish)}`], controller); }
            catch (error) { controller.error(error); }
            finally { releasingClaudeFinish = false; }
          }, PENDING_COMPLETION_FLUSH_MS);
          completionFlushTimer.unref?.();
          continue;
        }

        // An OpenAI-shaped upstream may stream `delta.content` as typed part
        // arrays (Mistral thinking chunks). Fold them into the string
        // `content` / `reasoning_content` the chat-chunk contract requires, so
        // the response translator never emits a non-string
        // `response.output_text.delta.delta` (OmniRoute #15757).
        if (sourceFormat === FORMATS.OPENAI) normalizeArrayContentChunk(parsed);

        if (upstreamErrorForwarded) continue;
        // A Responses client gets one lifecycle terminal. A later one is still
        // observed, so a contradiction counts against the attempt, but it is
        // not forwarded (upstream 9router #2713).
        if (responsesLifecycleTerminalForwarded && sourceFormat === FORMATS.OPENAI_RESPONSES) {
          const lateEventName = getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed);
          if (isOpenAIResponsesLifecycleTerminal(lateEventName, parsed)) {
            upstreamTerminal.observe({ chunk: parsed, eventName: lateEventName });
            currentUpstreamEvent = null;
            continue;
          }
        }
        // Capture raw diagnostics first; redact the public envelope (including
        // nested response.failed) before any client-facing translation.
        streamErrorPayload ??= extractStreamErrorPayload(parsed);
        sanitizePublicErrorEnvelope(parsed, errorSecrets);
        const terminalError = translatedTerminalError(parsed, nativeGemini ? FORMATS.GEMINI : sourceFormat);
        if (terminalError) {
          streamErrorPayload ??= extractStreamErrorPayload({ error: terminalError });
          clearCompletionFlushTimer();
          const output = formatTranslatedStreamError(terminalError, nativeGemini ? FORMATS.GEMINI : sourceFormat, errorSecrets);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          upstreamErrorForwarded = true;
          streamDoneSent = true;
          if (sourceFormat === FORMATS.OPENAI_RESPONSES) openAIResponsesDoneSent = true;
          continue;
        }

        // Responses API same-format passthrough: preserve event framing + track terminal state
        const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
        const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
        const openAIResponsesEventName = isOpenAIResponsesStream ?
        getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed) :
        currentUpstreamEvent;

        // A replayed Responses event re-sends a sequence_number that was already
        // forwarded. Forwarding it again glues duplicated text into the client
        // stream and doubles its share of the completion accounting, so drop it
        // before the terminal tracker, the summary and the translator see it.
        if (isOpenAIResponsesStream && responsesReplay.isReplay(parsed)) {
          continue;
        }

        upstreamTerminal.observe({
          chunk: parsed,
          eventName: openAIResponsesEventName,
          rawDone: parsed?.done === true
        });
        currentUpstreamEvent = null;
        recordCompletionData(parsed, { trackUsage: false });

        if (isOpenAIResponsesStream && isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)) {
          openAIResponsesTerminalSeen = true;
          responsesLifecycleTerminalForwarded ||= isOpenAIResponsesLifecycleTerminal(openAIResponsesEventName, parsed);
        }

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          flushPendingResponsesCompletion(controller);
          // Synthesize response.failed if the Responses stream never sent a terminal event
          if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
            const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
            reqLogger?.appendConvertedChunk?.(failedOutput);
            controller.enqueue(sharedEncoder.encode(failedOutput));
            openAIResponsesTerminalSeen = true;
            sseEmittedCount++;
          }

          // A same-format OpenAI stream only enters this path for DeepSeek-family model ids
          // (DSML tool-call recovery). Forward the wire terminator it would otherwise swallow.
          const keepsOpenAIChatFormat = targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI;
          if ((keepsOpenAIResponsesFormat || keepsOpenAIChatFormat) && !streamDoneSent) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }
          // A translated stream for an OpenAI chat client swallows the upstream
          // sentinel; flush() emits the one terminator after the translator's
          // own closing chunks (decolua/9router#4375).
          if (keepsOpenAIResponsesFormat || keepsOpenAIChatFormat || sourceFormat !== FORMATS.OPENAI) streamDoneSent = true;
          if (keepsOpenAIResponsesFormat) openAIResponsesDoneSent = true;
          continue;
        }

        // Ollama native format. Terminal `done: true` events can carry the
        // final assistant payload, and request logging must see it too.
        if (isString(parsed.message?.content) && parsed.message.content) {
          totalContentLength += parsed.message.content.length;
          appendContent(parsed.message.content);
        }
        if (isString(parsed.message?.thinking) && parsed.message.thinking) {
          totalContentLength += parsed.message.thinking.length;
          appendThinking(parsed.message.thinking);
        }

        // Claude format - content
        if (parsed.delta?.text) {
          totalContentLength += parsed.delta.text.length;
          appendContent(parsed.delta.text);
        }
        // Claude format - thinking
        if (parsed.delta?.thinking) {
          totalContentLength += parsed.delta.thinking.length;
          appendThinking(parsed.delta.thinking);
        }

        // OpenAI format - content
        if (parsed.choices?.[0]?.delta?.content) {
          totalContentLength += parsed.choices[0].delta.content.length;
          appendContent(parsed.choices[0].delta.content);
        }
        // OpenAI format - reasoning, in any vendor shape (reasoning_content preferred)
        const openAIReasoning = extractReasoningText(parsed.choices?.[0]?.delta);
        if (openAIReasoning) {
          totalContentLength += openAIReasoning.length;
          appendThinking(openAIReasoning);
        }

        // Gemini format
        if (parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content?.parts) {
          const geminiParts = parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content.parts || [];
          for (const part of geminiParts) {
            if (part.text && isString(part.text)) {
              totalContentLength += part.text.length;
              // Check if this is thinking content
              if (part.thought === true) {
                appendThinking(part.text);
              } else {
                appendContent(part.text);
              }
            }
          }
        }

        // Preserve Cloud Code's hidden usage for accounting as well as the client.
        if (nativeGemini && parsed.response?.cpaUsageMetadata) {
          parsed.response.usageMetadata = parsed.response.cpaUsageMetadata;
        }
        const extracted = extractUsage(parsed);
        if (extracted) state.usage = mergeUsage(state.usage, extracted);


        // Responses same-format passthrough: re-emit with original event framing
        if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
          const output = formatSSE({ event: openAIResponsesEventName, data: parsed }, sourceFormat);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          currentOpenAIResponsesEvent = null;
          sseEmittedCount++;
          continue;
        }

        currentOpenAIResponsesEvent = null;

        // Antigravity terminal chunks carry final content and usageMetadata.
        if ((provider === "antigravity" || provider === "agy") && parsed.response?.candidates?.some?.((candidate) => candidate?.finishReason) && onStreamComplete && !onStreamCompleteFired) {
          if (!hasValidUsage(state.usage) && totalContentLength > 0) state.usage = mergeUsage(state.usage, estimateUsage(body, totalContentLength, FORMATS.GEMINI));
          onStreamCompleteFired = true;
          onStreamComplete({
            ...getAccumulatedCompletion(),
            ...(hadToolCalls ? { hadToolCalls: true } : null),
            ...(toolCallNames.size ? { toolCallNames: [...toolCallNames] } : null),
            ...(streamErrorPayload ? { upstreamError: streamErrorPayload } : null)
          }, state.usage, ttftAt, completionSummary(state.usage));
        }

        // Provider-specific normalization must also run in TRANSLATE mode:
        // SenseNova maps delta.reasoning -> delta.reasoning_content so
        // openai-to-<target> translators (which only read reasoning_content)
        // don't drop reasoning-only chunks for Gemini/Antigravity/Vertex clients.
        PROVIDERS[provider]?.normalizeStreamChunk?.(parsed);

        // A complete, immediately adjacent usage-only frame in this same read
        // can be projected into the terminal without waiting for another read.
        // Match response IDs so a neighbouring response cannot donate its usage.
        if (targetFormat === FORMATS.OPENAI &&
            (sourceFormat === FORMATS.CLAUDE || sourceFormat === FORMATS.OPENAI_RESPONSES) &&
            parsed.id && parsed.choices?.some?.((choice) => choice?.finish_reason)) {
          const nextLine = lines.slice(lineIndex + 1).find((candidate) => candidate.trim());
          const next = nextLine && parseSSELine(nextLine.trim(), targetFormat);
          if (next?.id === parsed.id && Array.isArray(next.choices) && next.choices.length === 0 && hasValidUsage(next.usage)) {
            state.usage = mergeUsage(state.usage, next.usage);
            parsed.usage = state.usage;
          }
        }

        // Translate: targetFormat -> openai -> sourceFormat
        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

        // Log OpenAI intermediate chunks (if available)
        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (nativeGemini) {
          const output = formatSSE(antigravityGeminiResponse(parsed, toolNameMap, true), FORMATS.GEMINI);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          sseEmittedCount++;
        }
        if (!nativeGemini && translated?.length > 0) {
          for (const item of translated) {
            if (item === null || item === undefined) continue;
            // Filter empty chunks
            if (!hasValuableContent(item, sourceFormat)) {
              continue; // Skip this empty chunk
            }

            // Chat items skip the buffered restore, so return the client's tool names here.
            if (sourceFormat === FORMATS.OPENAI) restoreOpenAIToolNames(item, toolNameMap);

            // Inject estimated usage if finish chunk has no valid usage
            const isFinishChunk = item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (provider !== "replicate" && state.finishReason && isFinishChunk && !hasValidUsage(item.usage) && totalContentLength > 0) {
              const estimated = mergeUsage(state.usage ?? item.usage, estimateUsage(body, totalContentLength, sourceFormat));
              item.usage = filterUsageForFormat(withTps(enrichUsageCost(estimated, provider, model)), sourceFormat); // Filter + already has buffer
            } else if (state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              // Preserve the translated Claude cache details for OpenAI clients.
              const translatedUsage = targetFormat === FORMATS.CLAUDE && sourceFormat === FORMATS.OPENAI
                && item.usage?.prompt_tokens !== undefined ? item.usage : state.usage;
              const buffered = addBufferToUsage(translatedUsage, provider);
              item.usage = filterUsageForFormat(withTps(enrichUsageCost(buffered, provider, model)), sourceFormat);
            }

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
            sseEmittedCount++;
          }
        }
        if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES) {
          if (state.completedSent) {
            finalizeTranslatedStream();
          } else if (state.awaitingTrailingUsage && completionFlushTimer === null) {
            completionFlushTimer = setTimeout(() => {
              completionFlushTimer = null;
              if (state.completedSent || upstreamErrorForwarded) return;
              try {
                flushPendingResponsesCompletion(controller);
              } catch (error) {
                // Cancellation closes the readable side; callback or enqueue
                // failures propagate through the transform, not success.
                controller.error(error);
              }
            }, PENDING_COMPLETION_FLUSH_MS);
            completionFlushTimer.unref?.();
          }
        }
      }
  };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const nextPendingLineBytes = advancePendingSseLineBytes(pendingLineBytes, chunk);
      if (nextPendingLineBytes === null) {
        buffer = "";
        clearCompletionFlushTimer();
        upstreamTerminal.fail();
        const error = new Error("Upstream SSE line exceeded the size limit");
        error.code = "invalid_sse_payload";
        throw error;
      }
      pendingLineBytes = nextPendingLineBytes;
      const text = decoder.decode(chunk, { stream: true });
      const heldCR = buffer.endsWith("\r");
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      // Lines end at LF, CRLF or CR. A CR closing this read waits for the next
      // one, which may start with its LF. Only the new text is searched.
      const lastCR = text.length > 1 ? text.lastIndexOf("\r", text.length - 2) : -1;
      const lastEnd = Math.max(text.lastIndexOf("\n"), lastCR);
      const offset = buffer.length - text.length;
      let splitAt = -1;
      if (lastEnd >= 0) splitAt = offset + lastEnd;else
      if (heldCR && text) splitAt = offset - 1;
      let lines = [];
      if (splitAt >= 0) {
        const complete = buffer.slice(0, splitAt + 1);
        // A CRLF line keeps its CR, so forwarded lines keep their bytes.
        lines = complete.split(complete.includes("\r") ? /\r(?!\n)|\n/ : "\n");
        lines.pop();
        const endedAtCR = buffer[splitAt] === "\r";
        buffer = buffer.slice(splitAt + 1);
        // The byte cap above only resets at LF.
        if (endedAtCR) pendingLineBytes = sharedEncoder.encode(buffer).byteLength;
      }

      processLines(selectKeepaliveLines(lines), controller);
    },

    flush(controller) {
      clearCompletionFlushTimer();
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        // A held CR with nothing before it is the final frame's blank line.
        if (buffer === "\r") {
          buffer = "";
          processLines(selectKeepaliveLines([""]), controller);
        }
        // The stream ended inside a split frame, with or without a final newline.
        if (splitData) {
          const held = splitData.lines;
          splitData = null;
          const tailData = sseLineData(buffer.trim());
          const takesTail = tailData !== null && tailData !== "[DONE]";
          const joined = joinSplitData(takesTail ? [...held, buffer] : held);
          if (!joined) {
            replayLines = held.length;
            processLines(held, controller);
          } else if (takesTail) {
            processLines(joined.others, controller);
            buffer = joined.line;
          } else {
            processLines([...joined.others, joined.line], controller);
          }
        }

        if (pendingClaudeFinish) {
          const finish = pendingClaudeFinish;
          pendingClaudeFinish = null;
          const receipt = buffer.trim() && parseSSELine(buffer.trim(), targetFormat);
          if (receipt?.id === finish.id && Array.isArray(receipt.choices) && receipt.choices.length === 0 && hasValidUsage(receipt.usage)) finish.usage = receipt.usage;
          releasingClaudeFinish = true;
          try { processLines([`data: ${JSON.stringify(finish)}`], controller); } finally { releasingClaudeFinish = false; }
        }

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (sanitizeMinimaxThinking) {
            const tail = flushMinimaxThinkingStreamState(minimaxThinkingState);
            if (tail.content || tail.reasoning) {
              if (tail.reasoning) {
                totalContentLength += tail.reasoning.length;
                appendThinking(tail.reasoning);
              }
              if (tail.content) {
                totalContentLength += tail.content.length;
                appendContent(tail.content);
              }
              const flushedDelta = {
                ...(tail.content ? { content: tail.content } : null),
                ...(!omitStreamReasoning && tail.reasoning ? { reasoning_content: tail.reasoning } : null)
              };
              if (Object.keys(flushedDelta).length > 0) {
                const flushed = {
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: model || "unknown",
                  choices: [{ index: 0, delta: flushedDelta }]
                };
                const flushedOutput = `data: ${JSON.stringify(flushed)}\n`;
                reqLogger?.appendConvertedChunk?.(flushedOutput);
                controller.enqueue(sharedEncoder.encode(flushedOutput));
              }
            }
          }

          const pendingInlineThinkingOutput = flushInlineThinkingStates();
          if (pendingInlineThinkingOutput) {
            reqLogger?.appendConvertedChunk?.(pendingInlineThinkingOutput);
            controller.enqueue(sharedEncoder.encode(pendingInlineThinkingOutput));
          }

          // Decide the unterminated candidate using its final partial line too.
          if (filterProviderKeepalive && (keepaliveCandidate.length || (keepaliveFrameStart && isProviderKeepaliveEvent(buffer.replace(/\r$/, ""))))) {
            const tail = buffer;
            buffer = "";
            const selected = selectKeepaliveLines(tail ? [tail] : [], true);
            if (selected.length) {
              // The final partial line retains the existing tail handling.
              if (tail && selected[selected.length - 1] === tail) buffer = selected.pop();
              processLines(selected, controller);
            }
          }

          if (buffer) {
            const trimmedBuffer = buffer.trim();
            const bufferedChunk = parseSSELine(trimmedBuffer, targetFormat);
            const parsed = maskedGatewayErrorEnvelope(bufferedChunk) ?? bufferedChunk;
            const bufferedError = extractStreamErrorPayload(parsed);
            let output = "";
            if (parsed?.done) {
              if (!streamDoneSent) {
                emitPendingUsageEstimate(controller);
                upstreamTerminal.observe({ rawDone: true, eventName: currentUpstreamEvent });
                currentUpstreamEvent = null;
                streamDoneSent = true;
                output = "data: [DONE]\n\n";
              }
            } else if (bufferedError) {
              // Match the live error boundary: retain raw diagnostics before redacting public fields.
              streamErrorPayload ??= bufferedError;
              sanitizePublicErrorEnvelope(parsed, errorSecrets);
              upstreamTerminal.observe({ chunk: parsed, eventName: currentUpstreamEvent });
              currentUpstreamEvent = null;
              recordCompletionData(parsed, { content: true });
              const prefix = sseLineData(trimmedBuffer) !== null ? "data: " : "";
              output = `${prefix}${JSON.stringify(parsed)}\n\n`;
            } else if (parsed && targetFormat === FORMATS.OPENAI) {
              const tokenLimit = isOpenAITokenLimitFrame(parsed);
              PROVIDERS[provider]?.normalizeStreamChunk?.(parsed);
              const normalized = normalizeOpenAIPassthroughChunk(parsed);
              if (normalized.keep) {
                // An unterminated final error frame never reached the main loop; capture the
                // raw payload for settlement and redact the public copy before it goes out.
                streamErrorPayload ??= extractStreamErrorPayload(parsed);
                sanitizePublicErrorEnvelope(parsed, errorSecrets);
                upstreamTerminal.observe({ chunk: parsed, eventName: currentUpstreamEvent });
                currentUpstreamEvent = null;
                recordCompletionData(parsed, { content: true, tokenLimit });
                const prefix = sseLineData(trimmedBuffer) !== null ? "data: " : "";
                output = `${prefix}${JSON.stringify(parsed)}\n\n`;
              }
            } else if (responsesPassthrough && parsed && responsesReplay.isReplay(parsed)) {
              // The unterminated final frame is a replay: drop it and the label
              // it was holding.
              pendingSSEFields = "";
            } else if (!(filterEmptyOpenAIFrames && /^(?:id|event|retry)(?::|$)/.test(trimmedBuffer))) {
              currentUpstreamEvent = observeBufferedUpstream(trimmedBuffer, currentUpstreamEvent);
              if (parsed) recordCompletionData(parsed, { content: true });
              output = spaceDataField(buffer);
              if (!/\r?\n\r?\n$/.test(output)) output = `${output.replace(/\s+$/, "")}\n\n`;
            }
            if (output && filterEmptyOpenAIFrames && sseLineData(trimmedBuffer) !== null) {
              output = pendingSSEFields + output;
              pendingSSEFields = "";
            } else if (output && responsesPassthrough) {
              // The held Responses label belongs in front of the frame it labels.
              output = pendingSSEFields + output;
              pendingSSEFields = "";
            }
            if (output) {
              dataFrameOpen = false;
              reqLogger?.appendConvertedChunk?.(output);
              controller.enqueue(sharedEncoder.encode(output));
            }
          }

          if (pendingSSEFields && responsesPassthrough) {
            // A Responses label whose frame never arrived still belongs to the client.
            reqLogger?.appendConvertedChunk?.(pendingSSEFields);
            controller.enqueue(sharedEncoder.encode(pendingSSEFields));
            pendingSSEFields = "";
          }

          emitPendingUsageEstimate(controller);
          usage = refreshProvisionalOutput(usage, claudeOutputChars);
          if (provider !== "replicate" && !hasValidUsage(usage) && totalContentLength > 0) {
            usage = mergeUsage(usage, estimateUsage(body, totalContentLength, FORMATS.OPENAI));
          }

          if (hasValidUsage(usage)) {
            logUsage(provider, usage, model, connectionId, apiKey);
          } else {
            appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => {});
          }

          // IMPORTANT: In passthrough mode we still must terminate the SSE stream.
          // Some clients (e.g. OpenClaw) expect the OpenAI-style sentinel:
          //   data: [DONE]\n\n
          // Without it they can hang until timeout and trigger failover.
          // Gemini-family clients (Antigravity, Vertex, Gemini) reject this sentinel with 400 syntax errors.
          const isGeminiFamily = GEMINI_PASSTHROUGH_PROVIDERS.has(provider);
          const isClaudeStream = targetFormat === FORMATS.CLAUDE;
          const isResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
          if (isClaudeStream && !claudeTerminalSeen && !streamErrorPayload) {
            throw new Error("Claude passthrough stream ended before message_stop");
          }
          if (isResponsesStream && upstreamTerminal.outcome !== "success") {
            const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
            upstreamTerminal.observe({
              eventName: "response.failed",
              chunk: { type: "response.failed", response: { status: "failed" } }
            });
            reqLogger?.appendConvertedChunk?.(failedOutput);
            controller.enqueue(sharedEncoder.encode(failedOutput));
          }
          if (
          !streamDoneSent &&
          !isGeminiFamily &&
          !isClaudeStream &&
          upstreamTerminal.outcome !== "failure")
          {
            // Close the open frame first, or [DONE] would join its data.
            const doneOutput = `${dataFrameOpen ? "\n" : ""}data: [DONE]\n\n`;
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }

          if (onStreamComplete && !onStreamCompleteFired) {
            onStreamCompleteFired = true;
            onStreamComplete({
              ...getAccumulatedCompletion(),
              ...(hadToolCalls ? { hadToolCalls: true } : null),
              ...(toolCallNames.size ? { toolCallNames: [...toolCallNames] } : null),
              ...(streamErrorPayload ? { upstreamError: streamErrorPayload } : null)
            }, usage, ttftAt, completionSummary(usage));
          }
          return;
        }

        // An unterminated final error line never reached the main loop: route it through the
        // same formatter instead of letting the translators ignore it and synthesize success.
        if (mode === STREAM_MODE.TRANSLATE && !upstreamErrorForwarded && buffer.trim()) {
          const tail = parseSSELine(buffer.trim(), targetFormat);
          // Raw diagnostics first; redact nested response.failed before any
          // client-facing translation or formatted error terminal.
          streamErrorPayload ??= extractStreamErrorPayload(tail);
          sanitizePublicErrorEnvelope(tail, errorSecrets);
          const tailError = translatedTerminalError(tail, sourceFormat);
          if (tailError) {
            streamErrorPayload ??= extractStreamErrorPayload({ error: tailError });
            const output = formatTranslatedStreamError(tailError, sourceFormat, errorSecrets);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
            upstreamErrorForwarded = true;
            streamDoneSent = true;
            if (sourceFormat === FORMATS.OPENAI_RESPONSES) openAIResponsesDoneSent = true;
          }
        }

        const finalizeFailedStream = () => {
          appendRequestLog({ model, provider, connectionId, tokens: null, status: "FAILED STREAM_ERROR" }).catch(() => {});
          // Close the request-detail row as an error; without this call it kept
          // the "[Streaming in progress...]" placeholder with status "success".
          if (onStreamComplete && !onStreamCompleteFired) {
            onStreamCompleteFired = true;
            onStreamComplete({
              ...getAccumulatedCompletion(),
              upstreamError: streamErrorPayload
            }, state?.usage, ttftAt, completionSummary(state?.usage));
          }
        };

        if (upstreamErrorForwarded) {
          finalizeFailedStream();
          return;
        }

        if (buffer.trim()) {
          const trimmedBuffer = buffer.trim();
          const parsed = parseSSELine(trimmedBuffer, targetFormat);
          const replay = targetFormat === FORMATS.OPENAI_RESPONSES && responsesReplay.isReplay(parsed);
          if (!replay) {
            currentUpstreamEvent = observeBufferedUpstream(trimmedBuffer, currentUpstreamEvent);
            // Nested response.failed EOF tails re-parse here; keep raw diagnostics
            // and redact the public envelope before translation.
            streamErrorPayload ??= extractStreamErrorPayload(parsed);
            sanitizePublicErrorEnvelope(parsed, errorSecrets);
            /** recordCompletionData owns provider-summary ingestion for each parsed frame. */
            if (parsed && !parsed.done) {
              recordCompletionData(parsed, { trackUsage: false, content: true });
              const extracted = extractUsage(parsed);
              if (extracted) state.usage = mergeUsage(state.usage, extracted);
            }
            if (parsed && (!parsed.done || targetFormat === FORMATS.OLLAMA)) {
              const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

              if (translated?._openaiIntermediate) {
                for (const item of translated._openaiIntermediate) {
                  const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                  reqLogger?.appendOpenAIChunk?.(openaiOutput);
                }
              }

              if (nativeGemini) {
                controller.enqueue(sharedEncoder.encode(formatSSE(antigravityGeminiResponse(parsed, toolNameMap, true), FORMATS.GEMINI)));
              }
              if (!nativeGemini && translated?.length > 0) {
                for (const item of translated) {
                  if (item === null || item === undefined) continue;
                  if (sourceFormat === FORMATS.OPENAI) restoreOpenAIToolNames(item, toolNameMap);
                  const output = formatSSE(item, sourceFormat);
                  reqLogger?.appendConvertedChunk?.(output);
                  controller.enqueue(sharedEncoder.encode(output));
                }
              }
            }
          }
        }

        // A Gemini-family stream that reaches EOF without a finish reason or a prompt
        // block was cut off. The null flush below would invent a successful end and
        // release buffered tool calls, so end it with an error (upstream #4486).
        // A translated Responses stream with no terminal event is cut off the same way
        // (upstream #4490).
        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
        const cutGemini = !nativeGemini && GEMINI_FAMILY_FORMATS.has(targetFormat) && !state.finishReason;
        const cutResponses = targetFormat === FORMATS.OPENAI_RESPONSES && !keepsOpenAIResponsesFormat &&
          !state.finishReason && !openAIResponsesTerminalSeen && upstreamTerminal.outcome !== "success";
        if (cutGemini || cutResponses) {
          streamErrorPayload = {
            type: sourceFormat === FORMATS.CLAUDE ? "api_error" : "server_error",
            code: "incomplete_upstream_stream",
            message: cutGemini ? "Gemini stream ended before a finish reason" : "Responses stream ended before a terminal event"
          };
          const output = formatTranslatedStreamError(streamErrorPayload, sourceFormat, errorSecrets);
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          // The partial output was still generated, so account for it.
          if (!hasValidUsage(state.usage) && totalContentLength > 0) {
            state.usage = mergeUsage(state.usage, estimateUsage(body, totalContentLength, sourceFormat));
          }
          if (hasValidUsage(state.usage)) logUsage(state.provider || targetFormat, state.usage, model, connectionId, apiKey);
          finalizeFailedStream();
          return;
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (!nativeGemini && flushed?.length > 0) {
          for (const item of flushed) {
            if (item === null || item === undefined) continue;
            if (sourceFormat === FORMATS.OPENAI) restoreOpenAIToolNames(item, toolNameMap);
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }
        }

        // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
        if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          controller.enqueue(sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        // Every OpenAI-shaped client stream ends with the [DONE] sentinel, whatever
        // the upstream protocol: Gemini and Ollama upstreams close without one.
        const needsOpenAIDone = !nativeGemini && (sourceFormat === FORMATS.OPENAI || keepsOpenAIResponsesFormat);
        if (needsOpenAIDone && !openAIResponsesDoneSent && !streamDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
          openAIResponsesDoneSent = true;
          streamDoneSent = true;
        }

        finalizeTranslatedStream();
      } catch (error) {
        console.log("Error in flush:", error);
        // A native Claude stream without message_stop is truncated, not a
        // successful response. Propagate that failure to the HTTP pipeline.
        if (mode === STREAM_MODE.PASSTHROUGH && targetFormat === FORMATS.CLAUDE) {
          throw error;
        }
        // A refused buffer (retained-size budget) must not end as a clean stream.
        if (error?.code === "invalid_sse_payload") throw error;
      } finally {
        upstreamTerminal.finalize();
      }
    }
  });
  transformStream.getStreamSnapshot = getStreamSnapshot;
  transformStream.hasTokenLimitTerminal = hasTokenLimitTerminal;
  // Keep interruption snapshots stable; terminal classification also needs
  // tool and error state that is not part of the accounting snapshot contract.
  transformStream.getEmptyStreamSnapshot = () => ({
    ...getStreamSnapshot(),
    hadToolCalls,
    hasTokenLimitTerminal: hasTokenLimitTerminal(),
    upstreamError: streamErrorPayload
  });
  return transformStream;
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, claudeClassifierCompat = "off", onCoherentTerminal = null, providerBody = null, credentials = null, claudeCloaked = false, nativeGemini = false) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    onCoherentTerminal,
    providerBody,
    apiKey,
    claudeClassifierCompat,
    credentials,
    claudeCloaked,
    nativeGemini
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, targetFormat = null, onCoherentTerminal = null, providerBody = null, claudeCloaked = false, credentials = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    targetFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId,
    body,
    onStreamComplete,
    onCoherentTerminal,
    providerBody,
    apiKey,
    claudeCloaked,
    // Selected/refreshed credential values redacted from the PUBLIC error envelope.
    credentials
  });
}
