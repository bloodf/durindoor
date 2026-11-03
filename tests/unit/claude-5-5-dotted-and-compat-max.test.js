import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

describe("Copilot dotted Claude 5.5 ids share the dashed thinking rules (#1367)", () => {
  for (const [dotted, dashed] of [
    ["claude-opus-5.5", "claude-opus-5-5"],
    ["claude-sonnet-5.5", "claude-sonnet-5-5"],
  ]) {
    it(`${dotted} resolves like ${dashed}`, () => {
      const d = getCapabilitiesForModel("github", dotted);
      const s = getCapabilitiesForModel("github", dashed);
      expect(d.thinkingFormat).toBe(s.thinkingFormat);
      expect(d.thinkingCanDisable).toBe(false);
      expect(d.thinkingModes).toEqual(s.thinkingModes);
      expect(getThinkingLevels("github", dotted)).toEqual(getThinkingLevels("github", dashed));
      expect(getThinkingLevels("github", dotted)).not.toContain("none");
    });

    it.each(["github", "kiro", "kr"])(`${dotted} never receives thinking.type "disabled" on %s`, (provider) => {
      const body = applyThinking("claude", dotted, { model: dotted, reasoning_effort: "none", messages: [] }, provider);
      expect(body.thinking?.type).not.toBe("disabled");
    });
  }
});

describe("OpenAI-compatible nodes keep effort max for GPT-5.6 / GPT-6 (#1367)", () => {
  const compat = "openai-compatible-abc";
  const effort = (model) =>
    applyThinking("openai", model, { model, reasoning_effort: "max", messages: [] }, compat).reasoning_effort;

  it.each(["gpt-5.6", "GPT-5.6", "gpt-5.6-pro", "gpt-5.6-2026-01-01", "openai/gpt-5.6", "gpt-6-sol"])(
    "%s keeps max",
    (model) => expect(effort(model)).toBe("max"),
  );

  it("other compatible models are unchanged", () => {
    expect(effort("gpt-5.5")).toBe("xhigh");
    expect(effort("gpt-5.60")).toBe("xhigh");
  });

  it("built-in openai provider is unchanged", () => {
    expect(getThinkingLevels("openai", "gpt-5.6-pro")).not.toContain("max");
  });
});
