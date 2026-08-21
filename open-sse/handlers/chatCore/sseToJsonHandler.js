import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { createErrorResult } from "../../utils/error.js";
import { readBodyWithTimeout, BodyReadTimeoutError } from "../../utils/bodyTimeout.js";
import { HTTP_STATUS, MAX_PROVIDER_BODY_BYTES, PROVIDER_BODY_TIMEOUT_MS, RESPONSE_BODY_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { projectCompletionToClientFormat, responsesApiToOpenAICompletion } from "../../translator/response/completionProjector.js";
import { logToolSemantics } from "../../utils/toolSemanticsTrace.js";
import { extractReasoningText } from "../../translator/concerns/reasoning.js";
import { normalizeInlineThinkingResponse } from "./inlineThinking.js";
import { createUpstreamTerminalTracker } from "../../utils/streamTerminal.js";
import { applyReasoningVisibility } from "../../utils/reasoningVisibility.js";

// Responses-API providers (e.g. codex) may emit SSE without content-type + use Responses output shape
const isResponsesProvider = (p) => PROVIDERS[p]?.format === FORMATS.OPENAI_RESPONSES;
import { saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";

// Claude Code classifier compat: detect classifier-shaped requests by the
// security-monitor system prompt or the "</block>" stop sequence, gated by the
// claudeClassifierCompat setting ("off" | "auto" | "always"). When enabled,
// Claude-shaped projections suppress the reasoning `thinking` block so the
// classifier's allow/deny decision is the only visible content.
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

/**
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 * Used when provider forces streaming but client wants non-streaming.
 */
export function parseSSEToOpenAIResponse(rawSSE, fallbackModel, {
  format = FORMATS.OPENAI,
  providerBody = null,
} = {}) {
  const chunks = [];
  let eventName = null;
  const terminal = createUpstreamTerminalTracker({
    format,
    expectedChoiceCount: providerBody?.n,
    expectedCandidateCount: providerBody?.candidate_count
      ?? providerBody?.candidateCount
      ?? providerBody?.generationConfig?.candidateCount
      ?? providerBody?.generation_config?.candidate_count,
  });

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      eventName = trimmed.slice(6).trim() || null;
      continue;
    }
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload) continue;
    if (payload === "[DONE]") {
      terminal.observe({ rawDone: true, eventName });
      eventName = null;
      continue;
    }
    try {
      const parsed = JSON.parse(payload);
      chunks.push(parsed);
      terminal.observe({ chunk: parsed, eventName });
    } catch { terminal.fail(); }
    eventName = null;
  }

  if (chunks.length === 0 || terminal.outcome !== "success") return null;

  const first = chunks[0];
  const choicesByIndex = new Map();
  let usage = null;

  for (const chunk of chunks) {
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    for (const [position, choice] of (chunk?.choices || []).entries()) {
      const choiceIndex = Number.isInteger(choice?.index) ? choice.index : position;
      if (!choicesByIndex.has(choiceIndex)) {
        choicesByIndex.set(choiceIndex, {
          index: choiceIndex,
          role: "assistant",
          contentParts: [],
          reasoningParts: [],
          toolCallMap: new Map(),
          finishReason: null,
        });
      }

      const accumulator = choicesByIndex.get(choiceIndex);
      const delta = choice?.delta || {};
      if (typeof delta.role === "string" && delta.role) accumulator.role = delta.role;
      if (typeof delta.content === "string" && delta.content.length > 0) accumulator.contentParts.push(delta.content);
      const reasoning = extractReasoningText(delta);
      if (reasoning) accumulator.reasoningParts.push(reasoning);
      if (choice?.finish_reason) accumulator.finishReason = choice.finish_reason;

      // Tool-call indexes are scoped to a response choice, not the response.
      for (const toolCall of (Array.isArray(delta.tool_calls) ? delta.tool_calls : [])) {
        const toolIndex = toolCall.index ?? 0;
        if (!accumulator.toolCallMap.has(toolIndex)) {
          accumulator.toolCallMap.set(toolIndex, {
            id: toolCall.id || "",
            type: toolCall.type || "function",
            function: { name: "", arguments: "" },
          });
        }
        const existing = accumulator.toolCallMap.get(toolIndex);
        if (toolCall.id) existing.id = toolCall.id;
        if (toolCall.type) existing.type = toolCall.type;
        if (toolCall.function?.name) existing.function.name += toolCall.function.name;
        if (toolCall.function?.arguments) existing.function.arguments += toolCall.function.arguments;
      }
    }
  }

  if (choicesByIndex.size === 0) {
    choicesByIndex.set(0, {
      index: 0,
      role: "assistant",
      contentParts: [],
      reasoningParts: [],
      toolCallMap: new Map(),
      finishReason: null,
    });
  }

  const choices = [...choicesByIndex.values()]
    .sort((left, right) => left.index - right.index)
    .map(accumulator => {
      const text = accumulator.contentParts.join("");
      const message = {
        role: accumulator.role,
        content: text || (accumulator.toolCallMap.size > 0 ? null : ""),
      };
      if (accumulator.reasoningParts.length > 0) {
        message.reasoning_content = accumulator.reasoningParts.join("");
      }
      if (accumulator.toolCallMap.size > 0) {
        message.tool_calls = [...accumulator.toolCallMap.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([, toolCall]) => toolCall);
      }
      return {
        index: accumulator.index,
        message,
        finish_reason: accumulator.finishReason || "stop",
      };
    });

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices,
  };
  if (usage) result.usage = usage;
  return result;
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 * Supports both Codex/Responses API SSE and standard Chat Completions SSE.
 */
