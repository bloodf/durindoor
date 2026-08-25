import { isString } from "../../../src/shared/utils/typeChecks.js";

/**
 * Incremental client-frame framer.
 *
 * Splits arbitrary byte/string chunks into complete client-format frames
 * without assuming one push() call carries exactly one frame.
 *
 * - sse-lines: keeps an optional pending `event:` line and finalizes a
 *   frame when the next complete `data:` line arrives (matches the repo's
 *   SSE passthrough, which emits `data: ...\n` without a blank delimiter).
 *   A blank line also finalizes early if present.
 * - sse: canonical SSE framing. Accumulates lines and finalizes only on a
 *   blank line, so a multi-line `data:` record stays one frame.
 * - ndjson: finalizes a frame on each newline.
 */
export function createClientFrameFramer({ format, onFrame }) {
  if (format !== "sse" && format !== "sse-lines" && format !== "ndjson") {
    throw new Error(`Unsupported client frame format: ${format}`);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingLines = [];

  function decodeChunk(chunk, final) {
    if (isString(chunk)) return chunk;
    return decoder.decode(chunk, { stream: !final });
  }

  function emitPending() {
    if (pendingLines.length) {
      onFrame(pendingLines.join("\n"));
      pendingLines = [];
    }
  }

  function handleSseLinesLine(line) {
    if (line === "") {
      emitPending();
      return;
    }
    pendingLines.push(line);
    if (line.startsWith("data:")) emitPending();
  }

  function handleSseLine(line) {
    if (line === "") {
      emitPending();
      return;
    }
    pendingLines.push(line);
  }

  function handleNdjsonLine(line) {
    if (line !== "") onFrame(line);
  }

  function lineHandlerFor(fmt) {
    if (fmt === "ndjson") return handleNdjsonLine;
    if (fmt === "sse-lines") return handleSseLinesLine;
    return handleSseLine;
  }

  function consumeLines(final) {
    const handleLine = lineHandlerFor(format);
    const parts = buffer.split("\n");
    buffer = parts.pop();
    for (const part of parts) {
      handleLine(part.endsWith("\r") ? part.slice(0, -1) : part);
    }
    if (final && buffer !== "") {
      handleLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      buffer = "";
    }
  }

  function push(chunk) {
    buffer += decodeChunk(chunk, false);
    consumeLines(false);
  }

  function flush() {
    buffer += decodeChunk(new Uint8Array(0), true);
    consumeLines(true);
    emitPending();
  }

  return { push, flush };
}
