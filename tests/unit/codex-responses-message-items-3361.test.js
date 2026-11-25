import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "gpt-5.3-codex";

const dispatchInput = (input) =>
  new CodexExecutor().transformRequest(MODEL, { model: MODEL, input }, true, {}).input;

describe("upstream #3361: Codex typed Responses message items", () => {
  it("types legacy role/content items, using output_text only for assistant turns", () => {
    expect(dispatchInput([
      { role: "system", content: "Use concise code changes." },
      { role: "user", content: "Fix the failing test." },
      { type: "message", role: "assistant", content: "Looking." },
    ])).toEqual([
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Use concise code changes." }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Fix the failing test." }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Looking." }] },
    ]);
  });

  it("keeps a saver prompt appended to a legacy system item typed at dispatch", () => {
    const body = { model: MODEL, input: [{ role: "system", content: "Base." }, { role: "user", content: "Hi" }] };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "Respond tersely.");
    new CodexExecutor().transformRequest(MODEL, body, true, {});

    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Base.\n\nRespond tersely." }],
    });
  });

  it("leaves typed content and tool history alone and does not mutate caller content items", () => {
    const legacy = { role: "user", content: "Run it." };
    const typed = { type: "message", role: "user", content: [{ type: "input_text", text: "Already typed." }] };
    const call = { type: "function_call", call_id: "call_1", name: "read_file", arguments: "{}" };
    const output = { type: "function_call_output", call_id: "call_1", output: "ok" };

    const input = dispatchInput([legacy, structuredClone(typed), structuredClone(call), structuredClone(output)]);

    expect(input.slice(1)).toEqual([typed, call, output]);
    expect(legacy).toEqual({ role: "user", content: "Run it." });
  });
});
