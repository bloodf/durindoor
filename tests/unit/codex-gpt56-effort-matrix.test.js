// decolua/9router#86131b9c ("feat(codex): support GPT-5.6 Max and Ultra
// overrides") is already satisfied by this fork's model-aware effort resolution.
// These tests pin the behavior the upstream commit introduced so the claim
// cannot silently rot: Sol/Terra accept ultra on the wire, Luna does not and
// falls back to max, and a model with no ultra/max support falls back to xhigh.
import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { resolveOpenAiEffort } from "../../open-sse/translator/concerns/thinkingUnified.js";
import codex from "../../open-sse/providers/registry/codex.js";

describe("Codex GPT-5.6 effort matrix", () => {
  it("advertises ultra only for the tiers that accept it", () => {
    expect(getThinkingLevels("codex", "gpt-5.6-sol")).toContain("ultra");
    expect(getThinkingLevels("codex", "gpt-5.6-terra")).toContain("ultra");
    expect(getThinkingLevels("codex", "gpt-5.6-luna")).not.toContain("ultra");
    expect(getThinkingLevels("codex", "gpt-5.6-luna")).toContain("max");
  });

  it("keeps ultra and max intact for Sol and Terra", () => {
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra"]) {
      expect(resolveOpenAiEffort("ultra", "codex", model), model).toBe("ultra");
      expect(resolveOpenAiEffort("max", "codex", model), model).toBe("max");
    }
  });

  // Luna has no ultra tier, so an ultra request degrades to the highest level it
  // does support rather than being rejected upstream.
  it("falls ultra back to max for Luna", () => {
    expect(resolveOpenAiEffort("ultra", "codex", "gpt-5.6-luna")).toBe("max");
    expect(resolveOpenAiEffort("max", "codex", "gpt-5.6-luna")).toBe("max");
  });

  // Older codex models support neither; both collapse to xhigh.
  it("falls ultra and max back to xhigh when the model supports neither", () => {
    expect(resolveOpenAiEffort("ultra", "codex", "gpt-5.1-codex")).toBe("xhigh");
    expect(resolveOpenAiEffort("max", "codex", "gpt-5.1-codex")).toBe("xhigh");
  });

  it("passes ordinary levels through untouched", () => {
    for (const level of ["low", "medium", "high", "xhigh"]) {
      expect(resolveOpenAiEffort(level, "codex", "gpt-5.6-sol"), level).toBe(level);
    }
  });

  // The wire alias is this fork's addition on top of the upstream semantics:
  // "ultra" is a real semantic level, but the Codex endpoint wants "max".
  it("maps ultra to max on the wire via the registry alias", () => {
    expect(codex.transport?.quirks?.reasoningEffortAliases?.ultra).toBe("max");
  });
});
