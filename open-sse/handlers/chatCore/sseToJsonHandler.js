import { Buffer } from "node:buffer";
import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { createErrorResult } from "../../utils/error.js";
import { readBodyWithTimeout, BodyReadTimeoutError } from "../../utils/bodyTimeout.js";
import { HTTP_STATUS, MAX_PROVIDER_BODY_BYTES, PROVIDER_BODY_TIMEOUT_MS, RESPONSE_BODY_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { FORMATS, GEMINI_FAMILY_FORMATS } from "../../translator/formats.js";
import { geminiToOpenAIResponse } from "../../translator/response/gemini-to-openai.js";
import { extractCompleteSseFrames } from "../../utils/streamHelpers.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { projectCompletionToClientFormat, responsesApiToOpenAICompletion } from "../../translator/response/completionProjector.js";
import { logToolSemantics } from "../../utils/toolSemanticsTrace.js";
import { createResponsesToolNameResolver } from "../../translator/response/openai-responses.js";
import { extractReasoningText } from "../../translator/concerns/reasoning.js";
import { restoreOpenAIToolNames } from "../../translator/concerns/toolCall.js";
import { normalizeInlineThinkingResponse } from "./inlineThinking.js";
import { classifyMaskedGatewayError, createUpstreamTerminalTracker } from "../../utils/streamTerminal.js";
import { applyReasoningVisibility } from "../../utils/reasoningVisibility.js";
import { claudeToOpenAIResponse } from "../../translator/response/claude-to-openai.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { CLAUDE_BLOCK } from "../../translator/schema/index.js";

// Responses-API providers (e.g. codex) may emit SSE without content-type + use Responses output shape
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";
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
  const systemTexts = Array.isArray(body?.system) ?
  body.system.map((part) => isString(part?.text) ? part.text : "").filter(Boolean) :
  [];
  const stopSequences = Array.isArray(body?.stop_sequences) ? body.stop_sequences : [];
  return systemTexts.some((text) => text.includes("You are a security monitor for autonomous AI coding agents")) ||
  stopSequences.includes("</block>");
}

function parseSseEvents(rawSSE) {
  const text = String(rawSSE || "");
  const { frames, remainder } = extractCompleteSseFrames(text);
  if (remainder.trim()) frames.push(remainder);

  return frames.flatMap((frame) => {
    let eventName = null;
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim() || null;
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) return [];
    const data = dataLines.join("\n");
    if (!data.trim()) return [];
    if (dataLines.length === 1 || data.trim() === "[DONE]") {
      return [{ eventName, data, done: data.trim() === "[DONE]" }];
    }
    try {
      JSON.parse(data);
      return [{ eventName, data, done: false }];
    } catch {
      return dataLines.
      filter((line) => line.trim()).
      map((line) => ({ eventName, data: line, done: line.trim() === "[DONE]" }));
    }
  });
}

