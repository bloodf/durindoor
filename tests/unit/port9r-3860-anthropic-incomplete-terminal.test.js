import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = [];
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(async (detail) => { rows.push(detail); }),
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

import "../translator/registerAll.js";
const { handleStreamingResponse, buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { createStreamController } = await import("../../open-sse/utils/streamHandler.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const encoder = new TextEncoder();
const upstream = (frames) => new Response(new ReadableStream({
  start(controller) {
    for (const frame of frames) controller.enqueue(encoder.encode(frame));
    controller.close();
  },
}), { headers: { "content-type": "text/event-stream" } });

const chat = (delta, finishReason = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-fixture123", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
const claude = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

async function relay(frames, targetFormat, provider) {
  const onRequestSuccess = vi.fn(async () => {});
  const body = { messages: [{ role: "user", content: "hi" }], stream: true };
  const callbacks = buildOnStreamComplete({
    provider, model: "fixture", connectionId: "c1", requestStartTime: Date.now(), body, stream: true,
    onRequestSuccess, terminalProvenance: "upstream",
  });
  const result = await handleStreamingResponse({
    providerResponse: upstream(frames), provider, model: "fixture", sourceFormat: FORMATS.CLAUDE, targetFormat,
    body, stream: true, requestStartTime: Date.now(), connectionId: "c1",
    streamController: createStreamController({ provider, model: "fixture" }), ...callbacks,
  });
  const text = await result.response.text();
  await vi.waitFor(() => expect(rows.length).toBeGreaterThan(1));
  const events = [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1].trim());
  return { text, events, onRequestSuccess, row: rows.at(-1) };
}
const fromOpenAI = (frames) => relay(frames, FORMATS.OPENAI, "openai");

describe("9router #3860: a cut stream never reaches a Claude client as a finished message", () => {
  beforeEach(() => { rows.length = 0; });

  it("ends a translated stream with one retryable error and records the turn as an error", async () => {
    const { text, events, onRequestSuccess, row } = await fromOpenAI([chat({ role: "assistant", content: "partial" })]);

    expect(text).toContain("partial");
    expect(events).not.toContain("message_stop");
    expect(text).not.toContain("end_turn");
    expect(events.filter((event) => event === "error")).toHaveLength(1);
    expect(events.at(-1)).toBe("error");
    expect(text).toContain("overloaded_error");
    expect(row.status).toBe("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("does not hand out a half-received tool call", async () => {
    const { text, events } = await fromOpenAI([
      chat({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run", arguments: "{\"command\":" } }] }),
    ]);

    expect(text).not.toContain("\"stop_reason\":\"tool_use\"");
    expect(events).not.toContain("message_stop");
    expect(events.at(-1)).toBe("error");
  });

  it("rejects a sentinel after an unfinished tool call and records an error", async () => {
    const { text, events, row, onRequestSuccess } = await fromOpenAI([
      chat({ role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run", arguments: '{"command":' } }] }),
      "data: [DONE]\n\n",
    ]);

    expect(text).not.toContain("input_json_delta");
    expect(text).not.toContain('"stop_reason":"tool_use"');
    expect(events).not.toContain("message_stop");
    expect(events.at(-1)).toBe("error");
    expect(row.status).toBe("error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects a sentinel after tool arguments arrive before the ID and name", async () => {
    const { events, row } = await fromOpenAI([
      chat({ role: "assistant", tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] }),
      "data: [DONE]\n\n",
    ]);

    expect(events).not.toContain("message_stop");
    expect(events.at(-1)).toBe("error");
    expect(row.status).toBe("error");
  });

  it.each([
    ["a finish reason without [DONE]", [chat({ role: "assistant", content: "done" }), chat({}, "stop")]],
    ["[DONE] without a finish reason", [chat({ role: "assistant", content: "done" }), "data: [DONE]\n\n"]],
    ["an unterminated final [DONE]", [chat({ role: "assistant", content: "done" }), "data: [DONE]"]],
    ["an unterminated final finish chunk", [chat({ role: "assistant", content: "done" }), chat({}, "stop").trimEnd()]],
  ])("keeps a normal ending for %s", async (_label, frames) => {
    const { events, row } = await fromOpenAI(frames);

    expect(events.at(-1)).toBe("message_stop");
    expect(events).not.toContain("error");
    expect(row.status).toBe("success");
  });

  it("sends a native Claude stream cut before message_stop an in-band error", async () => {
    const { events, text, onRequestSuccess } = await relay([
      claude({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "fixture", content: [], usage: { input_tokens: 1, output_tokens: 0 } } }),
      claude({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      claude({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }),
    ], FORMATS.CLAUDE, "claude");

    expect(events).not.toContain("message_stop");
    expect(events.at(-1)).toBe("error");
    expect(text).toContain("overloaded_error");
    expect(text).not.toContain("[DONE]");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});
