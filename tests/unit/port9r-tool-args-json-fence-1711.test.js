import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

// 9router #1711: non-Anthropic models sometimes wrap tool arguments in a markdown
// ```json fence. The Claude-bound translator must emit parseable JSON.
function run(args) {
  const state = { toolCalls: new Map(), nextBlockIndex: 0 };
  const chunk = (delta, finish_reason = null) => ({ id: "c1", model: "x/y", choices: [{ delta, finish_reason }] });
  const events = [
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: args } }] }), state),
    openaiToClaudeResponse(chunk({}, "tool_calls"), state),
  ].flatMap((r) => r || []);
  return events.filter((e) => e?.delta?.type === "input_json_delta").map((e) => e.delta.partial_json).join("");
}

describe("port 9router #1711: tool-call argument fences", () => {
  it("strips a ```json fence around tool arguments", () => {
    const out = run('```json\n{"file_path":"/a","limit":"5"}\n```');
    expect(JSON.parse(out)).toEqual({ file_path: "/a", limit: 5 });
  });

  it("leaves plain JSON arguments unchanged", () => {
    expect(JSON.parse(run('{"file_path":"/a"}'))).toEqual({ file_path: "/a" });
  });
});
