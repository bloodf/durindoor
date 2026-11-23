import { invalidClassifierVerdict } from "./classifierVerdict.js";
import { encodeClaudeThinking } from "../../translator/concerns/claudeThinkingEnvelope.js";
import { antigravityGeminiResponse } from "./antigravityGeminiNative.js";
import { responsesSearchToClaudeMessage } from "../../translator/response/responses-to-claude.js";
import { hasClaudeSearch } from "../../translator/concerns/searchRouting.js";
import { normalizeDsmlClaudeMessage, normalizeDsmlCompletion } from "../../translator/concerns/dsml.js";
import { normalizeMistralContent } from "../../utils/arrayContentDelta.js";
import { FORMATS, GEMINI_FAMILY_FORMATS } from "../../translator/formats.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { unwrapClinepassEnvelope } from "../../utils/clinepassEnvelope.js";
import { addBufferToUsage, claudeUsageToOpenAI, enrichUsageCost, estimateNonStreamingUsage, filterUsageForFormat } from "../../utils/usageTracking.js";
import { detectQuotaExhaustion } from "../../services/accountFallback.js";
import { createErrorResult as createFormattedErrorResult } from "../../utils/error.js";
import { readBodyWithTimeout, BodyReadTimeoutError } from "../../utils/bodyTimeout.js";
import { HTTP_STATUS, MAX_PROVIDER_BODY_BYTES, RESPONSE_BODY_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { EMPTY_CONTENT_COOLDOWN_MS, INCOHERENT_NON_STREAMING_RESPONSE_MESSAGE } from "../../config/errorConfig.js";
import { parseSSEToOpenAIResponse, createSSEErrorResult } from "./sseToJsonHandler.js";
import { parseJsonDocumentBehindEventStream } from "./nonStreamingJsonDocument.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { translateOpenAIToClaudeIfNeeded } from "../../translator/response/openai-to-claude-json.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { restoreClaudeToolNames, restoreGeminiToolNames, restoreOpenAIToolNames } from "../../translator/concerns/toolCall.js";
import { openAIResponsesBodyToClaude, openAIResponsesBodyToGemini, openAIResponsesBodyToOpenAI } from "../../translator/response/openai-responses-nonstream.js";
import { projectCompletionToClientFormat } from "../../translator/response/completionProjector.js";
import { createResponsesToolNameResolver } from "../../translator/response/openai-responses.js";
import { translateResponse, initState } from "../../translator/index.js";
import { formatSSE } from "../../utils/streamHelpers.js";
import { SSE_HEADERS_CORS } from "../../utils/sseConstants.js";
import { resolvedModelHeaders } from "../../utils/routeResponseHeaders.js";
import { normalizeInlineThinkingResponse } from "./inlineThinking.js";
import { normalizeOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { toOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { encodeToolCallIdWithSignature } from "../../translator/concerns/signatureTransport.js";
import { createGeminiPlaceholderStripper } from "../../translator/concerns/geminiPlaceholderArgs.js";
import { hasResponsesContentItem, isResponsesReceipt } from "../../utils/responsesContent.js";
import { classifyMaskedGatewayError, hasTokenLimitCompletion, isCoherentNonStreamingResponse } from "../../utils/streamTerminal.js";
import { PROVIDERS } from "../../config/providers.js";
import { CLAUDE_BLOCK } from "../../translator/schema/blocks.js";
import { CLAUDE_STOP, GEMINI_FINISH } from "../../translator/schema/finishReasons.js";
import { applyReasoningVisibility } from "../../utils/reasoningVisibility.js";
import { classifyFakeSuccessBody, extractAssistantText } from "../../services/fakeSuccessBodyClassifier.js";
import { evictResponseDispatcher } from "../../utils/proxyFetch.js";

// Upstream #10258: reject parsed JSON that isn't a plain record (primitives,
// arrays, null) before any envelope unwrap or property access can throw or
// silently coerce garbage into a "coherent" response.
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
function isJsonRecord(value) {
  return !!value && isObject(value) && !Array.isArray(value);
}

/**
 * Upstream marker for a provider body that is an HTML/XML error page instead
 * of a JSON payload: a doctype or comment (`<!`), a tag (`<` plus a letter) or
 * an XML declaration (`<?xml`).
 *
 * Ported from OmniRoute #1104 (head `d0efab8222df9e63050f6f90dae91ccd520eba66`,
 * merge `f8045744b3ec0974eeb0ac3feb0ab039302592af`). The merged upstream
 * expression was `/^\s*(?:\s|<!|<[a-zA-Z]|<\?xml)/` applied to the untrimmed
 * body; its leading `\s` alternative lets the pattern match after backtracking
 * over the whitespace, so ANY body that merely starts with whitespace was
 * classified as an HTML error page and the "generic non-JSON" case was
 * unreachable for an indented plain-text body. The upstream pull-request head
 * used `/^(\s|<!|<[a-zA-Z][a-zA-Z0-9]*|<\?xml)/` on the trimmed body, which
 * keeps the same marker set but requires one of them to be present. This port
 * keeps that behavior: an HTML error page stays distinguishable from other
 * unusable non-JSON content.
 */
const HTML_ERROR_PAGE_PATTERN = /^(?:<!|<[a-zA-Z]|<\?xml)/;

/**
 * Detect an upstream HTML/XML error page in a provider body that failed to
 * parse. The body itself is never echoed, stored or logged.
 * @param {string} text - Raw provider body.
 * @returns {boolean} True when the body is an HTML/XML error page.
 */
export function isHtmlErrorPageBody(text) {
  return isString(text) && HTML_ERROR_PAGE_PATTERN.test(text.trimStart());
}

/**
 * Client-facing diagnostic for a provider that answered with an HTML error
 * page instead of a JSON body. It names the fact and the two things an
 * operator can check; it carries no upstream text and no request detail.
 */
const HTML_PROVIDER_ERROR_MESSAGE =
  "Provider returned HTML error page instead of JSON - check credentials and endpoint";

/** Recover a complete JSON object only when its sole trailing content is an SSE done marker (#5384). */
export function parseJsonWithTrailingDone(text) {
  const input = text.trimStart();
  if (!input.startsWith("{")) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      if (!/^\s*data:\s*\[DONE\]\s*$/.test(input.slice(i + 1))) return null;
      try { return JSON.parse(input.slice(0, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/** Check the emitted response shape for client-usable text, reasoning, or tools. */
function hasUsefulContent(response) {
  /** Translation may emit OpenAI choices regardless of the client's source dialect. */
  if (Array.isArray(response?.choices)) {
    const message = response.choices[0]?.message;
    return isString(message?.content) && message.content.trim().length > 0 ||
    Array.isArray(message?.content) && message.content.length > 0 ||
    isString(message?.reasoning_content) && message.reasoning_content.trim().length > 0 ||
    isString(message?.reasoning) && message.reasoning.trim().length > 0 ||
    isString(message?.audio?.data) && message.audio.data.length > 0 ||
    Array.isArray(message?.tool_calls) && message.tool_calls.length > 0 ||
    Boolean(message?.function_call);
  }
  if (response?.type === "message") {
    return response.stop_reason === "refusal" ||
    Array.isArray(response.content) && response.content.some((block) =>
    block?.type === "tool_use" ||
    block?.type === "thinking" && isString(block.thinking) && block.thinking.trim() ||
    block?.type === "text" && isString(block.text) && block.text.trim());
  }

  // Background Responses acknowledge acceptance with an empty output array.
  if (isResponsesReceipt(response)) return true;
  if (Array.isArray(response?.output)) return response.output.some(hasResponsesContentItem);

  const candidates = response?.candidates ?? response?.response?.candidates;
  if (Array.isArray(candidates)) {
    return candidates.some((candidate) =>
    Array.isArray(candidate?.content?.parts) && candidate.content.parts.some((part) =>
    isString(part?.text) && part.text.trim() || part?.functionCall || part?.inlineData || part?.inline_data));
  }

  if (response?.message || isString(response?.response)) {
    return isString(response?.message?.content) && response.message.content.trim().length > 0 ||
    isString(response?.response) && response.response.trim().length > 0 ||
    Array.isArray(response?.message?.tool_calls) && response.message.tool_calls.length > 0;
  }

  return false;
}

// Antigravity is Google's first-party Gemini API: an empty candidate paired
// with a normal terminal stop is a real, legitimate answer, not the
// scraping-provider "empty 200 shell" failure hasUsefulContent() otherwise
// guards against (OmniRoute #14243 / #14160). Retrying the same prompt on
// another account just returns the same empty answer, so treating it as a
// 502 only locks a healthy account out of the pool. Every other provider
// (and antigravity itself on any non-normal finish) keeps the guard.
const TRUSTED_EMPTY_STOP_PROVIDERS = new Set(["antigravity", "agy"]);

function hasNormalTerminalStop(response) {
  if (Array.isArray(response?.choices)) return response.choices[0]?.finish_reason === "stop";
  if (response?.type === "message") return response.stop_reason === CLAUDE_STOP.END_TURN;
  return false;
}

function isTrustedEmptyStop(response, provider) {
  return TRUSTED_EMPTY_STOP_PROVIDERS.has(provider) && hasNormalTerminalStop(response);
}

// Claude Code classifier compat: detect classifier-shaped requests by the
// security-monitor system prompt or the "</block>" stop sequence, gated by the
// claudeClassifierCompat setting ("off" | "auto" | "always").
function shouldEnableClaudeCompat(mode, sourceFormat, body) {
  if (sourceFormat !== FORMATS.CLAUDE) return false;
  if (mode === "always") return true;
  if (mode !== "auto") return false;
  const systemTexts = Array.isArray(body?.system) ?
  body.system.map((part) => isString(part?.text) ? part.text : "").filter(Boolean) :
  [];
  const stopSequences = Array.isArray(body?.stop_sequences) ? body.stop_sequences : [];
  return systemTexts.some((text) => text.includes("You are a security monitor for autonomous AI coding agents")) ||
  stopSequences.includes("</block>");
}

// Reconstruct Claude cache usage the Chat converter drops without changing
// prompt_tokens: reverse projection reports full input plus cache fields.
function normalizeClaudeCacheUsage(claudeMsg, originalBody) {
  if (!claudeMsg || claudeMsg.type !== "message") return claudeMsg;
  const cached = originalBody?.usage?.prompt_tokens_details?.cached_tokens;
  claudeMsg.usage = claudeMsg.usage || {};
  // An explicit reported zero is kept; an omitted counter is not invented.
  if (Number.isFinite(cached) && cached >= 0) claudeMsg.usage.cache_read_input_tokens = cached;
  return claudeMsg;
}

// Strip thinking blocks from a Claude message for classifier clients that
// reject content_block_start {thinking}. Conditional on compat mode.
function stripClaudeThinking(claudeMsg) {
  if (!claudeMsg || claudeMsg.type !== "message") return claudeMsg;
  if (Array.isArray(claudeMsg.content)) {
    claudeMsg.content = claudeMsg.content.filter((block) => block?.type !== CLAUDE_BLOCK.THINKING);
    if (claudeMsg.content.length === 0) claudeMsg.content.push({ type: CLAUDE_BLOCK.TEXT, text: "" });
  }
  return claudeMsg;
}


function openAICompletionToChunks(responseBody, fallbackModel) {
  const id = responseBody?.id || `chatcmpl-${Date.now()}`;
  const created = responseBody?.created || Math.floor(Date.now() / 1000);
  const model = responseBody?.model || fallbackModel;
  const choices = Array.isArray(responseBody?.choices) && responseBody.choices.length > 0 ?
  responseBody.choices :
  [{}];
  const choiceIndex = (choice, position) => Number.isInteger(choice?.index) ? choice.index : position;
  const chunks = [{
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: choices.map((choice, position) => ({
      index: choiceIndex(choice, position),
      delta: { role: choice?.message?.role || "assistant" },
      finish_reason: null
    }))
  }];

  const reasoningChoices = choices.flatMap((choice, position) => {
    const reasoning = choice?.message?.reasoning_content;
    return isString(reasoning) && reasoning.length > 0 ?
    [{ index: choiceIndex(choice, position), delta: { reasoning_content: reasoning }, finish_reason: null }] :
    [];
  });
  if (reasoningChoices.length > 0) {
    chunks.push({
      id, object: "chat.completion.chunk", created, model,
      choices: reasoningChoices
    });
  }

  const contentChoices = choices.flatMap((choice, position) => {
    const content = choice?.message?.content;
    return isString(content) && content.length > 0 ?
    [{ index: choiceIndex(choice, position), delta: { content }, finish_reason: null }] :
    [];
  });
  if (contentChoices.length > 0) {
    chunks.push({
      id, object: "chat.completion.chunk", created, model,
      choices: contentChoices
    });
  }

  const toolChoices = choices.flatMap((choice, position) => {
    const toolCalls = choice?.message?.tool_calls;
    return Array.isArray(toolCalls) && toolCalls.length > 0 ?
    [{
      index: choiceIndex(choice, position),
      delta: { tool_calls: toolCalls.map((toolCall, index) => ({ index, ...toolCall })) },
      finish_reason: null
    }] :
    [];
  });
  if (toolChoices.length > 0) {
    chunks.push({
      id, object: "chat.completion.chunk", created, model,
      choices: toolChoices
    });
  }

  const final = {
    id, object: "chat.completion.chunk", created, model,
    choices: choices.map((choice, position) => ({
      index: choiceIndex(choice, position),
      delta: {},
      finish_reason: choice?.finish_reason || "stop"
    }))
  };
  if (responseBody?.usage) final.usage = responseBody.usage;
  chunks.push(final);
  return chunks;
}

function openAICompletionToClientSSE(responseBody, fallbackModel, sourceFormat) {
  const state = initState(sourceFormat);
  let output = "";
  for (const chunk of openAICompletionToChunks(responseBody, fallbackModel)) {
    const events = sourceFormat === FORMATS.OPENAI ?
    [chunk] :
    translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
    for (const event of events || []) {
      if (event != null) output += formatSSE(event, sourceFormat);
    }
  }
  if (sourceFormat === FORMATS.OPENAI) output += formatSSE({ done: true }, sourceFormat);
  return output;
}


/**
 * Translate non-streaming response body from upstream format → client format.
 *
 * `sourceFormat` is what the client asked for. `targetFormat` is the selected
 * upstream transport. When they differ, the provider response must be projected
 * back into `sourceFormat` before returning it to the client.
 *
 * Most branches translate an upstream response into OpenAI chat.completion
 * shape first. Responses clients are an exception: chat-completion upstreams
 * must be projected back into a Responses object before generic OpenAI
 * passthrough can return the raw provider body.
 *
 * Streaming responses go through translateResponse() — this function only
 * handles non-streaming JSON bodies.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, options = {}) {
  if (targetFormat === FORMATS.OPENAI) normalizeDsmlCompletion(responseBody, options.effectiveModel || options.model, options.provider);
  /** Upstream PR #3373: request translators emit arrays; projection uses Set membership. */
  const customToolNames = options.customToolNames instanceof Set ?
  options.customToolNames :
  new Set(options.customToolNames || []);
  // Same name resolution as the streaming translator: restore request-side aliases,
  // then split namespace tools and strip provider-injected prefixes (upstream PR #4200).
  const responsesClient = sourceFormat === FORMATS.OPENAI_RESPONSES || sourceFormat === FORMATS.OPENAI_RESPONSE;
  const projectionOptions = () => {
    if (!responsesClient) return { ...options, customToolNames };
    return { ...options, customToolNames, resolveToolName: createResponsesToolNameResolver(options.requestBody, options.toolNameMap) };
  };
  /**
   * Project Responses-client calls before generic OpenAI upstream passthrough.
   */
  if (
  responsesClient &&
  targetFormat === FORMATS.OPENAI &&
  Array.isArray(responseBody?.choices))
  {
    return projectCompletionToClientFormat(responseBody, sourceFormat, projectionOptions());
  }
  /** Normalize NVIDIA/vLLM's OpenAI reasoning alias on same-format passthrough. */
  if (targetFormat === sourceFormat) {
    if (targetFormat === FORMATS.OPENAI) {
      for (const choice of responseBody?.choices || []) {
        const message = choice?.message;
        if (isString(message?.reasoning) && !message.reasoning_content) {
          message.reasoning_content = message.reasoning;
          delete message.reasoning;
        }
      }
      // Same-format Chat skips translateResponse; restore request-side aliases here
      // so clients never see the upstream-safe rewrite (#1343).
      restoreOpenAIToolNames(responseBody, options.toolNameMap);
    }
    return responseBody;
  }

  // When the client spoke Claude but the upstream spoke OpenAI (e.g. gpt-5.5-9router
  // routes to an OpenAI-format provider), convert the OpenAI body to Anthropic
  // Messages shape so the Claude client gets a parseable content[] block
  // instead of a leaked {object:"chat.completion",choices:[...]} payload.
  if (sourceFormat === FORMATS.CLAUDE && targetFormat === FORMATS.OPENAI) {
    let claudeMsg = translateOpenAIToClaudeIfNeeded(responseBody, sourceFormat, options);
    claudeMsg = normalizeClaudeCacheUsage(claudeMsg, responseBody);
    return options.claudeCompat ? stripClaudeThinking(claudeMsg) : claudeMsg;
  }
  if (sourceFormat === FORMATS.GEMINI && targetFormat === FORMATS.OPENAI && responseBody?.choices?.[0]) {
    // The shared projector returns a wrapped Gemini-family body; native Gemini
    // requires candidates and usageMetadata at the top level.
    const result = projectCompletionToClientFormat(responseBody, sourceFormat, projectionOptions()).response;
    const calls = responseBody.choices[0].message?.tool_calls || [];
    let callIndex = 0;
    for (const part of result.candidates[0].content.parts) {
      if (part.functionCall) {
        const id = calls[callIndex++]?.id;
        if (id !== undefined) part.functionCall.id = id;
      }
    }
    const usage = responseBody.usage;
    if (usage?.prompt_tokens_details?.cached_tokens !== undefined) {
      result.usageMetadata.cachedContentTokenCount = usage.prompt_tokens_details.cached_tokens;
    }
    if (usage?.completion_tokens_details?.reasoning_tokens !== undefined) {
      result.usageMetadata.thoughtsTokenCount = usage.completion_tokens_details.reasoning_tokens;
      // OpenAI completion tokens include reasoning; Gemini counts thoughts separately.
      result.usageMetadata.candidatesTokenCount = Math.max(0,
        result.usageMetadata.candidatesTokenCount - result.usageMetadata.thoughtsTokenCount);
    }
    return result;
  }
  if (targetFormat === FORMATS.OPENAI) return responseBody;

  // OpenAI Responses API JSON body → requested client format.
  // Streaming goes through translateResponse(); non-streaming needs an explicit
  // body-level conversion so clients always receive the shape they requested,
  // including a usage object (some clients validate `usage.input_tokens`).
  if (targetFormat === FORMATS.OPENAI_RESPONSES) {
    if (sourceFormat === FORMATS.CLAUDE) {
      let claudeMsg = openAIResponsesBodyToClaude(responseBody);
      if (options.provider === "codex" && hasClaudeSearch(options.requestBody)) claudeMsg = responsesSearchToClaudeMessage(responseBody, claudeMsg, true);
      return options.claudeCompat ? stripClaudeThinking(claudeMsg) : claudeMsg;
    }
    if (sourceFormat === FORMATS.OPENAI) {
      return openAIResponsesBodyToOpenAI(responseBody, { chatCustomToolNames: initState(FORMATS.OPENAI, options.requestBody).chatCustomToolNames, toolNameMap: options.toolNameMap });
    }
    // Native Gemini uses top-level candidates; Antigravity / gemini-cli keep the
    // { response } envelope that their stream translators emit.
    if (GEMINI_FAMILY_FORMATS.has(sourceFormat)) {
      const geminiBody = openAIResponsesBodyToGemini(responseBody);
      return sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.VERTEX ?
        geminiBody :
        { response: geminiBody };
    }
  }

  // Gemini / Antigravity
  if (GEMINI_FAMILY_FORMATS.has(targetFormat)) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;
    let textContent = "",reasoningContent = "";
    const toolCalls = [];
    // Drop the compatibility-only `reason` the Gemini cleaner added to empty object schemas.
    const stripPlaceholderArgs = createGeminiPlaceholderStripper({ clientTools: options.requestBody?.tools, providerBody: options.providerBody, toolNameMap: options.toolNameMap });

    if (content?.parts) {
      let pendingThoughtSignature = null;
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;else
        if (part.text !== undefined) textContent += part.text;
        if (part.thought === true && !part.functionCall) {
          const signature = part.thoughtSignature || part.thought_signature;
          if (signature) pendingThoughtSignature = signature;
        }
        if (part.functionCall) {
          // Mirror the streaming translator (#676): prefer the upstream call id
          // and carry any provider-issued thought signature in the transport id
          // so the next-turn request translator can replay it.
          const partSignature = part.thoughtSignature || part.thought_signature || pendingThoughtSignature;
          pendingThoughtSignature = null;
          const rawId = part.functionCall.id || `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`;
          toolCalls.push({
            id: encodeToolCallIdWithSignature(rawId, partSignature),
            type: "function",
            function: { name: part.functionCall.name, arguments: JSON.stringify(stripPlaceholderArgs(part.functionCall.name, part.functionCall.args || {})) }
          });
        }
        // Handle inline image data (from image generation models)
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
          textContent += `\n![image](data:${mimeType};base64,${inlineData.data})\n`;
        }
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    // Same mapping as the streaming Gemini translator (MAX_TOKENS → length, SAFETY → content_filter).
    let finishReason = toOpenAIFinish(candidate.finishReason || GEMINI_FINISH.STOP, "gemini");
    if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

    const result = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (usage) {
      result.usage = toOpenAIUsage(usage, "gemini");
    }
    return sourceFormat === FORMATS.OPENAI_RESPONSES || sourceFormat === FORMATS.OPENAI_RESPONSE ?
    projectCompletionToClientFormat(result, sourceFormat, projectionOptions()) :
    result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
    // DeepSeek encodes tool calls as DSML text, and its Anthropic-compatible
    // transport carries those frames inside a plain text block. Decode them
    // before the content blocks are read so the body yields tool_use blocks
    // instead of literal markup.
    normalizeDsmlClaudeMessage(responseBody, options.effectiveModel || options.model, options.provider);
    // Always translate a Claude-format body to OpenAI, even if `content` is
    // missing/null (e.g. M3 with max_tokens:1 spends the budget on thinking
    // and returns `content: null`). Returning the raw body would leave the
    // OpenAI client without a `choices` array and surface as a UI test error.
    // Early return if the response is already in OpenAI format (has choices array)
    // or if it has content as a non-array value (likely a different non-Claude format).
    // Some providers (e.g. xiaomi-tokenplan) return OpenAI-format responses even when
    // the request was translated to Claude format — the targetFormat is Claude but the
    // actual response is OpenAI-native and needs no further translation.
    if (responseBody.choices || responseBody.content && !Array.isArray(responseBody.content)) return responseBody;

    let textContent = "",thinkingContent = "";
    const toolCalls = [];

    for (const block of responseBody.content || []) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = block.text ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";else
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    const thinkingBlocks = (responseBody.content || []).filter((block) => block.type === CLAUDE_BLOCK.THINKING || block.type === CLAUDE_BLOCK.REDACTED_THINKING);
    const envelope = encodeClaudeThinking(options.effectiveModel || options.model || responseBody.model, thinkingBlocks);
    if (envelope) message.reasoning_encrypted_content = envelope;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    // A refusal (stop_reason "refusal") carries no content blocks at all: fall back to
    // Anthropic's own explanation so the client sees why the turn is empty instead of
    // failing the downstream empty-content check as a retryable 502.
    if (!message.content && !message.tool_calls) {
      const explanation = responseBody.stop_details?.explanation;
      message.content = isString(explanation) ? explanation : "";
    }

    const finishReason = toOpenAIFinish(responseBody.stop_reason || "end_turn", "claude");

    const result = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (responseBody.usage) {
      result.usage = claudeUsageToOpenAI(responseBody.usage);
    }
    return responsesClient ? projectCompletionToClientFormat(result, sourceFormat, projectionOptions()) : result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    const result = ollamaBodyToOpenAI(responseBody);
    return responsesClient ? projectCompletionToClientFormat(result, sourceFormat, projectionOptions()) : result;
  }

  /**
   * Binary transports decode their wire format into an OpenAI completion before
   * this handler runs; project that completion back into the client's dialect.
   */
  if (Array.isArray(responseBody?.choices)) {
    return projectCompletionToClientFormat(responseBody, sourceFormat, projectionOptions());
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 * Preserve the admission billing epoch, including null, through delayed completion.
 */
export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, streamToClient, translatedBody, finalBody, requestStartTime, connectionId, comboId = null, comboName = null, comboNoLog = false, apiKey, apiKeyId = null, billingEpoch, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, claudeCloaked = false, customToolNames, trackDone, appendLog, pxpipe, reqTag, log, usageEventId, claudeClassifierCompat, signal = null, terminalProvenance = null, responseBodyTimeoutMs = RESPONSE_BODY_TIMEOUT_MS, credentials = null }) {
  const createErrorResult = (status, message, resetsAt, errorBody, evidence, credentials, clientStatus) =>
    createFormattedErrorResult(status, message, resetsAt, errorBody, evidence, credentials, clientStatus, sourceFormat);
  try {
    const markSuccess = async () => {
      if (!onRequestSuccess || !["upstream", "validated"].includes(terminalProvenance)) return;
      try {await onRequestSuccess();}
      catch {console.error("[ChatCore] completed-response cleanup failed");}
    };
    const contentType = providerResponse.headers.get("content-type") || "";
    let responseBody;
    let responseFormat = targetFormat;

    let responseText;
    try {
      responseText = await readBodyWithTimeout(providerResponse, {
        signal,
        maxBytes: MAX_PROVIDER_BODY_BYTES,
        timeoutMs: responseBodyTimeoutMs
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return { ...createErrorResult(499, "Request aborted"), quotaTerminalReason: "abort" };
      }
      if (error instanceof BodyReadTimeoutError) {
        return {
          ...createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "Provider response body timed out"),
          quotaTerminalReason: "timeout"
        };
      }
      return {
        ...createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to read provider response"),
        quotaTerminalReason: "stream_error"
      };
    }

    if (contentType.includes("text/event-stream")) {
      const sseText = responseText;
      const terminalFormat = [FORMATS.KIRO, FORMATS.COMMANDCODE, FORMATS.CURSOR].includes(targetFormat) ?
      targetFormat :
      FORMATS.OPENAI;
      const parsed = parseSSEToOpenAIResponse(sseText, model, {
        format: terminalFormat,
        providerBody: finalBody || translatedBody,
        provider
      });
      // A forced-streaming upstream can answer with one complete JSON response
      // document under the event-stream media type (OmniRoute #18377). Read it
      // as the non-stream response it is instead of failing the request.
      const jsonDocument = parsed ? null : parseJsonDocumentBehindEventStream(sseText, targetFormat);
      if (!parsed && !jsonDocument) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
      }
      let errorPayload = parsed || jsonDocument.body;
      if ((provider === "antigravity" || provider === "agy") && isJsonRecord(errorPayload?.error)) {
        const code = errorPayload.error.code;
        if (code === 401 || code === 403) evictResponseDispatcher(providerResponse);
        errorPayload = { ...errorPayload, error: { ...errorPayload.error, status: code } };
      }
      const quotaError = detectQuotaExhaustion({ error: errorPayload?.error });
      if (quotaError.exhausted) {
        appendLog({ status: "FAILED 429" });
        return createErrorResult(HTTP_STATUS.RATE_LIMITED, "Provider quota exhausted", quotaError.resetAtMs, undefined, null, credentials);
      }
      const sseError = createSSEErrorResult(errorPayload, credentials, sourceFormat);
      if (sseError) {
        appendLog({ status: `FAILED ${sseError.status}` });
        return sseError;
      }
      if (jsonDocument) {
        // The document keeps its own dialect. The event-stream accumulator
        // always produces OpenAI completions, even when the provider transport
        // and the client use the same native format (#5380).
        responseBody = jsonDocument.body;
        responseFormat = jsonDocument.format;
      } else {
        responseBody = parsed;
        responseFormat = FORMATS.OPENAI;
      }
    } else {
      try {
        responseBody = JSON.parse(responseText);
      } catch (err) {
        responseBody = parseJsonWithTrailingDone(responseText);
        if (!responseBody) {
          // OmniRoute #1104: a provider that answers with an HTML error page
          // (captive portal, proxy interception, wrong endpoint) is a different
          // failure from a malformed JSON body, and the operator needs to tell
          // them apart. Only the diagnostic differs here: the status code, the
          // error envelope, the retry/fallback decision and every usage or
          // admission effect stay exactly as they were, and no upstream body
          // text is echoed, stored or logged.
          const htmlErrorPage = isHtmlErrorPageBody(responseText);
          appendLog({
            status: htmlErrorPage ?
              `FAILED ${HTTP_STATUS.BAD_GATEWAY} (html error page)` :
              `FAILED ${HTTP_STATUS.BAD_GATEWAY}`
          });
          console.error(`[ChatCore] Failed to parse JSON from ${provider}: ${err?.name || "Error"}`);
          return createErrorResult(HTTP_STATUS.BAD_GATEWAY, htmlErrorPage ?
            HTML_PROVIDER_ERROR_MESSAGE :
            `Invalid JSON response from ${provider}`);
        }
      }
      if (!isJsonRecord(responseBody)) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
      }
      // Inspect only the error envelope, never echoed request content.
      if (responseBody.error) {
        const quota = detectQuotaExhaustion({ error: responseBody.error });
        if (quota.exhausted) {
          appendLog({ status: "FAILED 429" });
          return createErrorResult(HTTP_STATUS.RATE_LIMITED, "Provider quota exhausted", quota.resetAtMs, undefined, null, credentials);
        }
      }
      // Cloud Code can return a Google RPC error inside an HTTP 200 response.
      // Preserve its numeric code so account-level authentication handling sees it.
      if ((provider === "antigravity" || provider === "agy") && isJsonRecord(responseBody.error)) {
        const code = responseBody.error.code;
        const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : HTTP_STATUS.BAD_GATEWAY;
        if (status === 401 || status === 403) evictResponseDispatcher(providerResponse);
        const message = isString(responseBody.error.message) && responseBody.error.message.trim() ?
          responseBody.error.message : "Upstream Antigravity request failed";
        appendLog({ status: `FAILED ${status}` });
        return { ...createErrorResult(status, message, undefined, undefined, null, credentials), quotaTerminalReason: "stream_error" };
      }
    }

    if (clientRawRequest?.geminiNativeResponse === true && ["antigravity", "agy"].includes(provider) && responseFormat === FORMATS.ANTIGRAVITY) {
      // Validate and account for the same completed native response we return.
      const normalized = antigravityGeminiResponse(responseBody, toolNameMap, true);
      responseBody = responseBody.response ? { ...responseBody, response: normalized } : normalized;
    }

    // Unwrap ClinePass {success, data} envelope before marking success: a
    // {success:false, error} body must surface as a 502, never as a successful call.
    {
      const { body: unwrapped, error: envError } = unwrapClinepassEnvelope(responseBody, provider);
      if (envError) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, envError.message);
      }
      if (!isJsonRecord(unwrapped)) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
      }
      responseBody = unwrapped;
    }
    // Normalize Mistral typed content before coherence checks and projection.
    if (provider === "mistral") for (const choice of responseBody?.choices || []) normalizeMistralContent(choice?.message);
    const maskedGatewayError = classifyMaskedGatewayError(responseBody);
    if (maskedGatewayError) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Upstream provider error: ${maskedGatewayError}`);
    }
    if (!isCoherentNonStreamingResponse(responseBody, responseFormat)) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, INCOHERENT_NON_STREAMING_RESPONSE_MESSAGE);
    }

    // Provider-specific non-stream normalization (e.g. SenseNova maps
    // message.reasoning -> message.reasoning_content) must run before request
    // logging and Claude/Responses translation, which read reasoning_content.
    PROVIDERS[provider]?.normalizeResponse?.(responseBody);

    reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);

    // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
    responseBody = decloakToolNames(responseBody, toolNameMap, claudeCloaked);

    // MiniMax's OpenAI transport may inline M3 reasoning as complete <think>
    // segments. Normalize the raw provider completion once, before a client
    // projection can collapse its per-choice OpenAI shape.
    const inlineThinking = normalizeInlineThinkingResponse(responseBody, { provider, model, targetFormat: responseFormat });
    responseBody = inlineThinking.responseBody;


    const isTokenLimited = !TRUSTED_EMPTY_STOP_PROVIDERS.has(provider) && hasTokenLimitCompletion(responseBody);
    const claudeCompat = shouldEnableClaudeCompat(claudeClassifierCompat, sourceFormat, body);
    let translatedResponse = translateNonStreamingResponse(
      responseBody,
      responseFormat,
      sourceFormat,
      { claudeCompat, model, effectiveModel: (finalBody || translatedBody)?.model, provider, customToolNames, toolNameMap, requestBody: body, providerBody: finalBody || translatedBody }
    );

    /**
     * Provider translators normalize non-Claude JSON to an OpenAI completion.
     * Project that intermediate back to Messages shape for `/v1/messages` clients.
     */
    if (sourceFormat === FORMATS.CLAUDE && Array.isArray(translatedResponse?.choices)) {
      translatedResponse = normalizeClaudeCacheUsage(
        translateOpenAIToClaudeIfNeeded(translatedResponse, sourceFormat, { model }),
        translatedResponse
      );
      if (claudeCompat) translatedResponse = stripClaudeThinking(translatedResponse);
    }
    if (invalidClassifierVerdict(sourceFormat, body, translatedResponse)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Claude classifier returned an invalid decision");
    // Chat clients get the completion as-is, so restore request-side tool-name
    // aliases the way the streaming and forced-SSE paths do (#1433).
    if (sourceFormat === FORMATS.OPENAI) restoreOpenAIToolNames(translatedResponse, toolNameMap);
    // Gemini clients: JSON projection bypasses the streaming translator's alias restore.
    if (GEMINI_FAMILY_FORMATS.has(sourceFormat)) restoreGeminiToolNames(translatedResponse, toolNameMap);
    if (sourceFormat === FORMATS.CLAUDE) restoreClaudeToolNames(translatedResponse, toolNameMap);

    let usage = extractUsageFromResponse(responseBody);
    // Reported usage always wins and is persisted immediately, as before. When
    // the provider sent none, persistence waits until the response has passed
    // the empty-content and fake-success checks below so a failed reply never
    // records an estimate.
    const usageReported = Boolean(usage);
    const persistUsage = () => {
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ usageAttribution: clientRawRequest?.usageAttribution, provider, model, tokens: usage, connectionId, comboId, comboName, apiKey, apiKeyId, billingEpoch, endpoint: clientRawRequest?.endpoint, usageEventId, latency: { total: Date.now() - requestStartTime, ttft: 0 }, silent: true });
    };
    if (usageReported) persistUsage();

    // A Claude-native refusal (stop_reason "refusal") is a finished turn even when
    // its only content is an optional, possibly null/blank explanation string.
    // Same-format passthrough (targetFormat === sourceFormat === Claude) returns
    // responseBody untouched above, and the OpenAI-pivot round trip for other
    // client formats intentionally does not round-trip "refusal" back out of
    // "content_filter" (see fromOpenAIFinish) — check the raw provider body here
    // so neither path is mistaken for a retryable empty-content gateway fault.
    const isNativeClaudeRefusal = responseBody?.stop_reason === CLAUDE_STOP.REFUSAL;
    if (!isNativeClaudeRefusal && !isTokenLimited &&
        !hasUsefulContent(translatedResponse) && !(clientRawRequest?.geminiNativeResponse === true && ["antigravity", "agy"].includes(provider) && hasUsefulContent(responseBody)) && !isTrustedEmptyStop(translatedResponse, provider)) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY} (empty content)` });
      log?.warn?.("CHATCORE", `${provider}/${model} returned HTTP 200 with no usable content`);
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        `Empty response content from ${provider}/${model}`,
        Date.now() + EMPTY_CONTENT_COOLDOWN_MS
      );
    }

    // Ported from OmniRoute #13910: on a narrow provider allowlist (free/
    // web-session providers known to do this), a short assistant message
    // dominated by a known credits-exhausted/account-deactivated phrase is
    // the provider's own error prose disguised as a real HTTP 200 answer.
    // See fakeSuccessBodyClassifier.js for the false-positive guards
    // (allowlist + short content + dominant signal coverage) that keep this
    // from ever tripping on a genuine longer completion.
    if (!isNativeClaudeRefusal) {
      const fakeSuccessReason = classifyFakeSuccessBody(
        extractAssistantText(translatedResponse),
        provider
      );
      if (fakeSuccessReason) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY} (fake success: ${fakeSuccessReason})` });
        log?.warn?.("CHATCORE", `${provider}/${model} returned HTTP 200 disguising a ${fakeSuccessReason} failure`);
        return createErrorResult(
          HTTP_STATUS.BAD_GATEWAY,
          `Upstream reported a failure disguised as a successful response from ${provider}/${model}`,
          Date.now() + EMPTY_CONTENT_COOLDOWN_MS
        );
      }
    }

    // Successful reply without a provider usage object: persist an estimated
    // input/output usage, marked `estimated`, from the request actually sent
    // and the content generated. Client-facing usage is left untouched.
    if (!usageReported) {
      usage = estimateNonStreamingUsage(finalBody || translatedBody || body, translatedResponse);
      persistUsage();
    }

    /**
     * Upstream PR #3111 logs resolved route/session identity from the provider
     * request body without altering client-facing response usage.
     */
    const sessionId = (finalBody || translatedBody)?.conversationState?.conversationId;
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime }, provider, model, sessionId }));
    const isClaudeMessageResponse = sourceFormat === FORMATS.CLAUDE && translatedResponse?.type === "message";

    const isOpenAIChatResponse = Array.isArray(translatedResponse?.choices);

    if (isOpenAIChatResponse) {
      // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
      if (translatedResponse.choices?.[0]) {
        const choice = translatedResponse.choices[0];
        const msg = choice.message;
        const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
        if (hasToolCalls && choice.finish_reason !== "tool_calls") {
          choice.finish_reason = "tool_calls";
        }
      }

      // Ensure OpenAI-required fields only for OpenAI Chat-shaped responses.
      if (isOpenAIChatResponse) {
        if (!translatedResponse.object) translatedResponse.object = "chat.completion";
        if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);
      }

      // Strip Azure-specific fields only for OpenAI Chat-shaped responses.
      if (isOpenAIChatResponse) {
        delete translatedResponse.prompt_filter_results;
        if (translatedResponse?.choices) {
          for (const choice of translatedResponse.choices) {
            delete choice.content_filter_results;
            // OpenAI clients only: Claude stop_reason literals are not OpenAI values.
            if (sourceFormat === FORMATS.OPENAI) choice.finish_reason = normalizeOpenAIFinish(choice.finish_reason);
          }
        }
      }
    }

    if (!isClaudeMessageResponse && translatedResponse?.usage) {
      translatedResponse.usage = filterUsageForFormat(
        enrichUsageCost(addBufferToUsage(translatedResponse.usage, provider), provider, model),
        sourceFormat
      );
    }

    // OpenAI reasoning is preserved unless the client or deployment explicitly opts out.
    if (!isClaudeMessageResponse && isOpenAIChatResponse) {
      applyReasoningVisibility(translatedResponse, clientRawRequest);
    }

    reqLogger.logConvertedResponse(translatedResponse);

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      comboNoLog,
      provider, model, connectionId,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: responseBody || null,
      response: {
        content: translatedResponse?.choices?.[0]?.message?.content || translatedResponse?.content || null,
        thinking: translatedResponse?.choices?.[0]?.message?.reasoning_content || translatedResponse?.reasoning_content || null,
        finish_reason: translatedResponse?.choices?.[0]?.finish_reason || "unknown"
      },
      pxpipe,
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch((err) => {
      console.error("[RequestDetail] Failed to save:", err.message);
    });

    const nativeGemini = clientRawRequest?.geminiNativeResponse === true && ["antigravity", "agy"].includes(provider) && responseFormat === FORMATS.ANTIGRAVITY;
    if (nativeGemini) {
      const nativeResponse = antigravityGeminiResponse(responseBody, toolNameMap, true);
      await markSuccess();
      return { success: true, response: new Response(streamToClient ? formatSSE(nativeResponse, FORMATS.GEMINI) : JSON.stringify(nativeResponse), {
        headers: { "Content-Type": streamToClient ? "text/event-stream" : "application/json", "Access-Control-Allow-Origin": "*", "x-durindoor-internal-gemini-native": "1", ...resolvedModelHeaders(provider, model) }
      }) };
    }

    // Client requested streaming but the provider only returned a non-stream JSON
    if (streamToClient === true) {
      // A same-format Gemini-family response is already a valid streaming chunk.
      // Sending it through an empty OpenAI synthetic delta loses text, inlineData,
      // function calls/results, and provider-specific metadata.
      const isNativeGeminiResponse = sourceFormat === targetFormat &&
      GEMINI_FAMILY_FORMATS.has(sourceFormat) && (
      Array.isArray(translatedResponse?.candidates) || Array.isArray(translatedResponse?.response?.candidates));
      if (isNativeGeminiResponse) {
        await markSuccess();
        return {
          success: true,
          response: new Response(formatSSE(translatedResponse, sourceFormat), {
            headers: {
              "Content-Type": "text/event-stream",
              ...SSE_HEADERS_CORS,
              ...resolvedModelHeaders(provider, model)
            }
          })
        };
      }

      // Always synthesize from an OpenAI-normalized intermediate. Reading finish
      // and usage from the raw provider body mislabels Claude/Gemini fields and
      // drops tool terminal semantics. The response dialect is the parsed one:
      // a complete JSON document keeps its own dialect even when the transport
      // label says otherwise (OmniRoute #18377).
      const openAIIntermediate = responseFormat === FORMATS.OPENAI ?
      structuredClone(responseBody) :
      translateNonStreamingResponse(structuredClone(responseBody), responseFormat, FORMATS.OPENAI);
      if (!Array.isArray(openAIIntermediate?.choices)) {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Unable to normalize non-streaming response for SSE");
      }
      const intermediateChoice = openAIIntermediate.choices[0];
      if (Array.isArray(intermediateChoice?.message?.tool_calls) && intermediateChoice.message.tool_calls.length > 0) {
        intermediateChoice.finish_reason = "tool_calls";
      }
      const sseText = openAICompletionToClientSSE(openAIIntermediate, model, sourceFormat);

      await markSuccess();
      return {
        success: true,
        response: new Response(sseText, {
          headers: {
            "Content-Type": "text/event-stream",
            ...SSE_HEADERS_CORS,
            ...resolvedModelHeaders(provider, model)
          }
        })
      };
    }

    await markSuccess();
    return {
      success: true,
      response: new Response(JSON.stringify(translatedResponse), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...resolvedModelHeaders(provider, model)
        }
      })
    };
  } finally {
    trackDone();
  }
}
