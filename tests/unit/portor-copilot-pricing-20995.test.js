import { expect, it } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

it("prices the Copilot dotted Sonnet 5.5 ID at the Sonnet 5.5 rate", () => {
  for (const provider of ["github", "gh"]) {
    expect(getPricingForModel(provider, "claude-sonnet-5.5")).toEqual({
      input: 2, output: 10, cached: 0.2, reasoning: 10, cache_creation: 2.5,
    });
  }
});
