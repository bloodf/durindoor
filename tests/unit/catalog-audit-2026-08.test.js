import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
}));

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
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { buildModelsList } from "../../src/app/api/v1/models/buildModelsList.js";
import * as localDb from "@/lib/localDb";

const CLOUDFLARE_WINDOWS = [
  ["@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", 80_000],
  ["@cf/moonshotai/kimi-k2.5", 256_000],
  ["@cf/zai-org/glm-4.7-flash", 131_072],
  ["@cf/qwen/qwq-32b", 24_000],
  ["@cf/meta/llama-3.2-1b-instruct", 60_000],
  ["@cf/meta/llama-3.2-3b-instruct", 80_000],
  ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", 24_000],
];

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

  it.each(CLOUDFLARE_WINDOWS)("resolves cf/%s to %d tokens", (model, expected) => {
    const caps = getCapabilitiesForModel("cloudflare-ai", model);
    expect(caps.contextWindow).toBe(expected);
    expect(caps.maxOutput).toBeUndefined();
  });

  it("uses the observed served window for local llama3.2:1b", () => {
    expect(getCapabilitiesForModel("ollama-local", "llama3.2:1b")).toMatchObject({
      contextWindow: 4_096,
      maxOutput: undefined,
    });
  });

  it("uses Z.ai's documented GLM-4.6V output ceiling", () => {
    expect(getCapabilitiesForModel("zai", "glm-4.6v").maxOutput).toBe(32_768);
  });

  it("publishes documented Kimi Code context windows", () => {
    expect(getCapabilitiesForModel("kimi", "k3").contextWindow).toBe(1048576);
    for (const model of ["k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"]) {
      expect(getCapabilitiesForModel("kimi", model).contextWindow, model).toBe(262144);
    }
    expect(getCapabilitiesForModel("cloudflare-ai", "@cf/moonshotai/kimi-k2.6").maxOutput).toBeUndefined();
  });

  it("preserves third-party Kimi capability and thinking fallbacks", () => {
    expect(getCapabilitiesForModel("opencode-go", "kimi-k2.5")).toMatchObject({
      contextWindow: 262144,
      reasoning: true,
      thinkingFormat: "kimi",
    });
    expect(getCapabilitiesForModel("opencode-go", "kimi-k2.7-code").thinkingCanDisable).toBe(false);
    expect(getCapabilitiesForModel("novita", "moonshotai/kimi-k3").contextWindow).toBe(1048576);
    expect(getThinkingLevels("novita", "moonshotai/kimi-k3")).toEqual(["max"]);
  });

  it("preserves third-party Kimi base pricing", () => {
    expect(getPricingForModel("novita", "moonshotai/kimi-k3")).toMatchObject({ input: 3.00, output: 15.00 });
    expect(getPricingForModel("bluesminds", "kimi-k2").input).toBe(1.00);
  });

  it("does not claim fixed limits for target-dependent router aliases", () => {
    expect(getCapabilitiesForModel("cursor", "default")).toMatchObject({ contextWindow: null, maxOutput: null });
    expect(getCapabilitiesForModel("9router", "auto")).toMatchObject({ contextWindow: null, maxOutput: null });
  });

  it("keeps an all-unknown combo output ceiling unset", () => {
    expect(aggregateComboCapabilities(["kimi/kimi-k2.6", "kimi/kimi-k2.7-code"]).maxOutput).toBeUndefined();
  });
});
