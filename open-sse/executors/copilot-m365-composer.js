/**
 * Transport-free composition of Microsoft 365 Copilot message snapshots and cursor-targeted deltas
 * into the answer text, its citations and Copilot's reasoning summary.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365Protocol/composer.ts`
 * at 5ffa68e835442a12ed1204a2eebf4076c298aecb.
 */
import { isRecord, isString } from "../../src/shared/utils/typeChecks.js";
import { M365CitationLedger, renderM365Citations } from "./copilot-m365-citations.js";

export const M365_COMPOSER_MAX_TEXT_LENGTH = 1_000_000;
export const M365_MAX_MESSAGES = 256;
const MAX_REASONING_LENGTH = 256 * 1024;
const ANONYMOUS = "__anonymous__";

const record = (value) => isRecord(value) ? value : null;
const CARD_CURSOR = /^\$\[['"]([^'"\]]+)['"]\]\.adaptiveCards\[(\d+)\]\.body\[(\d+)\]\.text$/;

/**
 * When the cursor targets one of this message's card bodies, that card text is the snapshot
 * `writeAtCursor` appends to. `message.text` can meanwhile preview a token the following
 * writes repeat, so using it would duplicate that token.
 */
function cursorCardText(cursor, id, message) {
  const match = isString(cursor?.j) ? CARD_CURSOR.exec(cursor.j) : null;
  if (!match || match[1] !== id || !Array.isArray(message.adaptiveCards)) return undefined;
  const card = record(message.adaptiveCards[Number(match[2])]);
  const body = card && Array.isArray(card.body) ? record(card.body[Number(match[3])]) : null;
  return isString(body?.text) ? body.text : undefined;
}

/** A reasoning-summary message: shown apart from the answer, never as part of it. */
const isReasoning = (message) =>
message.contentOrigin === "ChainOfThoughtSummary" || message.addToChainOfThought === true;

/**
 * Use `text` for buffered turns. `delta` is append-only and stops permanently after a rewrite:
 * a streaming consumer cannot retract published bytes, so a replacement is never appended.
 */
export class M365TurnComposer {
  #messages = new Map();
  #blocked = new Set();
  #reasoningMessages = new Map();
  #citations = new M365CitationLedger();
  #cursorId = null;
  #cursorSuppressed = false;
  #final = false;
  #emitted = "";
  #emittedAnnotations = 0;
  #emittedReasoning = "";
  #reasoningDiverged = false;
  #diverged = false;
  #maxTextLength;
  #maxMessages;

  constructor(options = {}) {
    this.#maxTextLength = options.maxTextLength ?? M365_COMPOSER_MAX_TEXT_LENGTH;
    this.#maxMessages = options.maxMessages ?? M365_MAX_MESSAGES;
    for (const limit of [this.#maxTextLength, this.#maxMessages]) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError("Invalid M365 composition limit");
    }
  }

  get #raw() {
    return [...this.#messages.values()].join("\n\n");
  }

  #rendered() {
    return renderM365Citations(this.#raw, this.#citations, this.#final);
  }

  /** The answer as the client receives it, citation markers resolved. */
  get text() {
    return this.#rendered().text;
  }

  /** The `url_citation` annotations of `text`. */
  get annotations() {
    return this.#rendered().annotations;
  }

  /** Copilot's reasoning summary for this turn, if it sent one. */
  get reasoning() {
    return [...this.#reasoningMessages.values()].join("\n\n");
  }

  get streamingDiverged() {
    return this.#diverged;
  }

  #setText(id, text) {
    if (!this.#messages.has(id) && this.#messages.size + this.#blocked.size >= this.#maxMessages) {
      throw new RangeError("M365 message limit exceeded");
    }
    const previous = this.#messages.get(id);
    const size = this.#raw.length - (previous?.length ?? 0) + text.length + (previous === undefined && this.#messages.size ? 2 : 0);
    if (size > this.#maxTextLength) throw new RangeError("M365 text limit exceeded");
    this.#messages.set(id, text);
  }

  #setReasoning(id, text) {
    const previous = this.#reasoningMessages.get(id)?.length ?? 0;
    if (this.reasoning.length - previous + text.length > MAX_REASONING_LENGTH) return;
    if (!this.#reasoningMessages.has(id) && this.#reasoningMessages.size >= this.#maxMessages) return;
    this.#reasoningMessages.set(id, text);
  }

  #updateCursor(cursor) {
    if (!isString(cursor?.j)) return;
    const match = /^\$\[['"]([^'"\]]+)['"]\]/.exec(cursor.j);
    this.#cursorId = match?.[1] ?? null;
    this.#cursorSuppressed = !match;
  }

  #blockMessage(id) {
    if (id === ANONYMOUS) {
      this.#cursorSuppressed = true;
      return;
    }
    if (this.#blocked.has(id)) return;
    if (this.#blocked.size + this.#messages.size >= this.#maxMessages) throw new RangeError("M365 message limit exceeded");
    this.#blocked.add(id);
  }

  #consumeMessage(message, cursor) {
    const id = isString(message.messageId) ? message.messageId : ANONYMOUS;
    if (isReasoning(message) && isString(message.text)) this.#setReasoning(id, message.text);
    const control = message.messageType !== undefined && message.messageType !== "Chat";
    const hidden = control || isReasoning(message) ||
    ["SearchResults", "Code", "ToolCall", "EarlyProgress"].includes(String(message.contentType));
    if (hidden || message.author !== undefined && message.author !== "bot") {
      this.#blockMessage(id);
      return true;
    }
    this.#citations.add(message.references);
    if (isString(message.text) && !this.#blocked.has(id)) {
      if (id === ANONYMOUS && !cursor) this.#cursorSuppressed = false;
      this.#setText(id, cursorCardText(cursor, id, message) ?? message.text);
    }
    return false;
  }

  #writeAtCursor(text, progress) {
    const id = this.#cursorId ?? ANONYMOUS;
    const reasoning = this.#reasoningMessages.get(id);
    if (reasoning !== undefined) {
      this.#setReasoning(id, reasoning + text);
      return;
    }
    if (!this.#cursorSuppressed && !this.#blocked.has(id) && !(progress && this.#cursorId === null)) {
      this.#setText(id, (this.#messages.get(id) ?? "") + text);
    }
  }

