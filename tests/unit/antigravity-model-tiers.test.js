import { describe, expect, it } from "vitest";
import { isPaidModel } from "../../open-sse/providers/pricing.js";
import { getDefaultModel, getModelThinkingIntent, getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const WIRE_ID = "gemini-3.6-flash-tiered";
const TIERS = [["gemini-3.6-flash-high", "high"], ["gemini-3.6-flash-medium", "medium"], ["gemini-3.6-flash-low", "low"]];

describe("Antigravity Gemini 3.6 tiers", () => {
  it.each(TIERS)("maps %s to one wire model with pinned %s effort", (id, level) => {
    expect(getModelUpstreamId("ag", id)).toBe(WIRE_ID);
    expect(getModelThinkingIntent("ag", id)).toEqual({ mode: "level", level });
  });

  it("keeps the high tier as the public default while registering its wire target", () => {
    expect(getDefaultModel("ag")).toBe("gemini-3.6-flash-high");
    expect(PROVIDER_MODELS.ag.map((model) => model.id).slice(0, 4)).toEqual([
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      WIRE_ID,
    ]);
  });

  it.each(TIERS)("keeps %s visible when paid models are hidden", (id) => {
    expect(isPaidModel(`agy/${id}`)).toBe(false);
  });

  it("sends the bare tiered model with pinned thinkingLevel", () => {
    const upstream = getModelUpstreamId("ag", "gemini-3.6-flash-high");
    const translated = openaiToAntigravityRequest(upstream, {
      messages: [{ role: "user", content: "hello" }],
    }, false, {});
    applyThinking(FORMATS.ANTIGRAVITY, "gemini-3.6-flash-high", translated, "antigravity", getModelThinkingIntent("ag", "gemini-3.6-flash-high"));
    const outbound = new AntigravityExecutor().transformRequest(upstream, translated, false, {});
    expect(outbound.model).toBe(WIRE_ID);
    expect(outbound.request.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  });

  it.each(TIERS)("registers %s on every static provider surface", (id) => {
    expect(PROVIDER_MODELS.ag.some((model) => model.id === id)).toBe(true);
    expect(MITM_TOOLS.antigravity.modelAliases).toContain(id);
    expect(MITM_TOOLS.antigravity.defaultModels.some((model) => model.id === id)).toBe(true);
    expect(isValidModel("ag", id)).toBe(true);
  });
});
