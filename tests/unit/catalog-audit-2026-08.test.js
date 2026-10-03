import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
}));

vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));

import {
  aggregateComboCapabilities,
  getCapabilitiesForModel,
} from "../../open-sse/providers/capabilities.js";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";
import * as localDb from "@/lib/localDb";


describe("August 2026 model catalog audit", () => {
  it("never serves maxOutput greater than or equal to contextWindow", async () => {
    const models = await buildModelsList(["llm"]);
    const offenders = models
      .filter(({ capabilities }) => Number.isFinite(capabilities?.contextWindow)
        && Number.isFinite(capabilities?.maxOutput)
        && capabilities.maxOutput >= capabilities.contextWindow)
      .map(({ id, capabilities }) => `${id}: ${capabilities.maxOutput} >= ${capabilities.contextWindow}`);
    expect(offenders).toEqual([]);
  });
  it("omits impossible dynamic maxOutput values at the served-catalog boundary", async () => {
    localDb.getCustomModels.mockResolvedValueOnce([{
      id: "impossible-output",
      providerAlias: "custom",
      capabilities: { contextWindow: 4_096, maxOutput: 4_096 },
    }]);

    const models = await buildModelsList(["llm"]);
    const model = models.find(({ id }) => id === "custom/impossible-output");

    expect(model.capabilities.contextWindow).toBe(4_096);
    expect(model.capabilities.maxOutput).toBeUndefined();
    expect(model.max_completion_tokens).toBeUndefined();
  });


  it("does not claim fixed limits for target-dependent router aliases", () => {
    expect(getCapabilitiesForModel("cursor", "default")).toMatchObject({ contextWindow: null, maxOutput: null });
    expect(getCapabilitiesForModel("9router", "auto")).toMatchObject({ contextWindow: null, maxOutput: null });
  });

  it("keeps an all-unknown combo output ceiling unset", () => {
    expect(aggregateComboCapabilities(["kimi/kimi-k2.6", "kimi/kimi-k2.7-code"]).maxOutput).toBeUndefined();
  });
});
