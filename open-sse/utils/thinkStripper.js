/**
 * Pure text helpers for providers that explicitly declare the MiniMax M3
 * OpenAI-transport compatibility quirk. The handler owns provider/model
 * gating and invokes `extractThinkTags()` before any client-format conversion.
 *
 * `extractThinkTags()` validates the complete response before changing it:
 * complete segments are extracted in order while visible text is preserved
 * byte-for-byte, and any stray, nested, or unclosed tag fails open.
 *
 * The streaming counterpart validates each pending tag transaction before it
 * emits normalized bytes, then commits balanced segments promptly to preserve
 * live output. Malformed bytes received after a committed segment remain
 * visible and disable later extraction, but cannot retract reasoning that the
 * client has already consumed.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

function unchanged(content, malformed = false) {
  return { content, reasoning: null, matched: false, malformed };
}

// Non-streaming: validate the whole tag sequence before returning a transform.
export function extractThinkTags(content) {
  if (!isString(content)) return unchanged(content);
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
    if (closeIndex === -1 || nestedOpenIndex !== -1 && nestedOpenIndex < closeIndex) {
      return unchanged(content, true);
    }

    visible.push(content.slice(cursor, openIndex));
    reasoningSegments.push(content.slice(reasoningStart, closeIndex));
    cursor = closeIndex + CLOSE_TAG.length;
  }

  const nonEmptyReasoning = reasoningSegments.filter((segment) => segment.length > 0);
  return {
    content: visible.join(""),
    reasoning: nonEmptyReasoning.length > 0 ? nonEmptyReasoning.join("\n") : null,
    matched: true,
    malformed: false
  };
}

// Non-streaming: simple regex (everything in one JSON blob)
export function stripThinkFromResponse(responseBody) {
  if (!responseBody?.choices) return responseBody;
  for (const choice of responseBody.choices) {
    const msg = choice?.message || choice?.delta;
    if (msg?.content && isString(msg.content)) {
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
    if (delta?.content && isString(delta.content)) {
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
  if (!isString(text)) return text;
  const extracted = extractThinkTags(text);
  return extracted.matched ? extracted.content : text;
}

function longestTagPrefixSuffix(value) {
  const limit = Math.min(value.length, Math.max(OPEN_TAG.length, CLOSE_TAG.length) - 1);
  for (let length = limit; length > 0; length--) {
    const suffix = value.slice(-length);
    if (OPEN_TAG.startsWith(suffix) || CLOSE_TAG.startsWith(suffix)) return length;
  }
  return 0;
}

/**
 * Stateful counterpart for passthrough SSE. It keeps partial tokens and one
 * pending tag transaction scoped to a response choice. A transaction commits
 * once its current input batch is balanced with no partial tag token. Until
 * then malformed input can restore the original bytes across chunk boundaries.
 * `failOpen()` permanently disables extraction for the choice.
 */
export function createThinkTagStreamExtractor() {
  let pending = "";
  let inside = false;
  let disabled = false;
  let transactionRaw = null;
  let transactionVisible = "";
  let reasoningSegments = [];

  const clearTransaction = () => {
    pending = "";
    inside = false;
    transactionRaw = null;
    transactionVisible = "";
    reasoningSegments = [];
  };

  const rollback = (prefix = "") => {
    const content = `${prefix}${transactionRaw || ""}${pending}`;
    clearTransaction();
    disabled = true;
    return { content, reasoning: null, changed: true };
  };

  return {
    process(text) {
      if (!isString(text)) {
        return { content: text, reasoning: null, changed: false };
      }
      if (disabled) return { content: text, reasoning: null, changed: false };

      pending += text;
      let content = "";
      let changed = false;

      while (pending.length > 0) {
        if (transactionRaw === null) {
          const openIndex = pending.indexOf(OPEN_TAG);
          const strayCloseIndex = pending.indexOf(CLOSE_TAG);

          if (strayCloseIndex !== -1 && (openIndex === -1 || strayCloseIndex < openIndex)) {
            return rollback(content);
          }

          if (openIndex !== -1) {
            content += pending.slice(0, openIndex);
            pending = pending.slice(openIndex + OPEN_TAG.length);
            transactionRaw = OPEN_TAG;
            inside = true;
            changed = true;
            continue;
          }

          const retainedLength = longestTagPrefixSuffix(pending);
          const emitLength = pending.length - retainedLength;
          content += pending.slice(0, emitLength);
          pending = pending.slice(emitLength);
          if (retainedLength > 0) changed = true;
          break;
        }

        if (inside) {
          const closeIndex = pending.indexOf(CLOSE_TAG);
          const nestedOpenIndex = pending.indexOf(OPEN_TAG);
          if (nestedOpenIndex !== -1 && (closeIndex === -1 || nestedOpenIndex < closeIndex)) {
            return rollback(content);
          }
          if (closeIndex === -1) {
            changed = true;
            break;
          }
          const segment = pending.slice(0, closeIndex);
          if (segment.length > 0) reasoningSegments.push(segment);
          transactionRaw += `${segment}${CLOSE_TAG}`;
          pending = pending.slice(closeIndex + CLOSE_TAG.length);
          inside = false;
          changed = true;
          continue;
        }

        const openIndex = pending.indexOf(OPEN_TAG);
        const strayCloseIndex = pending.indexOf(CLOSE_TAG);
        if (strayCloseIndex !== -1 && (openIndex === -1 || strayCloseIndex < openIndex)) {
          return rollback(content);
        }

        if (openIndex !== -1) {
          const visible = pending.slice(0, openIndex);
          transactionVisible += visible;
          transactionRaw += `${visible}${OPEN_TAG}`;
          pending = pending.slice(openIndex + OPEN_TAG.length);
          inside = true;
          changed = true;
          continue;
        }

        const retainedLength = longestTagPrefixSuffix(pending);
        const emitLength = pending.length - retainedLength;
        const visible = pending.slice(0, emitLength);
        transactionVisible += visible;
        transactionRaw += visible;
        pending = pending.slice(emitLength);
        if (retainedLength > 0) changed = true;
        break;
      }

      if (transactionRaw !== null && !inside && pending.length === 0) {
        content += transactionVisible;
        const reasoning = reasoningSegments.length > 0 ? reasoningSegments.join("\n") : null;
        clearTransaction();
        return { content, reasoning, changed: true };
      }

      return {
        content,
        reasoning: null,
        changed: changed || transactionRaw !== null
      };
    },

    flush() {
      if (disabled) {
        const content = pending;
        clearTransaction();
        return { content, reasoning: null, changed: content.length > 0 };
      }

      if (transactionRaw !== null) {
        if (inside) return rollback();

        const content = `${transactionVisible}${pending}`;
        const reasoning = reasoningSegments.length > 0 ? reasoningSegments.join("\n") : null;
        clearTransaction();
        return { content, reasoning, changed: true };
      }

      const content = pending;
      clearTransaction();
      return { content, reasoning: null, changed: content.length > 0 };
    },

    failOpen() {
      if (disabled) return { content: "", reasoning: null, changed: false };
      if (transactionRaw !== null || pending.length > 0) return rollback();
      disabled = true;
      return { content: "", reasoning: null, changed: false };
    }
  };
}

// Stream-safe version: strips <think> tags across chunks using a state object.
// Returns the stripped content string. Mutates state.
export function stripThinkFromDelta(deltaContent, state) {
  if (!isString(deltaContent) || !deltaContent) return deltaContent;

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