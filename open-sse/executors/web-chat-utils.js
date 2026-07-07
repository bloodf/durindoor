import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

export function errorJson(status, message, code = undefined) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: code || `HTTP_${status}`,
    },
  }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Web executors currently forward text-only chat content; multimodal parts must
 * fail closed so callers do not silently lose user-provided images/files/audio.
 */
export function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const unsupported = content.find((part) => part?.type !== "text");
    if (unsupported) {
      const type = unsupported?.type ? `type "${unsupported.type}"` : "missing type";
      throw new TypeError(`Unsupported non-text chat message part (${type})`);
    }
    return content
      .map((part) => String(part.text || ""))
      .join("");
  }
  return String(content ?? "");
}

export function normalizeOpenAIMessages(messages) {
  let systemMsg = "";
  const history = [];
  for (const msg of messages || []) {
    let role = String(msg?.role || "user");
    if (role === "developer") role = "system";
    let content = extractText(msg?.content).trim();
    if (!content) continue;
    if (role === "tool") {
      const toolName = msg.name || msg.tool_call_id || "tool";
      role = "tool";
      content = `Tool result (${toolName}):\n${content}`;
    }
    if (role === "system") systemMsg += `${systemMsg ? "\n" : ""}${content}`;
    else if (role === "user" || role === "assistant" || role === "tool") history.push({ role, content });
  }

  let currentMsg = "";
  if (history.length > 0 && history[history.length - 1].role === "user") {
    currentMsg = history.pop().content;
  }
  return { systemMsg, history, currentMsg };
}

export function openAICompletion({ id, created, model, content, prompt = "" }) {
  const promptTokens = Math.ceil(String(prompt).length / 4);
  const completionTokens = Math.ceil(String(content).length / 4);
  return new Response(JSON.stringify({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
      logprobs: null,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export function streamingTextResponse({ source, model, id, created, extractDelta, signal }) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
      })));

      try {
        for await (const event of readEventStream(source, signal)) {
          const delta = extractDelta(event);
          if (delta === "__DONE__") break;
          if (!delta) continue;
          controller.enqueue(encoder.encode(sseChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null, logprobs: null }],
          })));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: { content: `[Stream error: ${err?.message || String(err)}]` },
            finish_reason: null,
            logprobs: null,
          }],
        })));
      }

      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
      })));
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  }), { status: 200, headers: SSE_HEADERS_NO_BUFFER });
}

export async function collectTextFromEvents(source, extractDelta, signal) {
  let text = "";
  for await (const event of readEventStream(source, signal)) {
    const delta = extractDelta(event);
    if (delta === "__DONE__") break;
    if (delta) text += delta;
  }
  return text;
}

export async function* readEventStream(source, signal) {
  if (!source) return;
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];

  const parseStreamPayload = (payload) => {
    try { return JSON.parse(payload); } catch { /* try AI SDK data-stream frames below */ }
    const frame = payload.match(/^([0-9]+):([\s\S]*)$/);
    if (!frame) return null;
    try {
      const value = JSON.parse(frame[2]);
      if (frame[1] === "0" && typeof value === "string") return { text: value };
      return { code: frame[1], value };
    } catch {
      return null;
    }
  };

  const flush = () => {
    if (dataLines.length === 0) return null;
    const payload = dataLines.join("\n").trim();
    dataLines = [];
    if (!payload || payload === "[DONE]") return "__DONE__";
    return parseStreamPayload(payload);
  };

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line === "") {
          const event = flush();
          if (event === "__DONE__") return;
          if (event) yield event;
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        } else if (line.trim() && !line.startsWith("event:")) {
          const event = parseStreamPayload(line.trim());
          if (event) yield event;
        }
      }
    }
    const remaining = buffer.trim();
    if (remaining.startsWith("data:")) {
      dataLines.push(remaining.slice(5).trimStart());
    } else if (remaining && !remaining.startsWith("event:")) {
      const event = parseStreamPayload(remaining);
      if (event) yield event;
    }
    const tail = flush();
    if (tail && tail !== "__DONE__") yield tail;
  } finally {
    reader.releaseLock();
  }
}
