import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: a lone text part becomes a plain string,
// otherwise the array is returned as-is. Matches existing translator behavior.
export function collapseTextParts(parts) {
  return parts.length > 0 && parts.every((part) => part?.type === OPENAI_BLOCK.TEXT)
    ? parts.map((part) => part.text || "").join("\n")
    : parts;
}
