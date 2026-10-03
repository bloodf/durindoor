import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getThinkingLevels, getThinkingLevelsFromCapabilities } from "../../open-sse/providers/thinkingLevels.js";

const alwaysOnCaps = {
  reasoning: true,
  thinkingFormat: "openai",
  thinkingCanDisable: false,
  thinkingEfforts: ["low", "medium", "high"],
};
const optionalCaps = {
  reasoning: true,
  thinkingFormat: "openai",
  thinkingCanDisable: true,
  thinkingEfforts: ["none", "low", "medium", "high"],
};

describe("OpenAI thinking disable normalization", () => {
  it("clamps explicit none to model minimum when custom capability forbids disabling", () => {
    const out = applyThinking(FORMATS.OPENAI, "custom-always-on", { reasoning_effort: "none" }, "openai", undefined, alwaysOnCaps);
    expect(out.reasoning_effort).toBe("low");
    expect(getThinkingLevelsFromCapabilities(alwaysOnCaps, "openai", "custom-always-on")).not.toContain("none");
  });

  it("preserves explicit supported level for always-on model", () => {
    const out = applyThinking(FORMATS.OPENAI, "custom-always-on", { reasoning_effort: "high" }, "openai", undefined, alwaysOnCaps);
    expect(out.reasoning_effort).toBe("high");
  });

  it("Codex normalizes none to an advertised supported effort", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", { reasoning_effort: "none" }, "codex");
    expect(out.reasoning_effort).not.toBe("none");
    expect(getThinkingLevels("codex", "gpt-5.6-sol")).toContain(out.reasoning_effort);
  });

  it("Kiro capability removes none from advertised levels", () => {
    expect(getThinkingLevels("kiro", "gpt-5.6-sol")).not.toContain("none");
  });

  it("direct OpenAI keeps explicit none for same model id", () => {
    const out = applyThinking(FORMATS.OPENAI, "gpt-5.6-sol", { reasoning_effort: "none" }, "openai");
    expect(out.reasoning_effort).toBe("none");
  });

  it("keeps explicit none when custom capability permits disabling", () => {
    const out = applyThinking(FORMATS.OPENAI, "custom-optional", { reasoning_effort: "none" }, "openai", undefined, optionalCaps);
    expect(out.reasoning_effort).toBe("none");
    expect(getThinkingLevelsFromCapabilities(optionalCaps, "openai", "custom-optional")).toContain("none");
  });
});
