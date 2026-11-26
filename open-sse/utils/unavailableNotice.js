// OmniRoute #21066 (8f599effad97): some upstreams answer HTTP 200 with an
// assistant message saying the model, or the outdated client version, is no
// longer available. A combo must treat that as a failed member.
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const FAMILY = "(?:claude|gpt|gemini|opus|sonnet|haiku|deepseek|qwen|llama|mistral|grok|glm|minimax|kimi|o[134])";
const MODEL_NOTICE = new RegExp(
  `^(?:(?:this\\s+)?model|${FAMILY}(?:-[a-z0-9._:/-]+)?)(?:\\s+[a-z0-9._:/-]+){0,4}\\s+is\\s+no\\s+longer\\s+available\\.\\s*Please\\s+switch\\s+to\\s+[a-z0-9_:/-]+(?:[.][a-z0-9_:/-]+|\\s+[a-z0-9_:/-]+)*[.!]?$`,
  "i"
);
// Anchored and limited to first-party client names, so "This version of Python
// is no longer supported" stays an ordinary answer.
const CLIENT_NOTICE = /^this\s+version\s+of\s+(?:antigravity|agy)\s+is\s+no\s+longer\s+supported[.!]?(?:\s+please\s+(?:update|download\s+and\s+install\s+the\s+latest\s+version)[.!]?)?$/i;
const CLIENT_NOTICE_PHRASES = ["antigravity", "agy"].map((name) => `this version of ${name} is no longer supported`);
const FAMILY_NAMES = ["claude", "gpt", "gemini", "opus", "sonnet", "haiku", "deepseek", "qwen", "llama", "mistral", "grok", "glm", "minimax", "kimi", "o1", "o3", "o4"];
const FAMILY_TOKEN = new RegExp(`^${FAMILY}(?:-[a-z0-9._:/-]+)?$`);
const MODIFIER_TOKEN = /^[a-z0-9._:/-]+$/;
const TAILS = ["is no longer available. please switch to", "is no longer available.please switch to"];
const PREFIX_CHAR_CAP = 512;

/**
 * A notice must occupy the entire trimmed answer. Long answers are content.
 */
export function isUnavailableNotice(text) {
  if (!isString(text)) return false;
  const trimmed = text.trim();
  return trimmed.length < PREFIX_CHAR_CAP && (CLIENT_NOTICE.test(trimmed) || MODEL_NOTICE.test(trimmed));
}

function couldBeModelNotice(text) {
  const words = text.split(" ");
  const [first] = words;
  if (words.length === 1) {
    return "this".startsWith(first) || "model".startsWith(first) ||
      FAMILY_NAMES.some((name) => name.startsWith(first)) || FAMILY_TOKEN.test(first);
  }
  let rest = words.slice(1);
  if (first === "this") {
    if (rest.length === 1) return "model".startsWith(rest[0]);
    if (rest[0] !== "model") return false;
    rest = rest.slice(1);
  } else if (first !== "model" && !FAMILY_TOKEN.test(first)) {
    return false;
  }
  // Up to four name words may sit between the subject and the fixed tail.
  for (let skip = 0; skip <= Math.min(4, rest.length); skip += 1) {
    if (skip > 0 && !MODIFIER_TOKEN.test(rest[skip - 1])) return false;
    const tail = rest.slice(skip).join(" ");
    if (TAILS.some((phrase) => phrase.startsWith(tail) || tail.startsWith(phrase))) return true;
  }
  return false;
}

/** True while streamed `text` can still grow into a notice. */
function couldBecomeNotice(text) {
  if (text.length >= PREFIX_CHAR_CAP) return false;
  const normalized = text.trimStart().toLowerCase().replace(/\s+/g, " ");
  return !normalized || CLIENT_NOTICE_PHRASES.some((phrase) => phrase.startsWith(normalized) || normalized.startsWith(phrase)) ||
    couldBeModelNotice(normalized);
}

/** The text of a frame that carries visible text and nothing else, otherwise null. */
export function textOnlyDelta(frame) {
  const delta = frame.choices?.[0]?.delta;
  if (delta) {
    const other = delta.reasoning_content || delta.reasoning || delta.tool_calls?.length || delta.function_call;
    return !other && isString(delta.content) ? delta.content : null;
  }
  if (frame.type === "content_block_delta") {
    return frame.delta?.type !== "thinking_delta" && isString(frame.delta?.text) ? frame.delta.text : null;
  }
  if (frame.type === "response.output_text.delta") return isString(frame.delta) ? frame.delta : null;
  const parts = (frame.response || frame).candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const plain = parts.every((part) => isObject(part) && isString(part.text) && !part.thought && !part.functionCall);
  return plain ? parts.map((part) => part.text).join("") : null;
}

/**
 * Decides what to do with each content frame of one stream: "hold" while the
 * text can still be a notice, otherwise "content". A caller must wait for
 * stream completion before classifying held text as a notice.
 */
export function createNoticeGate() {
  let text = "";
  return {
    get holding() { return text.length > 0; },
    push(frame) {
      const delta = textOnlyDelta(frame);
      if (delta === null) return "content";
      text += delta;
      return isUnavailableNotice(text) || couldBecomeNotice(text) ? "hold" : "content";
    },
    get text() { return text; }
  };
}
