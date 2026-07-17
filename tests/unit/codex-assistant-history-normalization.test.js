import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

// Port of diegosouzapw/OmniRoute#6932: replayed assistant history sent by
// codex-cli as `input_text` (or legacy `text`) must be rewritten to
// `output_text` or the Codex/OpenAI backend rejects the request. The
// normalization is model-agnostic — bare and prefixed Codex model ids share
// the same wire contract — and never touches user or function items.
function transform(model, input) {
  const executor = new CodexExecutor();
  const body = {
    model,
    input,
    stream: true,
  };

  executor.transformRequest(model, body, true, {
    connectionId: "test-codex-assistant-history",
    providerSpecificData: {},
  });

  return body.input;
}

function assistantHistoryInput() {
  return [
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "input_text",
          text: "Previous assistant answer",
          annotations: [{ type: "url_citation", url: "https://example.com" }],
          logprobs: [{ token: "Previous" }],
          obfuscation: "opaque",
        },
        { type: "text", text: "Legacy text part" },
        { type: "scoped_content", scope: "internal", content: "Preserve me" },
      ],
    },
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "user stays input_text" },
        { type: "input_image", image_url: "https://example.com/image.png", detail: "high" },
        { type: "input_file", file_id: "file_123" },
      ],
    },
    { type: "function_call", call_id: "call_123", name: "lookup", arguments: "{}" },
    { type: "function_call_output", call_id: "call_123", output: "done" },
  ];
}

describe("CodexExecutor assistant history normalization (#6932)", () => {
  it("rewrites assistant input_text/text parts to output_text for bare model ids", () => {
    const input = transform("gpt-5.5", assistantHistoryInput());

    expect(input[0].content).toEqual([
      { type: "output_text", text: "Previous assistant answer" },
      { type: "output_text", text: "Legacy text part" },
      { type: "scoped_content", scope: "internal", content: "Preserve me" },
    ]);
  });

  it("rewrites assistant history for prefixed Codex model ids", () => {
    const input = transform("cx/gpt-5.6-sol", assistantHistoryInput());

    expect(input[0].content[0]).toEqual({ type: "output_text", text: "Previous assistant answer" });
    expect(input[0].content[1]).toEqual({ type: "output_text", text: "Legacy text part" });
  });

  it("leaves user and function items untouched", () => {
    const input = transform("gpt-5.5", assistantHistoryInput());

    expect(input[1]).toEqual({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "user stays input_text" },
        { type: "input_image", image_url: "https://example.com/image.png", detail: "high" },
        { type: "input_file", file_id: "file_123" },
      ],
    });
    expect(input[2]).toEqual({ type: "function_call", call_id: "call_123", name: "lookup", arguments: "{}" });
    expect(input[3]).toEqual({ type: "function_call_output", call_id: "call_123", output: "done" });
  });
});
