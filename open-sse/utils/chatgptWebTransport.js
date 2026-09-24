import { parseChatGptWebEncodedItem } from "./chatgptWebDeltaV1.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
function isRecord(value) {
  return isObject(value) && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value, name) {
  if (!isString(value) || !value.trim()) {
    throw new Error(`ChatGPT Web requires a non-empty ${name}`);
  }
  return value;
}

/**
 * One-turn storage for browser-produced Sentinel and conduit artifacts.
 *
 * These values are dynamic challenge results. Consuming them invalidates the state so callers
 * cannot accidentally replay one turn's tokens on a later request.
 */
export class ChatGptWebHandshakeState {
  sentinel = null;
  conduitToken = null;
  setSentinel(artifacts) {
    const chatRequirementsToken = requireNonEmptyString(
      artifacts.chatRequirementsToken,
      "chatRequirementsToken"
    );
    const proofToken = requireNonEmptyString(artifacts.proofToken, "proofToken");
    const turnstileToken = requireNonEmptyString(artifacts.turnstileToken, "turnstileToken");
    if (!Number.isFinite(artifacts.expiresAtMs) || artifacts.expiresAtMs <= 0) {
      throw new Error("ChatGPT Web requires a valid Sentinel expiration time");
    }
    this.sentinel = {
      chatRequirementsToken,
      proofToken,
      turnstileToken,
      expiresAtMs: artifacts.expiresAtMs,
    };
  }

  setConduit(token) {
    this.conduitToken = requireNonEmptyString(token, "conduitToken");
  }

  clear() {
    this.sentinel = null;
    this.conduitToken = null;
  }

  consumeConversationHeaders(turnTraceId, nowMs = Date.now()) {
    const traceId = requireNonEmptyString(turnTraceId, "turnTraceId");
    if (!this.sentinel || !this.conduitToken) {
      throw new Error("ChatGPT Web handshake is incomplete");
    }
    if (nowMs >= this.sentinel.expiresAtMs) {
      this.clear();
      throw new Error("ChatGPT Web Sentinel artifacts expired before dispatch");
    }
    const headers = {
      "openai-sentinel-chat-requirements-token": this.sentinel.chatRequirementsToken,
      "openai-sentinel-proof-token": this.sentinel.proofToken,
      "openai-sentinel-turnstile-token": this.sentinel.turnstileToken,
      "x-conduit-token": this.conduitToken,
      "x-oai-turn-trace-id": traceId,
    };
    this.clear();
    return headers;
  }
}

function optionTopic(options, type) {
  if (!Array.isArray(options)) return null;
  for (const option of options) {
    if (!isRecord(option) || option.type !== type) continue;
    return requireNonEmptyString(option.topic_id, `${type} topic_id`);
  }
  return null;
}

function consumeConversationHandoffEvent(state, event) {
  if (event.type === "resume_conversation_token") {
    state.resumeToken = requireNonEmptyString(event.token, "resume conversation token");
    state.resumeConversationId = requireNonEmptyString(
      event.conversation_id,
      "resume conversation_id"
    );
    return;
  }
  if (event.type !== "stream_handoff") return;
  state.conversationId = requireNonEmptyString(event.conversation_id, "conversation_id");
  state.turnExchangeId = requireNonEmptyString(event.turn_exchange_id, "turn_exchange_id");
  state.resumeTopicId = optionTopic(event.options, "resume_sse_endpoint");
  state.websocketTopicId = optionTopic(event.options, "subscribe_ws_topic");
}

function finalizeConversationHandoff(state) {
  if (
    state.resumeTopicId &&
    state.websocketTopicId &&
    state.resumeTopicId !== state.websocketTopicId
  ) {
    throw new Error("ChatGPT Web handoff topic mismatch");
  }
  if (
    state.resumeConversationId &&
    state.conversationId &&
    state.resumeConversationId !== state.conversationId
  ) {
    throw new Error("ChatGPT Web handoff conversation mismatch");
  }
  if (
    !state.resumeToken ||
    !state.conversationId ||
    !state.turnExchangeId ||
    !state.resumeTopicId ||
    !state.websocketTopicId
  ) {
    throw new Error("ChatGPT Web handoff is incomplete");
  }
  return {
    conversationId: state.conversationId,
    turnExchangeId: state.turnExchangeId,
    topicId: state.websocketTopicId,
    resumeToken: state.resumeToken,
  };
}

