// Upstream 9router #1392: Codex custom tools (apply_patch) round-trip as
// custom_tool_call items. The live pipeline is the openai-responses translator
// pair; DurinDoor has no responsesHandler, so the legacy transform stream is not
// on a request path.
import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState } from "../../open-sse/translator/index.js";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";

const patch = "*** Begin Patch\n*** Add File: demo.txt\n+hello\n*** End Patch\n";

function run(body, name, args) {
  const state = initState(FORMATS.OPENAI_RESPONSES, body);
  return [
    ...openaiToOpenAIResponsesResponse({
      id: "chatcmpl_1",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name, arguments: args } }] } }],
    }, state),
    ...openaiToOpenAIResponsesResponse({ id: "chatcmpl_1", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }, state),
  ];
}

describe("upstream 9router #1392 - preserve Codex custom tool calls", () => {
  it("emits a declared custom tool as custom_tool_call with raw input", () => {
    const events = run({ tools: [{ type: "custom", name: "apply_patch", description: "Apply patch" }] }, "apply_patch", patch);
    expect(events.find((e) => e.event === "response.output_item.added").data.item).toMatchObject({ type: "custom_tool_call", call_id: "call_1", name: "apply_patch" });
    expect(events.filter((e) => e.event === "response.custom_tool_call_input.delta").map((e) => e.data.delta).join("")).toBe(patch);
    expect(events.find((e) => e.event === "response.custom_tool_call_input.done").data.input).toBe(patch);
    expect(events.find((e) => e.event === "response.output_item.done").data.item).toMatchObject({ type: "custom_tool_call", input: patch });
    expect(events.some((e) => e.event === "response.function_call_arguments.delta")).toBe(false);
  });

  it("keeps function tools as function_call arguments", () => {
    const events = run({ tools: [{ type: "function", name: "read_file", parameters: { type: "object", properties: {} } }] }, "read_file", "{\"path\":\"demo.txt\"}");
    expect(events.find((e) => e.event === "response.output_item.added").data.item.type).toBe("function_call");
    expect(events.find((e) => e.event === "response.function_call_arguments.delta").data.delta).toBe("{\"path\":\"demo.txt\"}");
    expect(events.some((e) => e.event === "response.custom_tool_call_input.delta")).toBe(false);
  });

  it("lowers custom_tool_call history and its output to paired Chat messages", () => {
    const result = openaiResponsesToOpenAIRequest("gpt-5.4", {
      input: [
        { type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: "*** Begin Patch\n*** End Patch\n" },
        { type: "custom_tool_call_output", call_id: "call_patch", output: "Done" },
      ],
    }, true);
    const assistant = result.messages.find((m) => m.role === "assistant");
    expect(assistant.tool_calls[0]).toMatchObject({ id: "call_patch", function: { name: "apply_patch" } });
    expect(result.messages.find((m) => m.role === "tool")).toMatchObject({ tool_call_id: "call_patch", content: "Done" });
  });
});
