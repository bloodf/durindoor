import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("Claude-compatible model routability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([{ name: "claude-fast" }]);
    mocks.getModelAliases.mockResolvedValue({ fast: "openai/gpt-5.5" });
    mocks.getProviderNodes.mockImplementation(async ({ type }) =>
      type === "openai-compatible" ? [{ id: "node-id", prefix: "node" }] : []);
    mocks.getCustomModels.mockResolvedValue([{ providerAlias: "custom", id: "future" }]);
  });

  it("uses registry, combo, alias, node, and custom sources from one cached snapshot", async () => {
    const isRoutable = createRoutableModelIdChecker();

    await expect(isRoutable("glm/glm-5.3[1m]")).resolves.toBe(true);
    await expect(isRoutable("kimi/k3[1m]")).resolves.toBe(true);
    await expect(isRoutable("claude-fast")).resolves.toBe(true);
    await expect(isRoutable("fast")).resolves.toBe(true);
    await expect(isRoutable("node/model")).resolves.toBe(true);
    await expect(isRoutable("custom/future")).resolves.toBe(true);
    await expect(isRoutable("missing/model")).resolves.toBe(false);

    expect(mocks.getCombos).toHaveBeenCalledOnce();
    expect(mocks.getModelAliases).toHaveBeenCalledOnce();
    expect(mocks.getProviderNodes).toHaveBeenCalledTimes(2);
    expect(mocks.getCustomModels).toHaveBeenCalledOnce();
  });
});