  #consume(argument) {
    const cursor = record(argument.cursor);
    this.#updateCursor(cursor);
    // Sources often ride on the update that streams the text citing them.
    this.#citations.add(argument.references);
    const messages = Array.isArray(argument.messages) ? argument.messages : [];
    let progress = false;
    for (const value of messages) {
      const message = record(value);
      if (message && this.#consumeMessage(message, cursor)) progress = true;
    }
    if (isString(argument.writeAtCursor)) this.#writeAtCursor(argument.writeAtCursor, progress);
  }

  #consumeFinal(value) {
    // Result metadata describes completion or refusal, not an assistant message; only compose messages.
    const argument = Array.isArray(value.arguments) ? record(value.arguments[0]) : null;
    const rawItem = value.item ?? argument?.item;
    const item = record(Array.isArray(rawItem) ? rawItem[0] : rawItem);
    if (item) this.#consume(item);
  }

  #reasoningUpdate() {
    const reasoning = this.reasoning;
    // A reasoning summary that rewrites itself stops streaming; it never fails the answer.
    if (this.#reasoningDiverged || !reasoning.startsWith(this.#emittedReasoning)) {
      this.#reasoningDiverged = true;
      return "";
    }
    const delta = reasoning.slice(this.#emittedReasoning.length);
    this.#emittedReasoning = reasoning;
    return delta;
  }

  /** Consume one frame; returns `{ delta, next, streamingDiverged, annotations, reasoningDelta }`. */
  push(frame) {
    const value = record(frame);
    if (value?.type === 1 && value.target === "update" && Array.isArray(value.arguments)) {
      for (const argument of value.arguments) {
        const item = record(argument);
        if (item) this.#consume(item);
      }
    } else if (value?.type === 2 || value?.type === 3) {
      this.#final = true;
      if (value.type === 2) this.#consumeFinal(value);
    }
    const rendered = this.#rendered();
    const next = rendered.text.slice(0, rendered.stableLength);
    if (!next.startsWith(this.#emitted)) this.#diverged = true;
    const delta = this.#diverged ? "" : next.slice(this.#emitted.length);
    let annotations = [];
    if (!this.#diverged) {
      this.#emitted = next;
      const published = rendered.annotations.filter((annotation) => annotation.url_citation.end_index <= next.length);
      annotations = published.slice(this.#emittedAnnotations);
      this.#emittedAnnotations = published.length;
    }
    return { delta, next, streamingDiverged: this.#diverged, annotations, reasoningDelta: this.#reasoningUpdate() };
  }
}
