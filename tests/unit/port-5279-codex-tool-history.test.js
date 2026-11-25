import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const transform = (input) => new CodexExecutor()
  .transformRequest("gpt-5.5", { model: "gpt-5.5", input }, true, {}).input;
const call = (type, call_id) => ({ type, call_id, name: "tool", ...(type === "function_call" ? { arguments: "{}" } : { input: "x" }) });
const output = (type, call_id) => ({ type, call_id, output: "done" });
const user = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };

describe("upstream PR #5279 - Codex tool history", () => {
  it.each([
    ["function_call", "function_call_output"],
    ["custom_tool_call", "custom_tool_call_output"],
  ])("answers an interrupted %s", (callType, outputType) => {
    const input = transform([user, call(callType, "call_1"), user]);
    expect(input.map((item) => item.type)).toEqual(["message", callType, outputType, "message"]);
    expect(input[2]).toMatchObject({ call_id: "call_1", output: expect.stringContaining("interrupted") });
  });

  it("keeps paired calls and drops outputs with no call of the same kind", () => {
    const input = transform([
      user,
      call("function_call", "call_a"), call("custom_tool_call", "call_b"),
      output("function_call_output", "call_a"), output("custom_tool_call_output", "call_b"),
      output("custom_tool_call_output", "call_orphan"),
    ]);
    expect(input.map((item) => [item.type, item.call_id])).toEqual([
      ["message", undefined],
      ["function_call", "call_a"], ["custom_tool_call", "call_b"],
      ["function_call_output", "call_a"], ["custom_tool_call_output", "call_b"],
    ]);
  });

  it("replaces an interrupted computer_call with a note and drops an orphan screenshot", () => {
    const computer = (type, call_id) => ({ type, call_id });
    const input = transform([
      user,
      computer("computer_call", "cu_done"), computer("computer_call_output", "cu_done"),
      computer("computer_call", "cu_cut"),
      computer("computer_call_output", "cu_orphan"),
    ]);
    expect(input.map((item) => item.type)).toEqual(["message", "computer_call", "computer_call_output", "message"]);
    expect(input[3]).toMatchObject({ role: "assistant", content: [{ type: "output_text", text: expect.stringContaining("cu_cut") }] });
  });

  it("normalizes call ids so each call and result stay paired", () => {
    const long = `call_${"x".repeat(80)}`;
    const input = transform([
      call("function_call", "call_1|fc_item"), output("function_call_output", "call_1|other"),
      call("function_call", "tool.name:0"), output("function_call_output", "tool.name:0"),
      call("function_call", "tool_name_0"), output("function_call_output", "tool_name_0"),
      call("function_call", long), output("function_call_output", long),
    ]);
    const ids = input.map((item) => item.call_id);
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe("call_1");
    for (let index = 0; index < ids.length; index += 2) expect(ids[index + 1]).toBe(ids[index]);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
