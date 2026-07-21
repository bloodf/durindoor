// OmniRoute #7905: Responses API custom tool calls.
// Covers the two self-contained behaviors ported into DurinDoor:
//   B-3: a Responses `type:"custom"` tool normalizes to a function tool with an
//        { input: string } schema on the Chat Completions request.
//   B-7: a non-stream `custom_tool_call` output item carries its raw payload in
//        `input`, which must be preserved (not collapsed to {}).
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openAIResponsesBodyToClaude } from "../../open-sse/translator/response/openai-responses-nonstream.js";

describe("OmniRoute #7905 — custom tool request normalization (B-3)", () => {
  it("normalizes a type:custom Responses tool to a function tool with { input: string }", () => {
    const out = openaiResponsesToOpenAIRequest(
      "gpt-5",
      {
        input: [{ type: "message", role: "user", content: "hi" }],
        tools: [{ type: "custom", name: "apply_patch", description: "apply a patch" }],
      },
      false,
      {},
    );
    const tool = out.tools.find((t) => t.function?.name === "apply_patch");
    expect(tool).toBeTruthy();
    expect(tool.type).toBe("function");
    expect(tool.function.parameters).toEqual({
      type: "object",
      properties: { input: { type: "string" } },
      required: ["input"],
      additionalProperties: false,
    });
  });

  it("leaves a normal function tool untouched", () => {
    const out = openaiResponsesToOpenAIRequest(
      "gpt-5",
      {
        input: [{ type: "message", role: "user", content: "hi" }],
        tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
      },
      false,
      {},
    );
    const tool = out.tools.find((t) => t.function?.name === "get_weather");
    expect(tool.function.parameters.properties.city).toEqual({ type: "string" });
  });
});

describe("OmniRoute #7905 — non-stream custom_tool_call input (B-7)", () => {
  it("preserves the raw input of a custom_tool_call item as { input: <raw> }", () => {
    const claude = openAIResponsesBodyToClaude({
      output: [
        { type: "custom_tool_call", call_id: "call_1", name: "apply_patch", input: "*** Begin Patch\n...\n*** End Patch" },
      ],
    });
    const toolUse = claude.content.find((b) => b.type === "tool_use");
    expect(toolUse).toBeTruthy();
    expect(toolUse.name).toBe("apply_patch");
    expect(toolUse.input).toEqual({ input: "*** Begin Patch\n...\n*** End Patch" });
  });

  it("still reads arguments for a normal function_call item", () => {
    const claude = openAIResponsesBodyToClaude({
      output: [
        { type: "function_call", call_id: "call_2", name: "get_weather", arguments: '{"city":"Paris"}' },
      ],
    });
    const toolUse = claude.content.find((b) => b.type === "tool_use");
    expect(toolUse.input).toEqual({ city: "Paris" });
  });
});
