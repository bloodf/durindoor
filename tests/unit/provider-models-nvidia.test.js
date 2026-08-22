import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODELS,
  getModelUpstreamId,
  getModelsByProviderId,
} from "../../open-sse/config/providerModels.js";
import { FREE_MODEL_BUDGETS } from "../../open-sse/config/freeModelCatalog.data.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { checkModelLifecycle } from "../../open-sse/handlers/chatCore/modelLifecyclePolicy.js";

describe("NVIDIA NIM model registration", () => {
  it("advertises only live NVIDIA chat-completions models", () => {
    const ids = (PROVIDER_MODELS.nvidia || []).map((m) => m.id);

    for (const id of [
      "deepseek-ai/deepseek-v4-flash-0731",
      "minimaxai/minimax-m3",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "qwen/qwen3-next-80b-a3b-instruct",
      "qwen/qwen3.5-122b-a10b",
    ]) {
      expect(ids).toContain(id);
    }

    expect(ids).not.toContain("minimaxai/minimax-m2.7");
    expect(ids).not.toContain("deepseek-ai/deepseek-v4-pro");
    expect(ids).not.toContain("deepseek-ai/deepseek-v4-flash");
    expect((PROVIDER_MODELS.deepseek || []).map((m) => m.id)).toContain("deepseek-v4-flash");
    expect(getCapabilitiesForModel("nvidia", "deepseek-ai/deepseek-v4-flash-0731")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 65536,
    });
  });

  it("keeps exact NVIDIA free-budget membership after retirement", () => {
    expect(FREE_MODEL_BUDGETS
      .filter(({ provider }) => provider === "nvidia")
      .map(({ modelId }) => modelId)).toEqual([
      "z-ai/glm-5.1",
      "google/gemma-4-31b-it",
      "mistralai/mistral-small-4-119b-2603",
      "mistralai/mistral-large-3-675b-instruct-2512",
      "mistralai/devstral-2-123b-instruct-2512",
      "qwen/qwen3.5-397b-a17b",
      "qwen/qwen3.5-122b-a10b",
      "stepfun-ai/step-3.5-flash",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "nvidia/nemotron-3-super-120b-a12b",
    ]);
  });

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

  it("keeps non-chat NVIDIA models typed as media/service models", () => {
    const models = getModelsByProviderId("nvidia");

    expect(models.find((m) => m.id === "nvidia/nv-embedqa-e5-v5")).toMatchObject({
      kind: "embedding",
    });
    expect(models.find((m) => m.id === "nvidia/parakeet-ctc-1.1b-asr")).toMatchObject({
      kind: "stt",
    });
    expect(models.find((m) => m.id === "fastpitch")).toMatchObject({
      kind: "tts",
    });
  });
});
