import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("upstream decolua/9router#3664 - Codex Spark suffixed model context", () => {
  it.each([
    "gpt-5.3-codex-spark",
    "gpt-5.3-codex-spark-review",
    "gpt-5.3-codex-spark-high",
    "gpt-5.3-codex-spark-xhigh",
  ])("reports the 128K window for %s", (model) => {
    for (const provider of ["codex", "cx"]) {
      expect(getCapabilitiesForModel(provider, model)).toMatchObject({
        vision: false,
        reasoning: true,
        contextWindow: 128000,
      });
    }
  });

  it("leaves the larger window on other Codex models", () => {
    expect(getCapabilitiesForModel("cx", "gpt-5.3-codex-high").contextWindow).toBe(400000);
  });
});
