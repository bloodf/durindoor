import { Buffer } from "node:buffer";
import { executeChatGptWebFirstPartyTurn } from "./chatgptWebFirstParty.js";
import { ChatGptWebDeltaV1Decoder, parseChatGptWebEncodedItem } from "./chatgptWebDeltaV1.js";
import {
  ChatGptWebTopicStream,
  parseChatGptWebConversationHandoff,
} from "./chatgptWebTransport.js";
import { isObject, isString, runtimeTypeName } from "../../src/shared/utils/typeChecks.js";
const CHATGPT_WEB_ORIGIN = "https://chatgpt.com";
const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const MAX_BUFFERED_FRAMES = 2_048;
const MAX_BUFFERED_FRAME_BYTES = 16 * 1024 * 1024;
function isRecord(value) {
  return isObject(value) && value !== null && !Array.isArray(value);
}

function requirePrompt(value) {
  if (!isString(value) || !value.trim()) {
    throw new Error("ChatGPT Web browser turn requires a non-empty prompt");
  }
  return value;
}

function requireFirstPartyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ChatGPT Web browser session requires a valid URL");
  }
  if (url.origin !== CHATGPT_WEB_ORIGIN) {
    throw new Error("ChatGPT Web browser session requires the first-party chatgpt.com origin");
  }
}

function maybeTerminalResult(snapshot, conversationId, turnExchangeId) {
  if (!isRecord(snapshot) || !isRecord(snapshot.message)) return null;
  const message = snapshot.message;
  const author = isRecord(message.author) ? message.author : null;
  const content = isRecord(message.content) ? message.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  if (
    author?.role !== "assistant" ||
    content?.content_type !== "text" ||
    !parts.every((part) => isString(part)) ||
    message.status !== "finished_successfully" ||
    message.end_turn !== true
  ) {
    return null;
  }
  return {
    conversationId,
    turnExchangeId,
    text: parts.join(""),
    status: message.status,
    endTurn: true,
  };
}

function snapshotMessageRole(snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.message)) return null;
  const author = isRecord(snapshot.message.author) ? snapshot.message.author : null;
  return isString(author?.role) ? author.role : null;
}

function terminalResult(snapshot, conversationId, turnExchangeId) {
  const result = maybeTerminalResult(snapshot, conversationId, turnExchangeId);
  if (result) return result;
  if (!isRecord(snapshot) || !isRecord(snapshot.message)) {
    const rootKeys = isRecord(snapshot) ? Object.keys(snapshot).sort().join(",") : "non-object";
    throw new Error(`ChatGPT Web assistant document is incomplete (root=${rootKeys})`);
  }
  const message = snapshot.message;
  const author = isRecord(message.author) ? message.author : null;
  const content = isRecord(message.content) ? message.content : null;
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const summary = JSON.stringify({
    messageKeys: Object.keys(message).sort(),
    role: author?.role ?? null,
    contentType: content?.content_type ?? null,
    partCount: parts.length,
    partTypes: parts.map((part) => runtimeTypeName(part)),
    status: message.status ?? null,
    endTurn: message.end_turn ?? null,
  });
  throw new Error(`ChatGPT Web assistant document is incomplete (${summary})`);
}

function encodeParsedEvent(event) {
  const eventLine = event.event === "message" ? "" : `event: ${event.event}\n`;
  return `${eventLine}data: ${event.data}\n\n`;
}

/** Decode the direct first-party `/f/conversation` SSE body. */
export function parseChatGptWebDirectConversation(sseText) {
  if (!isString(sseText) || !sseText.trim()) {
    throw new Error("ChatGPT Web direct conversation returned an empty stream");
  }
  let decoder = new ChatGptWebDeltaV1Decoder();
  let conversationId = "";
  let turnExchangeId = "";
  let latestTerminal = null;
  for (const event of parseChatGptWebEncodedItem(sseText)) {
    if (isRecord(event.json)) {
      if (isString(event.json.conversation_id)) {
        conversationId = event.json.conversation_id;
      }
      if (isString(event.json.turn_exchange_id)) {
        turnExchangeId = event.json.turn_exchange_id;
      }
    }
    if (event.event === "delta_encoding") {
      latestTerminal =
        maybeTerminalResult(decoder.snapshot(), conversationId, turnExchangeId) ?? latestTerminal;
      decoder = new ChatGptWebDeltaV1Decoder();
    }
    decoder.ingest(encodeParsedEvent(event));
    latestTerminal =
      maybeTerminalResult(decoder.snapshot(), conversationId, turnExchangeId) ?? latestTerminal;
  }
  const result =
    maybeTerminalResult(decoder.snapshot(), conversationId, turnExchangeId) ?? latestTerminal;
  if (!result) return terminalResult(decoder.snapshot(), conversationId, turnExchangeId);
  return { ...result, conversationId, turnExchangeId };
}

