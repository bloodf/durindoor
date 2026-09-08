import { describe, expect, it, vi } from "vitest";
import {
  getConnectionOptions,
  getModelReasoningOptions,
  groupModelsByProvider,
  normalizeReasoningEffort,
  paginateSessions,
} from "./playgroundHelpers.js";

describe("getConnectionOptions", () => {
  it("returns empty array for null group", () => {
    expect(getConnectionOptions(null)).toEqual([]);
  });

  it("returns empty array when the group has one or fewer connections", () => {
    const group = { providerId: "openai", connections: [{ id: "openai-1" }] };
    expect(getConnectionOptions(group)).toEqual([]);
  });

  it("returns auto plus connection options with labels", () => {
    const group = {
      providerId: "openai",
      connections: [
        { id: "openai-1", name: "OpenAI Primary", email: "primary@example.com" },
        { id: "openai-2", email: "fallback@example.com" },
        { id: "openai-3" },
      ],
    };
    const options = getConnectionOptions(group);
    expect(options).toEqual([
      { value: "auto", label: "Auto" },
      { value: "openai-1", label: "OpenAI Primary" },
      { value: "openai-2", label: "fallback@example.com" },
      { value: "openai-3", label: "openai-3" },
    ]);
  });

  it("returns empty array when connections is missing", () => {
    const group = { providerId: "openai" };
    expect(getConnectionOptions(group)).toEqual([]);
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

describe("paginateSessions", () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ id: `s${index + 1}` }));

  it("returns the current slice for page 3 with the default page size", () => {
    const result = paginateSessions(items, 3);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(3);
    expect(result.items).toHaveLength(5);
    expect(result.items.map((s) => s.id)).toEqual(["s21", "s22", "s23", "s24", "s25"]);
  });

  it("clamps an out-of-range page back to the last page", () => {
    const result = paginateSessions(items, 9);
    expect(result.page).toBe(3);
    expect(result.items).toHaveLength(5);
    expect(result.items.map((s) => s.id)).toEqual(["s21", "s22", "s23", "s24", "s25"]);
  });

  it("clamps to page 1 when the list shrinks below the current page", () => {
    const small = items.slice(0, 3);
    const result = paginateSessions(small, 5);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(3);
  });

  it("honors a custom page size", () => {
    const result = paginateSessions(items, 2, 7);
    expect(result.totalPages).toBe(4);
    expect(result.items.map((s) => s.id)).toEqual(["s8", "s9", "s10", "s11", "s12", "s13", "s14"]);
  });

  it("handles empty input", () => {
    const result = paginateSessions([], 1);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.items).toEqual([]);
  });
});
