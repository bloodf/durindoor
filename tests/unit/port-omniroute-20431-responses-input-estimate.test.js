import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../open-sse/handlers/countTokensCore.js";

const text = (length) => "a".repeat(length);

describe("OmniRoute #20431 (cda04d03c80e) - count every Responses input item at the token gate", () => {
  it("counts instructions, messages, tool calls, tool outputs and reasoning summaries", () => {
    const body = {
      instructions: text(400),
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: text(400) }] },
        { role: "assistant", content: text(400) },
        { type: "function_call", call_id: "c1", name: "read", arguments: text(396) },
        { type: "function_call_output", call_id: "c1", output: text(400) },
        { type: "custom_tool_call", call_id: "c2", name: "edit", input: text(396) },
        { type: "custom_tool_call_output", call_id: "c2", output: [{ type: "output_text", text: text(400) }] },
        { type: "reasoning", summary: [{ type: "summary_text", text: text(400) }] },
      ],
    };

    expect(estimateTokens(body)).toBe(800);
  });

  it("counts a string input", () => {
    expect(estimateTokens({ input: text(4000) })).toBe(1000);
  });

  it("does not count image bytes or sealed reasoning as text", () => {
    const body = {
      input: [
        { type: "message", role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${text(40000)}` }] },
        { type: "reasoning", summary: [], encrypted_content: text(40000) },
        { type: "function_call_output", call_id: "c1", output: [{ type: "input_image", image_url: text(40000) }] },
      ],
    };

    expect(estimateTokens(body)).toBe(1);
  });
});
