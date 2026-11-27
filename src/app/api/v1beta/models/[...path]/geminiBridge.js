/**
 * Conversion helpers for the Gemini-compatible /v1beta bridge. Keeping these
 * outside route.js lets unit tests exercise the translation surface without
 * adding non-route exports to the Next.js app route module.
 */
import { isObject, isRecord, isString } from "../../../../../shared/utils/typeChecks.js";
import { GEMINI_ROLE } from "open-sse/translator/schema/roles.js";
import { encodeToolCallIdWithSignature } from "open-sse/translator/concerns/signatureTransport.js";
import { encodeDataUri } from "open-sse/translator/concerns/image.js";
import { buildGeminiUsageMetadata } from "open-sse/translator/response/geminiUsageMetadata.js";
import { groupGeminiFunctionResponses } from "open-sse/translator/formats/gemini.js";
import { formatGoogleRpcStreamError } from "open-sse/utils/antigravityGeminiNative.js";

/**
 * Check native reply groups before the OpenAI pivot can repair or discard them.
 * CPA 13e0642 deliberately preserves invalid boundaries and excess replies for
 * pairing rejection. A later model turn starts a fresh queue, as in #1089.
 */
export function validateGeminiFunctionPairing(contents) {
  let pending = [];
  const fail = () => { throw new Error("Invalid Gemini function pairing"); };
  for (const content of groupGeminiFunctionResponses(contents) || []) {
    if (!isRecord(content) || !Array.isArray(content.parts) || content.parts.length === 0) {
      if (pending.length) fail();
      continue;
    }
    const calls = content.parts.map(p => p?.functionCall ?? p?.function_call).filter(isRecord);
    const replies = content.parts.map(p => p?.functionResponse ?? p?.function_response).filter(isRecord);
    if (calls.length) {
      if (content.role !== GEMINI_ROLE.MODEL && pending.length) fail();
      pending = calls;
      continue;
    }
    if (!replies.length) continue;
    if (replies.length !== pending.length) fail();
    for (let i = 0; i < pending.length; i++) {
      const call = pending[i];
      const reply = replies[i];
      const name = isString(reply.name) ? reply.name.trim() : "";
      if (call.id && reply.id && call.id !== reply.id) fail();
      if (name && call.name && name !== call.name) fail();
    }
    pending = [];
  }
  if (pending.length) fail();
}

/**
 * Convert Gemini request format to OpenAI/internal format.
 *
 * @param {object} geminiBody  - parsed Gemini request body
 * @param {string} model       - resolved model string (e.g. "gemini-pro-high")
 * @param {boolean} stream     - whether to stream (from URL action)
 * @param {boolean} preserveSignatures - public gateway transports native signatures
 * through the OpenAI pivot; direct callers keep their historical plain IDs.
 */
export function convertGeminiToInternal(geminiBody, model, stream, preserveSignatures = false) {
  const messages = [];

  if (geminiBody.systemInstruction) {
    const systemText = geminiBody.systemInstruction.parts?.
    map((p) => p.text).
    join("\n") || "";
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  if (geminiBody.contents) {
    const toolCallIdState = { serialByName: new Map(), queueByName: new Map(), callOrder: [], preserveSignatures };
    // Regroup split parallel replies in call order before ids are paired.
    for (const content of groupGeminiFunctionResponses(geminiBody.contents)) {
      const converted = convertGeminiContentToInternal(content, toolCallIdState);
      if (Array.isArray(converted)) messages.push(...converted);else
      if (converted) messages.push(converted);
    }
  }

  const result = {
    model,
    messages,
    stream,
    // Gemini replies carry usageMetadata, so the bridge asks the Chat stream for usage.
    ...(stream ? { stream_options: { include_usage: true } } : null),
    ...(geminiBody.reasoning_effort && { reasoning_effort: geminiBody.reasoning_effort }),
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP
  };

  if (Array.isArray(geminiBody.tools)) {
    const tools = [];
    for (const tool of geminiBody.tools) {
      for (const func of tool.functionDeclarations || []) {
        tools.push({
          type: "function",
          function: {
            name: func.name || "",
            description: func.description || "",
            parameters: normalizeGeminiSchemaTypes(func.parameters || func.parametersJsonSchema) || { type: "object", properties: {} }
          }
        });
      }
    }
    if (tools.length > 0) result.tools = tools;

    const toolConfig = geminiBody.toolConfig;
    const mode = toolConfig?.functionCallingConfig?.mode;
    if (mode === "NONE") {
      result.tool_choice = "none";
    } else if (mode === "ANY") {
      const allowed = toolConfig?.functionCallingConfig?.allowedFunctionNames;
      // Names matching no declared tool are ignored: keep every tool so "required" never ships empty.
      const matched = Array.isArray(allowed) ? tools.filter((t) => allowed.includes(t.function.name)) : [];
      if (matched.length > 0) result.tools = matched;
      if (result.tools?.length === 1) {
        result.tool_choice = { type: "function", function: { name: result.tools[0].function.name } };
      } else {
        result.tool_choice = "required";
      }
    } else if (mode === "ANY_MODE" || mode === "AUTO" || mode === "VALIDATED") {
      result.tool_choice = "auto";
    }
  }

  return result;
}

/**
 * Gemini v1beta accepts schema type names such as OBJECT or STRING, while the
 * OpenAI tool bridge expects lowercase JSON Schema type values at every depth.
 */
export function normalizeGeminiSchemaTypes(schema) {
  if (!schema || !isObject(schema)) return schema;
  if (Array.isArray(schema)) return schema.map((item) => normalizeGeminiSchemaTypes(item));

  const normalized = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && isString(value)) {
      normalized[key] = value.toLowerCase();
    } else if (key === "type" && Array.isArray(value)) {
      normalized[key] = value.map((item) => isString(item) ? item.toLowerCase() : item);
    } else {
      normalized[key] = normalizeGeminiSchemaTypes(value);
    }
  }
  return normalized;
}

