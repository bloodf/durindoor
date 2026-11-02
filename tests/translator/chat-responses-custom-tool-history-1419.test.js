// #1344 / #1419 review: Chat custom tool history replays as Responses custom_tool_call.
import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const PATCH = "*** Begin Patch\n*** Update File: a.txt\n-old\n+new\n*** End Patch";
const customTool = { type: "custom", custom: { name: "apply_patch", description: "Apply a patch" } };
const toResponses = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "m", structuredClone(body), false);

describe("Chat custom tool history to Responses", () => {
  it("replays two turns of custom calls as paired custom_tool_call items", () => {
    const out = toResponses({
      tools: [customTool],
      messages: [
        { role: "user", content: "patch a" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "custom", custom: { name: "apply_patch", input: PATCH } }] },
        { role: "tool", tool_call_id: "c1", content: "Done a" },
        { role: "user", content: "patch b" },
        // Function-shaped call to the declared custom tool, `{input}` wrapped.
        { role: "assistant", content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "apply_patch", arguments: JSON.stringify({ input: PATCH }) } }] },
        { role: "tool", tool_call_id: "c2", content: "Done b" },
      ],
    });
    const items = out.input.filter((item) => item.type !== "message");
    expect(items).toEqual([
      { type: "custom_tool_call", call_id: "c1", name: "apply_patch", input: PATCH },
      { type: "custom_tool_call_output", call_id: "c1", output: "Done a" },
      { type: "custom_tool_call", call_id: "c2", name: "apply_patch", input: PATCH },
      { type: "custom_tool_call_output", call_id: "c2", output: "Done b" },
    ]);
    expect(out.tools).toEqual([{ type: "custom", name: "apply_patch", description: "Apply a patch" }]);
  });

  it("keeps raw non-JSON arguments of a declared custom tool verbatim", () => {
    const out = toResponses({
      tools: [customTool],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [{ id: "c3", type: "function", function: { name: "apply_patch", arguments: PATCH } }] },
      ],
    });
    expect(out.input.find((item) => item.type === "custom_tool_call").input).toBe(PATCH);
  });

  it("leaves ordinary function history unchanged", () => {
    const out = toResponses({
      tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [{ id: "c4", type: "function", function: { name: "f", arguments: "{\"a\":1}" } }] },
        { role: "tool", tool_call_id: "c4", content: "ok" },
      ],
    });
    expect(out.input.filter((item) => item.type !== "message")).toEqual([
      { type: "function_call", call_id: "c4", name: "f", arguments: "{\"a\":1}" },
      { type: "function_call_output", call_id: "c4", output: "ok" },
    ]);
  });
});
