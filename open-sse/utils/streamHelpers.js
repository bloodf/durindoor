import { FORMATS } from "../translator/formats.js";

// ANSI / VT100 escape sequence pattern.
// Matches: CSI sequences (\x1b[ ... final-byte), OSC sequences (\x1b] ... ST/BEL),
// single-char escapes (\x1b[A-Z\[\]\\^_`]), and raw C0 controls except \t, \n, \r.
// gc/ (Gemini Cloud Code Assist) occasionally prepends terminal control chars
// (cursor-up, clear-line, carriage-return) to SSE frames before the "data:" prefix,
// which masks the prefix and causes strict client SSE parsers to crash or hang.
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[A-Z\[\]\\^_`])|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/**
 * Strip ANSI / VT100 terminal control sequences from a string.
 * Safe to call on SSE line text — does not touch printable content or JSON.
 */
export function stripAnsiCodes(str) {
  return str ? str.replace(ANSI_ESCAPE_RE, "") : str;
}

// Parse SSE data line
export function parseSSELine(line, format = null) {
  if (!line) return null;

  // NDJSON format (Ollama and compatible raw provider streams): raw JSON lines
  // without a "data:" prefix.
  const trimmed = line.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (format === FORMATS.OLLAMA) {
    return null;
  }

  // Strip any terminal control sequences that some upstream sources (e.g. gc/ Cloud Code
  // Assist) prepend to SSE lines as progress/loading indicators. Without this, the "data:"
  // prefix check below fails and the entire frame is silently dropped, which can cause the
  // client SSE parser to stall waiting for a frame that never arrives.
  const clean = line.charCodeAt(0) === 0x1b || (line.charCodeAt(0) < 0x20 && line.charCodeAt(0) !== 0x09)
    ? stripAnsiCodes(line)
    : line;

  // Standard SSE format: "data: {...}"
  if (clean.charCodeAt(0) !== 100) return null; // 'd' = 100

  const data = clean.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    return JSON.parse(data);
  } catch (error) {
    if (data.length > 0 && data.length < 1000) {
      console.log(`[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`);
    }
    return null;
  }
}

// Check if chunk has valuable content (not empty)
export function hasValuableContent(chunk, format) {
  // Wrapped Gemini-family Responses passthrough (e.g. Antigravity) - check
  // the response.candidates path even when format is OpenAI, so terminal
  // chunks with finishReason or non-empty content are not filtered.
  if (chunk.response?.candidates?.[0]?.content?.parts) {
    return true;
  }
  if (chunk.response?.candidates?.[0]?.finishReason) {
    return true;
  }
  // OpenAI format
  if (format === FORMATS.OPENAI && Array.isArray(chunk.choices)) {
    return chunk.choices.some((choice) => {
      const delta = choice?.delta;
      if (!delta) return Boolean(choice?.finish_reason);
      return delta.content && delta.content !== "" ||
             delta.reasoning_content && delta.reasoning_content !== "" ||
             delta.tool_calls && delta.tool_calls.length > 0 ||
             choice.finish_reason ||
             delta.role;
    });
  }

  // Claude format
  if (format === FORMATS.CLAUDE) {
    const isContentBlockDelta = chunk.type === "content_block_delta";
    const hasText = chunk.delta?.text && chunk.delta.text !== "";
    const hasThinking = chunk.delta?.thinking && chunk.delta.thinking !== "";
    const hasInputJson = chunk.delta?.partial_json && chunk.delta.partial_json !== "";
    
    if (isContentBlockDelta && !hasText && !hasThinking && !hasInputJson) {
      return false;
    }
    return true;
  }

  return true; // Other formats: keep all chunks
}

// Fix invalid id (generic or too short)
export function fixInvalidId(parsed) {
  if (parsed.id && (parsed.id === "chat" || parsed.id === "completion" || parsed.id.length < 8)) {
    const fallbackId = parsed.extend_fields?.requestId || 
                      parsed.extend_fields?.traceId || 
                      Date.now().toString(36);
    parsed.id = `chatcmpl-${fallbackId}`;
    return true;
  }
  return false;
}

function cleanUsagePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  let cleaned = payload;

  if ("usage" in cleaned) {
    if (cleaned.usage === null) {
      const { usage, ...payloadWithoutUsage } = cleaned;
      cleaned = payloadWithoutUsage;
    } else if (typeof cleaned.usage === "object" && cleaned.usage.perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = cleaned.usage;
      cleaned = { ...cleaned, usage: usageWithoutPerf };
    }
  }

  if (cleaned.response && typeof cleaned.response === "object" && !Array.isArray(cleaned.response)) {
    const cleanedResponse = cleanUsagePayload(cleaned.response);
    if (cleanedResponse !== cleaned.response) {
      cleaned = { ...cleaned, response: cleanedResponse };
    }
  }

  return cleaned;
}

// Format output as SSE
export function formatSSE(data, sourceFormat) {
  if (data === null || data === undefined) return "";
  if (data && data.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format
  if (data && data.event && data.data) {
    const cleanedEventData = cleanUsagePayload(data.data);
    return `event: ${data.event}\ndata: ${JSON.stringify(cleanedEventData)}\n\n`;
  }

  data = cleanUsagePayload(data);

  // Claude format
  if (sourceFormat === FORMATS.CLAUDE && data && data.type) {
    return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Split an accumulated raw SSE text buffer into complete frames plus the
 * unterminated tail. Frames are delimited by a blank line (`\r?\n\r?\n`); text
 * after the last delimiter is returned as `remainder` so the caller can
 * prepend it to the next chunk without inspecting partial data.
 *
 * @param {string} buffer Accumulated raw SSE text that may contain a partial final frame.
 * @returns {{frames: string[], remainder: string}} Complete frames and the unterminated tail.
 */
export function extractCompleteSseFrames(buffer) {
  const frames = [];
  const delimiter = /\r?\n\r?\n/g;
  let cursor = 0;
  let match;
  while ((match = delimiter.exec(buffer)) !== null) {
    frames.push(buffer.slice(cursor, match.index));
    cursor = delimiter.lastIndex;
  }
  return { frames, remainder: buffer.slice(cursor) };
}
