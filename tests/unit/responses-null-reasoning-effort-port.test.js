import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

const messages = [{ role: "user", content: "hi" }];
const convert = (extra) => openaiToOpenAIResponsesRequest("custom-model", { messages, ...extra }, true, null);

describe("upstream 9router #5518: null reasoning_effort on the Responses wire", () => {
  it.each([undefined, null])("adds no reasoning object when reasoning_effort is %s", (effort) => {
    const out = convert({ reasoning_effort: effort });
    expect(out.reasoning).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("leaves the caller's reasoning object untouched when reasoning_effort is null", () => {
    const out = convert({ reasoning_effort: null, reasoning: { effort: "low", summary: "concise" } });
    expect(out.reasoning).toEqual({ effort: "low", summary: "concise" });
  });

  it("still lets an explicit reasoning_effort win over reasoning.effort", () => {
    const out = convert({ reasoning_effort: "high", reasoning: { effort: "low" } });
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
  });
});
