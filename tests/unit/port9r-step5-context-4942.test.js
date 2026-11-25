import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("upstream #4942: Step 5 has a 1M context window", () => {
  it.each([
    ["oc", "step-5-preview-free"],
    ["nvidia", "stepfun-ai/step-5-preview"],
    ["openai-compatible-step", "stepfun/step-5-preview:free"],
  ])("resolves %s %s to 1M and keeps the Step thinking shape", (provider, model) => {
    expect(getCapabilitiesForModel(provider, model)).toMatchObject({
      contextWindow: 1000000,
      reasoning: true,
      thinkingFormat: "step",
    });
  });

  it("does not widen other Step lines that fall back to the family pattern", () => {
    expect(getCapabilitiesForModel("oc", "step-3.5-flash").contextWindow).toBe(128000);
  });
});
