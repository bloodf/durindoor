/**
 * Cloudflare Playground conversation shaping for tool sessions.
 *
 * The playground rejects a message over 6000 characters and a conversation with
 * more than 10 user-role messages. Replayed tool results are user messages, so
 * an agent loop reaches both limits within a few turns. Turns older than the
 * verbatim window are compacted into one user message, which keeps the original
 * task instead of dropping it.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT)
 * `open-sse/translator/cloudflarePlaygroundConversation.ts`, PR #18313.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

export const CF_MAX_MESSAGE_CHARS = 5800;
export const CF_MAX_USER_MESSAGES = 10;

const TRUNCATED = "\n…[truncated to fit the playground's 6000-char limit]";
const COMPACT_HEADER = "# Earlier conversation (compacted to fit the playground's history limit)";
const COMPACT_LABELS = { user: "### USER", assistant: "### ASSISTANT", tool: "### TOOL RESULT" };
const COMPACT_ITEM_CHARS = { user: 700, assistant: 300, tool: 400 };
const COMPACT_MARKER_RESERVE = 80;

export const hasCfToolHistory = (messages) => messages.some((message) =>
  message?.role === "tool" || (message?.role === "assistant" && message.tool_calls?.length > 0));

function contentText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => isString(part) ? part : (isString(part?.text) ? part.text : "")).join("\n");
}

function argumentsValue(raw) {
  try { return JSON.parse(raw || "{}"); } catch { return raw; }
}

/** Earlier calls replay in the envelope the contract asks for, without a nonce. */
function callMarkup(toolCalls) {
  const calls = (Array.isArray(toolCalls) ? toolCalls : [])
    .filter((call) => isString(call?.function?.name))
    .map((call) => ({ type: "tool_call", name: call.function.name, arguments: argumentsValue(call.function.arguments) }));
  if (!calls.length) return "";
  return JSON.stringify(calls.length === 1 ? calls[0] : calls);
}

/** One OpenAI message as playground text; null for roles it drops (system). */
function renderTurn(message) {
  const kind = message?.role;
  if (!Object.hasOwn(COMPACT_LABELS, kind)) return null;
  let text = contentText(message.content);
  if (kind === "assistant") text = [text, callMarkup(message.tool_calls)].filter(Boolean).join("\n");
  if (kind === "tool") {
    const content = text || "Tool executed successfully";
    text = JSON.stringify({ tool_result: { ...(message.tool_call_id ? { call_id: message.tool_call_id } : null), content } });
  }
  return text ? { kind, text } : null;
}

const truncate = (text) => text.length <= CF_MAX_MESSAGE_CHARS
  ? text : text.slice(0, CF_MAX_MESSAGE_CHARS - TRUNCATED.length) + TRUNCATED;

function compactItem({ kind, text }) {
  const cap = COMPACT_ITEM_CHARS[kind];
  const capped = text.length <= cap ? text : `${text.slice(0, cap)} …[+${text.length - cap} chars]`;
  return `${COMPACT_LABELS[kind]}\n${capped}`;
}

/** On overflow keep the first turn and the newest ones; the middle is elided. */
function compactBlock(turns) {
  const items = turns.map(compactItem);
  const full = [COMPACT_HEADER, ...items].join("\n\n");
  if (full.length <= CF_MAX_MESSAGE_CHARS) return full;
  const [first, ...rest] = items;
  const tail = [];
  let room = CF_MAX_MESSAGE_CHARS - COMPACT_HEADER.length - first.length - COMPACT_MARKER_RESERVE;
  while (rest.length && rest.at(-1).length + 2 <= room) {
    room -= rest.at(-1).length + 2;
    tail.unshift(rest.pop());
  }
  return [COMPACT_HEADER, first, `... ${rest.length} earlier turns elided ...`, ...tail].join("\n\n");
}

/**
 * Text-only `{ role, content }` messages that fit both limits. `contract` holds
 * the tool-contract chunks, each of which spends one user-message slot.
 */
export function fitCfConversation(messages, contract = []) {
  const turns = messages.map(renderTurn).filter(Boolean);
  const slots = CF_MAX_USER_MESSAGES - contract.length;
  const userStarts = turns.flatMap((turn, index) => turn.kind === "assistant" ? [] : [index]);
  // The compacted block takes a slot of its own.
  const start = userStarts.length > slots ? userStarts.at(1 - slots) : 0;
  const older = start > 0 ? [{ role: "user", content: compactBlock(turns.slice(0, start)) }] : [];
  return [
    ...contract.map((content) => ({ role: "user", content })),
    ...older,
    ...turns.slice(start).map((turn) => ({ role: turn.kind === "assistant" ? "assistant" : "user", content: truncate(turn.text) })),
  ];
}
