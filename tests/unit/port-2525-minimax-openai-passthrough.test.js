// Integration regression tests for upstream decolua/9router PR #2525
// (head 72385571c6): OpenAI-transport passthrough of MiniMax streams —
// leaked thinking markers are peeled into reasoning_content and reasoning
// fields are stripped from the client stream when the transport declares
// omitStreamReasoning. Uses MiniMax-M2.7 (no quirks.inlineThinking) so the
// ported sanitizer owns the stream; M3 is covered by the dev-native
// inline-thinking extractor (minimax-inline-thinking-stream.test.js).

import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();

async function runPassthrough({ provider, model, frames }) {
  const sse = `${frames.map((frame) => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
  const transformed = input.pipeThrough(createPassthroughStreamWithLogger(
    provider,
    null,
    null,
    model,
    null,
    { model, messages: [{ role: "user", content: "hello" }] },
    null,
    null,
    FORMATS.OPENAI,
  ));
  return new Response(transformed).text();
}

function dataObjects(sse) {
  return sse.split("\n")
    .filter((line) => line.startsWith("data:") && line.slice(5).trim() !== "[DONE]")
    .map((line) => JSON.parse(line.slice(5).trim()));
}

function collectChoiceDeltas(objects, index) {
  const deltas = objects
    .flatMap((object) => object.choices || [])
    .filter((choice) => choice.index === index)
    .map((choice) => choice.delta || {});
  return {
    content: deltas.map((delta) => delta.content || "").join(""),
    reasoning: deltas.map((delta) => delta.reasoning_content || "").join(""),
    hasReasoningFields: deltas.some(
      (delta) => delta.reasoning_content !== undefined
        || delta.reasoning !== undefined
        || delta.reasoning_details !== undefined,
    ),
  };
}

describe("port-2525 MiniMax openai passthrough (MiniMax-M2.7)", () => {
  it("peels leaked <think> markers from content and omits reasoning fields from the client stream", async () => {
    const frames = [
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: { content: "<think>hidden plan</think>visible answer" }, finish_reason: null },
      ] },
      { id: "c2", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M2.7", frames });
    const objects = dataObjects(output);
    const collected = collectChoiceDeltas(objects, 0);

    expect(collected.content).toBe("visible answer");
    // omitStreamReasoning: reasoning was peeled and counted but NOT forwarded.
    expect(collected.hasReasoningFields).toBe(false);
    expect(output).not.toContain("<think>");
    expect(output).not.toContain("reasoning_content");
  });

  it("strips native reasoning_content / reasoning_details from passthrough chunks", async () => {
    const frames = [
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: { content: "answer", reasoning_content: "secret", reasoning_details: [{ text: "x" }] }, finish_reason: null },
      ] },
      { id: "c2", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
    ];
    const output = await runPassthrough({ provider: "minimax-cn", model: "MiniMax-M2.7", frames });
    const collected = collectChoiceDeltas(dataObjects(output), 0);

    expect(collected.content).toBe("answer");
    expect(collected.hasReasoningFields).toBe(false);
  });

  it("holds partial thinking markers split across chunk boundaries", async () => {
    const frames = [
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: { content: "<mm:think>why</mm:thi" }, finish_reason: null },
      ] },
      { id: "c2", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: { content: "nk>ok" }, finish_reason: null },
      ] },
      { id: "c3", object: "chat.completion.chunk", created: 1, model: "MiniMax-M2.7", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M2.7", frames });
    const collected = collectChoiceDeltas(dataObjects(output), 0);

    expect(collected.content).toBe("ok");
    expect(output).not.toContain("<mm:think>");
    expect(output).not.toContain("</mm:thi");
  });

  it("leaves unrelated providers untouched", async () => {
    const frames = [
      { id: "c1", object: "chat.completion.chunk", created: 1, model: "gpt-x", choices: [
        { index: 0, delta: { content: "plain", reasoning_content: "kept" }, finish_reason: null },
      ] },
      { id: "c2", object: "chat.completion.chunk", created: 1, model: "gpt-x", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
    ];
    const output = await runPassthrough({ provider: "openai", model: "gpt-x", frames });
    const collected = collectChoiceDeltas(dataObjects(output), 0);

    expect(collected.content).toBe("plain");
    expect(collected.reasoning).toBe("kept");
  });
});
