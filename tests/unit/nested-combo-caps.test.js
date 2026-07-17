import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomModels: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
}));

vi.mock("../../src/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
  loadCustomCapabilities: async (provider, model) =>
    provider === "myprov" && model === "custom-vision" ? { vision: true } : null,
}));

import { resolveComboCapabilitiesMap } from "../../src/sse/handlers/chat.js";

describe("nested combo capabilities propagation", () => {
  it("derives an aggregate entry for a nested combo member", async () => {
    mocks.getModelInfo.mockImplementation(async (m) =>
      m === "inner-combo" ? { provider: null, model: null } : { provider: m.split("/")[0], model: m.split("/")[1] },
    );
    mocks.getComboModels.mockImplementation(async (m) =>
      m === "inner-combo" ? ["myprov/custom-vision", "openai/gpt-4o-mini"] : null,
    );
    const map = await resolveComboCapabilitiesMap(["inner-combo", "openai/gpt-4o"]);
    expect(map.get("inner-combo")).toMatchObject({ vision: true });
  });

  it("guards combo cycles via depth limit", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: null, model: null });
    mocks.getComboModels.mockImplementation(async () => ["self-combo"]);
    const map = await resolveComboCapabilitiesMap(["self-combo"]);
    expect(map.size).toBe(0); // no crash, no infinite recursion
  });
});
