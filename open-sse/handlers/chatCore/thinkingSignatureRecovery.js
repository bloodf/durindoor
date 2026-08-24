import { isObject, isString } from "@/shared/utils/typeChecks.js"; /**
 * Anthropic thinking-signature one-shot recovery (ported from OmniRoute #7906).
 *
 * Anthropic occasionally rejects a request whose COMPLETED historical assistant
 * turn carries a thinking block with a signature it will not re-validate (e.g.
 * after a cache/model boundary), returning `400 Invalid signature in thinking
 * block`. The correct recovery is to retry ONCE with the historical thinking
 * omitted, while keeping the complete active tool-use/result cycle verbatim.
 *
 * These helpers are pure and intentionally NOT applied eagerly: normal requests
 * must retain their thinking history, cache shape, and current-model semantics.
 */

function isThinkingBlock(block) {
  if (!block || !isObject(block)) return false;
  const { type } = block;
  return type === "thinking" || type === "redacted_thinking";
}

function hasBlock(message, type) {
  return (
    !!message &&
    Array.isArray(message.content) &&
    message.content.some((block) => !!block && isObject(block) && block.type === type));

}

/**
 * Match ONLY the Anthropic validation failure this recovery path understands.
 * Generic 400s and the separate "latest assistant message cannot be modified"
 * validation error must continue through the normal error path unchanged.
 */
export function isAnthropicThinkingSignatureError({ provider, status, message } = {}) {
  const isAnthropicTarget =
  provider === "claude" ||
  isString(provider) && provider.startsWith("anthropic-compatible-");
  if (!isAnthropicTarget || Number(status) !== 400 || !isString(message)) return false;
  return /invalid\s+[`'"]?signature[`'"]?\s+in\s+[`'"]?thinking[`'"]?\s+block/i.test(message);
}

/**
 * Build a one-shot recovery body after Anthropic rejected a thinking signature.
 * Historical thinking blocks are omitted, but the complete ACTIVE tool-use cycle
 * is preserved verbatim: when the request ends in one or more `user[tool_result]`
 * turns, every paired assistant `tool_use` turn in that still-open cycle keeps
 * its thinking blocks. A trailing unresolved assistant `tool_use` turn is
 * protected as well. Returns the original body reference when no safe change is
 * possible.
 */
export function stripHistoricalThinkingForSignatureRecovery(body) {
  if (!body || !isObject(body) || Array.isArray(body)) return body;
  if (!Array.isArray(body.messages)) return body;

  const messages = body.messages;
  const protectedAssistantIndexes = new Set();
  let cursor = messages.length - 1;

  // Some internal callers can resume from an unresolved assistant tool_use.
  if (cursor >= 0 && messages[cursor]?.role === "assistant" && hasBlock(messages[cursor], "tool_use")) {
    protectedAssistantIndexes.add(cursor);
    cursor -= 1;
  }

  // Walk the complete trailing tool-result chain. Interleaved thinking can span
  // several assistant/tool_result pairs, so protecting only the latest assistant
  // message is insufficient.
  while (cursor >= 0 && messages[cursor]?.role === "user" && hasBlock(messages[cursor], "tool_result")) {
    cursor -= 1;
    while (cursor >= 0 && messages[cursor]?.role !== "assistant") cursor -= 1;
    if (cursor < 0 || !hasBlock(messages[cursor], "tool_use")) break;
    protectedAssistantIndexes.add(cursor);
    cursor -= 1;
  }

  let changed = false;
  const recoveredMessages = messages.map((message, index) => {
    if (
    !message ||
    message.role !== "assistant" ||
    !Array.isArray(message.content) ||
    protectedAssistantIndexes.has(index))
    {
      return message;
    }
    const content = message.content.filter((block) => !isThinkingBlock(block));
    if (content.length === message.content.length) return message;
    changed = true;
    return { ...message, content };
  });

  if (!changed) return body;
  return { ...body, messages: recoveredMessages };
}