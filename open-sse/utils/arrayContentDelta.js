/**
 * Some OpenAI-compatible upstreams stream `choices[].delta.content` as an
 * array of typed chunks instead of a string. Mistral reasoning models (e.g.
 * `labs-leanstral-1-5`) send their thinking this way:
 *
 *   {"delta": {"content": [{"type": "thinking", "thinking": [{"type": "text", "text": "The"}]}]}}
 *   {"delta": {"content": [{"type": "text", "text": "Hi"}]}}
 *
 * OpenAI's chat-chunk contract requires `delta.content` to be a string. The
 * Responses translator forwards it verbatim as `response.output_text.delta.delta`,
 * which strict Responses clients reject ("malformed response.output_text.delta
 * delta"), and Chat-Completions passthrough clients receive a non-string
 * `content`.
 *
 * These helpers fold such a delta back into the OpenAI shape in place: text
 * parts become the `content` string, thinking parts are appended to
 * `reasoning_content`. Finite numeric content is converted to text as well.
 *
 * Ported from OmniRoute #15757.
 */
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

/**
 * The text carried by a `thinking` part, whose payload is either a bare
 * string or an array of `{type:"text", text}` parts.
 * @param {unknown} value
 * @returns {string}
 */
function partsText(value) {
  if (isString(value)) return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => (isRecord(part) && isString(part.text) ? part.text : ""))
    .join("");
}

/**
 * Normalize one `delta` object. Returns true when it was changed.
 * @param {Record<string, unknown>} delta
 * @returns {boolean}
 */
export function normalizeArrayContentDelta(delta) {
  if (!isRecord(delta)) return false;
  if (typeof delta.content === "number" && Number.isFinite(delta.content)) {
    delta.content = String(delta.content);
    return true;
  }
  if (!Array.isArray(delta.content)) return false;

  let text = "";
  let thinking = "";
  for (const part of delta.content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && isString(part.text)) {
      text += part.text;
    } else if (part.type === "thinking") {
      thinking += partsText(part.thinking);
    }
  }

  if (text) delta.content = text;
  else delete delta.content;

  if (thinking) {
    const existing = isString(delta.reasoning_content) ? delta.reasoning_content : "";
    delta.reasoning_content = existing + thinking;
  }
  return true;
}

/** Normalize Mistral text/thinking arrays only when no other part would be lost. */
export function normalizeMistralContent(message) {
  if (Array.isArray(message?.content) && message.content.length &&
      message.content.every((part) => part?.type === "text" || part?.type === "thinking")) {
    normalizeArrayContentDelta(message);
  }
}

/**
 * Normalize every `choices[].delta` of an OpenAI chat-completion chunk.
 * @param {unknown} chunk
 * @returns {boolean} true when at least one delta was changed
 */
export function normalizeArrayContentChunk(chunk) {
  if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return false;
  let changed = false;
  for (const choice of chunk.choices) {
    if (isRecord(choice) && isRecord(choice.delta)) {
      changed = normalizeArrayContentDelta(choice.delta) || changed;
    }
  }
  return changed;
}
