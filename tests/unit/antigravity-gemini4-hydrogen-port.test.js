import { describe, expect, it } from "vitest";
import { getModelsByProviderId, getModelUpstreamId, getModelUpstreamThinkingIntent } from "../../open-sse/config/providerModels.js";
import { ANTIGRAVITY_QUOTA_MODELS } from "../../open-sse/services/usage/google.js";

describe("Antigravity Gemini 4 Hydrogen catalog", () => {
  it("registers low, medium, high, and default-high routing with quota polling", () => {
    const ids = getModelsByProviderId("antigravity").map(({ id }) => id);
    for (const id of ["gemini-4-hydrogen", "gemini-4-hydrogen-xhigh", "gemini-4-hydrogen-high", "gemini-4-hydrogen-medium", "gemini-4-hydrogen-low"]) {
      expect(ids).toContain(id);
      if (id !== "gemini-4-hydrogen") expect(ANTIGRAVITY_QUOTA_MODELS).toContain(id);
    }
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen")).toBe("gemini-4-hydrogen-high");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen-high")).toBe("gemini-4-hydrogen-high");
    expect(getModelUpstreamId("ag", "gemini-4-hydrogen-xhigh")).toBe("gemini-4-hydrogen-xhigh");
    expect(getModelUpstreamThinkingIntent("ag", "gemini-4-hydrogen-xhigh")).toEqual({ mode: "level", level: "xhigh" });
  });
});
