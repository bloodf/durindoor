import { describe, expect, it } from "vitest";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import providers from "../../cli/src/cli/menus/providers.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const { PROVIDER_MODELS } = providers.__test__;

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("GPT-5.6 Luna routing", () => {
  it("routes gpt-5.6-luna through OpenAI Responses", () => {
    expect(getModelTargetFormat("openai", "gpt-5.6-luna")).toBe("openai-responses");
  });
});

describe("Kimi K3 reasoning wiring", () => {
  it("advertises only max thinking level", () => {
    expect(getThinkingLevels(null, "kimi-k3")).toEqual(["max"]);
  });

  it("keeps the exact native Kimi descriptor with its configurable output ceiling", () => {
    expect(getCapabilitiesForModel("moonshot", "kimi-k3")).toMatchObject({
      contextWindow: 1048576,
      maxOutput: 1048576,
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingCanDisable: false,
    });
  });

  it("keeps unsupported Kimi K3 variants on the conservative fallback", () => {
    expect(getCapabilitiesForModel(null, "vendor/kimi-k3-preview")).toMatchObject({
      contextWindow: 262144,
      maxOutput: 64000,
      vision: false,
      videoInput: false,
    });
  });

  it("emits reasoning_effort=max even when caller asks none", () => {
    const out = apply("openai", "kimi-k3", { reasoning_effort: "none" }, "kimi");
    expect(out.reasoning_effort).toBe("max");
    expect(out.thinking).toBeUndefined();
  });

  it("emits reasoning_effort=max for low/auto requests", () => {
    const low = apply("openai", "kimi-k3", { reasoning_effort: "low" }, "kimi");
    const auto = apply("openai", "kimi-k3", { reasoning_effort: "auto" }, "kimi");
    expect(low.reasoning_effort).toBe("max");
    expect(auto.reasoning_effort).toBe("max");
  });
});

describe("MiniMax M3 capabilities", () => {
  it.each([
    ["minimax", "MiniMax-M3"],
    ["minimax-cn", "MiniMax-M3"],
  ])("%s/%s exposes the native-API descriptor", (provider, model) => {
    expect(getCapabilitiesForModel(provider, model)).toMatchObject({
      contextWindow: 1000000,
      maxOutput: 131072,
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "minimax",
    });
  });

  it.each([
    [null, "MiniMax-M3"],
    [null, "minimax-m3"],
    ["openrouter", "minimax-m3"],
    ["minimax", "minimax-m3"],
    ["minimax-cn", "minimax-m3"],
    [null, "vendor/minimax-m3"],
  ])("%s/%s stays at the conservative 512K fallback", (provider, model) => {
    expect(getCapabilitiesForModel(provider, model)).toMatchObject({
      contextWindow: 512000,
      maxOutput: 131072,
    });
  });

  it.each([
    ["fireworks", "accounts/fireworks/models/minimax-m3", 524287, 512000],
    ["nvidia", "minimaxai/minimax-m3", 512000, 131072],
    ["codebuddy-cn", "minimax-m3", 512000, 48000],
  ])("preserves the %s/%s host override", (provider, model, contextWindow, maxOutput) => {
    expect(getCapabilitiesForModel(provider, model)).toMatchObject({ contextWindow, maxOutput });
  });

});

describe("GLM Flash zero pricing", () => {
  it("glm-4.7-flash is free", () => {
    expect(getPricingForModel(null, "glm-4.7-flash")).toEqual({
      input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0,
    });
  });

  it("glm-4.5-flash is free", () => {
    expect(getPricingForModel(null, "glm-4.5-flash")).toEqual({
      input: 0, output: 0, cached: 0, reasoning: 0, cache_creation: 0,
    });
  });
});

describe("CLI Kimi menu", () => {
  it("does not offer deprecated kimi-latest", () => {
    const ids = PROVIDER_MODELS.kimi?.map((m) => m.id) || [];
    expect(ids).not.toContain("kimi-latest");
  });

  it("offers kimi-k3 instead of kimi-latest", () => {
    const ids = PROVIDER_MODELS.kimi?.map((m) => m.id) || [];
    expect(ids).toContain("kimi-k3");
  });
});
