import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transform(input) {
  const body = { input };
  new CodexExecutor().transformRequest("test-model", body, true, { providerSpecificData: {} });
  return body.input;
}

describe("Codex stateless tool history", () => {
  it("keeps outputs with matching Responses or chat calls and removes orphaned outputs", () => {
    const input = [
      { type: "function_call", call_id: "a", name: "f", arguments: "{}" },
      { type: "function_call_output", call_id: "a", output: "one" },
      { role: "assistant", tool_calls: [{ id: "b", function: { name: "f", arguments: "{}" } }] },
      { type: "function_call_output", call_id: "b", output: "two" },
      { type: "function_call_output", call_id: "missing", output: "lost" },
    ];
    expect(transform(input).filter((item) => item.type === "function_call_output").map((item) => item.call_id)).toEqual(["a", "b"]);
  });

  it("provides nonempty input if every item was an orphan", () => {
    expect(transform([{ type: "function_call_output", call_id: "lost", output: "x" }])).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "..." }] },
    ]);
  });
});
