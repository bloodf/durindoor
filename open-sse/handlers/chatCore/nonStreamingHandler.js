import { FORMATS, GEMINI_FAMILY_FORMATS } from "../../translator/formats.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { unwrapClinepassEnvelope } from "../../utils/clinepassEnvelope.js";
import { addBufferToUsage, claudeUsageToOpenAI, filterUsageForFormat } from "../../utils/usageTracking.js";
import { createErrorResult } from "../../utils/error.js";
import { readBodyWithTimeout, BodyReadTimeoutError } from "../../utils/bodyTimeout.js";
import { HTTP_STATUS, MAX_PROVIDER_BODY_BYTES, RESPONSE_BODY_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { EMPTY_CONTENT_COOLDOWN_MS } from "../../config/errorConfig.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { translateOpenAIToClaudeIfNeeded } from "../../translator/response/openai-to-claude-json.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { openAIResponsesBodyToClaude, openAIResponsesBodyToOpenAI } from "../../translator/response/openai-responses-nonstream.js";
import { projectCompletionToClientFormat } from "../../translator/response/completionProjector.js";
import { translateResponse, initState } from "../../translator/index.js";
import { formatSSE } from "../../utils/streamHelpers.js";
import { SSE_HEADERS_CORS } from "../../utils/sseConstants.js";
import { normalizeInlineThinkingResponse } from "./inlineThinking.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { isCoherentNonStreamingResponse } from "../../utils/streamTerminal.js";
import { PROVIDERS } from "../../config/providers.js";
import { CLAUDE_BLOCK } from "../../translator/schema/blocks.js";
import { applyReasoningVisibility } from "../../utils/reasoningVisibility.js";

// Upstream #10258: reject parsed JSON that isn't a plain record (primitives,
// arrays, null) before any envelope unwrap or property access can throw or
// silently coerce garbage into a "coherent" response.
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
function isJsonRecord(value) {
  return !!value && isObject(value) && !Array.isArray(value);
}

/**
 * Check the emitted response shape for client-usable text, reasoning, or tools.
 * Translation can emit a shape other than the client's source dialect, so the
 * body itself—not sourceFormat—selects the content fields inspected here.
 */
function hasUsefulContent(response) {
  /** Translation may emit OpenAI choices regardless of the client's source dialect. */
  if (Array.isArray(response?.choices)) {
    const message = response.choices[0]?.message;
    return isString(message?.content) && message.content.trim().length > 0 ||
    Array.isArray(message?.content) && message.content.length > 0 ||
    isString(message?.reasoning_content) && message.reasoning_content.trim().length > 0 ||
    isString(message?.reasoning) && message.reasoning.trim().length > 0 ||
    Array.isArray(message?.tool_calls) && message.tool_calls.length > 0 ||
    Boolean(message?.function_call);
  }
  if (response?.type === "message") {
    return Array.isArray(response.content) && response.content.some((block) =>
    block?.type === "tool_use" ||
    block?.type === "thinking" && isString(block.thinking) && block.thinking.trim() ||
    block?.type === "text" && isString(block.text) && block.text.trim());
  }

  if (Array.isArray(response?.output)) {
    return response.output.some((item) =>
    item?.type === "function_call" ||
    item?.type === "custom_tool_call" ||
    item?.type === "reasoning" && (
    isString(item.reasoning) && item.reasoning.trim() ||
    Array.isArray(item.summary) && item.summary.some((part) => isString(part?.text) && part.text.trim())) ||
    item?.type === "message" && Array.isArray(item.content) && item.content.some((part) =>
    isString(part?.text) && part.text.trim()));
  }

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
  const cached = originalBody?.usage?.prompt_tokens_details?.cached_tokens || 0;
  claudeMsg.usage = claudeMsg.usage || {};
  if (cached > 0) claudeMsg.usage.cache_read_input_tokens = cached;
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
  /** Upstream PR #3373: request translators emit arrays; projection uses Set membership. */
  const customToolNames = options.customToolNames instanceof Set ?
  options.customToolNames :
  new Set(options.customToolNames || []);
  /**
   * Project Responses-client calls before generic OpenAI upstream passthrough.
   */
  if (
  (sourceFormat === FORMATS.OPENAI_RESPONSES || sourceFormat === FORMATS.OPENAI_RESPONSE) &&
  targetFormat === FORMATS.OPENAI &&
  Array.isArray(responseBody?.choices))
  {
    return projectCompletionToClientFormat(responseBody, sourceFormat, { ...options, customToolNames });
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
  if (targetFormat === FORMATS.OPENAI) return responseBody;

  // OpenAI Responses API JSON body → requested client format.
  // Streaming goes through translateResponse(); non-streaming needs an explicit
  // body-level conversion so clients always receive the shape they requested,
  // including a usage object (some clients validate `usage.input_tokens`).
  if (targetFormat === FORMATS.OPENAI_RESPONSES) {
    if (sourceFormat === FORMATS.CLAUDE) {
      const claudeMsg = openAIResponsesBodyToClaude(responseBody);
      return options.claudeCompat ? stripClaudeThinking(claudeMsg) : claudeMsg;
    }
    if (sourceFormat === FORMATS.OPENAI) return openAIResponsesBodyToOpenAI(responseBody);
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

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;else
        if (part.text !== undefined) textContent += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
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

    let finishReason = (candidate.finishReason || "stop").toLowerCase();
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
    projectCompletionToClientFormat(result, sourceFormat, { ...options, customToolNames }) :
    result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
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
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = responseBody.stop_reason || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

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
    return result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    return ollamaBodyToOpenAI(responseBody);
  }

  /**
   * Binary transports decode their wire format into an OpenAI completion before
   * this handler runs; project that completion back into the client's dialect.
   */
  if (Array.isArray(responseBody?.choices)) {
    return projectCompletionToClientFormat(responseBody, sourceFormat, { ...options, customToolNames });
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 */
export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, streamToClient, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, trackDone, appendLog, pxpipe, reqTag, log, usageEventId, claudeClassifierCompat, signal = null, terminalProvenance = null, responseBodyTimeoutMs = RESPONSE_BODY_TIMEOUT_MS }) {
  try {
    const markSuccess = async () => {
      if (!onRequestSuccess || !["upstream", "validated"].includes(terminalProvenance)) return;
      try {await onRequestSuccess();}
      catch {console.error("[ChatCore] completed-response cleanup failed");}
    };
    const contentType = providerResponse.headers.get("content-type") || "";
    let responseBody;

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
        providerBody: finalBody || translatedBody
      });
      if (!parsed) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
      }
      responseBody = parsed;
    } else {
      try {
        responseBody = JSON.parse(responseText);
      } catch (err) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        console.error(`[ChatCore] Failed to parse JSON from ${provider}: ${err?.name || "Error"}`);
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
      }
      if (!isJsonRecord(responseBody)) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
      }
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
    if (!isCoherentNonStreamingResponse(responseBody, targetFormat)) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Provider returned an incoherent non-streaming response");
    }

    // Provider-specific non-stream normalization (e.g. SenseNova maps
    // message.reasoning -> message.reasoning_content) must run before request
    // logging and Claude/Responses translation, which read reasoning_content.
    PROVIDERS[provider]?.normalizeResponse?.(responseBody);

    reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);

    // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
    responseBody = decloakToolNames(responseBody, toolNameMap);

    // MiniMax's OpenAI transport may inline M3 reasoning as complete <think>
    // segments. Normalize the raw provider completion once, before a client
    // projection can collapse its per-choice OpenAI shape.
    const inlineThinking = normalizeInlineThinkingResponse(responseBody, { provider, model, targetFormat });
    responseBody = inlineThinking.responseBody;


    const claudeCompat = shouldEnableClaudeCompat(claudeClassifierCompat, sourceFormat, body);
    let translatedResponse = translateNonStreamingResponse(
      responseBody,
      targetFormat,
      sourceFormat,
      { claudeCompat, model, customToolNames }
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

    const usage = extractUsageFromResponse(responseBody);
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, silent: true });

    if (!hasUsefulContent(translatedResponse)) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY} (empty content)` });
      log?.warn?.("CHATCORE", `${provider}/${model} returned HTTP 200 with no usable content`);
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        `Empty response content from ${provider}/${model}`,
        Date.now() + EMPTY_CONTENT_COOLDOWN_MS
      );
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
          for (const choice of translatedResponse.choices) delete choice.content_filter_results;
        }
      }
    }

    if (!isClaudeMessageResponse && translatedResponse?.usage) {
      translatedResponse.usage = filterUsageForFormat(addBufferToUsage(translatedResponse.usage), sourceFormat);
    }

    // OpenAI reasoning is preserved unless the client or deployment explicitly opts out.
    if (!isClaudeMessageResponse && isOpenAIChatResponse) {
      applyReasoningVisibility(translatedResponse, clientRawRequest);
    }

    reqLogger.logConvertedResponse(translatedResponse);

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
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
              ...SSE_HEADERS_CORS
            }
          })
        };
      }

      // Always synthesize from an OpenAI-normalized intermediate. Reading finish
      // and usage from the raw provider body mislabels Claude/Gemini fields and
      // drops tool terminal semantics.
      const openAIIntermediate = targetFormat === FORMATS.OPENAI ?
      structuredClone(responseBody) :
      translateNonStreamingResponse(structuredClone(responseBody), targetFormat, FORMATS.OPENAI);
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
            ...SSE_HEADERS_CORS
          }
        })
      };
    }

    await markSuccess();
    return {
      success: true,
      response: new Response(JSON.stringify(translatedResponse), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      })
    };
  } finally {
    trackDone();
  }
}