function aggregateParsedChunks(chunks, fallbackModel, {
  format,
  providerBody,
  terminalObservations = null,
  synthesizedRawDone = false
}) {
  // Preserve an explicit SSE error even after partial content. A failed terminal
  // is not an empty completion; both non-stream consumers must reject it (#1355).
  const errorChunk = chunks.find((chunk) => chunk?.error);
  if (errorChunk) return { error: errorChunk.error };
  const terminal = createUpstreamTerminalTracker({
    format,
    expectedChoiceCount: providerBody?.n,
    expectedCandidateCount: providerBody?.candidate_count ??
    providerBody?.candidateCount ??
    providerBody?.generationConfig?.candidateCount ??
    providerBody?.generation_config?.candidate_count
  });
  if (terminalObservations) {
    for (const observation of terminalObservations) terminal.observe(observation);
  } else {
    for (const chunk of chunks) terminal.observe({ chunk });
  }
  if (synthesizedRawDone) terminal.observe({ rawDone: true });
  if (chunks.length === 0) return null;
  // Upstream finish_reason "error" makes the terminal tracker fail. Still
  // aggregate so handleForcedSSEToJson can return the same incoherent-response
  // 502 as the non-stream coherence gate (#1330 / #1089) instead of the
  // generic "Invalid SSE" envelope — and never markSuccess on that path.
  if (terminal.outcome !== "success") {
    const hasErrorFinish = chunks.some((chunk) =>
      Array.isArray(chunk?.choices) &&
      chunk.choices.some((choice) => choice?.finish_reason === "error")
    );
    if (!hasErrorFinish) return null;
  }

  const first = chunks[0];
  const choicesByIndex = new Map();
  let usage = null;

  for (const chunk of chunks) {
    if (chunk?.usage && isObject(chunk.usage)) usage = chunk.usage;

    for (const [position, choice] of (chunk?.choices || []).entries()) {
      const choiceIndex = Number.isInteger(choice?.index) ? choice.index : position;
      if (!choicesByIndex.has(choiceIndex)) {
        choicesByIndex.set(choiceIndex, {
          index: choiceIndex,
          role: "assistant",
          contentParts: [],
          reasoningParts: [],
          audio: null,
          audioParts: [],
          transcriptParts: [],
          toolCallMap: new Map(),
          finishReason: null,
          nativeFinishReason: null
        });
      }

      const accumulator = choicesByIndex.get(choiceIndex);
      const delta = choice?.delta || {};
      if (isString(delta.role) && delta.role) accumulator.role = delta.role;
      if (isString(delta.content) && delta.content.length > 0) accumulator.contentParts.push(delta.content);
      if (delta.audio && isObject(delta.audio)) {
        accumulator.audio = { ...accumulator.audio, ...delta.audio };
        if (isString(delta.audio.data)) accumulator.audioParts.push(Buffer.from(delta.audio.data, "base64"));
        if (isString(delta.audio.transcript)) accumulator.transcriptParts.push(delta.audio.transcript);
      }
      const reasoning = extractReasoningText(delta);
      if (reasoning) accumulator.reasoningParts.push(reasoning);
      if (choice?.finish_reason) accumulator.finishReason = choice.finish_reason;
      if (choice?.native_finish_reason) accumulator.nativeFinishReason = choice.native_finish_reason;

      // Tool-call indexes are scoped to a response choice, not the response.
      for (const toolCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const toolIndex = toolCall.index ?? 0;
        if (!accumulator.toolCallMap.has(toolIndex)) {
          accumulator.toolCallMap.set(toolIndex, {
            id: toolCall.id || "",
            type: toolCall.type || "function",
            function: { name: "", arguments: "" }
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
      finishReason: null
    });
  }

  const choices = [...choicesByIndex.values()].
  sort((left, right) => left.index - right.index).
  map((accumulator) => {
    const text = accumulator.contentParts.join("");
    const message = {
      role: accumulator.role,
      content: text || (accumulator.toolCallMap.size > 0 ? null : "")
    };
    if (accumulator.reasoningParts.length > 0) {
      message.reasoning_content = accumulator.reasoningParts.join("");
    }
    if (accumulator.audio) {
      message.audio = {
        ...accumulator.audio,
        ...(accumulator.audioParts.length ? { data: Buffer.concat(accumulator.audioParts).toString("base64") } : null),
        ...(accumulator.transcriptParts.length ? { transcript: accumulator.transcriptParts.join("") } : null)
      };
      if (!text) message.content = null;
    }
    if (accumulator.toolCallMap.size > 0) {
      message.tool_calls = [...accumulator.toolCallMap.entries()].
      sort((left, right) => left[0] - right[0]).
      map(([, toolCall]) => toolCall);
    }
    return {
      index: accumulator.index,
      message,
      finish_reason: accumulator.finishReason || "stop",
      ...(accumulator.nativeFinishReason ? { native_finish_reason: accumulator.nativeFinishReason } : null)
    };
  });

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices
  };
  if (usage) result.usage = usage;
  return result;
}

/**
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 * Used when provider forces streaming but client wants non-streaming.
 */
export function parseSSEToOpenAIResponse(rawSSE, fallbackModel, {
  format = FORMATS.OPENAI,
  providerBody = null
} = {}) {
  const chunks = [];
  const terminalObservations = [];
  for (const { eventName, data, done } of parseSseEvents(rawSSE)) {
    if (done) {
      terminalObservations.push({ rawDone: true, eventName });
      continue;
    }
    try {
      const chunk = JSON.parse(data);
      chunks.push(chunk);
      terminalObservations.push({ chunk, eventName });
    } catch {return null;}
  }
  return aggregateParsedChunks(chunks, fallbackModel, { format, providerBody, terminalObservations });
}

/**
 * Port 9router 56dbf466 through the fork's shared redacting error builder.
 * Never forward raw envelopes, coerce object/array status fields, or mark an
 * SSE error as successful usage. Finish-reason errors keep their separate 502.
 */
export function createSSEErrorResult(parsed, credentials = null) {
  if (!parsed?.error) return null;
  const rawStatus = parsed.error.status;
  const candidate = isString(rawStatus) ? Number(rawStatus) : rawStatus;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ?
    candidate : HTTP_STATUS.BAD_GATEWAY;
  const message = isString(parsed.error.message) && parsed.error.message.trim() ?
    parsed.error.message : "Upstream SSE stream failed";
  return { ...createErrorResult(status, message, undefined, undefined, null, credentials), quotaTerminalReason: "stream_error" };
}

function parseGeminiSSEToOpenAIResponse(rawSSE, fallbackModel, providerBody, toolNameMap) {
  const state = { toolNameMap };
  const chunks = [];

  for (const { data, done } of parseSseEvents(rawSSE)) {
    if (done) continue;
    let parsed;
    try {parsed = JSON.parse(data);} catch {return null;}
    const translated = geminiToOpenAIResponse(parsed, state);
    if (translated) chunks.push(...translated);
  }

  return aggregateParsedChunks(chunks, fallbackModel, {
    format: FORMATS.OPENAI,
    providerBody,
    synthesizedRawDone: true
  });
}

const CLAUDE_TEXT_DELTA_FIELDS = { text_delta: "text", thinking_delta: "thinking", signature_delta: "signature" };

/**
 * Rebuild the Anthropic message from its stream events for Claude clients. The
 * Chat hop has no room for signatures, redacted thinking, block order,
 * stop_sequence or exclusive cache usage. Returns null on unparseable tool input.
 */
function foldClaudeEventsToMessage(events) {
  let message = {};
  const blocks = new Map();
  const toolJson = new Map();

  for (const event of events) {
    if (event.type === "message_start") {
      message = event.message || {};
    } else if (event.type === "content_block_start") {
      blocks.set(event.index, event.content_block);
    } else if (event.type === "content_block_delta" && blocks.has(event.index)) {
      const block = blocks.get(event.index);
      const { type, partial_json: partialJson, citation } = event.delta || {};
      const field = CLAUDE_TEXT_DELTA_FIELDS[type];
      if (field) blocks.set(event.index, { ...block, [field]: (block[field] || "") + (event.delta[field] || "") });
      if (type === "citations_delta") blocks.set(event.index, { ...block, citations: [...(block.citations || []), citation] });
      if (type === "input_json_delta") toolJson.set(event.index, (toolJson.get(event.index) || "") + (partialJson || ""));
    } else if (event.type === "message_delta") {
      message = { ...message, ...event.delta, usage: { ...message.usage, ...event.usage } };
    }
  }

  const content = [];
  for (const index of [...blocks.keys()].sort((left, right) => left - right)) {
    const json = toolJson.get(index);
    let block = blocks.get(index);
    if (json) {
      try {block = { ...block, input: JSON.parse(json) };} catch {return null;}
    }
    content.push(block);
  }
  return { ...message, content };
}

/**
 * Anthropic SSE from a Claude transport. Chunks go through the same converter as
 * streaming; the raw events drive the terminal check, so a missing message_stop
 * stays a 502. `completion` is null on failure, and the whole return is null when
 * the provider answered with Chat chunks despite its Claude transport.
 */
function parseClaudeSSE(rawSSE, fallbackModel, { providerBody, toolNameMap, nativeMessage }) {
  const state = { toolCalls: new Map(), toolNameMap };
  const events = [];
  const chunks = [];
  const terminalObservations = [];

  for (const { eventName, data, done } of parseSseEvents(rawSSE)) {
    if (done) continue;
    let event;
    try {event = JSON.parse(data);} catch {return { completion: null };}
    if (Array.isArray(event?.choices)) return null;
    if (eventName === "error" || event?.type === "error" || event?.error) {
      return { completion: { error: event?.error || {} } };
    }
    events.push(event);
    terminalObservations.push({ chunk: event, eventName });
    // The converter keeps growing the tool_call it already emitted. A stream
    // serializes each chunk right away; buffering must snapshot it or the
    // arguments are counted twice.
    const translated = claudeToOpenAIResponse(event, state);
    if (translated) chunks.push(...structuredClone(translated));
  }

  const completion = aggregateParsedChunks(chunks, fallbackModel, { format: FORMATS.CLAUDE, providerBody, terminalObservations });
  if (!completion || !nativeMessage) return { completion };
  const message = foldClaudeEventsToMessage(events);
  return message ? { completion, message: decloakToolNames(message, toolNameMap) } : { completion: null };
}

/** Overlay what the Chat hop loses onto the projected Claude response. */
function withNativeClaudeFields(projected, message, claudeCompat) {
  const hidden = [CLAUDE_BLOCK.THINKING, CLAUDE_BLOCK.REDACTED_THINKING];
  const content = claudeCompat ? message.content.filter((block) => !hidden.includes(block?.type)) : message.content;
  return {
    ...message,
    ...projected,
    id: message.id || projected.id,
    content: content.length > 0 ? content : [{ type: CLAUDE_BLOCK.TEXT, text: "" }],
    stop_reason: message.stop_reason || projected.stop_reason,
    stop_sequence: message.stop_sequence ?? null,
    usage: message.usage || projected.usage
  };
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 * Supports both Codex/Responses API SSE and standard Chat Completions SSE.
 */
export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, comboId = null, comboName = null, apiKey, clientRawRequest, onRequestSuccess, trackDone, appendLog, toolNameMap, customToolNames, reqTag, log, usageEventId, claudeClassifierCompat, terminalProvenance = null, signal = null, responseBodyTimeoutMs = RESPONSE_BODY_TIMEOUT_MS, credentials = null }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || contentType === "" && isResponsesProvider(provider);
  if (!isSSE) return null; // not handled here
  /** Upstream PR #3373: request translators emit arrays; projection uses Set membership. */
  const customToolNameSet = customToolNames instanceof Set ?
  customToolNames :
  new Set(customToolNames || []);

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };
  const sessionId = (finalBody || translatedBody)?.conversationState?.conversationId;
  const markSuccess = async () => {
    if (!onRequestSuccess || !["upstream", "validated"].includes(terminalProvenance)) return;
    try {await onRequestSuccess();}
    catch {console.error("[ChatCore] completed-response cleanup failed");}
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
          throwOnTimeout: true
        });
        if (!["completed", "incomplete"].includes(jsonResponse?.status)) {
          return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Provider stream ended before a coherent terminal");
        }
        const usage = jsonResponse.usage || {};
        appendLog({ tokens: usage, status: "200 OK" });
        saveUsageStats({ provider, model, tokens: usage, connectionId, comboId, comboName, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, latency: { total: Date.now() - requestStartTime, ttft: 0 }, silent: true });
        if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime }, provider, model, sessionId }));

        // Responses usage is already cache-inclusive after stream conversion.
        const inTokensForLog = usage.input_tokens || 0;

        // When the client asked for the Responses API format, return the converted JSON directly.
        // responsesApiToOpenAICompletion would project it to chat.completion shape and lose Responses fields.
        if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
          logToolSemantics(log, { source: sourceFormat, target: targetFormat, mode: "sse-json-responses", requestBody: body, translatedBody, providerBody: jsonResponse, clientBody: jsonResponse });

          const totalLatency = Date.now() - requestStartTime;
          saveRequestDetail(buildRequestDetail({
            ...ctx,
            latency: { ttft: totalLatency, total: totalLatency },
            tokens: { prompt_tokens: inTokensForLog, completion_tokens: usage.output_tokens || 0 },
            response: { content: jsonResponse.output?.map?.((o) => o.type === "message" ? o.content?.map?.((c) => c.type === "output_text" ? c.text : "").join("") : "").join("") || null, thinking: null, finish_reason: jsonResponse.status === "completed" ? "stop" : jsonResponse.status || "unknown" },
            status: "success"
          }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

          await markSuccess();
          return { success: true, response: new Response(JSON.stringify(jsonResponse), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
        }

        const openAICompletion = responsesApiToOpenAICompletion(jsonResponse, model);
        const claudeCompat = shouldEnableClaudeCompat(claudeClassifierCompat, sourceFormat, body);
        const finalResp = projectCompletionToClientFormat(openAICompletion, sourceFormat, { claudeCompat, model, customToolNames: customToolNameSet });
        // Chat clients get the projection as-is, so restore request-side aliases (#1406).
        if (sourceFormat === FORMATS.OPENAI) restoreOpenAIToolNames(finalResp, toolNameMap);
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
          quotaTerminalReason: err?.name === "AbortError" ?
          "abort" :
          err?.name === "TimeoutError" ? "timeout" : "stream_error"
        };
      }
    }

    // Standard Chat Completions SSE path
    try {
      const sseText = await readBodyWithTimeout(providerResponse, {
        signal,
        maxBytes: MAX_PROVIDER_BODY_BYTES,
        timeoutMs: responseBodyTimeoutMs
      });
      const isGeminiFamily = GEMINI_FAMILY_FORMATS.has(targetFormat);
      const terminalFormat = [FORMATS.KIRO, FORMATS.COMMANDCODE, FORMATS.CURSOR].includes(targetFormat) ?
      targetFormat :
      FORMATS.OPENAI;
      const claudeSSE = targetFormat === FORMATS.CLAUDE ?
      parseClaudeSSE(sseText, model, {
        providerBody: finalBody || translatedBody,
        toolNameMap,
        nativeMessage: sourceFormat === FORMATS.CLAUDE
      }) :
      null;
      let parsed = claudeSSE ? claudeSSE.completion : isGeminiFamily ?
      parseGeminiSSEToOpenAIResponse(sseText, model, finalBody || translatedBody, toolNameMap) :
      parseSSEToOpenAIResponse(sseText, model, {
        format: terminalFormat,
        providerBody: finalBody || translatedBody
      });
      if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
      const sseError = createSSEErrorResult(parsed, credentials);
      if (sseError) {
        appendLog({ status: `FAILED ${sseError.status}` });
        return sseError;
      }

      const inlineThinking = normalizeInlineThinkingResponse(parsed, { provider, model, targetFormat });
      parsed = inlineThinking.responseBody;

      const maskedGatewayError = classifyMaskedGatewayError(parsed);
      if (maskedGatewayError) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Upstream provider error: ${maskedGatewayError}`);
      }

      // Match non-stream isCoherentOpenAICompletion: allowlist only the exact
      // hub finish_reason "error". Do not project to Claude/Gemini or markSuccess.
      const hasErrorFinish = Array.isArray(parsed.choices) &&
        parsed.choices.some((choice) => choice?.finish_reason === "error");
      if (hasErrorFinish) {
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(
          HTTP_STATUS.BAD_GATEWAY,
          "Provider returned an incoherent non-streaming response"
        );
      }

      const usage = parsed.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, comboId, comboName, apiKey, endpoint: clientRawRequest?.endpoint, usageEventId, latency: { total: Date.now() - requestStartTime, ttft: 0 }, silent: true });
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
      const resolveToolName = sourceFormat === FORMATS.OPENAI_RESPONSES || sourceFormat === FORMATS.OPENAI_RESPONSE ? createResponsesToolNameResolver(body, toolNameMap) : undefined;
      const projected = projectCompletionToClientFormat(clientParsed, sourceFormat, { claudeCompat, model, customToolNames: customToolNameSet, resolveToolName });
      const finalResp = claudeSSE?.message ? withNativeClaudeFields(projected, claudeSSE.message, claudeCompat) : projected;
      // Chat clients get the projection as-is, so restore request-side aliases (#1406).
      if (sourceFormat === FORMATS.OPENAI) restoreOpenAIToolNames(finalResp, toolNameMap);
      logToolSemantics(log, { source: sourceFormat, target: targetFormat, mode: "sse-json-chat", requestBody: body, translatedBody, providerBody: parsed, clientBody: finalResp });

      await markSuccess();
      return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error(`[ChatCore] Chat Completions SSE→JSON failed: ${err?.name || "Error"}`);
      const status = err?.name === "AbortError" ?
      499 :
      err instanceof BodyReadTimeoutError ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY;
      return {
        ...createErrorResult(status, err?.name === "AbortError" ? "Request aborted" : err instanceof BodyReadTimeoutError ? "Provider response body timed out" : "Failed to convert streaming response to JSON"),
        quotaTerminalReason: err?.name === "AbortError" ?
        "abort" :
        err instanceof BodyReadTimeoutError ? "timeout" : "stream_error"
      };
    }
  } finally {
    trackDone();
  }
}
