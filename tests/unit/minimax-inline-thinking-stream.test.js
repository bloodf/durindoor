import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const encoder = new TextEncoder();

async function runPassthrough({ provider, model, frames }) {
  const sse = `${frames.map(frame => `data: ${JSON.stringify(frame)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
  const transformed = input.pipeThrough(createSSEStream({
    mode: "passthrough",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    provider,
    model,
    body: { model, messages: [{ role: "user", content: "hello" }] },
  }));
  return new Response(transformed).text();
}

function dataObjects(sse) {
  return sse.split("\n")
    .filter(line => line.startsWith("data:") && line.slice(5).trim() !== "[DONE]")
    .map(line => JSON.parse(line.slice(5).trim()));
}

function collectChoiceDeltas(objects, index) {
  const deltas = objects
    .flatMap(object => object.choices || [])
    .filter(choice => choice.index === index)
    .map(choice => choice.delta || {});
  return {
    content: deltas.map(delta => delta.content || "").join(""),
    reasoning: deltas.map(delta => delta.reasoning_content || "").join(""),
  };
}

describe("MiniMax passthrough streaming inline thinking", () => {
  it("keeps split tag state isolated for every choice", async () => {
    const frames = [
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { role: "assistant", content: "<thi" }, finish_reason: null },
        { index: 1, delta: { role: "assistant", content: "<think>one" }, finish_reason: null },
      ] },
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 1, delta: { content: " reason</think>one answer" }, finish_reason: null },
        { index: 0, delta: { content: "nk>zero reason</thi" }, finish_reason: null },
      ] },
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "nk>zero answer" }, finish_reason: null },
      ] },
      { id: "chunk-multi", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
        { index: 1, delta: {}, finish_reason: "stop" },
      ], usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 } },
    ];
    const output = await runPassthrough({ provider: "minimax-cn", model: "MiniMax-M3", frames });
    const objects = dataObjects(output);

    expect(collectChoiceDeltas(objects, 0)).toEqual({ content: "zero answer", reasoning: "zero reason" });
    expect(collectChoiceDeltas(objects, 1)).toEqual({ content: "one answer", reasoning: "one reason" });
    expect(output).not.toContain("<think>");
  });

  it("leaves literal tags untouched for an unrelated provider", async () => {
    const frames = [
      { id: "chunk-literal", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "<think>visible</think>answer" }, finish_reason: null },
      ] },
      { id: "chunk-literal", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "galadriel", model: "MiniMax-M3", frames });
    const choice = collectChoiceDeltas(dataObjects(output), 0);
    expect(choice).toEqual({ content: "<think>visible</think>answer", reasoning: "" });
  });

  it("restores an unclosed segment as visible content before terminal", async () => {
    const frames = [
      { id: "chunk-open", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: { content: "before<think>unfinished" }, finish_reason: null },
      ] },
      { id: "chunk-open", object: "chat.completion.chunk", created: 1, model: "MiniMax-M3", choices: [
        { index: 0, delta: {}, finish_reason: "stop" },
      ] },
    ];
    const output = await runPassthrough({ provider: "minimax", model: "MiniMax-M3", frames });
    expect(collectChoiceDeltas(dataObjects(output), 0)).toEqual({
      content: "before<think>unfinished",
      reasoning: "",
    });
  });
});
