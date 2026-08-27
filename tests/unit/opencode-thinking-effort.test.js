import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

// OpenCode's gateway owns the reasoning_effort enum for its stealth models;
// Ox Alpha's narrower low/high/max enum is covered separately.
describe("OpenCode thinking effort", () => {
  const gatewayIds = [
    "big-pickle",
    "muse-spark-1.2",
    "muse-spark-1.2-contributor-free",
    "mimo-v2.5-free",
  ];

  it("marks gateway-native stealth ids as reasoning with the OpenCode format", () => {
    for (const id of gatewayIds) {
      expect(getCapabilitiesForModel("opencode", id)).toMatchObject({
        reasoning: true,
        thinkingFormat: "opencode",
      });
    }
  });

  it.each([
    ["none", "none"],
    ["minimal", "low"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["max", "max"],
    ["xhigh", "max"],
    ["ultra", "max"],
  ])("maps %s to gateway reasoning_effort=%s", (input, expected) => {
    const out = applyThinking(
      FORMATS.OPENAI,
      "big-pickle",
      { reasoning_effort: input },
      "opencode",
    );
    expect(out.reasoning_effort).toBe(expected);
  });

  it("omits auto so the gateway chooses its default", () => {
    const out = applyThinking(
      FORMATS.OPENAI,
      "x-preview-f-free",
      { reasoning_effort: "auto" },
      "opencode",
    );
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("normalizes Claude intent only on the OpenAI transport", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "claude-sonnet-4-6",
      {
        messages: [{ role: "user", content: "hi" }],
        output_config: { effort: "high" },
      },
      true,
      null,
      "opencode",
    );
    expect(out.reasoning_effort).toBe("high");
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
  });

  it("exposes only the gateway-supported picker levels", () => {
    expect(getThinkingLevels("opencode", "big-pickle")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "max",
    ]);
  });
});
