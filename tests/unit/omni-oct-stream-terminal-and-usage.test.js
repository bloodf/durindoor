import { describe, expect, it } from "vitest";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const encoder = new TextEncoder();
const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const source = (chunks) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  },
});

describe("October stream terminal and usage reconciliation", () => {
  it("derives absent Gemini totals and keeps a reported total", () => {
    expect(toOpenAIUsage({ promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 5 }, "gemini"))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 25, total_tokens: 35 });
    expect(toOpenAIUsage({ promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 14 }, "gemini").total_tokens).toBe(14);
  });

  it("drains an unterminated Responses finish with usage exactly once", async () => {
    const content = frame({ choices: [{ index: 0, delta: { content: "hello" } }] });
    const finish = frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }).trimEnd();
    const text = await new Response(source([content, finish]).pipeThrough(createResponsesApiTransformStream())).text();
    const events = text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    const completed = events.filter((event) => event.type === "response.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].response.usage).toMatchObject({ input_tokens: 3, output_tokens: 2, total_tokens: 5 });
    expect(text.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("ends Ollama output once and ignores subsequent same-chunk and tail frames", async () => {
    const tool = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call", function: { name: "lookup", arguments: "{" } }] }, finish_reason: "tool_calls" }] };
    const late = { choices: [{ index: 0, delta: { content: "late" }, finish_reason: "stop" }] };
    const upstream = new Response(source([frame(tool) + frame(late), frame(late).trimEnd()]));
    const lines = (await transformToOllama(upstream, "fixture").text()).trim().split("\n").map(JSON.parse);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ done: true, message: { tool_calls: [{ function: { name: "lookup", arguments: {} } }] } });
  });

  it("does not emit success or further output after an Ollama error", async () => {
    const upstream = new Response(source([frame({ error: { message: "failed" } }) + frame({ choices: [{ delta: { content: "late" } }] })]));
    expect((await transformToOllama(upstream, "fixture").text()).trim().split("\n").map(JSON.parse)).toEqual([{ error: "failed" }]);
  });
});
