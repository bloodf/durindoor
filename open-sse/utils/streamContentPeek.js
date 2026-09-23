/**
 * Bounded SSE prefix peek shared by the combo loop and the single-model
 * early-EOF sibling failover (src/sse/handlers/chat.js).
 *
 * The peek reads the client-facing stream until the first frame that carries
 * output. Every consumed byte is kept so the caller can replay it unchanged
 * ahead of the unread live body. Nothing reaches the client during the peek,
 * which is what makes a retry on another connection safe: a stream that ends
 * or errors before any content has sent the client nothing.
 */
import { STREAM_FIRST_CHUNK_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { isString } from "../../src/shared/utils/typeChecks.js";
import { extractStreamErrorPayload } from "./streamLifecycle.js";

const SSE_CONTENT_TYPE = "text/event-stream";
export const STREAM_PEEK_MAX_BYTES = 256 * 1024;

function nonEmptyString(value) {
  return isString(value) && value.length > 0;
}

export function frameCarriesContent(line) {
  if (!line.startsWith("data:")) return false;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return false;

  let parsed;
  try {parsed = JSON.parse(payload);} catch {return false;}


  const delta = parsed.choices?.[0]?.delta;
  if (
  nonEmptyString(delta?.content) ||
  nonEmptyString(delta?.reasoning_content) ||
  nonEmptyString(delta?.reasoning) ||
  delta?.tool_calls?.length > 0 ||
  delta?.function_call)
  return true;

  if (parsed.type === "content_block_delta") {
    const content = parsed.delta;
    if (
    nonEmptyString(content?.text) ||
    nonEmptyString(content?.partial_json) ||
    nonEmptyString(content?.thinking))
    return true;
  }
  if (parsed.type === "content_block_start" && parsed.content_block?.type === "tool_use") return true;

  if (isString(parsed.type) && parsed.type.endsWith(".delta") && nonEmptyString(parsed.delta)) return true;

  /** Antigravity wraps native Gemini stream members in a response envelope. */
  const geminiResponse = parsed.response || parsed;
  const parts = geminiResponse.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.some((part) =>
  nonEmptyString(part?.text) || part?.functionCall || part?.inlineData))
  return true;

  return nonEmptyString(parsed.message?.content) ||
  nonEmptyString(parsed.response) ||
  parsed.message?.tool_calls?.length > 0;
}

function parseDataLine(line) {
  if (!line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {return JSON.parse(payload);} catch {return null;}
}

/**
 * Replay buffered chunks, then either finish (upstream done), re-raise the
 * upstream error, or keep reading the live reader.
 */
function replayStream(reader, chunks, { done = false, error = null, pendingRead = null } = {}) {
  let index = 0;
  // A read left in flight by a peek timeout must be consumed first, or its
  // chunk would be lost behind the next read.
  pendingRead?.catch(() => {});
  let finished = false;
  const release = () => {try {reader.releaseLock();} catch {}};

  return new ReadableStream({
    async pull(controller) {
      if (finished) return;
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
        return;
      }
      if (error) {
        finished = true;
        release();
        controller.error(error);
        return;
      }
      if (done) {
        finished = true;
        release();
        controller.close();
        return;
      }
      try {
        const next = await (pendingRead || reader.read());
        pendingRead = null;
        if (next.done) {
          finished = true;
          release();
          controller.close();
        } else controller.enqueue(next.value);
      } catch (readError) {
        finished = true;
        release();
        controller.error(readError);
      }
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      try {await reader.cancel(reason);} catch {} finally {release();}
    }
  });
}

/**
 * Inspect a bounded SSE prefix for output. Non-SSE bodies are never locked or
 * read. The body returned always replays what was consumed; a caller that
 * drops the attempt must cancel it.
 *
 * outcome:
 * - "content": a frame carried text, reasoning, or a tool call
 * - "limit": the peek budget filled up without a verdict (treated as content)
 * - "empty": the stream closed before any content
 * - "error": the stream errored before any content
 * - "timeout": nothing yet within timeoutMs; body continues the live stream
 *
 * streamError is the first in-stream error envelope seen before content.
 *
 * @param {Response} response
 * @param {number} [timeoutMs]
 * @returns {Promise<{hasContent:boolean, outcome:string, body:ReadableStream|null,
 *   streamError: {type?: string, code?: string, message?: string}|null}>}
 */
export async function peekStreamForContent(response, timeoutMs = STREAM_FIRST_CHUNK_TIMEOUT_MS) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes(SSE_CONTENT_TYPE) || !response.body) {
    return { hasContent: true, outcome: "content", body: null, streamError: null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  let pending = "";
  let streamError = null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const result = (outcome, replay = {}) => ({
    hasContent: outcome === "content" || outcome === "limit",
    outcome,
    body: replayStream(reader, chunks, replay),
    streamError
  });
  // True when the line carries output; records the first error envelope.
  const inspect = (line) => {
    if (frameCarriesContent(line)) return true;
    if (!streamError) streamError = extractStreamErrorPayload(parseDataLine(line));
    return false;
  };

  try {
    while (bytes < STREAM_PEEK_MAX_BYTES) {
      const read = reader.read();
      const next = await Promise.race([read, timeout]);
      if (next?.timedOut) return result("timeout", { pendingRead: read });
      if (next.done) {
        pending += decoder.decode();
        const tail = pending.trim();
        if (tail && inspect(tail)) return result("content", { done: true });
        return result("empty", { done: true });
      }

      chunks.push(next.value);
      bytes += next.value.byteLength;
      pending += decoder.decode(next.value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (inspect(line)) return result("content");
      }
    }
    return result("limit");
  } catch (error) {
    return result("error", { error });
  } finally {
    clearTimeout(timer);
  }
}
