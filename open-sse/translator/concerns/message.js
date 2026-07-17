import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array. A text-only array (one or more text
// blocks) is joined into a single plain string; any array containing non-text
// blocks (image_url, tool_result, …) is returned as-is so multimodal content
// keeps its structure. This fixes providers that reject repeated
// [{type:text},{type:text}] arrays and avoids losing content when a single
// message carries several consecutive text blocks.
export function collapseTextParts(parts) {
  return parts.length > 0 && parts.every((part) => part?.type === OPENAI_BLOCK.TEXT)
    ? parts.map((part) => part.text || "").join("\n")
    : parts;
}
