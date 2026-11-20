import { OPENAI_BLOCK } from "../schema/index.js";
import { isString } from "../../../src/shared/utils/typeChecks.js";

// Extract only text parts from OpenAI-compatible structured content.
export function extractTextContent(content) {
  if (isString(content)) return content;
  return Array.isArray(content) ? content.filter(part => part?.type === OPENAI_BLOCK.TEXT && isString(part.text)).map(part => part.text).join("") : "";
}
