import { describe, expect, it } from "vitest";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

// Grok 4.6 effort variants are virtual catalog ids; executor must strip the
// suffix and emit Responses-native reasoning.effort (decolua/9router#3540).
describe("Grok CLI 4.6 effort forwarding", () => {
  it("catalog maps every virtual effort id to grok-4.6", () => {
    for (const level of ["low", "medium", "high", "xhigh"]) {
      expect(getModelUpstreamId("grok-cli", `grok-4.6-${level}`)).toBe("grok-4.6");
    }
  });

  it.each(["low", "medium", "high", "xhigh"])(
    "maps grok-4.6-%s to grok-4.6 with matching effort",
    (level) => {
      const executor = new GrokCliExecutor();
      const out = executor.transformRequest(
        `grok-4.6-${level}`,
        {
          model: `grok-4.6-${level}`,
          input: [{ type: "message", role: "user", content: "hi" }],
        },
        true,
        { connectionId: `grok-4.6-${level}` },
      );
      expect(out.model).toBe("grok-4.6");
      expect(out.reasoning).toEqual({ effort: level, summary: "concise" });
      expect(out.reasoning_effort).toBeUndefined();
    },
  );

  it("forwards explicit xhigh effort for the base grok-4.6 id", () => {
    const executor = new GrokCliExecutor();
    const out = executor.transformRequest(
      "grok-4.6",
      {
        model: "grok-4.6",
        input: [{ type: "message", role: "user", content: "hi" }],
        reasoning_effort: "xhigh",
      },
      true,
      { connectionId: "grok-4.6-explicit" },
    );
    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "concise" });
  });
});