export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, trackDone, appendLog, toolNameMap, reqTag, log, usageEventId, claudeClassifierCompat, terminalProvenance = null, signal = null, responseBodyTimeoutMs = RESPONSE_BODY_TIMEOUT_MS }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  if (!isSSE) return null; // not handled here

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };
  const sessionId = (finalBody || translatedBody)?.conversationState?.conversationId;
  const markSuccess = async () => {
    if (!onRequestSuccess || !["upstream", "validated"].includes(terminalProvenance)) return;
    try { await onRequestSuccess(); }
    catch { console.error("[ChatCore] completed-response cleanup failed"); }
  };

  try {
    // Codex/Responses API SSE path
    const isCodexResponsesApi = isResponsesProvider(provider) || targetFormat === FORMATS.OPENAI_RESPONSES;
    if (isCodexResponsesApi) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body, {
        signal,
        maxBytes: MAX_PROVIDER_BODY_BYTES,
        timeoutMs: PROVIDER_BODY_TIMEOUT_MS,
        throwOnTimeout: true,
      });
      if (!["completed", "incomplete"].includes(jsonResponse?.status)) {
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Provider stream ended before a coherent terminal");
      }
      const usage = jsonResponse.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, silent: true });
      if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime }, provider, model, sessionId }));

      // Cache-inclusive prompt total for the recorded detail — same logic the
      // client-facing response uses below, so the DB and the client can't disagree.
      const inTokensForLog = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || usage.cached_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);

      // When the client asked for the Responses API format, return the converted JSON directly.
      // responsesApiToOpenAICompletion would project it to chat.completion shape and lose Responses fields.
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        logToolSemantics(log, { source: sourceFormat, target: targetFormat, mode: "sse-json-responses", requestBody: body, translatedBody, providerBody: jsonResponse, clientBody: jsonResponse });

        const totalLatency = Date.now() - requestStartTime;
        saveRequestDetail(buildRequestDetail({
          ...ctx,
          latency: { ttft: totalLatency, total: totalLatency },
          tokens: { prompt_tokens: inTokensForLog, completion_tokens: usage.output_tokens || 0 },
          response: { content: jsonResponse.output?.map?.(o => o.type === "message" ? o.content?.map?.(c => c.type === "output_text" ? c.text : "").join("") : "").join("") || null, thinking: null, finish_reason: jsonResponse.status === "completed" ? "stop" : jsonResponse.status || "unknown" },
          status: "success"
        }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

        await markSuccess();
        return { success: true, response: new Response(JSON.stringify(jsonResponse), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      const openAICompletion = responsesApiToOpenAICompletion(jsonResponse, model);
      const claudeCompat = shouldEnableClaudeCompat(claudeClassifierCompat, sourceFormat, body);
      const finalResp = projectCompletionToClientFormat(openAICompletion, sourceFormat, { claudeCompat, model });
      logToolSemantics(log, { source: sourceFormat, target: targetFormat, mode: "sse-json-responses", requestBody: body, translatedBody, providerBody: jsonResponse, clientBody: finalResp });

      const totalLatency = Date.now() - requestStartTime;
      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: openAICompletion.usage?.prompt_tokens ?? inTokensForLog, completion_tokens: usage.output_tokens || 0 },
        response: { content: openAICompletion.choices?.[0]?.message?.content || null, thinking: openAICompletion.choices?.[0]?.message?.reasoning_content || null, finish_reason: openAICompletion.choices?.[0]?.finish_reason || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      await markSuccess();
      return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error(`[ChatCore] Responses API SSE→JSON failed: ${err?.name || "Error"}`);
      return {
        ...createErrorResult(err?.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY, err?.name === "AbortError" ? "Request aborted" : "Failed to convert streaming response to JSON"),
        quotaTerminalReason: err?.name === "AbortError"
          ? "abort"
          : err?.name === "TimeoutError" ? "timeout" : "stream_error",
      };
    }
  }

    // Standard Chat Completions SSE path
    try {
    const sseText = await readBodyWithTimeout(providerResponse, {
      signal,
      maxBytes: MAX_PROVIDER_BODY_BYTES,
      timeoutMs: responseBodyTimeoutMs,
    });
    const terminalFormat = [FORMATS.KIRO, FORMATS.COMMANDCODE, FORMATS.CURSOR].includes(targetFormat)
      ? targetFormat
      : FORMATS.OPENAI;
    let parsed = parseSSEToOpenAIResponse(sseText, model, {
      format: terminalFormat,
      providerBody: finalBody || translatedBody,
    });
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");

    const inlineThinking = normalizeInlineThinkingResponse(parsed, { provider, model, targetFormat });
    parsed = inlineThinking.responseBody;

    const usage = parsed.usage || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime }, provider, model, sessionId }));

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: parsed.choices?.[0]?.message?.content || null,
        thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
        finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    // OpenAI reasoning is preserved unless the client or deployment explicitly opts out.
    const claudeCompat = shouldEnableClaudeCompat(claudeClassifierCompat, sourceFormat, body);
    if (sourceFormat !== FORMATS.CLAUDE) {
      applyReasoningVisibility(parsed, clientRawRequest);
    }

    // Provider-only metering fields (e.g. Kiro credits) must not reach the
    // client in any client format — the Claude/Gemini projections rebuild
    // usage from prompt/completion tokens and would otherwise drop them (and
    // full format-filtering here would zero Claude's input/output tokens).
    // Accounting above already consumed the raw usage; strip only the
    // provider-only keys on a clone used for the client-facing projection.
    let clientUsage = parsed.usage;
    if (clientUsage) {
      const { kiro_credits, kiro_credit_unit, ...rest } = clientUsage;
      clientUsage = rest;
    }
    const clientParsed = clientUsage ? { ...parsed, usage: clientUsage } : parsed;
    const finalResp = projectCompletionToClientFormat(clientParsed, sourceFormat, { claudeCompat, model });
    logToolSemantics(log, { source: sourceFormat, target: targetFormat, mode: "sse-json-chat", requestBody: body, translatedBody, providerBody: parsed, clientBody: finalResp });

    await markSuccess();
    return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error(`[ChatCore] Chat Completions SSE→JSON failed: ${err?.name || "Error"}`);
      const status = err?.name === "AbortError"
        ? 499
        : err instanceof BodyReadTimeoutError ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
      return {
        ...createErrorResult(status, err?.name === "AbortError" ? "Request aborted" : err instanceof BodyReadTimeoutError ? "Provider response body timed out" : "Failed to convert streaming response to JSON"),
        quotaTerminalReason: err?.name === "AbortError"
          ? "abort"
          : err instanceof BodyReadTimeoutError ? "timeout" : "stream_error",
      };
    }
  } finally {
    trackDone();
  }
}
