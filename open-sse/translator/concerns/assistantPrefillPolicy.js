import { isFunction, isObject, isString } from "../../../src/shared/utils/typeChecks.js";
import { CLAUDE_BLOCK, ROLE } from "../schema/index.js";

const ASSISTANT_CONTINUATION_PROMPT = "Continue from the assistant response above without repeating it.";
const INCOMPLETE_TOOL_RESULT = "Tool execution was not completed before this request continued.";
const PRESERVE_HEADER = "x-9router-assistant-prefill";

function getHeader(headers, name) {
  if (!headers) return null;
  if (isFunction(headers.get)) return headers.get(name);
  if (!isObject(headers)) return null;

  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? null : headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function hasText(content) {
  if (isString(content)) return Boolean(content.trim());
  return Array.isArray(content) && content.some((block) =>
    block?.type === CLAUDE_BLOCK.TEXT && isString(block.text) && Boolean(block.text.trim())
  );
}

/**
 * Make Claude-format conversations end on a user turn unless a client explicitly
 * requests native assistant-prefill semantics through the compatibility header.
 * Mutates and returns `body` to match existing translator normalization helpers.
 */
export function applyAssistantPrefillPolicy(body, rawHeaders = null) {
  if (!Array.isArray(body?.messages)) return body;
  if (String(getHeader(rawHeaders, PRESERVE_HEADER) || "").toLowerCase() === "preserve") return body;

  const trailingAssistant = body.messages.at(-1);
  if (trailingAssistant?.role !== ROLE.ASSISTANT) return body;

  const toolUses = Array.isArray(trailingAssistant.content)
    ? trailingAssistant.content.filter((block) => block?.type === CLAUDE_BLOCK.TOOL_USE && block.id)
    : [];
  if (toolUses.length > 0) {
    body.messages.push({
      role: ROLE.USER,
      content: toolUses.map((toolUse) => ({
        type: CLAUDE_BLOCK.TOOL_RESULT,
        tool_use_id: toolUse.id,
        is_error: true,
        content: INCOMPLETE_TOOL_RESULT,
      })),
    });
    return body;
  }

  if (!hasText(trailingAssistant.content)) {
    body.messages.pop();
    return body;
  }

  body.messages.push({
    role: ROLE.USER,
    content: [{ type: CLAUDE_BLOCK.TEXT, text: ASSISTANT_CONTINUATION_PROMPT }],
  });
  return body;
}
