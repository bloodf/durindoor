import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const chunks = [
  { id: "original", choices: [{ index: 0, delta: { reasoning_content: "thinking" } }] },
  { id: "original", choices: [{ index: 0, delta: { content: "Hello " } }] },
  { id: "changed", choices: [{ index: 0, delta: { content: "world" }, finish_reason: "stop" }] },
];

function checkIdentity(events) {
  const added = events.find((e) => e.type === "response.output_item.added" && e.item.type === "message");
  const deltas = events.filter((e) => e.type === "response.output_text.delta");
  const done = events.find((e) => e.type === "response.output_text.done");
  expect(added.item.id).toBeTruthy();
  expect(added.output_index).toBe(1);
  expect(deltas.map((e) => e.delta).join("")).toBe("Hello world");
  for (const delta of deltas) expect(delta).toMatchObject({ item_id: added.item.id, output_index: 1, content_index: 0 });
  expect(done).toMatchObject({ item_id: added.item.id, text: "Hello world" });
}

describe("November OmniRoute response and reasoning contracts", () => {
  it("keeps generated Responses delta identity through reasoning and terminal events", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    checkIdentity(chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(structuredClone(chunk), state)).map((e) => e.data));
  });

  it("keeps the same identity in the Responses transform stream", async () => {
    const source = new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
      controller.close();
    } });
    const text = await new Response(source.pipeThrough(createResponsesApiTransformStream())).text();
    checkIdentity(text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6))));
  });

  it("passes native Responses events through without inventing an item ID", () => {
    const event = { type: "response.output_text.delta", item_id: "provider-item", output_index: 2, content_index: 0, delta: "cached text" };
    expect(translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, event, initState(FORMATS.OPENAI_RESPONSES))).toEqual([event]);
  });

  it("adds the DeepSeek placeholder to translated history while preserving real reasoning and content", () => {
    const messages = [
      { role: "user", content: "cached prompt" },
      { role: "assistant", content: null, tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call1", content: "result" },
      { role: "assistant", content: "answer", reasoning_content: "real reasoning" },
    ];
    const result = new DefaultExecutor("deepseek").transformRequest("deepseek-reasoner", { messages }, true, { runtimeTransport: { format: FORMATS.OPENAI } });
    expect(result.messages[1]).toEqual({ ...messages[1], reasoning_content: " " });
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages[2]).toEqual(messages[2]);
    expect(result.messages[3]).toEqual(messages[3]);
  });

  it("does not add the OpenAI field to DeepSeek Claude transport", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "answer" }] }];
    const result = new DefaultExecutor("deepseek").transformRequest("deepseek-reasoner", { messages }, true, { runtimeTransport: { format: FORMATS.CLAUDE } });
    expect(result.messages).toEqual(messages);
  });
});
