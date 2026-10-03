import { describe, it, expect } from "vitest";
import { getProviderThinkingLevels } from "../../src/app/(dashboard)/dashboard/providers/[id]/providerThinkingLevels.js";

const PROVIDER = "openai";
const ALIAS = "custom-openai";
const lowHighCaps = {
  reasoning: true,
  thinkingFormat: "openai",
  thinkingEfforts: ["low", "high"],
};
const maxCaps = {
  reasoning: true,
  thinkingFormat: "openai",
  thinkingEfforts: ["high", "max"],
};

describe("getProviderThinkingLevels", () => {
  it("returns null when no reasoning models are present", () => {
    expect(getProviderThinkingLevels({ providerId: PROVIDER, providerStorageAlias: ALIAS })).toBeNull();
  });

  it("unions explicitly declared custom-model efforts and prefixes picker controls once", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      customModels: [
        { id: "custom-low-high", providerAlias: ALIAS, kind: "llm", capabilities: lowHighCaps },
        { id: "custom-max", providerAlias: ALIAS, kind: "llm", capabilities: maxCaps },
      ],
      providerStorageAlias: ALIAS,
    });

    expect(out).toEqual(["auto", "none", "low", "high", "max"]);
    expect(out.filter((level) => level === "high")).toHaveLength(1);
  });

  it("excludes custom models whose provider alias does not match storage alias", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      customModels: [{ id: "custom-low-high", providerAlias: "other-provider", kind: "llm", capabilities: lowHighCaps }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toBeNull();
  });

  it("excludes non-LLM custom models", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      customModels: [{ id: "custom-low-high", providerAlias: ALIAS, kind: "image", capabilities: lowHighCaps }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toBeNull();
  });
});
