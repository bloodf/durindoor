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


describe("August 2026 model catalog audit", () => {


  it("does not claim fixed limits for target-dependent router aliases", () => {
    expect(getCapabilitiesForModel("cursor", "default")).toMatchObject({ contextWindow: null, maxOutput: null });
    expect(getCapabilitiesForModel("9router", "auto")).toMatchObject({ contextWindow: null, maxOutput: null });
  });

  it("keeps an all-unknown combo output ceiling unset", () => {
    expect(aggregateComboCapabilities(["kimi/kimi-k2.6", "kimi/kimi-k2.7-code"]).maxOutput).toBeUndefined();
  });
});
