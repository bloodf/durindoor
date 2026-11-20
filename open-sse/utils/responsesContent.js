import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

function hasNonemptyResponseValue(value) {
  return isString(value) ? value.trim().length > 0 :
  value !== null && isObject(value) && !Array.isArray(value) && Object.keys(value).length > 0;
}

/** Recognize usable native Responses items, including typed media and tool calls. */
export function hasResponsesContentItem(item) {
  if (!item || !isObject(item)) return false;
  if (item.type === "image_generation_call") return hasNonemptyResponseValue(item.result);
  if (item.type === "mcp_approval_request") {
    const id = item.id || item.approval_request_id;
    return isString(id) && id.trim().length > 0 &&
    hasNonemptyResponseValue(item.name || item.server_label || item.arguments);
  }
  if (["function_call", "custom_tool_call", "computer_call", "shell_call", "local_shell_call", "apply_patch_call"].includes(item.type)) {
    const id = item.call_id || item.id;
    return isString(id) && id.trim().length > 0 &&
    hasNonemptyResponseValue(item.name || item.action || item.operation || item.command || item.arguments || item.input);
  }
  if (item.type === "reasoning") {
    return isString(item.reasoning) && item.reasoning.trim() ||
    Array.isArray(item.summary) && item.summary.some((part) => isString(part?.text) && part.text.trim());
  }
  if (item.type !== "message" || !Array.isArray(item.content)) return false;
  return item.content.some((part) =>
  isString(part?.text) && part.text.trim() ||
  isString(part?.refusal) && part.refusal.trim());
}

/** A background Responses receipt identifies an accepted asynchronous job. */
export function isResponsesReceipt(response) {
  return response?.object === "response" && isString(response.id) && response.id.trim().length > 0 && ["queued", "in_progress"].includes(response.status);
}

/**
 * A native Responses envelope: the provider's own `object: "response"` body
 * carrying its native `output` items.
 *
 * Such an envelope may also carry the request's text CONFIGURATION next to
 * that output (`text: {format: {type: "json_schema"}}`). That field is
 * metadata about how the answer was requested, not assistant content, so a
 * classifier must judge the envelope by its output items and status instead
 * of by the presence of a `text` key.
 */
export function isResponsesEnvelope(response) {
  return isObject(response) && response.object === "response" && Array.isArray(response.output);
}
