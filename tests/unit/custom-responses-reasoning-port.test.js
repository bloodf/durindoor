import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("custom Responses reasoning", () => {
  it("keeps Responses reasoning options and nests the effort", () => {
    const body = { reasoning_effort: "high", reasoning: { summary: "detailed" } };
    applyThinking(FORMATS.OPENAI_RESPONSES, "custom-model", body, "openai-compatible-responses-test", undefined, { reasoning: true });
    expect(body.reasoning).toEqual({ summary: "detailed", effort: "high" });
    expect(body.reasoning_effort).toBeUndefined();
  });
});
