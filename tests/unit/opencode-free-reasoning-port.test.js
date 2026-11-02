import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { openaiToAntigravityResponse } from "../../open-sse/translator/response/openai-to-antigravity.js";

const chat = (effort) => ({ messages: [{ role: "user", content: "hi" }], reasoning_effort: effort });
const effortFor = (provider, model, effort) => applyThinking("openai", model, chat(effort), provider).reasoning_effort;

describe("oc/mimo-v2.6-flash-free reasoning (upstream b8331283)", () => {
  it("lets none disable thinking and max stay reachable", () => {
    expect(effortFor("opencode", "mimo-v2.6-flash-free", "none")).toBe("none");
    expect(effortFor("opencode", "mimo-v2.6-flash-free", "max")).toBe("max");
    expect(getThinkingLevels("opencode", "mimo-v2.6-flash-free")).toEqual(["none", "low", "medium", "high", "max"]);
  });

  it("drops adaptive auto instead of sending it", () => {
    expect(effortFor("opencode", "mimo-v2.6-flash-free", "auto")).toBeUndefined();
  });

  it("keeps Xiaomi's own MiMo levels outside the opencode lane", () => {
    expect(getThinkingLevels("xiaomi-mimo", "mimo-v2.6-flash")).not.toContain("max");
  });

  it("lifts reasoning aliases into reasoning_content on the opencode stream", () => {
    const normalize = PROVIDERS.opencode.normalizeStreamChunk;
    const aliased = { choices: [{ delta: { reasoning: "think" } }] };
    expect(normalize(aliased)).toBe(true);
    expect(aliased.choices[0].delta).toEqual({ reasoning: "think", reasoning_content: "think" });

    const details = { choices: [{ delta: { reasoning_details: [{ text: "a" }, { text: "b" }] } }] };
    expect(normalize(details)).toBe(true);
    expect(details.choices[0].delta.reasoning_content).toBe("ab");

    const native = { choices: [{ delta: { reasoning_content: "x", reasoning: "y" } }] };
    expect(normalize(native)).toBe(false);
    expect(native.choices[0].delta.reasoning_content).toBe("x");
    expect(normalize({ choices: [{ delta: { content: "hi" } }] })).toBe(false);
  });

  it("emits alias-only reasoning as an Antigravity thought part", () => {
    const out = openaiToAntigravityResponse({ id: "c1", model: "m", choices: [{ index: 0, delta: { reasoning: "think" } }] }, {});
    const parts = out.response.candidates[0].content.parts;
    expect(parts).toEqual([{ thought: true, text: "think" }]);
  });
});

describe("zen deepseek-v4.1-flash-free efforts (upstream 313559f4)", () => {
  it("forwards low, high and max instead of collapsing to high", () => {
    expect(effortFor("opencode-zen", "deepseek-v4.1-flash-free", "low")).toBe("low");
    expect(effortFor("opencode-zen", "deepseek-v4.1-flash-free", "high")).toBe("high");
    expect(effortFor("opencode-zen", "deepseek-v4.1-flash-free", "max")).toBe("max");
    expect(getThinkingLevels("opencode-zen", "deepseek-v4.1-flash-free")).toEqual(["low", "high", "max"]);
  });

  it("leaves other non-native deepseek v4 hosts on the high collapse", () => {
    expect(effortFor("opencode-zen", "deepseek-v4-flash-free", "low")).toBe("high");
  });
});
