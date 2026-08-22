import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel, PROVIDER_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

function normalizeArguments(value, includeArguments = true) {
  const fn = { name: "probe_tool" };
  if (includeArguments) fn.arguments = value;
  const body = {
    messages: [{
      role: "assistant",
      tool_calls: [{ id: "call_probe", type: "function", function: fn }],
    }],
  };

  ensureToolCallIds(body);
  return fn.arguments;
}

/** Regression coverage for decolua/9router#3310 tool-call argument normalization. */
describe("ensureToolCallIds function arguments", () => {
  it.each([
    ["missing", undefined, false],
    ["null", null, true],
    ["empty string", "", true],
    ["empty object", {}, true],
  ])("normalizes %s arguments to an empty JSON object string", (_label, value, include) => {
    expect(normalizeArguments(value, include)).toBe("{}");
  });

  it("serializes object arguments without losing their values", () => {
    expect(normalizeArguments({ query: "nine router" })).toBe('{"query":"nine router"}');
  });

  it("preserves an existing valid JSON string", () => {
    expect(normalizeArguments('{"query":"nine router"}')).toBe('{"query":"nine router"}');
  });
});

/** Regression coverage for decolua/9router#3310 Xiaomi Token Plan capabilities. */
describe("Xiaomi Token Plan chat capabilities", () => {
  const openAiModels = ["mimo-v2.5-pro", "mimo-v2.5"];
  const textModalities = {
    vision: false,
    audioInput: false,
    videoInput: false,
  };

  it.each(["xiaomi-tokenplan", "xmtp"])("marks V2.5 chat models text-only through %s", (provider) => {
    for (const model of openAiModels) {
      expect(getCapabilitiesForModel(provider, model), `${provider}/${model}`).toMatchObject({
        ...textModalities,
        reasoning: true,
        thinkingFormat: "deepseek",
        thinkingCanDisable: false,
        contextWindow: 1048576,
        maxOutput: 131072,
      });
    }

    expect(getCapabilitiesForModel(provider, "mimo-v2.5-pro-claude")).toMatchObject({
      ...textModalities,
      reasoning: true,
      thinkingFormat: "claude-budget",
      thinkingCanDisable: true,
      contextWindow: 200000,
      maxOutput: 64000,
    });
  });

  it("keeps each V2.5 model capability row independent", () => {
    const rows = PROVIDER_CAPABILITIES["xiaomi-tokenplan"];
    expect(new Set([rows["mimo-v2.5-pro"], rows["mimo-v2.5-pro-claude"], rows["mimo-v2.5"]]).size).toBe(3);
  });

  it("keeps Claude budget tokens on the Claude-native alias wire", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 12000 } };
    applyThinking("claude", "mimo-v2.5-pro-claude", body, "xiaomi-tokenplan", { mode: "level", level: "high" });

    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("keeps the same MiMo family multimodal under another provider", () => {
    expect(getCapabilitiesForModel("xiaomi-mimo", "mimo-v2.5-pro").vision).toBe(true);
  });
});

/** Guard the stacked decolua/9router#3055 Gemini terminal-turn behavior. */
describe("stacked Gemini turn normalization", () => {
  it("keeps the terminal model continuation added by the predecessor", () => {
    const result = openaiToGeminiRequest("gemini-test", {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    }, false);

    expect(result.contents.at(-1)).toEqual({
      role: "user",
      parts: [{ text: "Continue" }],
    });
  });
});
