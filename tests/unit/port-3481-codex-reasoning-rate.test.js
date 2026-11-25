import { describe, expect, it } from "vitest";
import { calculateCostFromTokens, getPricingForModel } from "../../open-sse/providers/pricing.js";

describe("upstream #3481: OpenAI reasoning tokens bill at the output rate", () => {
  it.each(["gpt-5.1-codex-mini", "gpt-5.1-codex-mini-high", "gpt-5.1-codex-max"])(
    "%s adds no reasoning surcharge",
    (model) => {
      const pricing = getPricingForModel("openai", model);
      const usage = { prompt_tokens: 1000, completion_tokens: 500 };

      expect(pricing.reasoning).toBe(pricing.output);
      expect(calculateCostFromTokens({ ...usage, reasoning_tokens: 300 }, pricing))
        .toBeCloseTo(calculateCostFromTokens(usage, pricing), 12);
    },
  );
});
