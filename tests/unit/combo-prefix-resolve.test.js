import { beforeEach, describe, expect, it, vi } from "vitest";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";

const mocks = vi.hoisted(() => ({
  getComboForModel: vi.fn(),
  getComboByName: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn().mockResolvedValue({ disabledFreeProviders: [] }),
}));

vi.mock("@/lib/localDb", () => ({
  getComboForModel: mocks.getComboForModel,
  getComboByName: mocks.getComboByName,
  getModelAliases: mocks.getModelAliases,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
}));

async function loadGetComboModels() {
  return (await import("../../src/sse/services/model.js")).getComboModels;
}

const members = ["openrouter/nvidia/nemotron-3-super-120b-a12b:free"];
const combos = [{ name: "lordx.1", models: members }];

describe("provider-prefixed combo lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  it("resolves full-name, prefixed, and bare saved combos in both lookup paths", async () => {
    const fullMembers = ["openrouter/meta-llama/llama-3.1-8b-instruct:free"];
    const namedCombos = [...combos, { name: "openrouter/lordx.1", models: fullMembers }];
    expect(getComboModelsFromData("openrouter/lordx.1", namedCombos)).toBe(fullMembers);
    expect(getComboModelsFromData("openrouter/lordx.1", combos)).toBe(members);
    expect(getComboModelsFromData("lordx.1", combos)).toBe(members);

    mocks.getComboForModel.mockImplementation(async (name) =>
      namedCombos.find((combo) => combo.name === name) || null,
    );
    const getComboModels = await loadGetComboModels();
    await expect(getComboModels("openrouter/lordx.1")).resolves.toBe(fullMembers);

    mocks.getComboForModel.mockImplementation(async (name) =>
      combos.find((combo) => combo.name === name) || null,
    );
    mocks.getComboByName.mockImplementation(async (name) =>
      name === "lordx.1" ? combos[0] : null,
    );
    await expect(getComboModels("openrouter/lordx.1")).resolves.toBe(members);
    await expect(getComboModels("lordx.1")).resolves.toBe(members);
  });

  it("leaves non-existent provider-prefixed names as non-combos", async () => {
    expect(getComboModelsFromData("openrouter/nonexistent", combos)).toBeNull();

    mocks.getComboForModel.mockResolvedValue(null);
    mocks.getComboByName.mockResolvedValue(null);
    const getComboModels = await loadGetComboModels();
    await expect(getComboModels("openrouter/nonexistent")).resolves.toBeNull();
  });

  it("gives a real provider/model precedence over a same-named combo", async () => {
    const collidingCombos = [{ name: "claude-sonnet-5", models: members }];
    expect(getComboModelsFromData("anthropic/claude-sonnet-5", collidingCombos)).toBeNull();

    mocks.getComboForModel.mockImplementation(async (name) =>
      name === "claude-sonnet-5" ? collidingCombos[0] : null,
    );
    const getComboModels = await loadGetComboModels();
    await expect(getComboModels("anthropic/claude-sonnet-5")).resolves.toBeNull();
    expect(mocks.getComboForModel).toHaveBeenCalledExactlyOnceWith("anthropic/claude-sonnet-5");
    expect(mocks.getComboByName).not.toHaveBeenCalled();
  });
});
