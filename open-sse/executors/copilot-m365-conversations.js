/**
 * Copilot conversation continuity.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365Protocol/conversations.ts`
 * at 4265bb2ad5477450a07d3a43ea33a62c6c874878.
 *
 * Copilot keeps every conversation server-side under its `ConversationId`. Opening a new one per request
 * re-sends the whole history and starts a thread each turn, and Copilot throttles accounts that open threads
 * quickly. This store remembers, per connection and request profile, the history each conversation has
 * already seen, so a request that extends it with our reply plus new messages continues the same
 * conversation and sends only the new messages.
 *
 * A request continues a conversation only when all of these hold:
 * - its messages up to our reply hash to the exact history that conversation was sent (a sha256 chain
 *   over role, content and image references, so any edit breaks it);
 * - the message after that history is our reply: the tool-call ids we issued, or the same text up to
 *   whitespace (so two sessions with the same opener never swap conversations);
 * - something follows our reply, the conversation is not idle-expired and has room left under Copilot's
 *   per-conversation message cap.
 * Anything else starts a fresh conversation, which costs a thread but never a wrong context. A claim
 * removes the entry, so two concurrent identical requests cannot share one conversation; the caller
 * commits it back under the new history only after the turn succeeds.
 *
 * The scope (see `conversationScope` in copilot-m365-web.js) always starts with the connection id, so
 * two connections never see each other's conversations.
 */
import { createHash } from "node:crypto";
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";

const record = (value) => isRecord(value) ? value : {};

// The proxy-observed idle window for reusing a Copilot conversation.
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
// Copilot caps a conversation at 600 user messages; keep headroom for retries.
const DEFAULT_MAX_TURNS = 590;
const DEFAULT_MAX_ENTRIES = 1000;

function messageText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const p = record(part);
    return isString(p.text) ? p.text : "";
  }).join("\n");
}

/** A message's content for the history hash: its text, plus where each image part points. */
function contentIdentity(content) {
  if (!Array.isArray(content)) return messageText(content);
  return content.map((part) => {
    const p = record(part);
    if (isString(p.text)) return p.text;
    const image = isString(p.image_url) ? p.image_url : record(p.image_url).url;
    return isString(image) ? `\0image\0${image}` : "";
  }).join("\n");
}

function toolCallIds(message) {
  return Array.isArray(message.tool_calls) ? message.tool_calls.map((call) => String(record(call).id ?? "")) : [];
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Identity of a reply: its tool-call ids when it called tools, otherwise its text. */
export function m365ReplyFingerprint(output) {
  return output.calls?.length ?
  `calls:${output.calls.map((call) => call.id).join(",")}` :
  `text:${normalizeText(output.text || "")}`;
}

function echoedFingerprint(message) {
  if (message.role !== "assistant") return null;
  const ids = toolCallIds(message);
  return ids.length ? `calls:${ids.join(",")}` : `text:${normalizeText(messageText(message.content))}`;
}

function canonical(message) {
  return JSON.stringify([
  isString(message.role) ? message.role : "",
  contentIdentity(message.content),
  Array.isArray(message.tool_calls) ?
  message.tool_calls.map((raw) => {
    const call = record(raw);
    const fn = record(call.function);
    return [call.id ?? null, fn.name ?? null, fn.arguments ?? null];
  }) :
  null,
  message.tool_call_id ?? null]
  );
}

/** Chain heads: heads[k] identifies messages[0..k). */
function chainHeads(messages) {
  const heads = [createHash("sha256").update("m365-conversation").digest("hex")];
  for (const message of messages) {
    heads.push(
      createHash("sha256").
      update(heads[heads.length - 1]).
      update("\0").
      update(canonical(record(message))).
      digest("hex")
    );
  }
  return heads;
}

export class M365ConversationStore {
  entries = new Map();
  size = 0;

  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Take the conversation this request continues, if any; it leaves the store until committed. */
  claim(scope, messages) {
    const heads = chainHeads(messages);
    // Longest history first; the reply sits at index k and something must follow it.
    for (let k = messages.length - 2; k >= 1; k--) {
      const key = `${scope}\0${heads[k]}`;
      const list = this.entries.get(key);
      if (!list) continue;
      const echoed = echoedFingerprint(record(messages[k]));
      const index = list.findIndex((entry) => this.usable(entry) && entry.reply === echoed);
      if (index === -1) continue;
      const [entry] = list.splice(index, 1);
      this.size--;
      if (!list.length) this.entries.delete(key);
      return { ids: entry.ids, delta: messages.slice(k + 1), turns: entry.turns };
    }
    return null;
  }

  /** Remember a conversation after a successful turn that was sent `messages` and replied `reply`. */
  commit(scope, messages, ids, reply, turns) {
    const key = `${scope}\0${chainHeads(messages)[messages.length]}`;
    const list = this.entries.get(key) ?? [];
    list.push({ ids, reply, turns, lastUsed: this.now() });
    this.entries.delete(key); // re-insert: Map order is the eviction order
    this.entries.set(key, list);
    this.size++;
    this.evict();
  }

  usable(entry) {
    return this.now() - entry.lastUsed <= this.idleMs && entry.turns < this.maxTurns;
  }

  evict() {
    for (const [key, list] of this.entries) {
      if (this.size <= this.maxEntries) return;
      this.size -= list.length;
      this.entries.delete(key);
    }
  }
}

let shared = new M365ConversationStore();

/** The process-wide store the executor uses. */
export function m365Conversations() {
  return shared;
}

export function __resetM365ConversationsForTesting(store = new M365ConversationStore()) {
  shared = store;
}
