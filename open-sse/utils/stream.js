import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers.js";
import { PROVIDERS } from "../config/providers.js";
import { CLAUDE_BLOCK } from "../translator/schema/index.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";
import { createThinkTagStreamExtractor } from "./thinkStripper.js";
import { resolveInlineThinkingFormat } from "../handlers/chatCore/inlineThinking.js";
import { INLINE_THINKING_FORMATS } from "../providers/schema.js";
import { appendReasoningText } from "../translator/concerns/reasoning.js";
import { restoreOpenAIToolNames } from "../translator/concerns/toolCall.js";
import { createUpstreamTerminalTracker } from "./streamTerminal.js";
import {
  createMinimaxThinkingStreamState,
  flushMinimaxThinkingStreamState,
  isMinimaxThinkingProvider,
  sanitizeMinimaxDelta,
  shouldOmitStreamReasoning,
  stripClientReasoningDelta } from
"./minimaxThinkingStream.js";

import { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";
import { isBoolean, isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

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

function normalizeStreamError(error) {
  if (!error || !isObject(error)) {
    return { message: String(error || "Upstream stream error"), type: "server_error", code: "stream_error" };
  }
  return {
    message: String(error.message || "Upstream stream error"),
    type: String(error.type || "server_error"),
    code: String(error.code || "stream_error")
  };
}

/** Forward executor-side validation failures in the client's SSE format (#2681). */
function formatTranslatedStreamError(error, sourceFormat) {
  const normalized = normalizeStreamError(error);
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
    return `event: error\ndata: ${JSON.stringify({ type: "error", error: normalized })}\n\ndata: [DONE]\n\n`;
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
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    onCoherentTerminal = null,
    providerBody = null,
    apiKey = null,
    claudeClassifierCompat = "off"
  } = options;

  let buffer = "";
  let usage = null;

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
  { ...initState(sourceFormat, body || providerBody), provider, toolNameMap, model, signatureNamespace: connectionId, ...(claudeCompat && { claudeCompat: true }) } :
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
          } else if (chunk.usage) summaryUsage = mergeUsage(summaryUsage, scalarUsage(chunk.usage));
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
          reasoning = append(reasoning, delta?.reasoning_content ?? delta?.reasoning, MAX_REASONING);
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
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};
  let onStreamCompleteFired = false; // guard so terminal-chunk completion + flush() both fire onStreamComplete only once
  const recordCompletionData = (parsed, { summary = true, trackUsage = true, content = false } = {}) => {
    if (summary) providerSummary.ingest(parsed);
    const extracted = extractUsage(parsed);
    if (trackUsage && extracted) usage = mergeUsage(usage, extracted);
    if (!content) return extracted;

    if (!minimaxThinkingState) {
      for (const choice of parsed.choices || []) {
        const delta = choice?.delta;
        if (isString(delta?.content) && delta.content) {
          totalContentLength += delta.content.length;
          accumulatedContent += delta.content;
        }
        if (isString(delta?.reasoning_content) && delta.reasoning_content) {
          totalContentLength += delta.reasoning_content.length;
          accumulatedThinking += delta.reasoning_content;
        }
      }
    }
    const geminiParts = parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content?.parts || [];
    for (const part of geminiParts) {
      if (!isString(part?.text) || !part.text) continue;
      totalContentLength += part.text.length;
      if (part.thought === true) accumulatedThinking += part.text;else
      accumulatedContent += part.text;
    }
    return extracted;
  };

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let currentUpstreamEvent = null;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let streamDoneSent = false; // track duplicate [DONE] across transform + flush
  let claudeTerminalSeen = false;
  let upstreamErrorForwarded = false;
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
  const observeBufferedUpstream = (text, pendingEventName = null) => {
    let eventName = pendingEventName;
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || null;
        continue;
      }
      if (!line.startsWith("data:") && !line.startsWith("{")) continue;
      const parsed = parseSSELine(line, targetFormat);
      if (parsed?.done) upstreamTerminal.observe({ rawDone: true, eventName });else
      if (parsed) {
        upstreamTerminal.observe({ chunk: parsed, eventName });
        if (
        targetFormat === FORMATS.CLAUDE &&
        parsed?.type === "message_stop" &&
        upstreamTerminal.outcome === "success")
        claudeTerminalSeen = true;
      } else
      if (line.startsWith("{") || line.slice(5).trim()) upstreamTerminal.fail();
      eventName = null;
    }
    return eventName;
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
        accumulatedContent += pending.content;
      }
      if (pending.reasoning) {
        delta.reasoning_content = appendInlineThinkingReasoning(choiceState, undefined, pending.reasoning);
        trackInlineThinkingReasoning(choiceState, delta.reasoning_content, "inline");
        totalContentLength += delta.reasoning_content.length;
        accumulatedThinking += delta.reasoning_content;
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

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (isDebugEnabled && trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
        }

        // SSE event labels are part of the upstream terminal contract. Keep the
        // next label in every mode/format so event/payload contradictions cannot
        // be hidden by passthrough normalization.
        if (trimmed.startsWith("event:")) {
          currentUpstreamEvent = trimmed.slice(6).trim() || null;
          if (mode === STREAM_MODE.TRANSLATE && targetFormat === FORMATS.OPENAI_RESPONSES) {
            currentOpenAIResponsesEvent = currentUpstreamEvent;
          }
        }

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          let output;
          let injectedUsage = false;
          let pendingInlineThinkingOutput = "";
          const inlineThinkingRecoveryChoices = [];

          const isDoneLine = /^data:\s*\[DONE\]\s*$/.test(trimmed);
          const isDataLine = trimmed.startsWith("data:");
          const upstreamEventForLine = isDataLine ? currentUpstreamEvent : null;
          if (isDataLine) currentUpstreamEvent = null;
          if (isDoneLine) {
            pendingInlineThinkingOutput = flushInlineThinkingStates();
            streamDoneSent = true;
            upstreamTerminal.observe({ rawDone: true, eventName: upstreamEventForLine });
          }

          if ((isDataLine || trimmed.startsWith("{")) && !isDoneLine && (isDataLine ? trimmed.slice(5).trim() : trimmed)) {
            try {
              const parsed = JSON.parse(isDataLine ? trimmed.slice(5).trim() : trimmed);
              upstreamTerminal.observe({ chunk: parsed, eventName: upstreamEventForLine });
              recordCompletionData(parsed, { trackUsage: false });
              if (
              targetFormat === FORMATS.CLAUDE &&
              parsed?.type === "message_stop" &&
              upstreamTerminal.outcome === "success")
              claudeTerminalSeen = true;

              if (Array.isArray(parsed?.choices)) {
                inlineThinkingChunkMeta = {
                  id: parsed.id,
                  object: parsed.object,
                  created: parsed.created,
                  model: parsed.model
                };
              }

              const idFixed = fixInvalidId(parsed);

              // Decloak tool names in Claude content_block_start events.
              // claude→claude passthrough doesn't go through translateResponse (which
              // applies toolNameMap in TRANSLATE mode), so without this the client
              // receives suffixed names (e.g. "Execute_ide") it doesn't recognize.
              let toolNameDecloaked = false;
              if (toolNameMap?.size > 0 && parsed?.type === "content_block_start" && parsed?.content_block?.type === "tool_use") {
                const original = toolNameMap?.get(parsed.content_block.name);
                if (original) {
                  parsed.content_block = { ...parsed.content_block, name: original };
                  toolNameDecloaked = true;
                }
              }
              if (restoreOpenAIToolNames(parsed, toolNameMap)) toolNameDecloaked = true;

              // Some Anthropic-compatible providers (MiniMax) omit `signature`
              // from the thinking block start. Strict Messages clients deserialize
              // that field before the later signature_delta arrives, so inject an
              // empty placeholder when the provider quirk requests it (#2706).
              let fieldsInjected = false;
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
                  accumulatedContent += content;
                }
                if (reasoning && isString(reasoning)) {
                  totalContentLength += reasoning.length;
                  accumulatedThinking += reasoning;
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
                        accumulatedContent += pending.content;
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

              recordCompletionData(parsed, { summary: false, trackUsage: false, content: true });

              // Detect terminal chunk in both OpenAI (choices[0].finish_reason) and
              // Gemini-family (response.candidates[0].finishReason) passthrough shapes.
              const isFinishChunk = parsed.choices?.some?.((choice) => choice?.finish_reason) ||
              parsed.response?.candidates?.[0]?.finishReason;
              const formatLine = (obj) => isDataLine ? `data: ${JSON.stringify(obj)}\n` : `${JSON.stringify(obj)}\n`;
              if (isFinishChunk && !hasValidUsage(usage)) {
                const estimated = mergeUsage(usage, estimateUsage(body, totalContentLength, FORMATS.OPENAI));
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                output = formatLine(parsed);
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                const buffered = addBufferToUsage(usage);
                parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
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
                if (!hasValidUsage(usage) && totalContentLength > 0) {
                  usage = mergeUsage(usage, estimateUsage(body, totalContentLength, FORMATS.GEMINI));
                }
                onStreamCompleteFired = true;
                onStreamComplete(
                  { content: accumulatedContent, thinking: accumulatedThinking },
                  usage,
                  ttftAt,
                  providerSummary.finalize(usage)
                );
              }
              if (toolNameDecloaked && !injectedUsage) {
                output = isDataLine ? `data: ${JSON.stringify(parsed)}\n` : `${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch {
              upstreamTerminal.fail();
              // Skip non-JSON data lines silently — don't forward garbage to clients.
              // Upstream providers sometimes return plain-text errors (HTML, rate-limit
              // messages) in the SSE stream that would break downstream JSON decoders.
              continue;
            }
          }

          if (!injectedUsage) {
            if (line.startsWith("data:") && !line.startsWith("data: ")) {
              output = "data: " + line.slice(5) + "\n";
            } else {
              output = line + "\n";
            }
          }

          if (pendingInlineThinkingOutput) output = pendingInlineThinkingOutput + output;

          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(sharedEncoder.encode(output));
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) {
          if (trimmed.startsWith("data:") && trimmed.slice(5).trim()) upstreamTerminal.fail();
          continue;
        }

        if (upstreamErrorForwarded) continue;
        if (parsed.error) {
          const output = formatTranslatedStreamError(parsed.error, sourceFormat);
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

        upstreamTerminal.observe({
          chunk: parsed,
          eventName: openAIResponsesEventName,
          rawDone: parsed?.done === true
        });
        currentUpstreamEvent = null;
        providerSummary.ingest(parsed);

        if (isOpenAIResponsesStream && isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)) {
          openAIResponsesTerminalSeen = true;
        }

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          // Synthesize response.failed if the Responses stream never sent a terminal event
          if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
            const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
            reqLogger?.appendConvertedChunk?.(failedOutput);
            controller.enqueue(sharedEncoder.encode(failedOutput));
            openAIResponsesTerminalSeen = true;
            sseEmittedCount++;
          }

          if (keepsOpenAIResponsesFormat && !streamDoneSent) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }
          streamDoneSent = true;
          if (keepsOpenAIResponsesFormat) openAIResponsesDoneSent = true;
          continue;
        }

        // Ollama native format. Terminal `done: true` events can carry the
        // final assistant payload, and request logging must see it too.
        if (isString(parsed.message?.content) && parsed.message.content) {
          totalContentLength += parsed.message.content.length;
          accumulatedContent += parsed.message.content;
        }
        if (isString(parsed.message?.thinking) && parsed.message.thinking) {
          totalContentLength += parsed.message.thinking.length;
          accumulatedThinking += parsed.message.thinking;
        }

        // Claude format - content
        if (parsed.delta?.text) {
          totalContentLength += parsed.delta.text.length;
          accumulatedContent += parsed.delta.text;
        }
        // Claude format - thinking
        if (parsed.delta?.thinking) {
          totalContentLength += parsed.delta.thinking.length;
          accumulatedThinking += parsed.delta.thinking;
        }

        // OpenAI format - content
        if (parsed.choices?.[0]?.delta?.content) {
          totalContentLength += parsed.choices[0].delta.content.length;
          accumulatedContent += parsed.choices[0].delta.content;
        }
        // OpenAI format - reasoning
        if (parsed.choices?.[0]?.delta?.reasoning_content) {
          totalContentLength += parsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking += parsed.choices[0].delta.reasoning_content;
        }

        // Gemini format
        if (parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content?.parts) {
          const geminiParts = parsed.candidates?.[0]?.content?.parts || parsed.response?.candidates?.[0]?.content.parts || [];
          for (const part of geminiParts) {
            if (part.text && isString(part.text)) {
              totalContentLength += part.text.length;
              // Check if this is thinking content
              if (part.thought === true) {
                accumulatedThinking += part.text;
              } else {
                accumulatedContent += part.text;
              }
            }
          }
        }

        // Extract usage
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
          onStreamComplete({ content: accumulatedContent, thinking: accumulatedThinking }, state.usage, ttftAt, providerSummary.finalize(state.usage));
        }

        // Provider-specific normalization must also run in TRANSLATE mode:
        // SenseNova maps delta.reasoning -> delta.reasoning_content so
        // openai-to-<target> translators (which only read reasoning_content)
        // don't drop reasoning-only chunks for Gemini/Antigravity/Vertex clients.
        PROVIDERS[provider]?.normalizeStreamChunk?.(parsed);

        // Translate: targetFormat -> openai -> sourceFormat
        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

        // Log OpenAI intermediate chunks (if available)
        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (translated?.length > 0) {
          for (const item of translated) {
            if (item === null || item === undefined) continue;
            // Filter empty chunks
            if (!hasValuableContent(item, sourceFormat)) {
              continue; // Skip this empty chunk
            }

            // Inject estimated usage if finish chunk has no valid usage
            const isFinishChunk = item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (state.finishReason && isFinishChunk && !hasValidUsage(item.usage) && totalContentLength > 0) {
              const estimated = mergeUsage(state.usage ?? item.usage, estimateUsage(body, totalContentLength, sourceFormat));
              item.usage = filterUsageForFormat(estimated, sourceFormat); // Filter + already has buffer
            } else if (state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              const buffered = addBufferToUsage(state.usage);
              item.usage = filterUsageForFormat(buffered, sourceFormat);
            }

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
            sseEmittedCount++;
          }
        }
      }
    },

    flush(controller) {
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (sanitizeMinimaxThinking) {
            const tail = flushMinimaxThinkingStreamState(minimaxThinkingState);
            if (tail.content || tail.reasoning) {
              if (tail.reasoning) {
                totalContentLength += tail.reasoning.length;
                accumulatedThinking += tail.reasoning;
              }
              if (tail.content) {
                totalContentLength += tail.content.length;
                accumulatedContent += tail.content;
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

          if (buffer) {
            const trimmedBuffer = buffer.trim();
            currentUpstreamEvent = observeBufferedUpstream(trimmedBuffer, currentUpstreamEvent);
            const parsed = parseSSELine(trimmedBuffer, targetFormat);
            if (parsed && !parsed.done) recordCompletionData(parsed, { content: true });
            let output;
            if (/^data:\s*\[DONE\]$/.test(trimmedBuffer)) {
              output = "data: [DONE]\n\n";
              streamDoneSent = true;
            } else {
              output = buffer;
              if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
                output = "data: " + buffer.slice(5);
              }
              if (!/\r?\n\r?\n$/.test(output)) output = `${output.replace(/\s+$/, "")}\n\n`;
            }
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }

          if (!hasValidUsage(usage) && totalContentLength > 0) {
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
          if (isClaudeStream && !claudeTerminalSeen) {
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
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            controller.enqueue(sharedEncoder.encode(doneOutput));
          }

          if (onStreamComplete && !onStreamCompleteFired) {
            onStreamCompleteFired = true;
            onStreamComplete({
              content: accumulatedContent,
              thinking: accumulatedThinking
            }, usage, ttftAt, providerSummary.finalize(usage));
          }
          return;
        }

        if (upstreamErrorForwarded) {
          appendRequestLog({ model, provider, connectionId, tokens: null, status: "FAILED STREAM_ERROR" }).catch(() => {});
          return;
        }

        if (buffer.trim()) {
          const trimmedBuffer = buffer.trim();
          currentUpstreamEvent = observeBufferedUpstream(trimmedBuffer, currentUpstreamEvent);
          const parsed = parseSSELine(trimmedBuffer, targetFormat);
          if (parsed && !parsed.done) providerSummary.ingest(parsed);
          if (parsed && (!parsed.done || targetFormat === FORMATS.OLLAMA)) {
            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                if (item === null || item === undefined) continue;
                const output = formatSSE(item, sourceFormat);
                reqLogger?.appendConvertedChunk?.(output);
                controller.enqueue(sharedEncoder.encode(output));
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            if (item === null || item === undefined) continue;
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(sharedEncoder.encode(output));
          }
        }

        // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
        if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          controller.enqueue(sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        if (keepsOpenAIResponsesFormat && !openAIResponsesDoneSent && !streamDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          controller.enqueue(sharedEncoder.encode(doneOutput));
          openAIResponsesDoneSent = true;
          streamDoneSent = true;
        }

        if (!hasValidUsage(state?.usage) && totalContentLength > 0) {
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
            content: accumulatedContent,
            thinking: accumulatedThinking
          }, state?.usage, ttftAt, providerSummary.finalize(state?.usage));
        }
      } catch (error) {
        console.log("Error in flush:", error);
        // A native Claude stream without message_stop is truncated, not a
        // successful response. Propagate that failure to the HTTP pipeline.
        if (mode === STREAM_MODE.PASSTHROUGH && targetFormat === FORMATS.CLAUDE) {
          throw error;
        }
      } finally {
        upstreamTerminal.finalize();
      }
    }
  });
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, claudeClassifierCompat = "off", onCoherentTerminal = null, providerBody = null) {
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
    claudeClassifierCompat
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, targetFormat = null, onCoherentTerminal = null, providerBody = null) {
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
    apiKey
  });
}