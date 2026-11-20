import { isString } from "../../../src/shared/utils/typeChecks.js";
// OmniRoute's pinned JSONL translator limits the entire response, not just a line.
export const HUGGINGCHAT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_BODY_EXCEEDED_MESSAGE = "HuggingChat response exceeded the maximum supported size before completing";

export class HuggingChatStreamError extends Error {
  constructor(message) {
    super(message);
    this.name = "HuggingChatStreamError";
  }
}

function cancelReader(reader) {
  try { Promise.resolve(reader.cancel?.()).catch(() => {}); } catch { /* best effort */ }
}

function bindAbort(reader, signal) {
  if (!signal) return () => {};
  const cancel = () => cancelReader(reader);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return () => signal.removeEventListener("abort", cancel);
}
export function sseChunk(data) {
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
      if (event.status === "error") return { error: isString(event.message) && event.message ? event.message : "HuggingChat generation error" };
      if (event.status === "finished") return { done: true };
    }
  } catch {

    // Ignore keepalive and malformed lines from the JSONL stream.
  }
  return {};
}

export async function* streamJsonlToOpenAi(body, model, id, created, signal, cancellationSignal, maxBytes = HUGGINGCHAT_MAX_BODY_BYTES) {
  const reader = body.getReader();
  const unbind = [bindAbort(reader, signal), bindAbort(reader, cancellationSignal)];
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedRole = false;
  let fullText = "";
  let totalBytes = 0;

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
    if (parsed.error) { cancelReader(reader); throw new HuggingChatStreamError(parsed.error); }
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
      if (signal?.aborted || cancellationSignal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) {
        reachedEof = true;
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader);
        yield sseChunk({ id, object: "chat.completion.chunk", created, model, error: { message: MAX_BODY_EXCEEDED_MESSAGE, type: "upstream_error", code: "huggingchat_payload_too_large" } });
        yield "data: [DONE]\n\n";
        return;
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
    if (reachedEof && !signal?.aborted && !cancellationSignal?.aborted) buffer += decoder.decode();
    if (reachedEof && buffer.trim() && !signal?.aborted && !cancellationSignal?.aborted) {
      yield* handle(parseJsonlLine(buffer.trim()));
    }
  } finally {
    unbind.forEach((fn) => fn());
    reader.releaseLock();
  }

  if (!signal?.aborted && !cancellationSignal?.aborted) {
    yield emitDelta({}, "stop");
    yield "data: [DONE]\n\n";
  }
}

export async function readJsonlResponse(body, signal, maxBytes = HUGGINGCHAT_MAX_BODY_BYTES) {
  const reader = body.getReader();
  const unbind = bindAbort(reader, signal);
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let reasoning = "";
  let totalBytes = 0;
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader);
        throw new HuggingChatStreamError(MAX_BODY_EXCEEDED_MESSAGE);
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const parsed = parseJsonlLine(line.trim());
        if (parsed.error) { cancelReader(reader); throw new HuggingChatStreamError(parsed.error); }
        if (parsed.reasoning) reasoning += parsed.reasoning;
        if (parsed.token) fullText += parsed.token;
        if (parsed.text) return { text: parsed.text, reasoning };
      }
    }
    if (!signal?.aborted) buffer += decoder.decode();
    if (!signal?.aborted && buffer.trim()) {
      const parsed = parseJsonlLine(buffer.trim());
      if (parsed.error) throw new HuggingChatStreamError(parsed.error);
      if (parsed.reasoning) reasoning += parsed.reasoning;
      if (parsed.token) fullText += parsed.token;
      if (parsed.text) fullText = parsed.text;
    }
  } finally {
    unbind();
    reader.releaseLock();
  }
  return { text: fullText, reasoning };
}
