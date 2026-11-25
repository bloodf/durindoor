import { describe, expect, it } from "vitest";
import { repairCodexToolHistory } from "../../open-sse/executors/codexToolHistory.js";

describe("Codex tool history IDs", () => {
  it("reserves valid IDs and pairs outputs despite normalization collisions", () => {
    const input = [
      { type: "function_call", call_id: "a.b", name: "first" },
      { type: "function_call", call_id: "a_b_2e7336dc", name: "second" },
      { type: "function_call_output", call_id: "a.b", output: "first result" },
    ];
    const result = repairCodexToolHistory(input);
    const calls = result.filter((item) => item.type === "function_call");
    const outputs = result.filter((item) => item.type === "function_call_output");
    expect(new Set(calls.map((item) => item.call_id)).size).toBe(2);
    expect(calls[1].call_id).toBe("a_b_2e7336dc");
    expect(outputs.find((item) => item.output === "first result").call_id).toBe(calls[0].call_id);
    expect(outputs.find((item) => item.call_id === calls[1].call_id).output).toContain("No tool output recorded");
    expect(input[0].call_id).toBe("a.b");
  });

  it("normalizes chat-shaped calls and retains their matching results", () => {
    const result = repairCodexToolHistory([
      { role: "assistant", tool_calls: [{ id: "chat.id", type: "function" }] },
      { type: "function_call_output", call_id: "chat.id", output: "done" },
      { role: "tool", tool_call_id: "chat.id", content: "done" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].tool_calls[0].id).toBe(result[1].call_id);
    expect(result[2].tool_call_id).toBe(result[1].call_id);
  });
});
