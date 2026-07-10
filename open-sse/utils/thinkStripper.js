/**
 * Pure text helpers for providers that explicitly declare the MiniMax M3
 * OpenAI-transport compatibility quirk. The handler owns provider/model
 * gating and invokes `extractThinkTags()` before any client-format conversion.
 *
 * Complete segments are extracted in order while visible text is preserved
 * byte-for-byte. Any stray, nested, or unclosed tag fails open: the original
 * content remains visible and no partial reasoning is returned.
 */

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

function unchanged(content, malformed = false) {
  return { content, reasoning: null, matched: false, malformed };
}

// Non-streaming: validate the whole tag sequence before returning a transform.
export function extractThinkTags(content) {
  if (typeof content !== "string") return unchanged(content);
  if (!content.includes(OPEN_TAG) && !content.includes(CLOSE_TAG)) return unchanged(content);

  const visible = [];
  const reasoningSegments = [];
  let cursor = 0;

  while (cursor < content.length) {
    const openIndex = content.indexOf(OPEN_TAG, cursor);
    const strayCloseIndex = content.indexOf(CLOSE_TAG, cursor);
    if (strayCloseIndex !== -1 && (openIndex === -1 || strayCloseIndex < openIndex)) {
      return unchanged(content, true);
    }
    if (openIndex === -1) {
      visible.push(content.slice(cursor));
      break;
    }

    const reasoningStart = openIndex + OPEN_TAG.length;
    const closeIndex = content.indexOf(CLOSE_TAG, reasoningStart);
    const nestedOpenIndex = content.indexOf(OPEN_TAG, reasoningStart);
    if (closeIndex === -1 || (nestedOpenIndex !== -1 && nestedOpenIndex < closeIndex)) {
      return unchanged(content, true);
    }

    visible.push(content.slice(cursor, openIndex));
    reasoningSegments.push(content.slice(reasoningStart, closeIndex));
    cursor = closeIndex + CLOSE_TAG.length;
  }

  const nonEmptyReasoning = reasoningSegments.filter(segment => segment.length > 0);
  return {
    content: visible.join(""),
    reasoning: nonEmptyReasoning.length > 0 ? nonEmptyReasoning.join("\n") : null,
    matched: true,
    malformed: false,
  };
}

// Non-streaming: simple regex (everything in one JSON blob)
export function stripThinkFromResponse(responseBody) {
  if (!responseBody?.choices) return responseBody;
  for (const choice of responseBody.choices) {
    const msg = choice?.message || choice?.delta;
    if (msg?.content && typeof msg.content === "string") {
      msg.content = stripThinkTags(msg.content);
    }
  }
  return responseBody;
}

// Apply to a raw SSE data string (used in passthrough streaming)
export function stripThinkFromSSEChunk(dataStr) {
  try {
    const parsed = JSON.parse(dataStr);
    const delta = parsed?.choices?.[0]?.delta;
    if (delta?.content && typeof delta.content === "string") {
      delta.content = stripThinkTags(delta.content);
    }
    return JSON.stringify(parsed);
  } catch {
    return dataStr;
  }
}

// Core: strip <think>...</think> (with optional newlines) from text.
// Handles multi-line thinking blocks via the `s` flag (dot matches newlines).
// Also strips leading whitespace that follows a </think> tag.
export function stripThinkTags(text) {
  if (typeof text !== "string") return text;
  const extracted = extractThinkTags(text);
  return extracted.matched ? extracted.content : text;
}

function longestOpeningPrefixSuffix(value) {
  const limit = Math.min(value.length, OPEN_TAG.length - 1);
  for (let length = limit; length > 0; length--) {
    if (OPEN_TAG.startsWith(value.slice(-length))) return length;
  }
  return 0;
}

/**
 * Stateful counterpart for passthrough SSE. It keeps partial opening/closing
 * tokens and reasoning scoped to one response choice. `flush()` restores an
 * unclosed opening tag as visible text so the stream fails open at terminal.
 */
export function createThinkTagStreamExtractor() {
  let buffer = "";
  let inside = false;
  let disabled = false;

  return {
    process(text) {
      if (typeof text !== "string") {
        return { content: text, reasoning: null, changed: false };
      }
      if (disabled) return { content: text, reasoning: null, changed: false };

      buffer += text;
      let content = "";
      const reasoningSegments = [];
      let changed = false;

      while (buffer.length > 0) {
        if (inside) {
          const closeIndex = buffer.indexOf(CLOSE_TAG);
          const nestedOpenIndex = buffer.indexOf(OPEN_TAG);
          if (nestedOpenIndex !== -1 && (closeIndex === -1 || nestedOpenIndex < closeIndex)) {
            content += `${OPEN_TAG}${buffer}`;
            buffer = "";
            inside = false;
            disabled = true;
            changed = true;
            break;
          }
          if (closeIndex === -1) {
            changed = true;
            break;
          }
          const segment = buffer.slice(0, closeIndex);
          if (segment.length > 0) reasoningSegments.push(segment);
          buffer = buffer.slice(closeIndex + CLOSE_TAG.length);
          inside = false;
          changed = true;
          continue;
        }

        const openIndex = buffer.indexOf(OPEN_TAG);
        if (openIndex !== -1) {
          content += buffer.slice(0, openIndex);
          buffer = buffer.slice(openIndex + OPEN_TAG.length);
          inside = true;
          changed = true;
          continue;
        }

        const retainedLength = longestOpeningPrefixSuffix(buffer);
        const emitLength = buffer.length - retainedLength;
        content += buffer.slice(0, emitLength);
        buffer = buffer.slice(emitLength);
        if (retainedLength > 0) changed = true;
        break;
      }

      return {
        content,
        reasoning: reasoningSegments.length > 0 ? reasoningSegments.join("\n") : null,
        changed,
      };
    },

    flush() {
      const content = inside ? `${OPEN_TAG}${buffer}` : buffer;
      const changed = content.length > 0;
      buffer = "";
      inside = false;
      return { content, reasoning: null, changed };
    },
  };
}

// Stream-safe version: strips <think> tags across chunks using a state object.
// Returns the stripped content string. Mutates state.
export function stripThinkFromDelta(deltaContent, state) {
  if (typeof deltaContent !== "string" || !deltaContent) return deltaContent;

  let s = deltaContent;
  if (state.inside) {
    const ei = s.indexOf("</think>");
    if (ei >= 0) {
      state.inside = false;
      s = s.slice(ei + 8).trimStart();
    } else {
      return "";
    }
  }
  if (!state.inside) {
    const si = s.indexOf("<think>");
    if (si >= 0) {
      const after = s.slice(si + 7);
      const ei = after.indexOf("</think>");
      if (ei >= 0) {
        s = s.slice(0, si) + after.slice(ei + 8).trimStart();
      } else {
        state.inside = true;
        s = s.slice(0, si);
      }
    }
  }
  return s || "";
}
