// Wire-format builders for streamed and single-shot completions in the four
// dialects the gateway speaks: OpenAI chat, Anthropic Messages, OpenAI
// Responses and Gemini. Each stream builder returns an array of SSE frames.

import { estimateTokens, randomId, tokenize } from "./playgroundReplies.js";

const data = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const named = (event, payload) => `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
const now = () => Math.floor(Date.now() / 1000);

function usageFor(prompt, text) {
  const input = estimateTokens(prompt) + 12;
  const output = estimateTokens(text);
  return { input, output, total: input + output };
}

// ---- OpenAI chat completions ------------------------------------------------

export function openaiChatStream({ model, prompt, text }) {
  const id = randomId("chatcmpl-");
  const created = now();
  const base = { id, object: "chat.completion.chunk", created, model };
  const usage = usageFor(prompt, text);
  return [
    data({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }),
    ...tokenize(text).map((token) => data({ ...base, choices: [{ index: 0, delta: { content: token }, finish_reason: null }] })),
    data({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    data({ ...base, choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total } }),
    "data: [DONE]\n\n",
  ];
}

export function openaiChatCompletion({ model, prompt, text }) {
  const usage = usageFor(prompt, text);
  return {
    id: randomId("chatcmpl-"),
    object: "chat.completion",
    created: now(),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total },
  };
}

// ---- Anthropic Messages -----------------------------------------------------

export function claudeMessage({ model, prompt, text }) {
  const usage = usageFor(prompt, text);
  return {
    id: randomId("msg_"),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  };
}

export function claudeStream({ model, prompt, text }) {
  const message = claudeMessage({ model, prompt, text });
  return [
    named("message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null, usage: { input_tokens: message.usage.input_tokens, output_tokens: 1 } } }),
    named("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    named("ping", { type: "ping" }),
    ...tokenize(text).map((token) => named("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: token } })),
    named("content_block_stop", { type: "content_block_stop", index: 0 }),
    named("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } }),
    named("message_stop", { type: "message_stop" }),
  ];
}

// ---- OpenAI Responses -------------------------------------------------------

export function responsesObject({ model, prompt, text, status = "completed" }) {
  const usage = usageFor(prompt, text);
  const done = status === "completed";
  return {
    id: randomId("resp_"),
    object: "response",
    created_at: now(),
    status,
    model,
    output: done ? [{ id: randomId("msg_"), type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] : [],
    output_text: done ? text : "",
    usage: done ? { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.total } : null,
  };
}

export function responsesStream({ model, prompt, text }) {
  const final = responsesObject({ model, prompt, text });
  const pending = { ...final, status: "in_progress", output: [], output_text: "", usage: null };
  const item = final.output[0];
  let seq = 0;
  const ev = (type, payload) => named(type, { type, sequence_number: seq++, ...payload });
  return [
    ev("response.created", { response: pending }),
    ev("response.in_progress", { response: pending }),
    ev("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", content: [] } }),
    ev("response.content_part.added", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }),
    ...tokenize(text).map((delta) => ev("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta })),
    ev("response.output_text.done", { item_id: item.id, output_index: 0, content_index: 0, text }),
    ev("response.content_part.done", { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }),
    ev("response.output_item.done", { output_index: 0, item }),
    ev("response.completed", { response: final }),
  ];
}

// ---- Gemini -----------------------------------------------------------------

export function geminiResponse({ model, prompt, text }) {
  const usage = usageFor(prompt, text);
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: usage.input, candidatesTokenCount: usage.output, totalTokenCount: usage.total },
    modelVersion: model,
  };
}

export function geminiStream({ model, prompt, text, wrap = false }) {
  const tokens = tokenize(text);
  const frames = tokens.map((token, index) => {
    const last = index === tokens.length - 1;
    const chunk = last ? geminiResponse({ model, prompt, text: token }) : { candidates: [{ content: { role: "model", parts: [{ text: token }] }, index: 0 }], modelVersion: model };
    return data(wrap ? { response: chunk } : chunk);
  });
  return frames;
}

/** Stream frames for a provider wire format (see open-sse/translator/formats.js). */
export function streamForFormat(format, args) {
  if (format === "claude") return claudeStream(args);
  if (format === "openai-responses" || format === "codex") return responsesStream(args);
  if (format === "gemini") return geminiStream(args);
  if (format === "gemini-cli" || format === "antigravity") return geminiStream({ ...args, wrap: true });
  return openaiChatStream(args);
}
