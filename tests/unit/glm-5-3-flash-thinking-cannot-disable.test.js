import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// Upstream c61ee37d: z.ai documents that GLM-5.3 and GLM-5.3-FLASH cannot have
// thinking disabled. glm-5.3-flash had no exact row and fell through to the
// *glm-5* pattern, which allows disabling.
describe("glm-5.3-flash thinking", () => {
  it("is marked as unable to disable thinking, with the 1M window", () => {
    const caps = getCapabilitiesForModel("glm", "glm-5.3-flash");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1000000);
  });

  it.each([
    { reasoning_effort: "none" },
    { thinking: { type: "disabled" } },
  ])("never emits a disable flag for %j", (seed) => {
    const body = structuredClone(seed);
    applyThinking("claude", "glm-5.3-flash", body, "glm");
    expect(body.enable_thinking).toBeUndefined();
    expect(body.thinking?.type).not.toBe("disabled");
  });
});
