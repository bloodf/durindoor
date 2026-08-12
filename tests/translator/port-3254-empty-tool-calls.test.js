import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

describe("OpenAI empty tool_calls (#3254)", () => {
  it("treats an empty tool_calls array as no calls", () => {
    const result = filterToOpenAIFormat({
      messages: [
        {
          role: "assistant",
          tool_calls: [],
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "visible" },
          ],
        },
        { role: "assistant", tool_calls: [], content: "   " },
      ],
    });

    expect(result.messages).toEqual([
      { role: "assistant", tool_calls: [], content: "visible" },
    ]);
  });

  it("preserves an assistant message with populated tool_calls", () => {
    const message = {
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: "{}" },
        },
      ],
      content: [{ type: "thinking", thinking: "keep unchanged" }],
    };

    const result = filterToOpenAIFormat({ messages: [message] });

    expect(result.messages).toEqual([message]);
  });
});
