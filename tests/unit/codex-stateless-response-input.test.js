import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transformInput(input) {
  const body = { model: "gpt-5.6-sol", input, stream: true };

  new CodexExecutor().transformRequest("gpt-5.6-sol", body, true, {
    connectionId: "test-codex-stateless-response-input",
    providerSpecificData: {},
  });

  return body.input;
}

describe("CodexExecutor stateless Responses input", () => {
  it("preserves replayed call items and stable call IDs while dropping stored references", () => {
    expect(transformInput([
      { type: "message", id: "msg_history", role: "assistant", content: [{ type: "output_text", text: "continue" }] },
      { type: "function_call", id: "item_function", call_id: "call_function", name: "shell", arguments: "{}" },
      { type: "function_call_output", id: "item_function_output", call_id: "call_function", output: "done" },
      { type: "custom_tool_call", id: "item_custom", call_id: "call_custom", name: "apply_patch", input: "PATCH" },
      { type: "custom_tool_call_output", id: "item_custom_output", call_id: "call_custom", output: "applied" },
      { type: "item_reference", id: "item_stored" },
      "ctc_stored",
    ])).toEqual([
      { type: "message", id: "msg_history", role: "assistant", content: [{ type: "output_text", text: "continue" }] },
      { type: "function_call", call_id: "call_function", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call_function", output: "done" },
      { type: "custom_tool_call", call_id: "call_custom", name: "apply_patch", input: "PATCH" },
      { type: "custom_tool_call_output", call_id: "call_custom", output: "applied" },
    ]);
  });
});
