import { expect, it } from "vitest";
import { getDispatchUpstreamModelId } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

it("routes corrected Gemini and Claude tiers", () => {
  expect(getDispatchUpstreamModelId("ag", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high");
  expect(getDispatchUpstreamModelId("ag", "gemini-4-neon(xhigh)")).toBe("gemini-4-neon-xhigh");
  expect(getDispatchUpstreamModelId("ag", "claude-opus-5-5(max)")).toBe("claude-opus-5-5-max");
  expect(getThinkingLevels("antigravity", "claude-opus-5-5")).toEqual(["low", "medium", "high", "max"]);
});

it("keeps native Antigravity max and xhigh thinking levels on the wire", async () => {
  const { applyThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
  const { getPricingForModel } = await import("../../open-sse/providers/pricing.js");
  const { ANTIGRAVITY_QUOTA_MODELS } = await import("../../open-sse/services/usage/google.js");
  const level = (model) => {
    const body = { request: { contents: [], generationConfig: {} } };
    applyThinking("antigravity", model, body, "antigravity");
    return body.request.generationConfig.thinkingConfig.thinkingLevel;
  };
  expect(level("claude-sonnet-5-5-max(max)")).toBe("max");
  expect(level("claude-opus-5-5-max(max)")).toBe("max");
  expect(level("claude-opus-5-5-medium(medium)")).toBe("medium");
  expect(level("gemini-4-neon-xhigh(xhigh)")).toBe("xhigh");
  expect(level("gemini-4-neon-high(max)")).toBe("xhigh");
  expect(level("gemini-4-carbon-high(xhigh)")).toBe("high");
  expect(getPricingForModel("ag", "claude-sonnet-5-5-max")).toMatchObject({ input: 2, output: 10 });
  expect(getPricingForModel("ag", "claude-opus-5-5-max")).toMatchObject({ input: 4, output: 20 });
  expect(ANTIGRAVITY_QUOTA_MODELS).toEqual(expect.arrayContaining(["gemini-4-neon-xhigh", "claude-sonnet-5-5-max", "claude-opus-5-5-max"]));
});
