import { ROLE } from "../schema/index.js";

// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";export function reasoningDelta(text, withRole = false) {
  return withRole ?
  { role: ROLE.ASSISTANT, reasoning_content: text } :
  { reasoning_content: text };
}

// Extract reasoning text from a streamed OpenAI-compatible delta across vendor shapes:
//   - reasoning_content (GLM, Qwen, DeepSeek, Kimi, Step, Hunyuan)
//   - reasoning (some compat layers)
//   - reasoning_text (GitHub Copilot / gemini-3.x via Copilot: reasoning with empty content)
//   - reasoning_details[] (MiniMax reasoning_split=true): [{ text|content }]
// Returns concatenated reasoning string, or "" when none.
export function extractReasoningText(delta) {
  if (!delta || !isObject(delta)) return "";
  if (isString(delta.reasoning_content) && delta.reasoning_content) return delta.reasoning_content;
  if (isString(delta.reasoning) && delta.reasoning) return delta.reasoning;
  if (isString(delta.reasoning_text) && delta.reasoning_text) return delta.reasoning_text;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d) => isString(d) ? d : d?.text || d?.content || "").join("");
  }
  return "";
}

// Append independently sourced reasoning without replacing an existing native
// reasoning string. Non-string native fields are preserved rather than coerced.
export function appendReasoningText(existing, addition) {
  if (!isString(addition) || addition.length === 0) return existing;
  if (existing == null || existing === "") return addition;
  if (!isString(existing)) return existing;
  const separator = existing.endsWith("\n") || addition.startsWith("\n") ? "" : "\n";
  return `${existing}${separator}${addition}`;
}