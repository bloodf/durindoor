// Audit R2 — kiro-to-openai must emit incrementing tool_calls[].index per
// toolUseEvent in a Kiro turn. Downstream openai-to-claude.js keys open tool
// blocks by tc.index ?? 0; an always-0 index makes a 2nd toolUseEvent land on
// the same slot, gets deduped by state.toolCalls.has(0), and is dropped
// silently while messageStop still claims stop_reason: "tool_use".
//
// Regression guard: a single toolUseEvent must still carry index 0 so we don't
// break the existing single-tool-call contract.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function kiroToolUse(id, name, input) {
  return { toolUseEvent: { toolUseId: id, name, input }, _eventType: "toolUseEvent" };
}

function run(events) {
  const state = initState(FORMATS.KIRO);
  const out = [];
  for (const ev of events) {
    const r = translateResponse(FORMATS.KIRO, FORMATS.OPENAI, ev, state);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return out;
}

describe("kiro-to-openai: tool-call index per toolUseEvent", () => {
  it("positive: two consecutive toolUseEvents get distinct indexes 0 and 1", () => {
    const chunks = run([
      kiroToolUse("call_a", "read_file", { path: "/tmp/a" }),
      kiroToolUse("call_b", "write_file", { path: "/tmp/b", content: "x" }),
    ]);

    const toolChunks = chunks.filter(
      (c) => c.choices?.[0]?.delta?.tool_calls?.length
    );
    expect(toolChunks).toHaveLength(2);

    const first = toolChunks[0].choices[0].delta.tool_calls[0];
    const second = toolChunks[1].choices[0].delta.tool_calls[0];

    expect(first.index).toBe(0);
    expect(first.id).toBe("call_a");
    expect(first.function.name).toBe("read_file");

    expect(second.index).toBe(1);
    expect(second.id).toBe("call_b");
    expect(second.function.name).toBe("write_file");

    expect(first.index).not.toBe(second.index);
  });

  it("regression: single toolUseEvent still emits index 0", () => {
    const chunks = run([
      kiroToolUse("call_only", "read_file", { path: "/tmp/x" }),
    ]);

    const toolChunks = chunks.filter(
      (c) => c.choices?.[0]?.delta?.tool_calls?.length
    );
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0].choices[0].delta.tool_calls[0].index).toBe(0);
    expect(toolChunks[0].choices[0].delta.tool_calls[0].id).toBe("call_only");
  });
});
