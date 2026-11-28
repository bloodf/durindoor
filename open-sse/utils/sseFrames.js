import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
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
  // CLIProxyAPI 47f18e4d82bd TestAntigravityStreamSurfacesTrailingBackendError:
  // a backend may append plain JSON after SSE output. Only complete error
  // records qualify; arbitrary JSON, malformed noise and SSE metadata do not.
  // The incremental reader applies its byte cap before this parse.
  if (!dataLines.length && frame.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(frame);
      if (isRecord(parsed) && isRecord(parsed.error)) {
        dataLines.push(JSON.stringify({ error: parsed.error }));
      }
    } catch { /* non-SSE noise is not an error envelope */ }
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
export function createSseFrameReader({ maxBytes = MAX_PENDING_SSE_LINE_BYTES, preserveWire = false } = {}) {
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
        Object.defineProperty(frame, "wire", { value: preserveWire || !/^\s*\{/.test(raw) || !frame.hasData ? buffer.slice(offset, end) : `data: ${frame.data}\n\n` });
        offset = end;
        return frame;
      });
    },
    flush() {
      if (pendingChunks.length === 0) return [];
      const frames = this.push("", true);
      const tail = pendingChunks.join("");
      reset();
      if (!tail) return frames;
      const frame = parseSseFrame(tail);
      if (!preserveWire && frame.hasData && tail.trimStart().startsWith("{")) {
        Object.defineProperty(frame, "wire", { value: `data: ${frame.data}\n\n` });
      }
      return [...frames, frame];
    },
  };
}

/** Format an Anthropic error event with the standard SSE wire spelling. */
export function formatClaudeSseError(error) {
  return `event: error\ndata: ${JSON.stringify({ type: "error", error })}\n\n`;
}

// Guard output consists of complete frames. Retain their observations without
// putting metadata on client bytes or retaining completed streams globally.
const observedChunks = new WeakMap();

export function encodeObservedSseFrames(text, frames) {
  const bytes = sharedEncoder.encode(text);
  observedChunks.set(bytes, { text, frames });
  return bytes;
}

/**
 * Decode each byte chunk once and fan parsed frames out to synchronous observers.
 * A batch returned by push/flush also supplies decoded text to legacy line taps.
 * Complete frames forwarded by the empty-terminal guard reuse its observations.
 */
export function createSseFrameDispatcher(observers = [], { decoder = new TextDecoder() } = {}) {
  const reader = createSseFrameReader({ preserveWire: true });
  let decodedBytes = false;
  const observe = (frames) => {
    for (const frame of frames) {
      for (const callback of observers) callback(frame);
    }
    return frames;
  };
  const parse = (frames) => frames.map((frame) => {
    let payload;
    let linePayloads;
    if (frame.hasData && frame.data.trim() !== "[DONE]") {
      try { payload = JSON.parse(frame.data); } catch {
        // Legacy passthrough can emit independent data lines without blank
        // delimiters. Parse those once too, after trying valid multiline JSON.
        if (frame.dataLines.length > 1) {
          linePayloads = frame.dataLines.map((line) => {
            if (line.trim() === "[DONE]") return undefined;
            try { return JSON.parse(line); } catch { return undefined; }
          });
          payload = linePayloads[0];
        }
      }
    }
    return { ...frame, wire: frame.wire ?? frame.raw, payload, linePayloads };
  });
  return {
    push(bytes) {
      const cached = observedChunks.get(bytes);
      if (cached) {
        observe(cached.frames);
        return cached;
      }
      decodedBytes = true;
      const text = decoder.decode(bytes, { stream: true });
      return { text, frames: observe(parse(reader.push(text))) };
    },
    flush() {
      const text = decodedBytes ? decoder.decode() : "";
      decodedBytes = false;
      return { text, frames: observe(parse([...reader.push(text), ...reader.flush()])) };
    },
  };
}

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
  let decoder;
  let buffer = "";
  let pendingLines = [];

  function decodeChunk(chunk, final) {
    if (isString(chunk)) return chunk;
    decoder ??= new TextDecoder();
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
    if (decoder) buffer += decoder.decode();
    consumeLines(true);
    emitPending();
  }

  return { push, flush };
}
