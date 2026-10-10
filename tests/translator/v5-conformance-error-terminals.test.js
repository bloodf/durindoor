import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { OPENAI_FINISH } from "../../open-sse/translator/schema/index.js";

const feed = (events) => {
  const state = initState(FORMATS.OPENAI);
  return events.map((event) => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, event, state));
};

// Issue #1089 row T11: error terminals are text plus stop, never a structured client error.
describe("#1089 Responses error and duplicate terminals through registration", () => {
  it("emits one error terminal when error and response.failed arrive back to back", () => {
    const [first, second] = feed([
      { type: "error", error: { message: "model_not_found" } },
      { type: "response.failed", response: { error: { message: "model_not_found" } } },
    ]);
    expect(first).toHaveLength(1);
    expect(first[0].choices[0].delta.content).toBe("[Error] model_not_found");
    expect(first[0].choices[0].finish_reason).toBe(OPENAI_FINISH.STOP);
    expect(second).toEqual([]);
  });

  it("does not emit a second finish when completed follows incomplete", () => {
    const [incomplete, completed] = feed([
      { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
      { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ]);
    expect(incomplete[0].choices[0].finish_reason).toBe(OPENAI_FINISH.LENGTH);
    expect(completed).toEqual([]);
  });

  it("ignores a response.failed event that carries no error object", () => {
    const [out] = feed([{ type: "response.failed", response: {} }]);
    expect(out).toEqual([]);
  });
});