function turnError(error, fallback) {
  return error instanceof Error ? error : new Error(fallback);
}

class ChatGptWebBrowserTurnRunner {
  session;
  prompt;
  attachments;
  decoder = new ChatGptWebDeltaV1Decoder();
  bufferedFrames = [];
  bufferedFrameBytes = 0;
  topicStream = null;
  conversationId = "";
  turnExchangeId = "";
  latestTerminalAssistant = null;
  renderedReadPending = false;
  settled = false;
  turnController = new AbortController();
  resultPromise;
  resolveResult = () => {};
  rejectResult = () => {};
  constructor(session, prompt, attachments) {
    this.session = session;
    this.prompt = prompt;
    this.attachments = attachments;
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // Browser events can finish while Playwright is still resolving submission.
    void this.resultPromise.catch(() => {});
  }

  fail(error) {
    if (this.settled) return;
    this.settled = true;
    this.turnController.abort();
    this.rejectResult(error);
  }

  complete() {
    if (this.settled) return;
    try {
      const result =
        this.latestTerminalAssistant ??
        terminalResult(this.decoder.snapshot(), this.conversationId, this.turnExchangeId);
      this.settled = true;
      this.resolveResult(result);
    } catch (error) {
      this.fail(turnError(error, "ChatGPT Web browser turn failed"));
    }
  }

  completeFromRenderedAssistant() {
    if (this.renderedReadPending || !this.session.readRenderedAssistantText) return;
    this.renderedReadPending = true;
    void this.session
      .readRenderedAssistantText(10_000)
      .then((text) => this.acceptRenderedAssistant(text))
      .catch(() => {
        this.renderedReadPending = false;
      });
  }

  acceptRenderedAssistant(text) {
    this.renderedReadPending = false;
    if (this.settled || !isString(text) || !text.trim()) return;
    this.settled = true;
    this.resolveResult({
      conversationId: this.conversationId,
      turnExchangeId: this.turnExchangeId,
      text: text.trim(),
      status: "finished_successfully",
      endTurn: true,
    });
  }

  finishFrame() {
    if (this.latestTerminalAssistant) {
      this.complete();
      return;
    }
    if (snapshotMessageRole(this.decoder.snapshot()) !== "tool") {
      this.complete();
      return;
    }
    this.topicStream = null;
    this.decoder = new ChatGptWebDeltaV1Decoder();
    this.completeFromRenderedAssistant();
  }

  ingestFrame(frameText) {
    if (!this.topicStream || this.settled) return;
    try {
      const frame = this.topicStream.ingestFrame(frameText);
      for (const encodedItem of frame.encodedItems) {
        if (!this.decoder.ingest(encodedItem).changed) continue;
        this.latestTerminalAssistant =
          maybeTerminalResult(this.decoder.snapshot(), this.conversationId, this.turnExchangeId) ??
          this.latestTerminalAssistant;
      }
      if (frame.done) this.finishFrame();
    } catch (error) {
      this.fail(turnError(error, "ChatGPT Web stream decoding failed"));
    }
  }

  handleBootstrap(sseText) {
    if (this.settled) return;
    if (this.topicStream) {
      this.fail(new Error("ChatGPT Web browser turn received more than one handoff"));
      return;
    }
    try {
      const handoff = parseChatGptWebConversationHandoff(sseText);
      if (this.conversationId && handoff.conversationId !== this.conversationId) {
        this.fail(new Error("ChatGPT Web browser turn changed conversation during handoff"));
        return;
      }
      this.conversationId = handoff.conversationId;
      this.turnExchangeId = handoff.turnExchangeId;
      this.decoder = new ChatGptWebDeltaV1Decoder();
      this.latestTerminalAssistant = null;
      this.topicStream = new ChatGptWebTopicStream(handoff.topicId);
      for (const frame of this.bufferedFrames.splice(0)) this.ingestFrame(frame);
      this.bufferedFrameBytes = 0;
    } catch (error) {
      this.fail(turnError(error, "ChatGPT Web handoff parsing failed"));
    }
  }

