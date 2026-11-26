// Wire helpers for ChatPlayground's unified chat route (OmniRoute #20375). The
// route takes one message per request and answers with AI-SDK JSON events in SSE
// framing (`text-delta`, `reasoning-delta`, `error`, `finish`, `[DONE]`),
// whatever the Accept header asks for.
import { randomUUID } from "node:crypto";
import { sanitizeErrorMessage } from "../utils/error.js";
import { createSseFrameReader } from "../utils/sseFrames.js";
import { isNumber, isObject, isString } from "../../src/shared/utils/typeChecks.js";

export const MAX_MESSAGE_CHARS = 15_000;
const TRUNCATED = "ChatPlayground stream ended before its finish event";
const FINISH_REASONS = { stop: "stop", length: "length", "content-filter": "content_filter" };

function messageText(content) {
  if (isString(content)) return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isString(part) ? part : part?.text ?? "")).filter(Boolean).join("\n");
}

// Quote transcript control lines in replayed content so they cannot become turns.
function replayText(text) {
  return text.replace(/^([\t ]*)(?=(?:user|system|assistant|tool|tool call|tool result):|Conversation history:|Reply to the last message\.)/gim, "$1> ");
}

/** Earlier turns become a transcript; tool calls and results remain labelled history. */
export function renderMessageText(messages) {
  if (!messages.length) return "";
  const lastIsUser = messages.at(-1)?.role === "user";
  if (messages.length < 2 && lastIsUser) return messageText(messages[0]?.content);
  const history = (lastIsUser ? messages.slice(0, -1) : messages).flatMap((m) => {
    const content = replayText(messageText(m?.content));
    const rows = [];
    if (content || !m?.tool_calls?.length) rows.push(`${m?.role === "tool" ? "tool result" : m?.role ?? "user"}: ${content}`);
    for (const call of m?.tool_calls ?? []) rows.push(`tool call: ${replayText(JSON.stringify(call))}`);
    return rows;
  }).join("\n");
  return `Conversation history:\n${history}\n\nReply to the last message.\n${lastIsUser ? messageText(messages.at(-1)?.content) : ""}`;
}

/** Why the unified route cannot carry these messages, or null when it can. */
export function unifiedRequestError(messages) {
  for (const [index, message] of messages.entries()) {
    const parts = Array.isArray(message?.content) ? message.content : [];
    const unsupported = parts.find((part) => !isString(part) && !isString(part?.text));
    if (unsupported) return `ChatPlayground does not support inline "${unsupported.type || "non-text"}" content`;
    if (messageText(message?.content).length > MAX_MESSAGE_CHARS) {
      return `Message at index ${index} exceeds ChatPlayground's ${MAX_MESSAGE_CHARS}-character limit`;
    }
  }
  if (renderMessageText(messages).length > MAX_MESSAGE_CHARS) {
    return `Serialized conversation exceeds ChatPlayground's ${MAX_MESSAGE_CHARS}-character per-message limit`;
  }
  return null;
}

/** The schema is strict: any other top-level key is refused upstream. */
export function buildUnifiedPayload(messages, modelSlug) {
  return { modelSlug, submissionId: randomUUID(), message: { text: renderMessageText(messages) }, noSave: true };
}

function toOpenAiUsage(raw) {
  if (!raw || !isObject(raw) || !isNumber(raw.inputTokens) && !isNumber(raw.outputTokens)) return null;
  const count = (value) => (Number.isFinite(value) ? value : 0);
  const prompt = count(raw.inputTokens);
  const completion = count(raw.outputTokens);
  return {
    prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
    completion_tokens_details: { reasoning_tokens: count(raw.reasoningTokens) },
  };
}

function parseEvent(data) {
  try {
    return JSON.parse(data);
  } catch {
    return null; // `[DONE]` and any non-JSON payload carry no event
  }
}

/**
 * Incremental reader for one reply. `push` returns the new Chat Completions
 * deltas; `result` holds the outcome once a `finish` or `error` event arrives.
 */
export function createUnifiedReplyParser() {
  const frames = createSseFrameReader();
  const result = { content: "", reasoning: "", finishReason: null, usage: null, error: null };
  const fail = (message) => { result.error = sanitizeErrorMessage(message || "ChatPlayground stream error"); };
  const apply = (event, deltas) => {
    if (event?.type === "error") return fail(event.errorText || event.message || event.error);
    if (event?.type === "finish") {
      if (event.finishReason === "error") return fail("ChatPlayground reported an error finish reason");
      result.finishReason = FINISH_REASONS[event.finishReason] || "stop";
      result.usage = toOpenAiUsage(event.messageMetadata?.usage ?? event.usage);
      return;
    }
    if (!isString(event?.delta) || !event.delta) return;
    if (event.type === "text-delta") {
      result.content += event.delta;
      deltas.push({ content: event.delta });
    } else if (event.type === "reasoning-delta") {
      result.reasoning += event.delta;
      deltas.push({ reasoning_content: event.delta });
    }
  };
  return {
    result,
    push(text, final = false) {
      const ready = frames.push(text);
      if (final) ready.push(...frames.flush());
      const deltas = [];
      for (const data of ready.flatMap((frame) => frame.dataLines)) {
        if (result.finishReason || result.error) break;
        apply(parseEvent(data), deltas);
      }
      return deltas;
    },
  };
}

/** Parse a fully buffered body. `error` is set unless a finish event arrived. */
export function parseUnifiedReply(raw) {
  const parser = createUnifiedReplyParser();
  parser.push(raw, true);
  const { result } = parser;
  return result.finishReason || result.error ? result : { ...result, error: TRUNCATED };
}

export function unifiedCompletion(reply, model) {
  const message = { role: "assistant", content: reply.content, ...(reply.reasoning && { reasoning_content: reply.reasoning }) };
  return new Response(JSON.stringify({
    id: `chatcmpl-${randomUUID().slice(0, 12)}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message, finish_reason: reply.finishReason }],
    ...(reply.usage && { usage: reply.usage }),
  }), { headers: { "Content-Type": "application/json" } });
}

/**
 * Translate the upstream events into Chat Completions SSE. An in-band error or a
 * reply without a finish event errors the stream instead of faking a stop.
 */
export function createUnifiedChatStream(upstream, model) {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parser = createUnifiedReplyParser();
  const base = { id: `chatcmpl-${randomUUID().slice(0, 12)}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const chunk = (delta, finishReason = null, extra = null) =>
    encoder.encode(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finishReason }], ...extra })}\n\n`);
  const stopReading = (reason) => reader.cancel(reason).catch(() => {});
  return new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          const deltas = parser.push(done ? decoder.decode() : decoder.decode(value, { stream: true }), done);
          for (const delta of deltas) controller.enqueue(chunk(delta));
          const { finishReason, usage, error } = parser.result;
          if (error) throw new Error(error);
          if (finishReason) {
            controller.enqueue(chunk({}, finishReason, usage && { usage }));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            stopReading();
            return;
          }
          if (done) throw new Error(TRUNCATED);
          if (deltas.length) return;
        }
      } catch (error) {
        stopReading(error);
        controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}
