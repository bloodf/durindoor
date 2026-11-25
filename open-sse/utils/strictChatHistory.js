import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { ROLE } from "../translator/schema/index.js";

/** Repair simple text-only turns without discarding unknown fields or tool histories. */
export function normalizeStrictChatHistory(messages) {
  if (!Array.isArray(messages)) return messages;
  // Only rewrite histories whose complete shape is understood. In particular, tool
  // call/result ordering and multimodal blocks must never be guessed at here.
  if (!messages.every((message) => isRecord(message) &&
    Object.keys(message).every((key) => key === "role" || key === "content") &&
    [ROLE.SYSTEM, ROLE.DEVELOPER, ROLE.USER, ROLE.ASSISTANT].includes(message.role) &&
    isString(message.content))) return messages;
  const result = [];
  for (const message of messages) {
    const turn = (message.role === ROLE.USER || message.role === ROLE.ASSISTANT) && message.content === "" ? { ...message, content: " " } : message;
    const previous = result.at(-1);
    if (previous && previous.role === turn.role &&
      (turn.role === ROLE.USER || turn.role === ROLE.ASSISTANT)) {
      result[result.length - 1] = { ...previous, content: `${previous.content}\n${turn.content}` };
    } else {
      result.push(turn);
    }
  }
  return result;
}
