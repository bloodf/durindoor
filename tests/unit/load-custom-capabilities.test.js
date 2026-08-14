import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCustomModels: vi.fn(), getComboForModel: vi.fn() }));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(),
  getComboForModel: mocks.getComboForModel,
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnections: vi.fn(),
  getCustomModels: mocks.getCustomModels,
}));

import { loadCustomCapabilities } from "../../src/sse/services/model.js";

describe("loadCustomCapabilities", () => {
  it("resolves capabilities from the stored custom-model list", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { id: "my-model", providerAlias: "openai", capabilities: { vision: true } },
    ]);
    const caps = await loadCustomCapabilities("openai", "my-model", null);
    expect(caps).toMatchObject({ vision: true });
  });

  it("fails open (null) when the DB lookup throws", async () => {
    mocks.getCustomModels.mockRejectedValue(new Error("db down"));
    await expect(loadCustomCapabilities("openai", "my-model", null)).resolves.toBeNull();
  });
});
