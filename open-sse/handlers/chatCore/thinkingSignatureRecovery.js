/**
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
import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

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
 * protected as well. Any assistant redacted_thinking disables recovery so the
 * original error and opaque continuity are preserved. Returns the original body
 * reference when no safe change is possible.
 */
export function stripHistoricalThinkingForSignatureRecovery(body) {
  if (!body || !isObject(body) || Array.isArray(body)) return body;
  if (!Array.isArray(body.messages)) return body;

  const messages = body.messages;
  if (messages.some((message) => message?.role === "assistant" && hasBlock(message, "redacted_thinking"))) return body;
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

/**
 * `clear_thinking_*` context edits require thinking to be on, so they leave with
 * it. Other edits stay; an edits list left empty drops `context_management`.
 */
function withoutClearThinkingEdits(contextManagement) {
  if (!isObject(contextManagement) || !Array.isArray(contextManagement.edits)) return contextManagement;
  const edits = contextManagement.edits.filter(
    (edit) => !String(edit?.type ?? "").startsWith("clear_thinking"));
  if (edits.length === contextManagement.edits.length) return contextManagement;
  return edits.length > 0 ? { ...contextManagement, edits } : undefined;
}

/**
 * Last-resort recovery body (OmniRoute #20063): drop every thinking block,
 * including the active tool-use cycle, and drop extended thinking for this one
 * request, because the API rejects a tool_use turn without a leading thinking
 * block while thinking is on. Used only after the conservative strip failed or
 * changed nothing, i.e. a foreign-signed block sits inside the protected cycle
 * (a cross-provider fallback mid tool loop). Like the conservative strip, any
 * assistant redacted_thinking disables it. Returns the original reference when
 * nothing can change; the input is never mutated.
 */
export function stripAllThinkingForSignatureRecovery(body) {
  if (!body || !isObject(body) || !Array.isArray(body.messages)) return body;
  if (body.messages.some((message) => message?.role === "assistant" && hasBlock(message, "redacted_thinking"))) return body;

  let changed = false;
  const messages = body.messages.map((message) => {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return message;
    const content = message.content.filter((block) => !isThinkingBlock(block));
    if (content.length === message.content.length) return message;
    changed = true;
    return { ...message, content };
  });
  if (!changed) return body;

  const { thinking: _thinking, context_management: contextManagement, ...rest } = body;
  const kept = withoutClearThinkingEdits(contextManagement);
  return { ...rest, ...(kept === undefined ? null : { context_management: kept }), messages };
}
