import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

/**
 * A turn that only calls tools accumulates no assistant text, so the request log used
 * to report it as "[Empty streaming response]" — indistinguishable from an upstream
 * that returned nothing. `onStreamComplete` now also receives `toolCallNames`, the
 * distinct set of names seen across the stream, so callers can label the log entry.
 */
function body(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks, buildStream) {
  let captured = null;
  const transform = buildStream((contentObj) => { captured = contentObj; });
  const reader = body(chunks).pipeThrough(transform).getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  return captured;
}

const line = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const toolDelta = (call) => line({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: null }] });
const FINISH = line({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });

const passthrough = (onStreamComplete) =>
  createPassthroughStreamWithLogger("deepseek", null, null, "m", null, { messages: [] }, onStreamComplete, null, FORMATS.OPENAI);
const translate = (onStreamComplete) =>
  createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "openai", null, null, "m", null, { messages: [] }, onStreamComplete);

describe("tool call names reach onStreamComplete", () => {
  it("passthrough: captures a single OpenAI-shaped tool call name", async () => {
    const captured = await collect([
      toolDelta({ index: 0, id: "call_1", function: { name: "get_weather", arguments: '{"city":' } }),
      toolDelta({ index: 0, function: { arguments: '"Paris"}' } }),
      FINISH,
    ], passthrough);
    expect(captured.hadToolCalls).toBe(true);
    expect(captured.toolCallNames).toEqual(["get_weather"]);
    expect(captured.content).toBe("");
  });

  it("passthrough: dedupes and keeps parallel call names apart", async () => {
    const captured = await collect([
      toolDelta({ index: 0, id: "call_a", function: { name: "read", arguments: "{}" } }),
      toolDelta({ index: 1, id: "call_b", function: { name: "write", arguments: "{}" } }),
      toolDelta({ index: 0, function: { arguments: "" } }),
      FINISH,
    ], passthrough);
    expect(captured.toolCallNames.sort()).toEqual(["read", "write"]);
  });

  it("translate: captures the tool call name through format conversion", async () => {
    const captured = await collect([
      toolDelta({ index: 0, id: "call_1", function: { name: "get_weather", arguments: "{}" } }),
      FINISH,
    ], translate);
    expect(captured.toolCallNames).toEqual(["get_weather"]);
  });

  it("reports no tool call names for a plain text reply", async () => {
    const captured = await collect([
      line({ choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }] }),
      line({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    ], passthrough);
    expect(captured.toolCallNames).toBeUndefined();
    expect(captured.content).toBe("hi");
  });

  it("captures a Claude-shaped tool_use header name arriving as an OpenAI target", async () => {
    const captured = await collect([
      "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"tu_1\",\"name\":\"search\"}}\n\n",
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n",
      "data: {\"type\":\"message_stop\"}\n\n",
    ], (cb) => createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "claude", null, null, "m", null, { messages: [] }, cb));
    expect(captured.toolCallNames).toEqual(["search"]);
  });
});
