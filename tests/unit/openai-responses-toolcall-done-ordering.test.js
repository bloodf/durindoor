import { describe, expect, it } from "vitest";

import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

const chunk = (delta, finishReason = null) => ({
  choices: [{ index: 0, delta, finish_reason: finishReason }],
});

describe("Responses output_text.done ordering", () => {
  it("keeps text open across interleaved tool calls until finish_reason", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const beforeFinish = [
      chunk({ content: "Hello " }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] }),
      chunk({ content: "world" }),
    ].flatMap((value) => openaiToOpenAIResponsesResponse(value, state));

    expect(beforeFinish.filter(({ event }) => event === "response.output_text.done")).toHaveLength(0);

    const completed = openaiToOpenAIResponsesResponse(chunk({}, "tool_calls"), state);
    const done = completed.filter(({ event }) => event === "response.output_text.done");
    expect(done).toHaveLength(1);
    expect(done[0].data.text).toBe("Hello world");
  });

  it("keeps legacy transformer text open across interleaved tool calls", async () => {
    const stream = createResponsesApiTransformStream();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    let output = "";
    const reading = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
    })();

    for (const value of [
      chunk({ content: "Hello " }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] }),
      chunk({ content: "world" }),
      chunk({}, "tool_calls"),
    ]) {
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
    }
    await writer.close();
    await reading;

    const done = [...output.matchAll(/event: response\.output_text\.done\ndata: (.*)\n/g)]
      .map((match) => JSON.parse(match[1]));
    expect(done).toHaveLength(1);
    expect(done[0].text).toBe("Hello world");
  });
});
