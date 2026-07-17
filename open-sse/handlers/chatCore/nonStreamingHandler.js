import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { unwrapClinepassEnvelope } from "../../utils/clinepassEnvelope.js";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking.js";
import { createErrorResult, readBoundedResponseText } from "../../utils/error.js";
import { HTTP_STATUS, MAX_PROVIDER_BODY_BYTES, PROVIDER_BODY_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { translateOpenAIToClaudeIfNeeded } from "../../translator/response/openai-to-claude-json.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { openAIResponsesBodyToClaude, openAIResponsesBodyToOpenAI } from "../../translator/response/openai-responses-nonstream.js";
import { translateResponse, initState } from "../../translator/index.js";
import { formatSSE } from "../../utils/streamHelpers.js";
import { SSE_HEADERS_CORS } from "../../utils/sseConstants.js";
import { normalizeInlineThinkingResponse } from "./inlineThinking.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { isCoherentNonStreamingResponse } from "../../utils/streamTerminal.js";
import { PROVIDERS } from "../../config/providers.js";
import { CLAUDE_BLOCK } from "../../translator/schema/blocks.js";

const GEMINI_FAMILY_FORMATS = new Set([
  FORMATS.GEMINI,
  FORMATS.GEMINI_CLI,
  FORMATS.ANTIGRAVITY,
  FORMATS.VERTEX,
]);

// Claude Code classifier compat: detect classifier-shaped requests by the
// security-monitor system prompt or the "</block>" stop sequence, gated by the
// claudeClassifierCompat setting ("off" | "auto" | "always").
function shouldEnableClaudeCompat(mode, sourceFormat, body) {
  if (sourceFormat !== FORMATS.CLAUDE) return false;
  if (mode === "always") return true;
  if (mode !== "auto") return false;
  const systemTexts = Array.isArray(body?.system)
    ? body.system.map((part) => (typeof part?.text === "string" ? part.text : "")).filter(Boolean)
    : [];
  const stopSequences = Array.isArray(body?.stop_sequences) ? body.stop_sequences : [];
  return systemTexts.some((text) => text.includes("You are a security monitor for autonomous AI coding agents"))
    || stopSequences.includes("</block>");
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
  const choices = Array.isArray(responseBody?.choices) && responseBody.choices.length > 0
    ? responseBody.choices
    : [{}];
  const choiceIndex = (choice, position) => Number.isInteger(choice?.index) ? choice.index : position;
  const chunks = [{
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: choices.map((choice, position) => ({
      index: choiceIndex(choice, position),
      delta: { role: choice?.message?.role || "assistant" },
      finish_reason: null,
    })),
  }];

  const reasoningChoices = choices.flatMap((choice, position) => {
    const reasoning = choice?.message?.reasoning_content;
    return typeof reasoning === "string" && reasoning.length > 0
      ? [{ index: choiceIndex(choice, position), delta: { reasoning_content: reasoning }, finish_reason: null }]
      : [];
  });
  if (reasoningChoices.length > 0) {
    chunks.push({
      id, object: "chat.completion.chunk", created, model,
      choices: reasoningChoices,
    });
  }

  const contentChoices = choices.flatMap((choice, position) => {
    const content = choice?.message?.content;
    return typeof content === "string" && content.length > 0
      ? [{ index: choiceIndex(choice, position), delta: { content }, finish_reason: null }]
      : [];
  });
  if (contentChoices.length > 0) {
    chunks.push({
      id, object: "chat.completion.chunk", created, model,
      choices: contentChoices,
    });
  }

  const toolChoices = choices.flatMap((choice, position) => {
    const toolCalls = choice?.message?.tool_calls;
    return Array.isArray(toolCalls) && toolCalls.length > 0
      ? [{
          index: choiceIndex(choice, position),
          delta: { tool_calls: toolCalls.map((toolCall, index) => ({ index, ...toolCall })) },
          finish_reason: null,
        }]
      : [];
  });
  if (toolChoices.length > 0) {
    chunks.push({
      id, object: "chat.completion.chunk", created, model,
      choices: toolChoices,
    });
  }

  const final = {
    id, object: "chat.completion.chunk", created, model,
    choices: choices.map((choice, position) => ({
      index: choiceIndex(choice, position),
      delta: {},
      finish_reason: choice?.finish_reason || "stop",
    })),
  };
  if (responseBody?.usage) final.usage = responseBody.usage;
  chunks.push(final);
  return chunks;
}

function openAICompletionToClientSSE(responseBody, fallbackModel, sourceFormat) {
  const state = initState(sourceFormat);
  let output = "";
  for (const chunk of openAICompletionToChunks(responseBody, fallbackModel)) {
    const events = sourceFormat === FORMATS.OPENAI
      ? [chunk]
      : translateResponse(FORMATS.OPENAI, sourceFormat, chunk, state);
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
 * `targetFormat` is what the **client** asked for (i.e. the source format the
 * client sent). `sourceFormat` is the format the upstream returned in. When
 * they differ, we convert.
 *
 * Most branches translate into OpenAI chat.completion shape (the legacy
 * default). The OPENAI_RESPONSES branch is an exception: it returns whichever
 * shape the client actually requested — Claude body when the client sent
 * Claude, OpenAI chat when the client sent OpenAI — so the caller receives a
 * body matching their original request, including a usage object (some
 * clients validate `usage.input_tokens`).
 *
 * Streaming responses go through translateResponse() — this function only
 * handles non-streaming JSON bodies.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, options = {}) {
  if (targetFormat === sourceFormat) return responseBody;

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
  if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.VERTEX) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;
    let textContent = "", reasoningContent = "";
    const toolCalls = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;
        else if (part.text !== undefined) textContent += part.text;
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
    return result;
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
    if (responseBody.choices || (responseBody.content && !Array.isArray(responseBody.content))) return responseBody;

    let textContent = "", thinkingContent = "";
    const toolCalls = [];

    for (const block of (responseBody.content || [])) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = block.text ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";
      else if (block.type === "tool_use") {
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
      result.usage = {
        prompt_tokens: responseBody.usage.input_tokens || 0,
        completion_tokens: responseBody.usage.output_tokens || 0,
        total_tokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0)
      };
    }
    return result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    return ollamaBodyToOpenAI(responseBody);
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 */
export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, streamToClient, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, trackDone, appendLog, pxpipe, reqTag, log, usageEventId, claudeClassifierCompat, signal = null, terminalProvenance = null }) {
  try {
    const markSuccess = async () => {
      if (!onRequestSuccess || !["upstream", "validated"].includes(terminalProvenance)) return;
      try { await onRequestSuccess(); }
      catch { console.error("[ChatCore] completed-response cleanup failed"); }
    };
    const contentType = providerResponse.headers.get("content-type") || "";
    let responseBody;

  let responseText;
  try {
    responseText = await readBoundedResponseText(providerResponse, {
      signal,
      maxBytes: MAX_PROVIDER_BODY_BYTES,
      timeoutMs: PROVIDER_BODY_TIMEOUT_MS,
      throwOnTimeout: true,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return { ...createErrorResult(499, "Request aborted"), quotaTerminalReason: "abort" };
    }
    return {
      ...createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to read provider response"),
      quotaTerminalReason: error?.name === "TimeoutError" ? "timeout" : "stream_error",
    };
  }

  if (contentType.includes("text/event-stream")) {
    const sseText = responseText;
    const terminalFormat = [FORMATS.KIRO, FORMATS.COMMANDCODE, FORMATS.CURSOR].includes(targetFormat)
      ? targetFormat
      : FORMATS.OPENAI;
    const parsed = parseSSEToOpenAIResponse(sseText, model, {
      format: terminalFormat,
      providerBody: finalBody || translatedBody,
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
  }

  // Unwrap ClinePass {success, data} envelope before marking success: a
  // {success:false, error} body must surface as a 502, never as a successful call.
  // Source: decolua/9router#2332 @ 005d970f49.
  {
    const { body: unwrapped, error: envError } = unwrapClinepassEnvelope(responseBody, provider);
    if (envError) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, envError.message);
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

  const usage = extractUsageFromResponse(responseBody);
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, silent: true });
  if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

  const claudeCompat = shouldEnableClaudeCompat(claudeClassifierCompat, sourceFormat, body);
  let translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, { claudeCompat, model })
    : responseBody;

  /**
   * Provider translators normalize non-Claude JSON to an OpenAI completion.
   * Project that intermediate back to Messages shape for `/v1/messages` clients.
   */
  if (sourceFormat === FORMATS.CLAUDE && Array.isArray(translatedResponse?.choices)) {
    translatedResponse = normalizeClaudeCacheUsage(
      translateOpenAIToClaudeIfNeeded(translatedResponse, sourceFormat, { model }),
      translatedResponse,
    );
    if (claudeCompat) translatedResponse = stripClaudeThinking(translatedResponse);
  }
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

  // Preserve native and extracted reasoning for the explicitly configured M3
  // OpenAI response policy. Other providers retain the existing cleanup.
  if (!isClaudeMessageResponse && isOpenAIChatResponse && !inlineThinking.configured) {
    for (const choice of translatedResponse.choices) {
      if (choice?.message?.reasoning_content && choice.message.content) {
        delete choice.message.reasoning_content;
      }
    }
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
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  // Client requested streaming but the provider only returned a non-stream JSON
  if (streamToClient === true) {
    // A same-format Gemini-family response is already a valid streaming chunk.
    // Sending it through an empty OpenAI synthetic delta loses text, inlineData,
    // function calls/results, and provider-specific metadata.
    const isNativeGeminiResponse = sourceFormat === targetFormat
      && GEMINI_FAMILY_FORMATS.has(sourceFormat)
      && (Array.isArray(translatedResponse?.candidates) || Array.isArray(translatedResponse?.response?.candidates));
    if (isNativeGeminiResponse) {
      await markSuccess();
      return {
        success: true,
        response: new Response(formatSSE(translatedResponse, sourceFormat), {
          headers: {
            "Content-Type": "text/event-stream",
            ...SSE_HEADERS_CORS,
          },
        }),
      };
    }

    // Always synthesize from an OpenAI-normalized intermediate. Reading finish
    // and usage from the raw provider body mislabels Claude/Gemini fields and
    // drops tool terminal semantics.
    const openAIIntermediate = targetFormat === FORMATS.OPENAI
      ? structuredClone(responseBody)
      : translateNonStreamingResponse(structuredClone(responseBody), targetFormat, FORMATS.OPENAI);
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
        },
      }),
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
