import { describe, it, expect } from "vitest";
import { getProviderThinkingLevels } from "../../src/app/(dashboard)/dashboard/providers/[id]/providerThinkingLevels.js";

// providerId "codex": gpt-5.3-codex → [low,medium,high,xhigh]; gpt-5.6-sol → adds max.
const PROVIDER = "codex";
const ALIAS = "codex";

describe("getProviderThinkingLevels", () => {
  it("returns null when no reasoning models are present", () => {
    expect(
      getProviderThinkingLevels({ providerId: PROVIDER, providerStorageAlias: ALIAS })
    ).toBeNull();
  });

  it("unions levels from built-in config models", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      models: [{ id: "gpt-5.3-codex" }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toEqual(["auto", "none", "low", "medium", "high", "xhigh"]);
  });

  it("unions levels from kiloFreeModels even when not in built-in config", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      models: [],
      kiloFreeModels: [{ id: "gpt-5.3-codex" }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toContain("xhigh");
    expect(out[0]).toBe("auto");
  });

  it("unions levels from a matching custom LLM and surfaces gpt-5.6-sol max", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      models: [{ id: "gpt-5.3-codex" }],
      customModels: [{ id: "gpt-5.6-sol", providerAlias: ALIAS, kind: "llm" }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toContain("max");
    expect(out).toContain("xhigh");
  });

  it("excludes custom models whose providerAlias does not match storage alias", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      models: [],
      customModels: [{ id: "gpt-5.6-sol", providerAlias: "other-provider", kind: "llm" }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toBeNull();
  });

  it("excludes non-LLM custom models", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      models: [],
      customModels: [{ id: "gpt-5.6-sol", providerAlias: ALIAS, kind: "image" }],
      providerStorageAlias: ALIAS,
    });
    expect(out).toBeNull();
  });

  it("unions config + kiloFreeModels + customModels together (gpt-5.6-sol → max)", () => {
    const out = getProviderThinkingLevels({
      providerId: PROVIDER,
      models: [{ id: "gpt-5.3-codex" }], // low, medium, high, xhigh
      kiloFreeModels: [{ id: "gpt-5.3-codex" }], // duplicate id → deduped via seen-set
      customModels: [{ id: "gpt-5.6-sol", providerAlias: ALIAS, kind: "llm" }], // adds minimal + max
      providerStorageAlias: ALIAS,
    });
    expect(out).toEqual([
      "auto",
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "minimal",
      "max",
      "ultra",
    ]);
    expect(out.filter((l) => l === "xhigh")).toHaveLength(1);
  });
});
