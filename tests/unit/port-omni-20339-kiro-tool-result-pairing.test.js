import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const tools = [
  { type: "function", function: { name: "f", description: "d", parameters: { type: "object", properties: {} } } }
];

const call = (id) => ({ id, type: "function", function: { name: "f", arguments: "{}" } });

function translate(messages) {
  return openaiToKiroRequest("claude-sonnet-4.5", { messages, tools }, false, null).conversationState;
}

/** Every toolResult id paired with the toolUse ids of the turn right before it. */
function pairs(state) {
  const history = state.history ?? [];
  const turns = [...history, { userInputMessage: state.currentMessage.userInputMessage }];
  const out = [];
  turns.forEach((turn, index) => {
    const results = turn.userInputMessage?.userInputMessageContext?.toolResults;
    if (!results?.length) return;
    const previous = history[index - 1]?.assistantResponseMessage;
    out.push({
      resultIds: results.map((r) => r.toolUseId),
      useIds: (previous?.toolUses ?? []).map((u) => u.toolUseId)
    });
  });
  return out;
}

function expectAllPaired(state) {
  for (const { resultIds, useIds } of pairs(state)) {
    for (const id of resultIds) expect(useIds, `toolResult ${id} unpaired`).toContain(id);
  }
}

describe("OmniRoute #20339: Kiro toolResults pair with the preceding assistant turn", () => {
  it("demotes a stale result whose id belongs to an earlier turn", () => {
    const state = translate([
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("Z")] },
      { role: "tool", tool_call_id: "Z", content: "first Z" },
      { role: "assistant", content: null, tool_calls: [call("A")] },
      { role: "tool", tool_call_id: "A", content: "res A" },
      { role: "tool", tool_call_id: "Z", content: "second Z" },
      { role: "user", content: "next" }
    ]);
    expectAllPaired(state);
    const checked = pairs(state);
    expect(checked.at(-1).resultIds).toEqual(["A"]);
    expect(state.currentMessage.userInputMessage.content).toContain("second Z");
  });

  it("demotes an unknown result inside a history turn and keeps the matching one", () => {
    const state = translate([
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("A")] },
      { role: "tool", tool_call_id: "A", content: "res A" },
      { role: "tool", tool_call_id: "Z", content: "result for nothing" },
      { role: "assistant", content: "done" },
      { role: "user", content: "next" }
    ]);
    expectAllPaired(state);
    expect(pairs(state).some((p) => p.resultIds.includes("A"))).toBe(true);
    expect(JSON.stringify(state)).toContain("result for nothing");
    expect(JSON.stringify(state.history)).not.toContain('"toolUseId":"Z"');
  });

  it("keeps the demoted text and original user text together", () => {
    const state = translate([
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("A")] },
      { role: "tool", tool_call_id: "A", content: "res A" },
      { role: "tool", tool_call_id: "Z", content: "result for nothing" },
      { role: "user", content: "next" }
    ]);
    const content = state.currentMessage.userInputMessage.content;
    expect(content).toContain("next");
    expect(content).toContain("result for nothing");
    expect(pairs(state)).toEqual([{ resultIds: ["A"], useIds: ["A"] }]);
  });

  it("leaves a well-formed multi-turn exchange structured", () => {
    const state = translate([
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("A"), call("B")] },
      { role: "tool", tool_call_id: "A", content: "res A" },
      { role: "tool", tool_call_id: "B", content: "res B" },
      { role: "assistant", content: null, tool_calls: [call("C")] },
      { role: "tool", tool_call_id: "C", content: "res C" }
    ]);
    expect(pairs(state)).toEqual([
      { resultIds: ["A", "B"], useIds: ["A", "B"] },
      { resultIds: ["C"], useIds: ["C"] }
    ]);
  });

  it("demotes a result for an id that was called only in an earlier turn on the current message", () => {
    const state = translate([
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: [call("Z")] },
      { role: "tool", tool_call_id: "Z", content: "first Z" },
      { role: "assistant", content: null, tool_calls: [call("A")] },
      { role: "tool", tool_call_id: "Z", content: "late Z" }
    ]);
    expectAllPaired(state);
    expect(JSON.stringify(state.currentMessage)).toContain("late Z");
  });
});
