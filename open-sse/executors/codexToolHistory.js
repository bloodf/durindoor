/**
 * Tool call/result repair for the Codex backend. Codex is stateless: it rejects
 * a request whose history holds a call without a result, a result without its
 * call, or a call_id outside `[A-Za-z0-9_-]{1,64}`.
 */
import { createHash } from "node:crypto";
import { clampResponsesCallId } from "../translator/formats/responsesApi.js";
import { RESPONSES_ITEM, ROLE } from "../translator/schema/index.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const OUTPUT_TYPE_BY_CALL_TYPE = new Map([
  [RESPONSES_ITEM.FUNCTION_CALL, RESPONSES_ITEM.FUNCTION_CALL_OUTPUT],
  [RESPONSES_ITEM.CUSTOM_TOOL_CALL, RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT],
  [RESPONSES_ITEM.COMPUTER_CALL, RESPONSES_ITEM.COMPUTER_CALL_OUTPUT],
]);
const OUTPUT_TYPES = new Set(OUTPUT_TYPE_BY_CALL_TYPE.values());
const INTERRUPTED_TOOL_OUTPUT = "[No tool output recorded: the tool call was interrupted before it produced a result.]";

// A computer result must be a real screenshot, so an interrupted call cannot be
// answered with a placeholder; it becomes assistant history text instead.
const interruptedComputerCall = (callId) => ({
  type: RESPONSES_ITEM.MESSAGE,
  role: ROLE.ASSISTANT,
  content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: `[Computer call interrupted before a screenshot was recorded; call_id=${callId}]` }],
});

const pairKey = (outputType, callId) => `${outputType}\0${callId}`;

function normalizeCallId(id) {
  if (!isString(id) || !id) return id;
  // Composite `call|item` ids correlate on the first part only.
  const base = id.split(/[\n|]/).find(Boolean) || id;
  const safe = base.replace(/[^A-Za-z0-9_-]/g, "_");
  if (safe === base) return clampResponsesCallId(safe);
  // Hash the raw value so `a.b` and `a_b` cannot merge.
  return clampResponsesCallId(`${safe}_${createHash("sha256").update(base).digest("hex").slice(0, 8)}`);
}

/**
 * Normalize call ids, drop results with no call of the same kind, and add a
 * placeholder result after each function or custom call that has none. An
 * unanswered computer call is replaced with a note.
 *
 * @param {Array} input Responses API input items.
 * @returns {Array} repaired items; the caller's items are not mutated.
 */
export function repairCodexToolHistory(input) {
  const items = input.map((item) => OUTPUT_TYPES.has(item?.type) || OUTPUT_TYPE_BY_CALL_TYPE.has(item?.type)
    ? { ...item, call_id: normalizeCallId(item.call_id) }
    : item);

  const calls = new Set();
  const answered = new Set();
  for (const item of items) {
    const outputType = OUTPUT_TYPE_BY_CALL_TYPE.get(item?.type);
    if (outputType && isString(item.call_id)) calls.add(pairKey(outputType, item.call_id));
    if (OUTPUT_TYPES.has(item?.type) && isString(item.call_id)) answered.add(pairKey(item.type, item.call_id));
    // Chat-shaped items can sit in `input`: they declare and answer function calls.
    for (const toolCall of Array.isArray(item?.tool_calls) ? item.tool_calls : []) {
      if (isString(toolCall?.id)) calls.add(pairKey(RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, toolCall.id));
    }
    if (item?.role === ROLE.TOOL && isString(item.tool_call_id)) {
      answered.add(pairKey(RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, item.tool_call_id));
    }
  }

  return items.flatMap((item) => {
    if (OUTPUT_TYPES.has(item?.type)) {
      return !isString(item.call_id) || calls.has(pairKey(item.type, item.call_id)) ? [item] : [];
    }
    const outputType = OUTPUT_TYPE_BY_CALL_TYPE.get(item?.type);
    if (!outputType || !isString(item.call_id) || !item.call_id || answered.has(pairKey(outputType, item.call_id))) return [item];
    if (outputType === RESPONSES_ITEM.COMPUTER_CALL_OUTPUT) return [interruptedComputerCall(item.call_id)];
    return [item, { type: outputType, call_id: item.call_id, output: INTERRUPTED_TOOL_OUTPUT }];
  });
}
