// Review of #2635: declared effort metadata must beat the unlisted OpenAI
// Responses fallback, and unknown levels must not put unsupported tiers on the wire.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevelsFromCapabilities } from "../../open-sse/providers/thinkingLevels.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const MODEL = "gpt-7-future";
const translate = (body, context) => translateRequest(
  FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, MODEL,
  { model: MODEL, messages: [{ role: "user", content: "hello" }], ...body },
  false, null, "openai", null, [], null, null, context,
);
// Custom capabilities reach the translator merged over the static row, the
// same shape loadCustomCapabilities builds, so thinkingLevelsUnknown is inherited.
const customCaps = (operator) => {
  const merged = { ...getCapabilitiesForModel("openai", MODEL), ...operator };
  Object.defineProperty(merged, "customKeys", { value: new Set(Object.keys(operator)), enumerable: false });
  return merged;
};
const effortFor = (effort, modelCapabilities) =>
  translate({ reasoning_effort: effort }, modelCapabilities ? { modelCapabilities } : undefined).reasoning?.effort;

describe("unlisted OpenAI Responses family effort metadata (#2635)", () => {
  it("lets declared custom thinkingEfforts override the unknown-levels fallback", () => {
    const caps = customCaps({ thinkingEfforts: ["low", "high"] });
    expect(caps.thinkingLevelsUnknown).toBe(true);
    expect(getThinkingLevelsFromCapabilities(caps, "openai", MODEL)).toEqual(["low", "high"]);
    expect(effortFor("low", caps)).toBe("low");
    expect(effortFor("max", caps)).toBe("high");
    expect(effortFor("xhigh", caps)).toBe("high");
    expect(effortFor("ultra", caps)).toBe("high");
    expect(effortFor("minimal", caps)).toBe("low");
  });

  it("clamps declared tiers by rank without accidentally disabling reasoning", () => {
    const low = customCaps({ thinkingEfforts: ["none", "low"] });
    expect(effortFor("high", low)).toBe("low");
    expect(effortFor("max", low)).toBe("low");
    const high = customCaps({ thinkingEfforts: ["medium", "xhigh"] });
    expect(effortFor("high", high)).toBe("xhigh");
  });

  it("honors declared efforts from synced metadata without operator keys", () => {
    const caps = { ...getCapabilitiesForModel("openai", MODEL), thinkingEfforts: ["medium", "xhigh"] };
    expect(effortFor("max", caps)).toBe("xhigh");
  });

  it("keeps max and folds the gateway-only ultra tier to max when levels are unknown", () => {
    expect(getThinkingLevelsFromCapabilities(getCapabilitiesForModel("openai", MODEL), "openai", MODEL)).toBeNull();
    expect(effortFor("max")).toBe("max");
    expect(effortFor("xhigh")).toBe("xhigh");
    expect(effortFor("ultra")).toBe("max");
    expect(translate({ reasoning: { effort: "ultra" } }).reasoning?.effort).toBe("max");
  });

  it("omits reasoning for none when levels are unknown instead of sending an unverified none", () => {
    const body = translate({ reasoning_effort: "none" });
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("sends none when declared, and floors it to the lowest declared tier otherwise", () => {
    expect(effortFor("none", customCaps({ thinkingEfforts: ["none", "low", "high"] }))).toBe("none");
    expect(effortFor("none", customCaps({ thinkingEfforts: ["low", "high"] }))).toBe("low");
    expect(effortFor("none", customCaps({ thinkingEfforts: ["none", "low"], thinkingCanDisable: false }))).toBe("low");
  });
});
