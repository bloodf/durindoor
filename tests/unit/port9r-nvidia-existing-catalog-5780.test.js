import { describe, expect, it } from "vitest";
import fixture from "./fixtures/nvidia-catalog-5780.json";
import nvidia from "../../open-sse/providers/registry/nvidia.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";

describe("NVIDIA catalog reconciliation (#1072)", () => {
  it("registers the documented hosted chat IDs in the existing fallback", () => {
    const models = getProviderModels("nvidia");
    for (const id of ["stepfun-ai/step-5-preview", "minimaxai/minimax-m3.1-flash", "z-ai/glm-5.3-flash", "nvidia/nemotron-3.5-super-vl-120b-a12b", "mistralai/mistral-large-4-1t-a52b"]) {
      expect(models.filter((model) => model.id === id)).toHaveLength(1);
    }
    expect(models.some((model) => model.id === "moonshotai/kimi-k3.1-pro")).toBe(false);
    expect(models.some((model) => model.id === "meta/llama-3.3-70b-instruct")).toBe(true);
  });

  it("keeps authenticated connection discovery and parses the mixed catalog fixture", () => {
    const config = PROVIDER_MODELS_CONFIG.nvidia;
    expect(config.url).toBe("https://integrate.api.nvidia.com/v1/models");
    expect(config.authHeader).toBe("Authorization");
    expect(config.authPrefix).toBe("Bearer ");
    expect(config.parseResponse(fixture)).toEqual(fixture.data);
    expect(nvidia.modelsFetcher).toBeUndefined();
  });
});
