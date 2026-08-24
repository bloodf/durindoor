import { isObject, isString } from "../../../../../shared/utils/typeChecks.js"; /**
 * Conversion helpers for the Gemini-compatible /v1beta bridge. Keeping these
 * outside route.js lets unit tests exercise the translation surface without
 * adding non-route exports to the Next.js app route module.
 */

/**
 * Convert Gemini request format to OpenAI/internal format.
 *
 * @param {object} geminiBody  - parsed Gemini request body
 * @param {string} model       - resolved model string (e.g. "gemini-pro-high")
 * @param {boolean} stream     - whether to stream (from URL action)
 */
export function convertGeminiToInternal(geminiBody, model, stream) {
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
    const toolCallIdState = { serialByName: new Map(), queueByName: new Map() };
    for (const content of geminiBody.contents) {
      const converted = convertGeminiContentToInternal(content, toolCallIdState);
      if (Array.isArray(converted)) messages.push(...converted);else
      if (converted) messages.push(converted);
    }
  }

  const result = {
    model,
    messages,
    stream,
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
            parameters: normalizeGeminiSchemaTypes(func.parameters) || { type: "object", properties: {} }
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
      if (Array.isArray(allowed) && allowed.length > 0) {
        result.tools = tools.filter((t) => allowed.includes(t.function.name));
      }
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

function convertGeminiContentToInternal(content, toolCallIdState = { serialByName: new Map(), queueByName: new Map() }) {
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  if (parts.length === 0) return null;

  const messages = [];
  const remainingParts = [];
  const { serialByName, queueByName } = toolCallIdState;

  for (const part of parts) {
    if (part.functionResponse) {
      const response = part.functionResponse.response || {};
      const payload = Object.prototype.hasOwnProperty.call(response, "result") ?
      response.result :
      response;
      const name = part.functionResponse.name || "";
      let toolCallId = part.functionResponse.id;
      if (!toolCallId) {
        let queue = queueByName.get(name);
        if (!queue) {
          queue = [];
          queueByName.set(name, queue);
        }
        toolCallId = queue.shift();
      }
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

  const text = remainingParts.
  filter((part) => isString(part.text)).
  map((part) => part.text).
  join("\n");
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
    const queue = queueByName.get(name) || [];
    queue.push(id);
    queueByName.set(name, queue);
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
    messages.push(assistantMessage);
  } else if (text) {
    messages.push({ role: content.role === "model" ? "assistant" : "user", content: text });
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
    geminiChunk.usageMetadata = {
      promptTokenCount: parsed.usage.prompt_tokens || 0,
      candidatesTokenCount: parsed.usage.completion_tokens || 0,
      totalTokenCount: parsed.usage.total_tokens || 0
    };
    const reasoningTokens = parsed.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) {
      geminiChunk.usageMetadata.thoughtsTokenCount = reasoningTokens;
    }
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

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const geminiChunk = openAIChunkToGeminiChunk(parsed, model, toolCallState);
        if (!geminiChunk) continue;

        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n")
        );
      }
    },
    flush(controller) {
      const remaining = buffer.trim();
      if (!remaining.startsWith("data:")) return;
      const data = remaining.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
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
    geminiResponse.usageMetadata = {
      promptTokenCount: body.usage.prompt_tokens || 0,
      candidatesTokenCount: body.usage.completion_tokens || 0,
      totalTokenCount: body.usage.total_tokens || 0
    };
    const reasoningTokens = body.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) {
      geminiResponse.usageMetadata.thoughtsTokenCount = reasoningTokens;
    }
  }

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}