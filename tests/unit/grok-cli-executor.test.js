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

// Grok 4.7 is the Grok Build default (https://docs.x.ai/build/overview) and
// takes the same low/medium/high/xhigh efforts as 4.6.
describe("Grok CLI 4.7 effort forwarding", () => {
  it.each(["low", "medium", "high", "xhigh"])("maps grok-4.7-%s to grok-4.7 with matching effort", (level) => {
    expect(getModelUpstreamId("grok-cli", `grok-4.7-${level}`)).toBe("grok-4.7");
    const out = new GrokCliExecutor().transformRequest(
      `grok-4.7-${level}`,
      { model: `grok-4.7-${level}`, input: [{ type: "message", role: "user", content: "hi" }] },
      true,
      { connectionId: `grok-4.7-${level}` },
    );
    expect(out.model).toBe("grok-4.7");
    expect(out.reasoning).toEqual({ effort: level, summary: "concise" });
  });
});

// xAI publishes no "none" effort for grok-4.7; reasoning cannot be disabled.
describe("Grok CLI 4.7 disable request", () => {
  it("sends low instead of none", () => {
    const out = new GrokCliExecutor().transformRequest(
      "grok-4.7-high",
      { model: "grok-4.7-high", reasoning_effort: "none", input: [{ type: "message", role: "user", content: "hi" }] },
      true,
      { connectionId: "grok-4.7-none" },
    );
    expect(out.model).toBe("grok-4.7");
    expect(out.reasoning.effort).toBe("low");
  });
});
