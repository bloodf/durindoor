import { extractCompleteSseFrames } from "./streamHelpers.js";
import { MAX_PENDING_SSE_LINE_BYTES } from "./pendingSseLine.js";

const sharedEncoder = new TextEncoder();

function createFrameLimitError() {
  const error = new Error("SSE frame exceeds size limit");
  error.code = "invalid_sse_payload";
  return error;
}

function exceedsByteLimit(str, maxBytes) {
  if (str.length > maxBytes) return true;
  if (str.length * 3 <= maxBytes) return false;
  return sharedEncoder.encode(str).byteLength > maxBytes;
}

/**
 * Parse a single raw SSE frame per the WHATWG EventStream specification:
 * - Accepts LF, CRLF, and CR line endings
 * - Ignores `:` comment lines and empty lines
 * - Removes at most one optional space (` `) after the `:` separator
 * - Joins multiple `data:` fields with `\n`
 */
export function parseSseFrame(frame) {
  let eventName = null;
  const dataLines = [];
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value || null;
  }
  return {
    eventName,
    data: dataLines.join("\n"),
    dataLines,
    hasData: dataLines.length > 0,
    raw: frame,
  };
}

/**
 * Incrementally read SSE frames across chunk boundaries, applying the 64 MiB
 * pending-frame cap once in linear time. `flush()` parses any unterminated
 * trailing frame at end-of-stream.
 */
export function createSseFrameReader({ maxBytes = MAX_PENDING_SSE_LINE_BYTES } = {}) {
  let pendingChunks = [];
  let pendingBytes = 0;
  let scanTail = "";

  const reset = () => {
    pendingChunks = [];
    pendingBytes = 0;
    scanTail = "";
  };

  return {
    push(text) {
      if (!text) return [];
      const suffix = scanTail + text;
      if (!/\r?\n\r?\n/.test(suffix)) {
        pendingBytes += sharedEncoder.encode(text).byteLength;
        if (pendingBytes > maxBytes) {
          reset();
          throw createFrameLimitError();
        }
        pendingChunks.push(text);
        scanTail = suffix.slice(-3);
        return [];
      }

      pendingChunks.push(text);
      const buffer = pendingChunks.join("");
      const { frames, remainder } = extractCompleteSseFrames(buffer);
      const remainderBytes = remainder ? sharedEncoder.encode(remainder).byteLength : 0;
      if (remainderBytes > maxBytes || frames.some((frame) => exceedsByteLimit(frame, maxBytes))) {
        reset();
        throw createFrameLimitError();
      }
      pendingChunks = remainder ? [remainder] : [];
      pendingBytes = remainderBytes;
      scanTail = remainder.slice(-3);
      return frames.map(parseSseFrame);
    },
    flush() {
      if (pendingChunks.length === 0) return [];
      const tail = pendingChunks.join("");
      reset();
      return tail ? [parseSseFrame(tail)] : [];
    },
  };
}
