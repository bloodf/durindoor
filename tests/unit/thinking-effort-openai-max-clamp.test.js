import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const legacyOpenAiCaps = {
  reasoning: true,
  thinkingFormat: "openai",
  thinkingEfforts: ["low", "medium", "high", "xhigh"],
};

const maxOpenAiCaps = {
  reasoning: true,
  thinkingFormat: "openai",
  thinkingEfforts: ["low", "high", "max"],
};

describe("applyThinking (openai): effort fallback", () => {
  it("clamps unsupported max from either client field to xhigh", () => {
    for (const body of [
      { reasoning_effort: "max" },
      { output_config: { effort: "max" } },
      { thinking: { type: "enabled", budget_tokens: 128000 } },
    ]) {
      const out = applyThinking(FORMATS.OPENAI, "custom-legacy", body, "openai", undefined, legacyOpenAiCaps);
      expect(out.reasoning_effort).toBe("xhigh");
    }
  });

  it("preserves allowed max and falls unsupported ultra back to max", () => {
    const max = applyThinking(FORMATS.OPENAI, "custom-max", { reasoning_effort: "max" }, "openai", undefined, maxOpenAiCaps);
    const ultra = applyThinking(FORMATS.OPENAI, "custom-max", { reasoning_effort: "ultra" }, "openai", undefined, maxOpenAiCaps);

    expect(max.reasoning_effort).toBe("max");
    expect(ultra.reasoning_effort).toBe("max");
  });

  it("preserves supported non-max efforts", () => {
    const out = applyThinking(FORMATS.OPENAI, "custom-legacy", { reasoning_effort: "high" }, "openai", undefined, legacyOpenAiCaps);
    expect(out.reasoning_effort).toBe("high");
  });
});
