import { describe, it, expect } from "vitest";

import { resolveOpenAiEffort } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("GPT-6 Sol and Luna effort resolution", () => {
  const lunaCaps = {
    reasoning: true,
    thinkingCanDisable: false,
    thinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
  };
  const solCaps = { ...lunaCaps, thinkingEfforts: [...lunaCaps.thinkingEfforts, "ultra"] };

  it("preserves Sol ultra and falls Luna ultra back to max", () => {
    expect(resolveOpenAiEffort("ultra", "codex", "gpt-6-sol", solCaps)).toBe("ultra");
    expect(resolveOpenAiEffort("ultra", "codex", "gpt-6-luna", lunaCaps)).toBe("max");
  });

  it("floors unsupported disabled-thinking levels to low", () => {
    for (const [model, caps] of [["gpt-6-sol", solCaps], ["gpt-6-luna", lunaCaps]]) {
      expect(resolveOpenAiEffort("none", "codex", model, caps)).toBe("low");
      expect(resolveOpenAiEffort("minimal", "codex", model, caps)).toBe("low");
    }
  });
});

