import { expect, it } from "vitest";
import { getDispatchUpstreamModelId } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

it("routes corrected Gemini and Claude tiers", () => {
  expect(getDispatchUpstreamModelId("ag", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high");
  expect(getDispatchUpstreamModelId("ag", "gemini-4-neon(xhigh)")).toBe("gemini-4-neon-xhigh");
  expect(getDispatchUpstreamModelId("ag", "claude-opus-5-5(max)")).toBe("claude-opus-5-5-max");
  expect(getThinkingLevels("antigravity", "claude-opus-5-5")).toEqual(["low", "medium", "high", "max"]);
});
