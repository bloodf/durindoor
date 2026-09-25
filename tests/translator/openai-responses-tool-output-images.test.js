// openai-responses.js: tool outputs that carry input_image parts.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const R2O = (body) => translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true, null, null);

const IMG = "data:image/png;base64,AAAA";

describe("Responses → OpenAI: function_call_output with input_image parts", () => {
  it("keeps text in the tool message and lifts images into a following user message", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "view_image", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "ls", arguments: "{}" },
        {
          type: "function_call_output",
          call_id: "c1",
          output: [
            { type: "input_text", text: "screenshot" },
            { type: "input_image", image_url: IMG, detail: "high" },
            { type: "input_image", image_url: "https://example.com/b.png" }
          ]
        },
        { type: "function_call_output", call_id: "c2", output: "a.txt" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "what is it?" }] }
      ]
    });
    const roles = out.messages.map((m) => m.role);
    expect(roles).toEqual(["assistant", "tool", "tool", "user", "user"]);
    const tool = out.messages[1];
    expect(tool.tool_call_id).toBe("c1");
    expect(tool.content).toContain("screenshot");
    expect(tool.content).not.toContain("base64");
    expect(out.messages[3].content).toEqual([
      { type: "image_url", image_url: { url: IMG, detail: "high" } },
      { type: "image_url", image_url: { url: "https://example.com/b.png", detail: "auto" } }
    ]);
  });

  it("adds no user message for a text-only output", () => {
    const out = R2O({
      input: [
        { type: "function_call", call_id: "c1", name: "ls", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "a.txt" }
      ]
    });
    expect(out.messages.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(out.messages[1].content).toBe("a.txt");
  });
});
