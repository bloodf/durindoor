import { describe, expect, it } from "vitest";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Google Gemini API paid Standard tier, checked 2026-11-24. Change these only together
// with open-sse/providers/pricing.js, from the live pricing page.
describe("9router#5846 @ f09627e7: corrected Gemini prices", () => {
  const flash = { input: 0.75, output: 3.75, cached: 0.075, reasoning: 3.75, cache_creation: 0.75 };

  it.each(["gemini-3.8-flash", "gemini-3.6-flash"])("prices %s and its effort variants", (model) => {
    for (const suffix of ["", "-low", "-medium", "-high"]) {
      expect(getPricingForModel("gemini", `${model}${suffix}`)).toEqual(flash);
    }
  });

  it.each(["gemini-embedding-2", "gemini-embedding-2-preview"])("prices %s on text input only", (model) => {
    expect(getPricingForModel("gemini", model)).toMatchObject({ input: 0.2, output: 0 });
  });

  it("bills gemma-4-31b-it $0 on the Gemini API only", () => {
    expect(getPricingForModel("gemini", "gemma-4-31b-it")).toMatchObject({ input: 0, output: 0 });
    expect(getPricingForModel("crof", "gemma-4-31b-it")).toBeNull();
  });
});
