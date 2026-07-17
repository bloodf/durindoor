import { describe, expect, it, vi } from "vitest";
import {
  getConnectionSelectorState,
  getModelReasoningOptions,
  groupModelsByProvider,
  normalizeReasoningEffort,
} from "./playgroundHelpers.js";

describe("getConnectionSelectorState", () => {
  it("returns not visible when the group has fewer than two connections", () => {
    const group = { providerId: "openai", providerName: "OpenAI", connections: [{ id: "openai-1", name: "OpenAI #1" }], models: [] };
    expect(getConnectionSelectorState(group)).toEqual({ visible: false, label: "", notice: "" });
  });

  it("returns not visible for a null group", () => {
    expect(getConnectionSelectorState(null)).toEqual({ visible: false, label: "", notice: "" });
  });

  it("shows connection count and a pinning notice for multiple connections", () => {
    const group = {
      providerId: "openai",
      providerName: "OpenAI",
      connections: [
        { id: "openai-1", name: "OpenAI Primary" },
        { id: "openai-2", name: "OpenAI Fallback" },
      ],
      models: [],
    };
    const state = getConnectionSelectorState(group);
    expect(state.visible).toBe(true);
    expect(state.label).toBe("2 connections");
    expect(state.notice).toMatch(/pinning unavailable/i);
  });
});

describe("groupModelsByProvider", () => {
  const connections = [
    { id: "openai-1", providerId: "openai", providerName: "OpenAI", providerType: "openai-compatible" },
    { id: "openai-2", providerId: "openai", providerName: "OpenAI", providerType: "openai-compatible" },
    { id: "anthropic-1", providerId: "anthropic", providerName: "Anthropic", providerType: "anthropic-compatible" },
  ];

  it("groups models by providerId, dedupes, and sorts", () => {
    const models = [
      { id: "openai/gpt-4o", name: "GPT-4o", providerId: "openai" },
      { id: "openai/gpt-4o", name: "GPT-4o", providerId: "openai" },
      { id: "anthropic/claude-opus", name: "Claude Opus", providerId: "anthropic" },
    ];
    const groups = groupModelsByProvider(connections, models);
    expect(groups).toHaveLength(2);
    expect(groups[0].providerId).toBe("anthropic");
    expect(groups[0].models.map((m) => m.id)).toEqual(["anthropic/claude-opus"]);
    expect(groups[1].providerId).toBe("openai");
    expect(groups[1].models.map((m) => m.id)).toEqual(["openai/gpt-4o"]);
    expect(groups[1].connections).toHaveLength(2);
  });

  it("drops providers with no models", () => {
    const models = [{ id: "openai/gpt-4o", name: "GPT-4o", providerId: "openai" }];
    const groups = groupModelsByProvider(connections, models);
    expect(groups.map((g) => g.providerId)).toEqual(["openai"]);
  });

  it("sorts providers by name and models by name", () => {
    const models = [
      { id: "openai/zzz", name: "Zzz", providerId: "openai" },
      { id: "openai/aaa", name: "Aaa", providerId: "openai" },
      { id: "anthropic/mmm", name: "Mmm", providerId: "anthropic" },
    ];
    const groups = groupModelsByProvider(connections, models);
    expect(groups[0].providerId).toBe("anthropic");
    expect(groups[0].models[0].name).toBe("Mmm");
    expect(groups[1].models.map((m) => m.name)).toEqual(["Aaa", "Zzz"]);
  });
});

describe("playgroundHelpers", () => {
  describe("getModelReasoningOptions", () => {
    it("returns [auto, ...levels] when the model has thinking levels", () => {
      const lookup = vi.fn().mockReturnValue(["low", "medium", "high"]);
      const options = getModelReasoningOptions("openai", "gpt-4o-reasoning", { getThinkingLevels: lookup });
      expect(lookup).toHaveBeenCalledWith("openai", "gpt-4o-reasoning");
      expect(options).toEqual(["auto", "low", "medium", "high"]);
    });

    it("includes none when the model exposes it", () => {
      const lookup = vi.fn().mockReturnValue(["none", "low", "medium"]);
      const options = getModelReasoningOptions("anthropic", "claude-opus-4", { getThinkingLevels: lookup });
      expect(options).toEqual(["auto", "none", "low", "medium"]);
    });

    it("returns null when the model has no thinking levels", () => {
      const lookup = vi.fn().mockReturnValue([]);
      const options = getModelReasoningOptions("openai", "gpt-4o", { getThinkingLevels: lookup });
      expect(options).toBeNull();
    });

    it("returns null for missing provider or model id", () => {
      expect(getModelReasoningOptions("", "model", { getThinkingLevels: () => ["low"] })).toBeNull();
      expect(getModelReasoningOptions("provider", "", { getThinkingLevels: () => ["low"] })).toBeNull();
    });
  });

  describe("normalizeReasoningEffort", () => {
    it("keeps a valid value", () => {
      expect(normalizeReasoningEffort(["auto", "low", "high"], "low")).toBe("low");
    });

    it("falls back to auto when the value is not in the options", () => {
      expect(normalizeReasoningEffort(["auto", "low", "high"], "medium")).toBe("auto");
    });

    it("falls back to auto when options are missing", () => {
      expect(normalizeReasoningEffort(null, "low")).toBe("auto");
    });
  });
});
