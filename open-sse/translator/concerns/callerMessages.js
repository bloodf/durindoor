import { isRecord } from "../../../src/shared/utils/typeChecks.js";

function copyToolCall(toolCall) {
  if (!isRecord(toolCall)) return toolCall;
  const copy = { ...toolCall };
  if (isRecord(copy.function)) copy.function = { ...copy.function };
  return copy;
}

function copyMessage(message) {
  if (!isRecord(message)) return message;
  const copy = { ...message };
  if (Array.isArray(copy.tool_calls)) copy.tool_calls = copy.tool_calls.map(copyToolCall);
  return copy;
}

/**
 * Give the translator its own message list, message objects and tool calls so the
 * in-place edits it makes (echo-field strip, tool-call id/argument repair, displaced
 * tool-result reorder, content-type strip) never reach the caller's body. A combo
 * shares message objects between its targets (the per-target body copy is shallow),
 * so one target's edit would otherwise change the input of the next.
 *
 * One level only: every other body field, and a message's `content`, stay shared
 * with the caller, so a pass that rewrites a content block must copy it.
 */
export function ownMessages(body) {
  if (!isRecord(body) || !Array.isArray(body.messages)) return body;
  return { ...body, messages: body.messages.map(copyMessage) };
}
