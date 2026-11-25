import { describe, expect, it } from "vitest";

import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const encoder = new TextEncoder();
const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const contentDelta = (content) => event({ choices: [{ index: 0, delta: { content } }] });
const stop = (usage) =>
  event({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...(usage ? { usage } : {}) });

async function runResponsesTransform(chunks) {
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  const reader = source.pipeThrough(createResponsesApiTransformStream()).getReader();
  const decoder = new TextDecoder();
  let output = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();

  return output
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}

const textOf = (events) =>
  events
    .filter(({ type }) => type === "response.output_text.delta")
    .map(({ delta }) => delta)
    .join("");

const completedOf = (events) => events.find(({ type }) => type === "response.completed")?.response;

describe("Responses API transform stream", () => {
  it("preserves a multi-byte character split across transport chunks", async () => {
    const bytes = encoder.encode(contentDelta("xin chào 世界"));
    const cut = bytes.indexOf(0xe4);
    const events = await runResponsesTransform([bytes.slice(0, cut + 1), bytes.slice(cut + 1), stop()]);

    expect(textOf(events)).toBe("xin chào 世界");
    expect(textOf(events)).not.toContain("�");
  });

  it("delivers a final event without a blank-line terminator", async () => {
    const events = await runResponsesTransform([contentDelta("hello") + contentDelta(" world").trimEnd()]);

    expect(textOf(events)).toBe("hello world");
  });

  it("keeps a well-delimited stream unchanged", async () => {
    const events = await runResponsesTransform([
      contentDelta("hello"),
      contentDelta(" world"),
      stop(),
      "data: [DONE]\n\n",
    ]);

    expect(textOf(events)).toBe("hello world");
    expect(events.filter(({ type }) => type === "response.completed")).toHaveLength(1);
    expect(completedOf(events).status).toBe("completed");
  });

  it("preserves reasoning token details in response.completed", async () => {
    const usage = {
      input_tokens: 8,
      output_tokens: 3,
      total_tokens: 11,
      output_tokens_details: { reasoning_tokens: 2 },
    };
    const events = await runResponsesTransform([contentDelta("hello"), stop(usage)]);

    expect(completedOf(events).usage).toEqual({
      input_tokens: 8,
      output_tokens: 3,
      total_tokens: 11,
      output_tokens_details: { reasoning_tokens: 2 },
    });
  });

  it("omits usage when no usage chunk arrived", async () => {
    const events = await runResponsesTransform([contentDelta("hello"), stop()]);

    expect(completedOf(events)).not.toHaveProperty("usage");
  });
});