// Gemini accepts snake_case function_call/function_response parts too.
function withCamelFunctionParts(part) {
  if (!isRecord(part)) return {};
  const { function_call: snakeCall, function_response: snakeResponse, ...rest } = part;
  if (snakeCall === undefined && snakeResponse === undefined) return part;
  return { ...rest, functionCall: part.functionCall ?? snakeCall, functionResponse: part.functionResponse ?? snakeResponse };
}

function convertGeminiContentToInternal(content, toolCallIdState = { serialByName: new Map(), queueByName: new Map(), callOrder: [] }) {
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  if (parts.length === 0) return null;

  const messages = [];
  const remainingParts = [];
  const { serialByName, queueByName, callOrder } = toolCallIdState;
  // Each pending call is one entry, shared by its name queue and the turn order.
  const claim = (entries) => {
    const entry = entries?.find((candidate) => !candidate.used);
    if (entry) entry.used = true;
    return entry?.id;
  };

  for (const rawPart of parts) {
    const part = withCamelFunctionParts(rawPart);
    if (part.functionResponse) {
      const response = part.functionResponse.response || {};
      const payload = Object.prototype.hasOwnProperty.call(response, "result") ?
      response.result :
      response;
      const name = (part.functionResponse.name || "").trim();
      let toolCallId = part.functionResponse.id;
      // A nameless reply takes the next unanswered call by position, as
      // CLIProxyAPI backfills empty functionResponse names.
      if (toolCallId) {
        const entry = callOrder.find(candidate => !candidate.used && candidate.rawId === toolCallId && (!name || candidate.name === name))
          ?? callOrder.find(candidate => !candidate.used && candidate.rawId === toolCallId);
        if (entry) { entry.used = true; toolCallId = entry.id; }
      } else toolCallId = claim(name ? queueByName.get(name) : callOrder);
      if (!toolCallId && name) {
        toolCallId = `call_${name}`;
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify(payload ?? {})
      });
    } else {
      remainingParts.push(part);
    }
  }

  // Model thought text uses the same reasoning field as the native translator.
  const isThought = (part) => content.role === "model" && part.thought === true && isString(part.text);
  const reasoningContent = remainingParts.filter(isThought).map((part) => part.text).join("");
  const text = remainingParts.
  filter((part) => isString(part.text) && !isThought(part)).
  map((part) => part.text).
  join("\n");
  // Inline images, PDFs and audio become data-URL image_url parts, the same
  // mapping gemini-to-openai.js uses. gemini-cli sends a file a tool read as
  // inlineData next to the functionResponse, so this runs for those turns too.
  const inlineParts = remainingParts.
  filter((part) => part.inlineData?.data).
  map((part) => ({ type: "image_url", image_url: { url: encodeDataUri(part.inlineData.mimeType, part.inlineData.data) } }));
  // A reply pairs with the calls of the turn just before it: each model turn with calls starts a fresh pairing queue (the serial stays global so ids are unique across the history).
  if (remainingParts.some((part) => part.functionCall)) {
    queueByName.clear();
    callOrder.length = 0;
  }
  const toolCalls = remainingParts.
  filter((part) => part.functionCall).
  map((part) => {
    const name = part.functionCall.name || "";
    let id = part.functionCall.id;
    if (!id) {
      const serial = (serialByName.get(name) || 0) + 1;
      serialByName.set(name, serial);
      id = `call_${name}_${serial}`;
    }
    const rawId = id;
    const signature = part.thoughtSignature ?? part.thought_signature;
    if (toolCallIdState.preserveSignatures && signature) id = encodeToolCallIdWithSignature(id, signature);
    const entry = { id, rawId, name, used: false };
    const queue = queueByName.get(name) || [];
    queue.push(entry);
    queueByName.set(name, queue);
    callOrder.push(entry);
    return {
      id,
      type: "function",
      function: {
        name: part.functionCall.name || "",
        arguments: JSON.stringify(part.functionCall.args || {})
      }
    };
  });

  if (toolCalls.length > 0) {
    const assistantMessage = { role: "assistant", tool_calls: toolCalls };
    if (text) assistantMessage.content = text;
    if (reasoningContent) assistantMessage.reasoning_content = reasoningContent;
    messages.push(assistantMessage);
  } else if (inlineParts.length > 0) {
    const textParts = text ? [{ type: "text", text }] : [];
    const message = { role: content.role === "model" ? "assistant" : "user", content: [...textParts, ...inlineParts] };
    if (reasoningContent) message.reasoning_content = reasoningContent;
    messages.push(message);
  } else if (text) {
    const message = { role: content.role === "model" ? "assistant" : "user", content: text };
    if (reasoningContent) message.reasoning_content = reasoningContent;
    messages.push(message);
  } else if (reasoningContent) {
    messages.push({ role: "assistant", reasoning_content: reasoningContent });
  }

  return messages.length === 1 ? messages[0] : messages;
}

