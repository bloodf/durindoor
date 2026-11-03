import { describe, expect, it } from "vitest";

import { withCodexReviewModels } from "../../open-sse/providers/models/helpers.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Sourced limits: https://developers.openai.com/api/docs/models/gpt-6.1-sol and
// https://developers.openai.com/api/docs/models/gpt-6.1-terra list 1,050,000 context,
// 922,000 max input and 128,000 max output for both. The highest documented window is used on
// the OpenAI and Codex routes (Codex defaults to 500K; codex-rs max_context_window is 872000).
describe("GPT-6.1 Sol and Terra limits", () => {
  it.each(["openai", "codex", "cx"])("%s resolves the documented limits", (provider) => {
    for (const model of ["gpt-6.1-sol", "gpt-6.1-terra"]) {
      expect(getCapabilitiesForModel(provider, model), `${provider}/${model}`).toMatchObject({
        contextWindow: 1050000, maxInput: 922000, maxOutput: 128000,
      });
    }
  });

  it("lists gpt-6.1-terra for Codex and prices it", () => {
    expect(getModelsByProviderId("codex").some((m) => m.id === "gpt-6.1-terra")).toBe(true);
    expect(getPricingForModel("codex", "gpt-6.1-terra")).toMatchObject({ input: 1, output: 5 });
  });

  it("does not synthesize an unsupported gpt-6.1-terra-review", () => {
    const ids = getModelsByProviderId("codex").map((m) => m.id);
    expect(ids).not.toContain("gpt-6.1-terra-review");
    const out = withCodexReviewModels([{ id: "gpt-6.1-terra", name: "GPT 6.1 Terra" }]);
    expect(out.map((m) => m.id)).toEqual(["gpt-6.1-terra"]);
  });
});
