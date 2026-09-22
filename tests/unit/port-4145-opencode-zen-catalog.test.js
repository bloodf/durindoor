// Coverage for port(upstream): #4145 - additive OpenCode Zen catalog + "ocz" alias.
// This is a data-only port: no executor rewrite, no transports-array restructure, no
// free-tier fingerprint gating (that lands separately once the free-tier cloaking
// machinery exists). These tests lock in the two things the port actually changed:
//   1. "ocz" resolves to the opencode-zen provider for request routing.
//   2. Every newly added model id routes to the endpoint its targetFormat implies,
//      per the *existing* executor's own model-id regexes (isClaudeModel/
//      isResponsesModel) — nothing here should silently rely on the deferred
//      DefaultExecutor rewrite.
import { beforeEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";

const mocks = vi.hoisted(() => ({
  getCombos: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  getCustomModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getCombos: mocks.getCombos,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getCustomModels: mocks.getCustomModels,
  getComboForModel: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
}));

const { createRoutableModelIdChecker } = await import("../../src/sse/services/model.js");

const entry = REGISTRY.find((e) => e.id === "opencode-zen");

describe("OpenCode Zen registry entry (port #4145)", () => {
  it("keeps the legacy alias and adds ocz as an additional lookup token", () => {
    expect(entry.alias).toBe("opencode-zen");
    expect(entry.uiAlias).toBe("ocz");
    expect(entry.aliases).toContain("ocz");
  });

  it("ocz does not collide with another provider's alias/uiAlias/aliases", () => {
    const collisions = REGISTRY.filter((e) =>
      e.id !== "opencode-zen" &&
      (e.alias === "ocz" || e.uiAlias === "ocz" || e.aliases?.includes("ocz")));
    expect(collisions).toEqual([]);
  });

  it("resolves ocz/<model> to the opencode-zen provider via the routable-model checker", async () => {
    mocks.getCombos.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);

    const isRoutable = createRoutableModelIdChecker();
    await expect(isRoutable("ocz/glm-5.2")).resolves.toBe(true);
    // The registry-only fast path must not need a DB round trip.
    expect(mocks.getCombos).not.toHaveBeenCalled();
  });
});

describe("OpenCode Zen catalog additions route correctly (port #4145)", () => {
  const executor = new OpenCodeZenExecutor();
  const claudeIds = ["claude-fable-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"];
  const responsesIds = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
  const chatIds = [
    "grok-4.5", "grok-4.6", "grok-4.7",
    "glm-5.2", "glm-5.3", "glm-5.3-flash",
    "kimi-k2.7-code", "kimi-k3",
    "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
  ];

  it.each(claudeIds)("%s is in the catalog with targetFormat claude and routes to /messages", (id) => {
    const model = entry.models.find((m) => m.id === id);
    expect(model?.targetFormat).toBe("claude");
    expect(executor.buildUrl(id)).toBe("https://opencode.ai/zen/v1/messages");
  });

  it.each(responsesIds)("%s is in the catalog with targetFormat openai-responses and routes to /responses", (id) => {
    const model = entry.models.find((m) => m.id === id);
    expect(model?.targetFormat).toBe("openai-responses");
    expect(executor.buildUrl(id)).toBe("https://opencode.ai/zen/v1/responses");
  });

  it.each(chatIds)("%s is in the catalog with no targetFormat override and routes to /chat/completions", (id) => {
    const model = entry.models.find((m) => m.id === id);
    expect(model).toBeTruthy();
    expect(model.targetFormat).toBeUndefined();
    expect(executor.buildUrl(id)).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  // Deliberately deferred upstream ids: the existing executor's own routing regexes
  // would send these to the wrong endpoint (gemini-*/gpt-6-astra/muse-spark-*) or
  // they depend on free-tier fingerprint gating not yet built (the *-free ids).
  // This guards against re-adding them without also fixing the routing.
  it.each(["gemini-3-flash", "gpt-6-astra", "muse-spark-1.3", "union-alpha", "nemotron-3-ultra-free"])(
    "%s is intentionally not yet in the catalog", (id) => {
      expect(entry.models.some((m) => m.id === id)).toBe(false);
    }
  );
});
