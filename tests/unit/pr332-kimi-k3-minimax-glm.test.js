import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe("Kimi K3 reasoning wiring", () => {
  it("advertises only max thinking level", () => {
    expect(getThinkingLevels(null, "kimi-k3")).toEqual(["max"]);
  });

  it("does not allow disabling reasoning", () => {
    const caps = getCapabilitiesForModel(null, "kimi-k3");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
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
  it("context window capped at 512k", () => {
    const caps = getCapabilitiesForModel(null, "MiniMax-M3");
    expect(caps.contextWindow).toBe(512000);
  });

  it("minimax-m3 variant also capped at 512k", () => {
    const caps = getCapabilitiesForModel(null, "minimax-m3");
    expect(caps.contextWindow).toBe(512000);
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
