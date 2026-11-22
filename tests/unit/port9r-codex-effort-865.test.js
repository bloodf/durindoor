import { describe, expect, it } from "vitest";
import { getModelQuotaFamily, getModelUpstreamId, getProviderModels } from "../../open-sse/config/providerModels.js";

describe("Codex GPT-5.4 effort variants", () => {
  it.each(["xhigh", "high", "medium", "low"])("exposes %s and its review variant", (effort) => {
    const model = `gpt-5.4-${effort}`;
    const ids = getProviderModels("cx").map((entry) => entry.id);
    expect(ids).toContain(model);
    expect(ids).toContain(`${model}-review`);
    expect(getModelUpstreamId("cx", `${model}-review`)).toBe(model);
    expect(getModelQuotaFamily("cx", `${model}-review`)).toBe("review");
  });
});
