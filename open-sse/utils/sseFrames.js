import { MAX_PENDING_SSE_LINE_BYTES } from "./pendingSseLine.js";

const sharedEncoder = new TextEncoder();

/** Split complete SSE frames from an unterminated tail. */
export function extractCompleteSseFrames(buffer) {
  const frames = [];
  const delimiter = /(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/g;
  let cursor = 0;
  let match;
  while ((match = delimiter.exec(buffer)) !== null) {
    frames.push(buffer.slice(cursor, match.index));
    cursor = delimiter.lastIndex;
  }
  return { frames, remainder: buffer.slice(cursor) };
}

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

/** Replace a frame's data fields while retaining comments and other metadata. */
export function replaceSseFrameData(frame, data) {
  const metadata = frame.raw.split(/\r\n|\r|\n/)
    .filter((line) => line !== "data" && !line.startsWith("data:"));
  return [...metadata, `data: ${data}`, "", ""].join("\n");
}

/** Parse joined JSON first, then use the first data line as legacy Responses parsers did. */
export function parseResponsesSseData({ data, dataLines }) {
  if (data.trim() === "[DONE]") return { rawDone: true };
  try {
    return { parsed: JSON.parse(data) };
  } catch (error) {
    if (dataLines.length < 2) throw error;
    const firstLine = dataLines[0].trim();
    if (firstLine === "[DONE]") return { rawDone: true };
    return { parsed: JSON.parse(firstLine) };
  }
}

/**
 * Incrementally read SSE frames across chunk boundaries, applying the 64 MiB
 * pending-frame cap once in linear time. `flush()` parses any unterminated
 * trailing frame at end-of-stream. Complete frames expose their original
 * wire text as the non-enumerable `wire` string for transparent forwarding.
 * A final CR is held until the next chunk or flush to preserve split CRLF.
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
    push(text, final = false) {
      if (!text && !final) return [];
      const suffix = scanTail + text;
      const searchable = !final && suffix.endsWith("\r") ? suffix.slice(0, -1) : suffix;
      if (!/(?:\r\n|\r(?!\n)|\n)(?:\r\n|\r(?!\n)|\n)/.test(searchable)) {
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
      const searchableBuffer = !final && buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      const { frames, remainder: scannedRemainder } = extractCompleteSseFrames(searchableBuffer);
      const remainder = scannedRemainder + buffer.slice(searchableBuffer.length);
      const remainderBytes = remainder ? sharedEncoder.encode(remainder).byteLength : 0;
      if (remainderBytes > maxBytes || frames.some((frame) => exceedsByteLimit(frame, maxBytes))) {
        reset();
        throw createFrameLimitError();
      }
      pendingChunks = remainder ? [remainder] : [];
      pendingBytes = remainderBytes;
      scanTail = remainder.slice(-3);
      let offset = 0;
      return frames.map((raw) => {
        const frame = parseSseFrame(raw);
        const delimiterStart = offset + raw.length;
        const firstLength = buffer.slice(delimiterStart, delimiterStart + 2) === "\r\n" ? 2 : 1;
        const secondLength = buffer.slice(delimiterStart + firstLength, delimiterStart + firstLength + 2) === "\r\n" ? 2 : 1;
        const end = delimiterStart + firstLength + secondLength;
        Object.defineProperty(frame, "wire", { value: buffer.slice(offset, end) });
        offset = end;
        return frame;
      });
    },
    flush() {
      if (pendingChunks.length === 0) return [];
      const frames = this.push("", true);
      const tail = pendingChunks.join("");
      reset();
      return tail ? [...frames, parseSseFrame(tail)] : frames;
    },
  };
}

/** Format an Anthropic error event with the standard SSE wire spelling. */
export function formatClaudeSseError(error) {
  return `event: error\ndata: ${JSON.stringify({ type: "error", error })}\n\n`;
}