/** Parse the short bootstrap SSE response that hands a turn over to the shared WebSocket. */
export function parseChatGptWebConversationHandoff(sseText) {
  const state = {
    resumeToken: null,
    resumeConversationId: null,
    conversationId: null,
    turnExchangeId: null,
    resumeTopicId: null,
    websocketTopicId: null,
  };
  for (const event of parseChatGptWebEncodedItem(sseText)) {
    if (isRecord(event.json)) consumeConversationHandoffEvent(state, event.json);
  }
  return finalizeConversationHandoff(state);
}

/** Build the array-framed subscription command observed on the first-party WebSocket. */
export function buildChatGptWebSubscribeCommand(id, topicId, offset) {
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new Error("ChatGPT Web subscription id must be a non-negative safe integer");
  }
  const topic = requireNonEmptyString(topicId, "subscription topicId");
  const normalizedOffset =
    offset === undefined ? undefined : requireNonEmptyString(offset, "offset");
  const command = { type: "subscribe", topic_id: topic };
  if (normalizedOffset) command.offset = normalizedOffset;
  return JSON.stringify([{ id, command }]);
}

/** Extract one handoff topic from the shared multiplexed ChatGPT WebSocket. */
export class ChatGptWebTopicStream {
  topicId;
  seenStreamItems = new Set();
  streamDone = false;
  constructor(topicId) {
    this.topicId = topicId;
    requireNonEmptyString(topicId, "topicId");
  }

  ingestFrame(frameText) {
    let frame;
    try {
      frame = JSON.parse(frameText);
    } catch {
      throw new Error("ChatGPT WebSocket frame was not valid JSON");
    }
    if (!Array.isArray(frame)) throw new Error("ChatGPT WebSocket frame must be an array");
    const encodedItems = [];
    const lifecycleTypes = [];
    for (const item of frame) this.consumeItem(item, encodedItems, lifecycleTypes);
    return { encodedItems, lifecycleTypes, done: this.streamDone };
  }

  consumeItem(item, encodedItems, lifecycleTypes) {
    if (!isRecord(item)) return;
    if (item.type === "reply") {
      this.consumeReply(item.reply, encodedItems, lifecycleTypes);
      return;
    }
    if (item.type !== "message" || item.topic_id !== this.topicId) return;
    this.consumeMessage(item.payload, encodedItems, lifecycleTypes);
  }

  consumeReply(value, encodedItems, lifecycleTypes) {
    if (!isRecord(value) || !Array.isArray(value.catchups)) return;
    for (const catchup of value.catchups) {
      this.consumeItem(catchup, encodedItems, lifecycleTypes);
    }
  }

  consumeMessage(envelope, encodedItems, lifecycleTypes) {
    if (!isRecord(envelope) || !isString(envelope.type)) return;
    if (envelope.type !== "conversation-turn-stream") {
      lifecycleTypes.push(envelope.type);
      return;
    }
    this.consumeTurnPayload(envelope.payload, encodedItems);
  }

  consumeTurnPayload(payload, encodedItems) {
    if (!isRecord(payload) || !isString(payload.type)) return;
    if (payload.type === "done") {
      this.streamDone = true;
      return;
    }
    if (payload.type !== "stream-item") return;
    const streamItemId = requireNonEmptyString(payload.stream_item_id, "stream_item_id");
    if (this.seenStreamItems.has(streamItemId)) return;
    const encodedItem = requireNonEmptyString(payload.encoded_item, "encoded_item");
    this.seenStreamItems.add(streamItemId);
    encodedItems.push(encodedItem);
  }
}
