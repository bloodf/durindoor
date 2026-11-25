import { FORMATS } from "../translator/formats.js";
import { buildErrorBody } from "./error.js";
import { formatClaudeSseError } from "./sseFrames.js";
export { extractCompleteSseFrames } from "./sseFrames.js";
import { SSE_DONE } from "./sseConstants.js";

const sharedEncoder = new TextEncoder();

// ANSI / VT100 escape sequence pattern.
// Matches: CSI sequences (\x1b[ ... final-byte), OSC sequences (\x1b] ... ST/BEL),
// single-char escapes (\x1b[A-Z\[\]\\^_`]), and raw C0 controls except \t, \n, \r.
// gc/ (Gemini Cloud Code Assist) occasionally prepends terminal control chars
// (cursor-up, clear-line, carriage-return) to SSE frames before the "data:" prefix,
// which masks the prefix and causes strict client SSE parsers to crash or hang.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
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
  const clean = line.charCodeAt(0) === 0x1b || line.charCodeAt(0) < 0x20 && line.charCodeAt(0) !== 0x09 ?
  stripAnsiCodes(line) :
  line;

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
      isString(delta.reasoning) && delta.reasoning.trim() !== "" ||
      // Structured reasoning can be the only payload, including opaque encrypted
      // entries that the client has to replay (9router #4457).
      Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0 ||
      delta.tool_calls && delta.tool_calls.length > 0 ||
      /** Generated images arrive as standalone OpenAI deltas and must survive the stream gate. */
      delta.images && delta.images.length > 0 ||
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

/**
 * Mint an id for a streamed OpenAI tool-call fragment that opens a new
 * (choice, tool-call index) without one. Strict OpenAI-compatible clients
 * (@ai-sdk/openai-compatible) abort the turn on "Expected 'id' to be a string"
 * (upstream 9router 95c9d03e, #4992). Continuation fragments of an index
 * already seen are left as-is, per the OpenAI streaming contract. Known empty
 * function placeholders are removed first so they cannot create phantom ids.
 * @param {object} chunk - parsed chat.completion.chunk, mutated in place
 * @param {Set<string>} seen - per-stream keys of indices already opened
 * @returns {boolean} true when an id was added
 */
export function ensureStreamToolCallIds(chunk, seen) {
  if (!Array.isArray(chunk?.choices)) return false;
  let changed = false;
  for (const [choicePosition, choice] of chunk.choices.entries()) {
    let calls = choice?.delta?.tool_calls;
    if (!Array.isArray(calls)) continue;
    const nonEmpty = calls.filter(call => {
      if (!isObject(call) || call === null) return true;
      if (call.type && call.type !== "function") return true;
      if (Object.keys(call).some(key => !["index", "id", "type", "function"].includes(key))
        || Object.keys(call.function || {}).some(key => !["name", "arguments"].includes(key))) return true;
      return [call.id, call.function?.name, call.function?.arguments].some(value => value != null && value !== "");
    });
    if (nonEmpty.length !== calls.length) {
      changed = true;
      if (nonEmpty.length === 0) { delete choice.delta.tool_calls; continue; }
      choice.delta.tool_calls = calls = nonEmpty;
    }
    for (const [position, call] of calls.entries()) {
      if (!isObject(call) || call === null) continue;
      const choiceIndex = choice.index ?? choicePosition;
      const key = `${choiceIndex}:${call.index ?? position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isString(call.id) && call.id) continue;
      // Choice index too: n>1 choices opening the same index in one millisecond must not collide.
      call.id = `call_${choiceIndex}_${call.index ?? position}_${Date.now()}`;
      changed = true;
    }
  }
  return changed;
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
  if (!payload || !isObject(payload) || Array.isArray(payload)) {
    return payload;
  }

  let cleaned = payload;

  if ("usage" in cleaned) {
    if (cleaned.usage === null) {
      const { usage, ...payloadWithoutUsage } = cleaned;
      cleaned = payloadWithoutUsage;
    } else if (isObject(cleaned.usage) && cleaned.usage.perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = cleaned.usage;
      cleaned = { ...cleaned, usage: usageWithoutPerf };
    }
  }

  if (cleaned.response && isObject(cleaned.response) && !Array.isArray(cleaned.response)) {
    const cleanedResponse = cleanUsagePayload(cleaned.response);
    if (cleanedResponse !== cleaned.response) {
      cleaned = { ...cleaned, response: cleanedResponse };
    }
  }

  return cleaned;
}

// Format output as SSE; absent events produce no frame.
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

// Terminal frame for a stream that aborted (watchdog stall/ttft timeout, lost
// upstream connection) after HTTP 200 was already sent, for client formats
// createTerminalTracker does not cover (Gemini-family, Ollama, Kiro,
// Commandcode, Cursor) — those still closed silently otherwise. OpenAI-shaped
// clients get `data: {"error":...}` then `[DONE]` (openai-python raises
// APIError on any `data:` payload carrying an `error` key, checked before
// [DONE]); Claude clients get `event: error`. Never fabricate a successful
// finish_reason instead.
export function buildStreamErrorBytes(statusCode, message, clientFormat) {
  const { error } = buildErrorBody(statusCode, message);

  // Claude clients retry transient in-band failures when marked overloaded.
  const sse = clientFormat === FORMATS.CLAUDE
    ? formatClaudeSseError({ ...error, type: "overloaded_error" })
    : formatSSE({ error }, clientFormat) + SSE_DONE;

  return sharedEncoder.encode(sse);
}
