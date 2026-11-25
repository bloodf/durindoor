import { describe, expect, it } from "vitest";
import { getDispatchUpstreamModelId, getModelUpstreamId, getModelUpstreamThinkingIntent } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels, getThinkingLevelsFromCapabilities } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

describe("Antigravity Hydrogen effort dispatch", () => {
  it.each(["antigravity", "ag", "agy"])("preserves %s xhigh source intent and destination", (provider) => {
    const source = "gemini-4-hydrogen(xhigh)";
    expect(getDispatchUpstreamModelId(provider, source)).toBe("gemini-4-hydrogen-xhigh");
    expect(getDispatchUpstreamModelId(provider, "gemini-4-hydrogen", { reasoning_effort: "xhigh" })).toBe("gemini-4-hydrogen-xhigh");
    expect(getModelUpstreamThinkingIntent(provider, "gemini-4-hydrogen-xhigh")).toEqual({ mode: "level", level: "xhigh" });
    expect(getModelUpstreamId(provider, "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high");
    expect(getDispatchUpstreamModelId(provider, "gemini-4-carbon(xhigh)")).toBe("gemini-4-carbon-high");
    expect(getThinkingLevels(provider, "gemini-4-hydrogen")).toEqual(["low", "medium", "high", "xhigh"]);
  });
  it("writes xhigh to the executor envelope and respects explicit metadata", () => {
    const model = getDispatchUpstreamModelId("antigravity", "gemini-4-hydrogen(xhigh)");
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }], generationConfig: {} } };
    applyThinking("antigravity", model, body, "antigravity", { mode: "level", level: "xhigh" }, getCapabilitiesForModel("antigravity", model));
    const output = new AntigravityExecutor().transformRequest(model, body, true, { projectId: "test", connectionId: "test" });
    expect(output.model).toBe("gemini-4-hydrogen-xhigh");
    expect(output.request.generationConfig.thinkingConfig.thinkingLevel).toBe("XHIGH");
    expect(getThinkingLevelsFromCapabilities({ reasoning: true, thinkingEfforts: ["high"] }, "antigravity", model)).toEqual(["high"]);
    expect(getThinkingLevels("opencode-go", "deepseek-v4.1-flash")).toEqual(["low", "high", "max"]);
  });
});
