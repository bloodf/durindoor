import { isString } from "../../../src/shared/utils/typeChecks.js";export function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function parseJsonlLine(line) {
  try {
    const event = JSON.parse(line);
    if (event.type === "stream" && isString(event.token)) {
      const token = event.token.replace(/\0/g, "");
      if (token) return { token };
    }
    if (event.type === "reasoning" && event.subtype === "stream" && isString(event.token)) {
      const token = event.token.replace(/\0/g, "");
      if (token) return { reasoning: token };
    }
    if (event.type === "finalAnswer" && isString(event.text)) {
      return { text: event.text, done: true };
    }
    if (event.type === "status") {
      if (event.status === "error") return { error: event.message || "HuggingChat generation error" };
      if (event.status === "finished") return { done: true };
    }
  } catch {

    // Ignore keepalive and malformed lines from the JSONL stream.
  }return {};
}

export async function* streamJsonlToOpenAi(body, model, id, created, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedRole = false;
  let fullText = "";

  const roleChunk = () => sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }]
  });

  const emitDelta = (delta, finish_reason = null) => sseChunk({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason }]
  });

  function* handle(parsed) {
    if (parsed.error) throw new Error(parsed.error);
    if ((parsed.token || parsed.reasoning) && !emittedRole) {
      emittedRole = true;
      yield roleChunk();
    }
    if (parsed.reasoning) yield emitDelta({ reasoning_content: parsed.reasoning });
    if (parsed.token) {
      fullText += parsed.token;
      yield emitDelta({ content: parsed.token });
    }
    if (parsed.text) {
      const remaining = parsed.text.slice(fullText.length);
      if (remaining) {
        if (!emittedRole) {
          emittedRole = true;
          yield roleChunk();
        }
        yield emitDelta({ content: remaining });
      }
      return true;
    }
    if (parsed.done) return true;
    return false;
  }

  try {
    let reachedEof = false;
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) {
        reachedEof = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let lineFinished = false;
      for (const line of lines) {
        lineFinished = yield* handle(parseJsonlLine(line.trim()));
        if (lineFinished) break;
      }
      if (lineFinished) break;
    }
    if (reachedEof && buffer.trim() && !signal?.aborted) {
      yield* handle(parseJsonlLine(buffer.trim()));
    }
  } finally {
    reader.releaseLock();
  }

  if (!signal?.aborted) {
    yield emitDelta({}, "stop");
    yield "data: [DONE]\n\n";
  }
}

export async function readJsonlResponse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let reasoning = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const parsed = parseJsonlLine(line.trim());
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.reasoning) reasoning += parsed.reasoning;
        if (parsed.token) fullText += parsed.token;
        if (parsed.text) return { text: parsed.text, reasoning };
      }
    }
    if (buffer.trim()) {
      const parsed = parseJsonlLine(buffer.trim());
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.reasoning) reasoning += parsed.reasoning;
      if (parsed.token) fullText += parsed.token;
      if (parsed.text) fullText = parsed.text;
    }
  } finally {
    reader.releaseLock();
  }
  return { text: fullText, reasoning };
}