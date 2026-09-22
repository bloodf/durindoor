import { describe, expect, it } from "vitest";
import { getDefaultModel, getModelUpstreamId, getProviderModels, isValidModel } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel, resolveModelLimits } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { XaiExecutor } from "../../open-sse/executors/xai.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

const MODEL_IDS = [
  "grok-4.7",
  "grok-4.6",
  "grok-4.5",
  "grok-4.3",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-multi-agent-0309",
  "grok-build-0.1",
  "grok-code-fast-1",
  "grok-imagine-image-quality",
  "grok-imagine-image-2.0",
  "grok-imagine-image",
  "grok-imagine-video-1.5",
  "grok-imagine-video",
];

describe("xAI Grok catalog", () => {
  it("exposes the current xAI lineup and keeps the renamed coding alias", () => {
    expect(getProviderModels("xai").map(({ id }) => id)).toEqual(MODEL_IDS);
    expect(getModelUpstreamId("xai", "grok-code-fast-1")).toBe("grok-build-0.1");
  });

  it("selects Grok 4.7 with its published context window", () => {
    expect(isValidModel("xai", "grok-4.7")).toBe(true);
    expect(getDefaultModel("xai")).toBe("grok-4.7");
    expect(getCapabilitiesForModel("xai", "grok-4.7").contextWindow).toBe(500000);
  });

  it.each([
    ["grok-4.7", 500000, false],
    ["grok-4.6", 500000, false],
    ["grok-4.5", 500000, false],
    ["grok-4.3", 1000000, true],
    ["grok-4.20-0309-reasoning", 1000000, false],
    ["grok-4.20-multi-agent-0309", 1000000, false],
  ])("resolves %s context and thinking-disable support", (model, contextWindow, thinkingCanDisable) => {
    const caps = getCapabilitiesForModel("xai", model);
    expect(caps.contextWindow).toBe(contextWindow);
    expect(caps.thinkingCanDisable).toBe(thinkingCanDisable);
    expect(caps).toMatchObject({
      vision: true,
      tools: true,
      search: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("uses the published Grok Build context window", () => {
    expect(getCapabilitiesForModel("xai", "grok-build-0.1").contextWindow).toBe(262144);
  });

  it("keeps unlisted Grok 4 aliases at the current family's conservative floor", () => {
    const published = getCapabilitiesForModel("xai", "grok-4.6");
    const alias = getCapabilitiesForModel("xai", "grok-4.6-latest");

    expect(alias.contextWindow).toBeGreaterThanOrEqual(published.contextWindow);
    expect(alias.contextWindow).toBe(500000);
  });

  it.each([
    ["xai", "grok-4.6-latest"],
    ["xai", "grok-4.3-latest"],
    ["xai", "grok-build-latest"],
    ["grok-cli", "grok-build"],
    ["grok-cli", "grok-composer-2.5-fast"],
    ["grok-cli", "grok-composer-next"],
    ["xai", "grok-3-latest"],
  ])("does not invent an output ceiling for %s/%s", (provider, model) => {
    expect(getCapabilitiesForModel(provider, model).maxOutput).toBeUndefined();
    expect(resolveModelLimits(provider, model).maxOutput).toBeUndefined();
  });

  // docs.x.ai lists grok-build-latest as an alias of grok-4.5, not Build 0.1.
  it("uses documented public API capabilities for unlisted Build aliases", () => {
    expect(getCapabilitiesForModel("xai", "grok-build-latest")).toMatchObject({
      vision: true,
      tools: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 500000,
    });
  });

  it.each(MODEL_IDS)("does not invent an xAI output ceiling for catalog model %s", (model) => {
    expect(getCapabilitiesForModel("xai", model).maxOutput).toBeUndefined();
  });

  it("preserves provider-specific Grok output ceilings outside xAI and Grok CLI", () => {
    expect(getCapabilitiesForModel("api-airforce", "x-ai/grok-3").maxOutput).toBeGreaterThan(0);
    expect(resolveModelLimits("api-airforce", "x-ai/grok-3").maxOutput).toBe(65536);
  });

  // https://docs.x.ai/developers/models/grok-4.20-0309-non-reasoning lists "Reasoning: No".
  it("does not advertise or forward reasoning for the non-reasoning 4.20 variant", () => {
    expect(getCapabilitiesForModel("xai", "grok-4.20-0309-non-reasoning")).toMatchObject({
      vision: true,
      tools: true,
      reasoning: false,
      contextWindow: 1000000,
    });
    const out = new XaiExecutor().transformRequest("grok-4.20-0309-non-reasoning", {
      model: "grok-4.20-0309-non-reasoning",
      reasoning_effort: "high",
      reasoning: { effort: "high" },
    });
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toBeUndefined();
  });

  it("forwards xhigh reasoning effort to Grok 4.7", () => {
    const out = new XaiExecutor().transformRequest("grok-4.7", { model: "grok-4.7", reasoning_effort: "xhigh" });
    expect(out.reasoning_effort).toBe("xhigh");
  });
});

// Rates from https://docs.x.ai/developers/models (per 1M tokens, <200k tier).
// Every current text model doubles all rates once the prompt reaches 200k tokens.
describe("xAI Grok published pricing", () => {
  it.each([
    ["grok-4.7", 2, 6, 0.5],
    ["grok-4.6", 2, 6, 0.5],
    ["grok-4.5", 2, 6, 0.3],
    ["grok-4.3", 1.25, 2.5, 0.2],
    ["grok-4.20-0309-reasoning", 1.25, 2.5, 0.2],
    ["grok-4.20-0309-non-reasoning", 1.25, 2.5, 0.2],
    ["grok-4.20-multi-agent-0309", 1.25, 2.5, 0.2],
    ["grok-build-0.1", 1, 2, 0.2],
  ])("prices %s from its published rates", (model, input, output, cached) => {
    expect(getPricingForModel("xai", model)).toMatchObject({
      input,
      output,
      cached,
      longContextThreshold: 200_000,
      longContextInclusive: true,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 2,
    });
  });

  it("bills the xAI grok-code-fast-1 alias at Grok Build rates without changing other providers", () => {
    expect(getPricingForModel("xai", "grok-code-fast-1")).toMatchObject({ input: 1, output: 2, cached: 0.2 });
    expect(getPricingForModel("gb", "grok-code-fast-1").longContextThreshold).toBeUndefined();
  });
});

// Aliases and effort-suffixed ids miss the exact catalog rows; the family
// patterns must still carry the published xAI rules.
// https://docs.x.ai/developers/models/grok-4.3 (alias grok-4.3-latest, 1M)
// https://docs.x.ai/developers/models/grok-4.20-0309-non-reasoning (alias grok-4.20-non-reasoning)
// https://docs.x.ai/developers/models/grok-4.7 (efforts low/medium/high/xhigh)
describe("xAI Grok aliases and effort variants", () => {
  it("prices grok-4.3-latest with the grok-4.3 rates and long-context tier", () => {
    for (const provider of ["xai", "grok-cli", "opencode-zen"]) {
      expect(getPricingForModel(provider, "grok-4.3-latest")).toMatchObject({
        input: 1.25, output: 2.5, cached: 0.2, longContextThreshold: 200_000, longContextInclusive: true,
      });
    }
  });

  it("gives grok-4.3-latest its 1M window and non-reasoning aliases no reasoning", () => {
    expect(getCapabilitiesForModel("xai", "grok-4.3-latest").contextWindow).toBe(1000000);
    for (const id of ["grok-4.20-non-reasoning", "grok-4.20-non-reasoning-latest"]) {
      expect(getCapabilitiesForModel("xai", id)).toMatchObject({ reasoning: false, contextWindow: 1000000 });
      expect(getThinkingLevels("xai", id)).toBeNull();
    }
  });

  it.each([
    ["xai", "grok-4.7"],
    ["grok-cli", "grok-4.7"],
    ["grok-cli", "grok-4.7-high"],
    ["grok-cli", "grok-4.6-low"],
    ["gb", "grok-4.5-xhigh"],
  ])("offers only published efforts for %s/%s", (provider, model) => {
    expect(getThinkingLevels(provider, model)).toEqual(["low", "medium", "high", "xhigh"]);
  });

  it("clamps a disable request on Grok 4.7 to low instead of minimal", () => {
    const body = applyThinking("openai", "grok-4.7", { model: "grok-4.7", reasoning_effort: "none" }, "xai");
    expect(body.reasoning_effort).toBe("low");
  });

  it.each(["grok-cli", "gb"])("leaves the Grok 4 output ceiling unset on %s", (provider) => {
    expect(resolveModelLimits(provider, "grok-4.7").maxOutput).toBeUndefined();
    expect(resolveModelLimits(provider, "grok-4.7").contextWindow).toBe(500000);
  });
});

// Published aliases that point at a different model than their name suggests.
// https://docs.x.ai/developers/models/grok-4.5 (alias grok-build-latest)
// https://docs.x.ai/developers/models/grok-build-0.1 (aliases grok-code-fast, grok-code-fast-1-0825)
// https://docs.x.ai/developers/model-capabilities/text/reasoning (4.20 multi-agent efforts low..xhigh)
describe("xAI cross-model aliases", () => {
  it("treats grok-build-latest as grok-4.5", () => {
    expect(getPricingForModel("xai", "grok-build-latest")).toMatchObject({ input: 2, output: 6, cached: 0.3, longContextThreshold: 200_000 });
    expect(getCapabilitiesForModel("xai", "grok-build-latest")).toMatchObject({ reasoning: true, thinkingCanDisable: false, contextWindow: 500000 });
    expect(getThinkingLevels("xai", "grok-build-latest")).toEqual(["low", "medium", "high", "xhigh"]);
    const body = applyThinking("openai", "grok-build-latest", { model: "grok-build-latest", reasoning_effort: "none" }, "xai");
    expect(body.reasoning_effort).toBe("low");
    const out = new XaiExecutor().transformRequest("grok-build-latest", { model: "grok-build-latest", reasoning_effort: "high" });
    expect(out.reasoning_effort).toBe("high");
  });

  it.each(["grok-code-fast", "grok-code-fast-1-0825"])("bills %s at Grok Build 0.1 rates", (model) => {
    expect(getPricingForModel("xai", model)).toMatchObject({ input: 1, output: 2, cached: 0.2, longContextThreshold: 200_000 });
    expect(getCapabilitiesForModel("xai", model).contextWindow).toBe(262144);
  });

  it.each(["grok-4.20-multi-agent-0309", "grok-4.20-0309-reasoning"])("clamps a disable request on %s to low", (model) => {
    expect(getThinkingLevels("xai", model)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(applyThinking("openai", model, { model, reasoning_effort: "none" }, "xai").reasoning_effort).toBe("low");
  });

  it.each(["opencode-zen", "ocz"])("leaves the Grok 4 output ceiling unset on %s", (provider) => {
    expect(resolveModelLimits(provider, "grok-4.7").maxOutput).toBeUndefined();
  });
});