  handleWebSocketFrame(frameText) {
    if (this.settled) return;
    if (this.topicStream) {
      this.ingestFrame(frameText);
      return;
    }
    this.bufferedFrameBytes += Buffer.byteLength(frameText);
    if (
      this.bufferedFrames.length >= MAX_BUFFERED_FRAMES ||
      this.bufferedFrameBytes > MAX_BUFFERED_FRAME_BYTES
    ) {
      this.fail(new Error("ChatGPT Web browser turn exceeded the pre-handoff frame buffer"));
      return;
    }
    this.bufferedFrames.push(frameText);
  }

  handlers() {
    return {
      onBootstrap: (sseText) => this.handleBootstrap(sseText),
      onWebSocketFrame: (frameText) => this.handleWebSocketFrame(frameText),
      onError: () => this.fail(new Error("ChatGPT Web first-party browser session failed")),
    };
  }

  submitPrompt() {
    void this.session
      .submitPrompt({
        prompt: this.prompt,
        attachments: this.attachments,
        signal: this.turnController.signal,
      })
      .then((directResponse) => {
        if (!isString(directResponse) || this.settled) return;
        this.settled = true;
        this.resolveResult(parseChatGptWebDirectConversation(directResponse));
      })
      .catch((error) => {
        this.fail(turnError(error, "ChatGPT Web prompt submission failed"));
      });
  }

  async run(timeoutMs, signal) {
    let cleanup = null;
    const timeout = setTimeout(
      () => this.fail(new Error("ChatGPT Web browser turn timed out")),
      timeoutMs
    );
    timeout.unref?.();
    const abort = () => this.fail(new Error("ChatGPT Web browser turn aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      cleanup = await this.session.start(this.handlers());
      if (!this.settled) this.submitPrompt();
      return await this.resultPromise;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      await cleanup?.();
    }
  }
}

/** Run one turn while the first-party browser remains the sole challenge and auth owner. */
export async function runChatGptWebBrowserTurn(session, request) {
  if (request.signal?.aborted) throw new Error("ChatGPT Web browser turn aborted");
  const prompt = requirePrompt(request.prompt);
  requireFirstPartyUrl(session.url());
  const timeoutMs = request.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("ChatGPT Web browser turn requires a positive timeout");
  }
  const runner = new ChatGptWebBrowserTurnRunner(session, prompt, request.attachments ?? []);
  return runner.run(timeoutMs, request.signal);
}

/**
 * Playwright binding for a logged-in ChatGPT page.
 *
 * ChatGPT's own loaded module performs auth and Sentinel inside the page. The hot path never
 * touches the composer, model picker, attachment input, cookies, or bearer tokens.
 */
export class PlaywrightChatGptWebBrowserSession {
  page;
  pageUrl;
  selection;
  closePageOnCleanup;
  executePageRequest;
  constructor(page, options = {}) {
    this.page = page;
    if (isString(options)) {
      this.pageUrl = options;
      this.selection = undefined;
      this.closePageOnCleanup = false;
      this.executePageRequest = executeChatGptWebFirstPartyTurn;
    } else {
      this.pageUrl = options.pageUrl ?? "https://chatgpt.com/?temporary-chat=true";
      this.selection = options.selection;
      this.closePageOnCleanup = options.closePageOnCleanup === true;
      this.executePageRequest = options.executePageRequest ?? executeChatGptWebFirstPartyTurn;
    }
  }

  url() {
    return this.pageUrl;
  }

  async start(handlers) {
    void handlers;
    requireFirstPartyUrl(this.pageUrl);
    const cleanup = async () => {
      if (this.closePageOnCleanup) await this.page.close().catch(() => {});
    };
    try {
      let currentIsFirstParty = false;
      try {
        currentIsFirstParty = new URL(this.page.url()).origin === CHATGPT_WEB_ORIGIN;
      } catch {
        currentIsFirstParty = false;
      }
      if (!currentIsFirstParty) {
        await this.page.goto(this.pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      }
      requireFirstPartyUrl(this.page.url());
      return cleanup;
    } catch (error) {
      await cleanup();
      throw error;
    }
  }

  async submitPrompt(request) {
    if (!this.selection) throw new Error("ChatGPT Web direct request requires a model selection");
    requireFirstPartyUrl(this.page.url());
    return this.executePageRequest(
      this.page,
      {
        prompt: requirePrompt(request.prompt),
        attachments: request.attachments,
        selection: this.selection,
      },
      { signal: request.signal }
    );
  }
}