const FINISH_REASON_MAP = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY"
};

/**
 * Convert one OpenAI chat.completion.chunk payload to a Gemini SSE chunk.
 */
export function openAIChunkToGeminiChunk(parsed, model, state = {}) {
  const choice = parsed.choices?.[0];
  if (!choice) return null;

  const delta = choice.delta || {};
  const parts = [];
  if (delta.reasoning_content) {
    parts.push({ text: delta.reasoning_content, thought: true });
  }
  if (delta.content) {
    parts.push({ text: delta.content });
  }

  if (Array.isArray(delta.tool_calls)) {
    const accum = state.toolCallAccum ??= {};
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      const entry = accum[index] ??= { id: "", name: "", arguments: "" };
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.name += tc.function.name;
      if (tc.function?.arguments) entry.arguments += tc.function.arguments;
    }
  }

  if (choice.finish_reason && state.toolCallAccum) {
    for (const key of Object.keys(state.toolCallAccum)) {
      const entry = state.toolCallAccum[key];
      if (!entry.name) continue;
      let args = {};
      try {
        args = JSON.parse(entry.arguments || "{}");
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: entry.name, args } });
    }
    delete state.toolCallAccum;
  }

  if (parts.length === 0 && !choice.finish_reason) return null;

  const candidate = {
    content: {
      role: "model",
      parts: parts.length > 0 ? parts : [{ text: "" }]
    },
    index: 0
  };

  if (choice.finish_reason) {
    candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] || "STOP";
  }

  const geminiChunk = { candidates: [candidate] };

  if (choice.finish_reason && parsed.usage) {
    geminiChunk.usageMetadata = buildGeminiUsageMetadata(parsed.usage);
    geminiChunk.modelVersion = parsed.model || model;
  }

  return geminiChunk;
}

/**
 * Transform an OpenAI SSE stream into the Gemini SSE stream expected by
 * @google/genai on :streamGenerateContent?alt=sse.
 */
export function transformOpenAISSEToGeminiSSE(upstreamResponse, model) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const toolCallState = {};
  let failed = false;
  // A committed stream cannot change its HTTP status: an in-stream error ends
  // it with one Google RPC error frame and nothing is replayed after it.
  const forwardError = (parsed, controller) => {
    if (!isRecord(parsed?.error)) return false;
    if (!failed) controller.enqueue(encoder.encode(formatGoogleRpcStreamError(parsed.error)));
    failed = true;
    return true;
  };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (failed || !line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (forwardError(parsed, controller)) continue;

        const geminiChunk = openAIChunkToGeminiChunk(parsed, model, toolCallState);
        if (!geminiChunk) continue;

        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n")
        );
      }
    },
    flush(controller) {
      const remaining = buffer.trim();
      if (failed || !remaining.startsWith("data:")) return;
      const data = remaining.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        if (forwardError(parsed, controller)) return;
        const geminiChunk = openAIChunkToGeminiChunk(parsed, model, toolCallState);
        if (geminiChunk) {
          controller.enqueue(
            encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n")
          );
        }
      } catch {

        // Ignore partial trailing frames; Gemini SSE ends by stream close.
      }}
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 */
export async function convertOpenAIResponseToGemini(response, model) {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  if (body.candidates) return Response.json(body, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  if (body.error) return Response.json(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  const choice = body.choices?.[0];
  if (!choice) {
    return Response.json(body, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const { message, finish_reason } = choice;

  const parts = [];
  if (message.reasoning_content) {
    parts.push({ text: message.reasoning_content, thought: true });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (message.content || toolCalls.length === 0) {
    parts.push({ text: message.content || "" });
  }
  for (const toolCall of toolCalls) {
    let args = {};
    try {
      args = JSON.parse(toolCall.function?.arguments || "{}");
    } catch {
      args = {};
    }
    parts.push({
      functionCall: {
        name: toolCall.function?.name || "",
        args
      }
    });
  }

  const finishReason = FINISH_REASON_MAP[finish_reason] || "STOP";

  const geminiResponse = {
    candidates: [
    {
      content: { role: "model", parts },
      finishReason,
      index: 0
    }],

    modelVersion: body.model || model
  };

  if (body.usage) {
    geminiResponse.usageMetadata = buildGeminiUsageMetadata(body.usage);
  }

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
