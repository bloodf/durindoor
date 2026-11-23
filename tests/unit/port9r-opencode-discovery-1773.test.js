import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("../../open-sse/utils/outboundUrlGuard.js", async (importOriginal) => ({
  ...(await importOriginal()), guardedProbeFetch: mocks.probe,
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{ provider: "openai", isActive: true, apiKey: "test" }],
  getCombos: async () => [], getCustomModels: async () => [], getModelAliases: async () => ({}),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: async () => ({}) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: async () => ({ disabledFreeProviders: [], hidePaidModels: false }) }));

import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";

describe("OpenCode keyless catalog", () => {
  beforeEach(() => { clearLiveModelLimitsCache(); mocks.probe.mockReset(); });
  it("lists live free models without exposing paid models", async () => {
    mocks.probe.mockImplementation(async (url) => url === "https://opencode.ai/zen/v1/models"
      ? { ok: true, json: async () => ({ data: [{ id: "new-model-free" }, { id: "big-pickle" }, { id: "paid-model" }] }) }
      : { ok: false });
    const ids = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(ids).toContain("oc/new-model-free");
    expect(ids).toContain("oc/big-pickle");
    expect(ids).not.toContain("oc/paid-model");
    const call = mocks.probe.mock.calls.find(([url]) => url === "https://opencode.ai/zen/v1/models");
    expect(call[1].headers.Authorization).toBeUndefined();
  });
  it("falls back to static models when the live catalog fails", async () => {
    mocks.probe.mockResolvedValue({ ok: false });
    const ids = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(ids).toContain("oc/x-preview-f-free");
  });
});
