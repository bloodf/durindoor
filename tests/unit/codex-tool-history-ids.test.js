import { describe, expect, it } from "vitest";
import { repairCodexToolHistory } from "../../open-sse/executors/codexToolHistory.js";

const user = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };


describe("upstream PR #5279 - mixed chat and Responses tool history", () => {
  const chatCall = (id) => ({ role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "tool", arguments: "{}" } }] });
  const chatResult = (id, content = "CHAT_RESULT") => ({ role: "tool", tool_call_id: id, content });
  const fnCall = (call_id) => ({ type: "function_call", call_id, name: "tool", arguments: "{}" });
  const fnOutput = (call_id, output = "RESULT") => ({ type: "function_call_output", call_id, output });

  const outputsByCallId = (items) => {
    const counts = new Map();
    for (const item of items) {
      const id = item.type === "function_call_output" ? item.call_id : item.role === "tool" ? item.tool_call_id : undefined;
      if (id !== undefined) counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  };
  const callIds = (items) => items.flatMap((item) => item.type === "function_call"
    ? [item.call_id]
    : (item.tool_calls || []).map((toolCall) => toolCall.id));

  it("keeps a function_call_output answering a chat tool_calls id that normalization changes", () => {
    const out = repairCodexToolHistory([user, chatCall("toolu.01"), fnOutput("toolu.01")]);
    const outputs = out.filter((item) => item.type === "function_call_output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].output).toBe("RESULT");
    expect(outputs[0].call_id).toBe(out[1].tool_calls[0].id);
    expect(outputs[0].call_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("does not add a placeholder for a function_call answered by a role:tool item", () => {
    const out = repairCodexToolHistory([user, fnCall("a.b"), chatResult("a.b")]);
    expect(out).toHaveLength(3);
    expect(JSON.stringify(out)).not.toContain("No tool output recorded");
    expect(out[2]).toMatchObject({ role: "tool", content: "CHAT_RESULT", tool_call_id: out[1].call_id });
  });

  it("pairs every call with exactly one output and never drops a real output", () => {
    const ids = ["toolu.01", "a.b", "a_b", "call_1|item", "plain", `x.${"y".repeat(80)}`];
    const input = [user];
    ids.forEach((id, index) => {
      // Alternate shapes: chat call + Responses output, Responses call + chat output, and same-shape pairs.
      const shape = index % 4;
      if (shape === 0) input.push(chatCall(id), fnOutput(id, `R${index}`));
      else if (shape === 1) input.push(fnCall(id), chatResult(id, `R${index}`));
      else if (shape === 2) input.push(fnCall(id), fnOutput(id, `R${index}`));
      else input.push(chatCall(id), chatResult(id, `R${index}`));
    });
    input.push(fnCall("cut.off"));

    const out = repairCodexToolHistory(input);
    const counts = outputsByCallId(out);
    const calls = callIds(out);
    expect(new Set(calls).size).toBe(calls.length);
    for (const id of calls) expect(counts.get(id)).toBe(1);
    expect([...counts.keys()].sort()).toEqual([...calls].sort());

    const text = JSON.stringify(out);
    ids.forEach((_, index) => expect(text).toContain(`"R${index}"`));
    expect(text.match(/No tool output recorded/g)).toHaveLength(1);
    expect(out.at(-1)).toMatchObject({ type: "function_call_output", call_id: out.at(-2).call_id });
  });

  it("does not mutate the caller's chat-shaped items", () => {
    const input = [chatCall("toolu.01"), chatResult("toolu.01")];
    const snapshot = structuredClone(input);
    repairCodexToolHistory(input);
    expect(input).toEqual(snapshot);
  });
});
