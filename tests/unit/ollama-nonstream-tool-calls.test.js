import { describe, expect, it } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Ollama non-streaming tool calls (#651)", () => {
  it("uses provider targetFormat to translate mixed Ollama text and tool calls for an OpenAI client", () => {
    const result = translateNonStreamingResponse({
      model: "qwen3",
      message: {
        role: "assistant",
        content: "I will check.",
        tool_calls: [{
          function: { name: "get_weather", arguments: { city: "Paris" } },
        }],
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 8,
      eval_count: 4,
    }, FORMATS.OLLAMA, FORMATS.OPENAI);

    expect(result.choices[0]).toEqual(expect.objectContaining({
      message: {
        role: "assistant",
        content: "I will check.",
        tool_calls: [expect.objectContaining({
          type: "function",
          function: { name: "get_weather", arguments: JSON.stringify({ city: "Paris" }) },
        })],
      },
      finish_reason: "tool_calls",
    }));
  });
});
