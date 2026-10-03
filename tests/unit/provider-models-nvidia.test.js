import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODELS,
  getModelUpstreamId,
} from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { checkModelLifecycle } from "../../open-sse/handlers/chatCore/modelLifecyclePolicy.js";

describe("NVIDIA NIM model registration", () => {

  it("routes the retired Flash alias without advertising it", () => {
    expect(getModelUpstreamId("nvidia", "deepseek-ai/deepseek-v4-flash")).toBe(
      "deepseek-ai/deepseek-v4-flash-0731",
    );
    expect(getCapabilitiesForModel("nvidia", "deepseek-ai/deepseek-v4-flash")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 65536,
    });
    expect(PROVIDER_MODELS.nvidia.map(({ id }) => id)).not.toContain(
      "deepseek-ai/deepseek-v4-flash",
    );
  });

  it("fails closed for retired NVIDIA models before native thinking can dispatch", async () => {
    const retired = [
      ["deepseek-ai/deepseek-v4-pro", "openai"],
      ["minimaxai/minimax-m2.7", null],
    ];

    for (const [model, thinkingFormat] of retired) {
      expect(getCapabilitiesForModel("nvidia", model).thinkingFormat).toBe(thinkingFormat);
      const result = checkModelLifecycle({ provider: "nvidia", canonicalModel: model });
      expect(result).toMatchObject({ success: false, status: 410 });
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "model_shutdown", message: expect.stringContaining(model) },
      });
    }
  });

});
