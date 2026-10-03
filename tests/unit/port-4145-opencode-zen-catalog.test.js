import { describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";

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
  });
});

